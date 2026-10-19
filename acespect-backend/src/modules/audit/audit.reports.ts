/**
 * Audit reports and exports: the per-inspection audit report, activity / security / incident reports for a date range, and a CSV of any
 * filtered view. Every file states how it was made and whether the entries it draws on passed the integrity check, carries a SHA-256 of
 * the file as sent, and is itself recorded in the audit log.
 */
import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuditEvent } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { audit, verifyAudit, type VerifyResult } from '../../lib/auditTrail';
import { HOUSPECT_LOGO_DATA_URI } from '../../lib/assets/houspectLogoBase64';
import { buildWhere, inspectionTimeline, present, type Filters, type Viewer } from './audit.service';

export const REPORT_FORMAT = 'AUD-1';
export interface Built { buffer: Buffer; mime: string; fileName: string; sha256: string; rows: number }

// ───────────────────────── helpers ─────────────────────────

/** The built-in PDF font only holds Western characters: anything else becomes "?" rather than garbage. */
const safe = (v: unknown): string => String(v ?? '').replace(/→/g, '->').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, '?');
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '-');
const day = (d: Date) => d.toISOString().slice(0, 10);
const maskIp = (ip: string | null) => (!ip ? '' : ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + ':****' : ip.split('.').slice(0, 3).join('.') + '.***');
const hashOf = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function range(from?: string, to?: string): { from: Date; to: Date } {
  const t = to && !Number.isNaN(Date.parse(to)) ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to) : new Date();
  const f = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(t.getTime() - 30 * 24 * 3600 * 1000);
  return { from: f, to: t };
}

type Doc = InstanceType<typeof PDFDocument>;
function newDoc(title: string, subtitle: string, who: string): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: title, Author: 'ACE SPECT', Subject: 'Audit report', Producer: `ACE SPECT audit report format ${REPORT_FORMAT}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  try {
    const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(HOUSPECT_LOGO_DATA_URI);
    if (m) doc.image(Buffer.from(m[2]!, 'base64'), 40, 36, { height: 34 });
  } catch {
    /* the report is complete without its logo */
  }
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#1a2a4a').text(safe(title), 40, 84);
  doc.font('Helvetica').fontSize(10).fillColor('#475569').text(safe(subtitle));
  doc.text(`Prepared for: ${safe(who)}`);
  doc.moveDown(0.4).strokeColor('#cbd5e1').lineWidth(0.6).moveTo(40, doc.y).lineTo(555, doc.y).stroke().moveDown(0.8);
  doc.fillColor('#111827');
  return { doc, done };
}

function finish(doc: Doc, footer: string) {
  const r = doc.bufferedPageRange();
  for (let i = 0; i < r.count; i++) {
    doc.switchToPage(r.start + i);
    doc.font('Helvetica').fontSize(8).fillColor('#64748b');
    doc.text(safe(`${footer}  |  Format ${REPORT_FORMAT}  |  Page ${i + 1} of ${r.count}`), 40, 808, { align: 'center', width: 515, lineBreak: false });
  }
  doc.end();
}

const need = (doc: Doc, h: number) => { if (doc.y + h > 780) doc.addPage(); };
function h2(doc: Doc, text: string) { need(doc, 50); doc.x = 40; doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor('#1a2a4a').text(safe(text)).moveDown(0.25).font('Helvetica').fontSize(9).fillColor('#111827'); }
function para(doc: Doc, text: string, color = '#374151') { need(doc, 30); doc.x = 40; doc.font('Helvetica').fontSize(9).fillColor(color).text(safe(text), 40, doc.y, { width: 515 }).moveDown(0.3).fillColor('#111827'); }
function kv(doc: Doc, pairs: [string, unknown][]) {
  for (const [k, v] of pairs) {
    need(doc, 14);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    const hk = doc.heightOfString(safe(k), { width: 150 });
    doc.font('Helvetica');
    const hv = doc.heightOfString(safe(v ?? '-'), { width: 360 });
    doc.font('Helvetica-Bold').fillColor('#64748b').text(safe(k), 40, y, { width: 150 });
    doc.font('Helvetica').fillColor('#111827').text(safe(v ?? '-'), 195, y, { width: 360 });
    doc.y = y + Math.max(hk, hv, 11) + 2;
  }
  doc.x = 40;
  doc.moveDown(0.3);
}
function table(doc: Doc, cols: { title: string; width: number }[], rows: string[][], max = 4000) {
  const total = cols.reduce((a, c) => a + c.width, 0);
  const draw = (cells: string[], header = false) => {
    doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(safe(c), { width: cols[i]!.width - 6 }))) + 6;
    need(doc, h);
    const y = doc.y;
    if (header) doc.rect(40, y, total, h).fill('#eef2f7');
    let x = 40;
    cells.forEach((c, i) => { doc.fillColor(header ? '#1a2a4a' : '#111827').text(safe(c), x + 3, y + 3, { width: cols[i]!.width - 6 }); x += cols[i]!.width; });
    doc.y = y + h;
    doc.strokeColor('#e2e8f0').lineWidth(0.3).moveTo(40, doc.y).lineTo(40 + total, doc.y).stroke();
  };
  draw(cols.map((c) => c.title), true);
  rows.slice(0, max).forEach((r) => draw(r));
  doc.x = 40;
  if (rows.length > max) para(doc, `... ${rows.length - max} more not shown; use the CSV for the full list.`, '#b45309');
  doc.moveDown(0.4);
}

function integrityBlock(doc: Doc, v: VerifyResult, scope: string, extra: [string, unknown][] = []) {
  h2(doc, 'Integrity statement');
  para(doc, v.ok
    ? `The entries this report draws on were re-checked when it was produced and match the records written at the time: no entry has been changed or removed (${scope}).`
    : `WARNING: the integrity check FAILED for ${scope}. ${v.problems.length} problem(s) were found; the first: ${v.problems[0]?.detail ?? 'unknown'}. Treat this report with caution and contact the administrator.`, v.ok ? '#166534' : '#b91c1c');
  kv(doc, [
    ['Checked', iso(v.verifiedAt)],
    ['Entries recomputed', `${v.eventsChecked.toLocaleString()} in ${v.streams.toLocaleString()} chain(s)`],
    ['Latest entry fingerprint', v.headHash ?? '-'],
    ...(v.anchorsChecked ? ([['Hourly seals checked', String(v.anchorsChecked)]] as [string, unknown][]) : []),
    ...extra,
  ]);
  para(doc, 'How this works: each entry stores a fingerprint (SHA-256) of its own content and of the entry before it, so changing or removing any entry breaks every later one. The database also refuses to edit or delete audit entries. Hourly seals cover all entries in order.', '#64748b');
}

function compliancePage(doc: Doc) {
  doc.addPage();
  h2(doc, 'How this audit log relates to common requirements');
  para(doc, 'This page describes features of the system. It is not a certification, an audit opinion or legal advice.', '#64748b');
  table(doc, [{ title: 'Requirement', width: 150 }, { title: 'How the system addresses it', width: 365 }], [
    ['ISO/IEC 27001:2022 A.8.15 Logging', 'Entries record who (person, role), what (action, record, before/after values), when (server time, UTC), from where (phone app or portal, version, device, address) and the outcome. Covers sign-ins, data changes, approvals, downloads, administrator changes and refused requests. Kept for 7 years.'],
    ['A.8.16 Monitoring activities', 'The log is re-verified every night and an administrator is alerted if it does not match; failures, refusals and phone-side incidents are listed on the Audit log and Troubleshoot pages.'],
    ['A.5.28 Collection of evidence', 'Entries are hash-chained and sealed hourly; the database refuses edits and deletions; exported files carry a SHA-256 and each export is itself logged.'],
    ['A.8.17 Clock synchronisation', 'All times are the server\'s (UTC). A phone\'s own clock is recorded separately, with its difference from the server, and is never used as the authoritative time.'],
    ['A.5.15 / A.8.3 Access control', 'Administrators see everything; a reviewer sees the history of inspections assigned to them; an inspector sees their own inspections (without network details). Reading or exporting the log is logged.'],
    ['SOC 2 CC7.2 / CC7.3', 'Anomalies (failed submissions, refused requests, lockouts, incomplete deliveries) are recorded as warnings or failures and can be filtered, reported and followed through to resolution.'],
    ['SOC 2 CC6.1 (logical access)', 'Sign-in outcomes, lockouts and refused requests are logged; inspection data is only returned to people allowed to see it.'],
    ['Australian Privacy Principle 11', 'Passwords, tokens and secrets are never stored in the log; large values are truncated; IP addresses and device details can be masked in exports; entries are removed automatically after the retention period.'],
    ['OWASP Logging Cheat Sheet', 'Consistent event format; no sensitive data in the log; tamper evidence; central access and review; correlation ids tie a phone attempt to its server events.'],
  ]);
}

// ───────────────────────── CSV ─────────────────────────

const csvCell = (v: unknown) => {
  const t = v === null || v === undefined ? '' : String(v);
  const guarded = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; // a spreadsheet must not run a cell as a formula
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};

const CSV_COLUMNS = ['seq', 'time_utc', 'phone_clock_utc', 'category', 'action', 'outcome', 'severity', 'person', 'role', 'source', 'app_version', 'platform', 'device', 'ip', 'job_no', 'inspection_id', 'target_type', 'target', 'message', 'before', 'after', 'story_id', 'entry_hash'] as const;

function csvOf(events: ReturnType<typeof present>[], mask: boolean): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of events) {
    lines.push([
      e.seq, e.occurredAt, e.clientTime ?? '', e.category, e.action, e.outcome, e.severity, e.actor.name ?? '', e.actor.role ?? '', e.source, e.client.version ?? '', e.client.platform ?? '',
      mask ? '' : e.client.device ?? '', mask ? maskIp(e.ip) : e.ip ?? '', e.jobNo ?? '', e.inspectionId ?? '', e.target.type ?? '', e.target.label ?? '', e.message ?? '',
      e.before ? JSON.stringify(e.before) : '', e.after ? JSON.stringify(e.after) : '', e.correlationId ?? '', e.integrity.hash,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

async function fetchAll(viewer: Viewer, f: Filters, max: number, order: 'asc' | 'desc' = 'asc') {
  const where = await buildWhere(viewer, f);
  const out: ReturnType<typeof present>[] = [];
  let cursor: bigint | null = null;
  while (out.length < max) {
    const rows: AuditEvent[] = await prisma.auditEvent.findMany({ where: cursor === null ? where : { AND: [where, { seq: order === 'asc' ? { gt: cursor } : { lt: cursor } }] }, orderBy: { seq: order }, take: Math.min(2000, max - out.length) });
    if (rows.length === 0) break;
    out.push(...rows.map((r) => present(r, viewer)));
    cursor = rows[rows.length - 1]!.seq;
  }
  return out;
}

export async function exportCsv(viewer: Viewer, filters: Filters, mask: boolean): Promise<Built> {
  const events = await fetchAll(viewer, filters, 50_000, 'desc');
  const buffer = Buffer.from('﻿' + csvOf(events, mask), 'utf8');
  const sha256 = hashOf(buffer);
  await audit({ category: 'admin', action: 'audit.export', message: `${events.length} audit entries exported as CSV`, metadata: { rows: events.length, filters, masked: mask, sha256, bytes: buffer.length } });
  return { buffer, mime: 'text/csv; charset=utf-8', fileName: `audit-log-${day(new Date())}.csv`, sha256, rows: events.length };
}

// ───────────────────────── per-inspection report ─────────────────────────

const incident = (e: { outcome: string; severity: string }) => e.outcome !== 'success' || e.severity === 'warning' || e.severity === 'error';
const who = (e: { actor: { name: string | null; role: string | null } }) => `${e.actor.name ?? 'System'}${e.actor.role ? ` (${e.actor.role.toLowerCase()})` : ''}`;
const from = (e: ReturnType<typeof present>, mask: boolean) => [e.source === 'mobile' ? 'Phone' : e.source === 'web' ? 'Portal' : e.source === 'system' ? 'Server' : 'API', e.client.version && `v${e.client.version}`, !mask && e.client.device, !mask && e.ip].filter(Boolean).join(' ');

export async function inspectionReport(viewer: Viewer, inspectionId: string, format: 'pdf' | 'csv' | 'json', mask: boolean): Promise<Built> {
  const tl = await inspectionTimeline(viewer, inspectionId);
  const insp = tl.inspection;
  const full = insp ? await prisma.inspection.findUnique({ where: { id: inspectionId }, include: { inspector: { select: { name: true, email: true } }, reviewer: { select: { name: true, email: true } } } }) : null;
  const events = tl.events;
  const verify = await verifyAudit({ inspectionId });
  const me = await prisma.user.findUnique({ where: { id: viewer.id }, select: { name: true, email: true } });
  const generatedBy = me?.name ?? me?.email ?? viewer.id;
  const jobNo = insp?.jobNo ?? events.find((e) => e.jobNo)?.jobNo ?? inspectionId.slice(0, 8);
  let buffer: Buffer;
  let mime: string;

  if (format === 'csv') {
    buffer = Buffer.from('﻿' + csvOf(events, mask), 'utf8');
    mime = 'text/csv; charset=utf-8';
  } else if (format === 'json') {
    buffer = Buffer.from(JSON.stringify({ format: REPORT_FORMAT, generatedAt: new Date().toISOString(), generatedBy, inspection: insp, integrity: verify, events: mask ? events.map((e) => ({ ...e, ip: maskIp(e.ip), userAgent: null, requestId: null, client: { ...e.client, device: null } })) : events }, null, 2));
    mime = 'application/json';
  } else {
    const { doc, done } = newDoc('Inspection audit report', `Job ${jobNo}${full?.address ? ` - ${full.address}` : ''}`, generatedBy);
    h2(doc, 'The inspection');
    kv(doc, [
      ['Job number', jobNo], ['Address', [full?.address, full?.suburb].filter(Boolean).join(', ') || '-'], ['Client', full?.client ?? '-'], ['Type', insp ? `${insp.inspectionType}` : '-'],
      ['Current status', insp?.status ?? 'not on the server (history only)'], ['Inspector', full ? (full.inspector.name ?? full.inspector.email) : '-'], ['Reviewer', full?.reviewer ? (full.reviewer.name ?? full.reviewer.email) : '-'],
      ['Inspection id', inspectionId], ['Report produced', `${iso(new Date())} by ${generatedBy}`],
    ]);

    const first = (a: string) => events.find((e) => e.action === a);
    const count = (p: (e: ReturnType<typeof present>) => boolean) => events.filter(p).length;
    const offline = events.filter((e) => e.action === 'network.online').reduce((s, e) => s + Number((e.metadata as { offlineSeconds?: number } | null)?.offlineSeconds ?? 0), 0);
    const photos = events.filter((e) => e.action === 'photos.upload').reduce((s, e) => s + Number((e.metadata as { count?: number } | null)?.count ?? 0), 0);
    const submits = events.filter((e) => e.action === 'inspection.submit');
    h2(doc, 'Summary');
    kv(doc, [
      ['Entries on record', `${events.length} (${count((e) => e.source === 'mobile')} from the phone, ${count((e) => e.source === 'web')} from the portal)`],
      ['Started on the phone', iso(first('inspection.create')?.occurredAt)],
      ['First photo uploaded', iso(first('photos.upload')?.occurredAt)],
      ['Photos stored (as recorded)', photos ? String(photos) : '-'],
      ['Submitted', submits.length ? `${iso(submits[submits.length - 1]!.occurredAt)} (${submits.length} submission${submits.length === 1 ? '' : 's'})` : 'not recorded'],
      ['Sent for review', iso(first('inspection.finalize')?.occurredAt)],
      ['Sections approved', String(count((e) => e.action === 'section.approve') + count((e) => e.action === 'section.approve_all'))],
      ['Revisions requested', String(count((e) => e.action === 'section.request_revision'))],
      ['Reports downloaded', String(count((e) => e.action === 'report.download'))],
      ['Time the phone was offline', offline ? `${Math.round(offline / 60)} min in ${count((e) => e.action === 'network.offline')} period(s)` : 'none recorded'],
      ['Problems recorded', String(count(incident))],
    ]);

    h2(doc, 'People involved');
    const people = new Map<string, number>();
    for (const e of events) people.set(who(e), (people.get(who(e)) ?? 0) + 1);
    table(doc, [{ title: 'Person', width: 330 }, { title: 'Entries', width: 185 }], [...people.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)]));
    const devices = new Map<string, number>();
    for (const e of events) {
      if (e.source !== 'mobile') continue;
      const k = [e.client.platform, e.client.version && `app ${e.client.version}`, !mask && e.client.device].filter(Boolean).join(' / ') || 'unknown';
      devices.set(k, (devices.get(k) ?? 0) + 1);
    }
    if (devices.size) { h2(doc, 'Phones and app versions used'); table(doc, [{ title: 'Phone / app', width: 330 }, { title: 'Entries', width: 185 }], [...devices.entries()].map(([k, v]) => [k, String(v)])); }

    const problems = events.filter(incident);
    h2(doc, `Problems and incidents (${problems.length})`);
    if (problems.length === 0) para(doc, 'No failed, refused or warning entries were recorded for this inspection.');
    else table(doc, [{ title: 'Time', width: 92 }, { title: 'What', width: 140 }, { title: 'Who', width: 90 }, { title: 'Detail', width: 193 }], problems.map((e) => [iso(e.occurredAt), `${e.action}${e.outcome !== 'success' ? ` [${e.outcome}]` : ''}`, who(e), e.message ?? '']), 400);

    const approvals = events.filter((e) => /^section\.(approve|request_revision|reset_review|approve_all)$/.test(e.action));
    h2(doc, `Review decisions (${approvals.length})`);
    if (approvals.length === 0) para(doc, 'No review decisions have been recorded.');
    else table(doc, [{ title: 'Time', width: 92 }, { title: 'Decision', width: 120 }, { title: 'Reviewer', width: 110 }, { title: 'Section / note', width: 193 }], approvals.map((e) => [iso(e.occurredAt), e.action.replace('section.', '').replace(/_/g, ' '), who(e), `${e.target.label ?? ''}${(e.after as { reviewComment?: string } | null)?.reviewComment ? ` - "${(e.after as { reviewComment?: string }).reviewComment}"` : ''}`]), 400);

    h2(doc, `Complete timeline (${events.length} entries, oldest first)`);
    table(doc, [{ title: 'Time (UTC)', width: 78 }, { title: 'Event', width: 128 }, { title: 'Who', width: 92 }, { title: 'From', width: 80 }, { title: 'Result / detail', width: 137 }], events.map((e) => [iso(e.occurredAt).replace(' UTC', ''), labelOfEvent(e.action), who(e), from(e, mask), `${e.outcome === 'success' ? '' : `[${e.outcome}] `}${e.message ?? ''}`]), 1500);
    if (tl.truncated) para(doc, 'The history is longer than this report can show; use the CSV for the complete list.', '#b45309');

    integrityBlock(doc, verify, "this inspection's history", [['Entries for this inspection', String(events.length)], ['Chain', `insp:${inspectionId}`]]);
    compliancePage(doc);
    finish(doc, `ACE SPECT audit report - job ${jobNo} - produced ${iso(new Date())}`);
    buffer = await done;
    mime = 'application/pdf';
  }
  const sha256 = hashOf(buffer);
  await audit({ category: 'admin', action: 'audit.report', inspectionId, jobNo, target: { type: 'AuditReport', id: inspectionId, label: `inspection ${jobNo}` }, message: `Inspection audit report (${format.toUpperCase()}) produced`, metadata: { type: 'inspection', format, entries: events.length, integrityOk: verify.ok, masked: mask, sha256, bytes: buffer.length } });
  return { buffer, mime, fileName: `audit-${String(jobNo).replace(/[^a-z0-9.-]+/gi, '-')}.${format}`, sha256, rows: events.length };
}

function labelOfEvent(action: string): string {
  const t = action.replace(/[._]/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ───────────────────────── period reports ─────────────────────────

type Kind = 'activity' | 'security' | 'incidents';

export async function periodReport(viewer: Viewer, kind: Kind, fromQ: string | undefined, toQ: string | undefined, mask: boolean): Promise<Built> {
  if (viewer.role !== 'ADMIN') throw ApiError.forbidden('Only an administrator can produce this report');
  const { from: f, to: t } = range(fromQ, toQ);
  const me = await prisma.user.findUnique({ where: { id: viewer.id }, select: { name: true, email: true } });
  const by = me?.name ?? me?.email ?? viewer.id;
  const verify = await verifyAudit();
  const inRange = Prisma.sql`"occurredAt" >= ${f} AND "occurredAt" <= ${t}`;
  const title = kind === 'activity' ? 'Audit activity report' : kind === 'security' ? 'Security and access report' : 'Incident report';
  const { doc, done } = newDoc(title, `${day(f)} to ${day(t)}`, by);
  let rows = 0;

  if (kind === 'activity') {
    const [tot] = await prisma.$queryRaw<{ n: bigint; actors: bigint; problems: bigint }[]>(Prisma.sql`SELECT count(*) AS n, count(DISTINCT "actorId") AS actors, count(*) FILTER (WHERE outcome <> 'success' OR severity IN ('warning','error')) AS problems FROM audit_events WHERE ${inRange}`);
    rows = Number(tot?.n ?? 0);
    h2(doc, 'Overview');
    kv(doc, [['Entries', rows.toLocaleString()], ['People active', String(Number(tot?.actors ?? 0))], ['Problems (failed, refused or warning)', String(Number(tot?.problems ?? 0))], ['Period', `${iso(f)} - ${iso(t)}`]]);
    const bySource = await prisma.$queryRaw<{ source: string; category: string; n: bigint }[]>(Prisma.sql`SELECT source, category, count(*) AS n FROM audit_events WHERE ${inRange} GROUP BY 1,2 ORDER BY n DESC`);
    h2(doc, 'Where activity came from');
    table(doc, [{ title: 'Source', width: 120 }, { title: 'Category', width: 150 }, { title: 'Entries', width: 245 }], bySource.map((r) => [r.source, r.category, Number(r.n).toLocaleString()]));
    const perDay = await prisma.$queryRaw<{ d: Date; n: bigint; p: bigint }[]>(Prisma.sql`SELECT date_trunc('day', "occurredAt") AS d, count(*) AS n, count(*) FILTER (WHERE outcome <> 'success' OR severity IN ('warning','error')) AS p FROM audit_events WHERE ${inRange} GROUP BY 1 ORDER BY 1`);
    h2(doc, 'Entries per day');
    table(doc, [{ title: 'Day', width: 150 }, { title: 'Entries', width: 170 }, { title: 'Problems', width: 195 }], perDay.map((r) => [day(r.d), Number(r.n).toLocaleString(), String(Number(r.p))]), 400);
    const topActions = await prisma.$queryRaw<{ action: string; n: bigint }[]>(Prisma.sql`SELECT action, count(*) AS n FROM audit_events WHERE ${inRange} GROUP BY 1 ORDER BY n DESC LIMIT 15`);
    h2(doc, 'Most frequent events');
    table(doc, [{ title: 'Event', width: 320 }, { title: 'Entries', width: 195 }], topActions.map((r) => [r.action, Number(r.n).toLocaleString()]));
    const topActors = await prisma.$queryRaw<{ name: string | null; role: string | null; n: bigint }[]>(Prisma.sql`SELECT "actorName" AS name, "actorRole" AS role, count(*) AS n FROM audit_events WHERE ${inRange} AND "actorId" IS NOT NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 15`);
    h2(doc, 'Most active people');
    table(doc, [{ title: 'Person', width: 260 }, { title: 'Role', width: 120 }, { title: 'Entries', width: 135 }], topActors.map((r) => [r.name ?? '-', (r.role ?? '').toLowerCase(), Number(r.n).toLocaleString()]));
    const sub = await prisma.$queryRaw<{ ok: bigint; refused: bigint; photos: bigint | null; bytes: bigint | null; offline: bigint | null; periods: bigint; queued: bigint; retryFail: bigint; delivered: bigint }[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE action = 'inspection.submit') AS ok,
             count(*) FILTER (WHERE action = 'inspection.submit.refused') AS refused,
             sum(CASE WHEN action = 'photos.upload' THEN (metadata->>'count')::bigint END) AS photos,
             sum(CASE WHEN action = 'photos.upload' THEN (metadata->>'bytes')::bigint END) AS bytes,
             sum(CASE WHEN action = 'network.online' THEN (metadata->>'offlineSeconds')::bigint END) AS offline,
             count(*) FILTER (WHERE action = 'network.offline') AS periods,
             count(*) FILTER (WHERE action = 'submit.queued') AS queued,
             count(*) FILTER (WHERE action IN ('queue.retry_failed','submit.failed')) AS "retryFail",
             count(*) FILTER (WHERE action = 'queue.delivered') AS delivered
      FROM audit_events WHERE ${inRange}`);
    const s = sub[0];
    h2(doc, 'Phone to portal');
    kv(doc, [
      ['Inspections submitted', String(Number(s?.ok ?? 0))], ['Submissions refused by the server', String(Number(s?.refused ?? 0))],
      ['Submits kept on a phone to retry', String(Number(s?.queued ?? 0))], ['Failed attempts (submit or retry)', String(Number(s?.retryFail ?? 0))], ['Queued inspections delivered later', String(Number(s?.delivered ?? 0))],
      ['Photos stored', Number(s?.photos ?? 0).toLocaleString()], ['Photo data stored', `${(Number(s?.bytes ?? 0) / 1048576).toFixed(0)} MB`],
      ['Phone offline periods', `${Number(s?.periods ?? 0)} (${Math.round(Number(s?.offline ?? 0) / 60)} min in total)`],
    ]);
    const versions = await prisma.$queryRaw<{ v: string | null; platform: string | null; people: bigint; n: bigint }[]>(Prisma.sql`SELECT "appVersion" AS v, platform, count(DISTINCT "actorId") AS people, count(*) AS n FROM audit_events WHERE ${inRange} AND source = 'mobile' AND "appVersion" IS NOT NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 15`);
    if (versions.length) { h2(doc, 'App versions in use'); table(doc, [{ title: 'Version', width: 150 }, { title: 'Platform', width: 120 }, { title: 'People', width: 100 }, { title: 'Entries', width: 145 }], versions.map((r) => [r.v ?? '-', r.platform ?? '-', String(Number(r.people)), Number(r.n).toLocaleString()])); }
    const errs = await prisma.$queryRaw<{ action: string; message: string | null; n: bigint }[]>(Prisma.sql`SELECT action, left(message, 120) AS message, count(*) AS n FROM audit_events WHERE ${inRange} AND outcome <> 'success' GROUP BY 1,2 ORDER BY n DESC LIMIT 12`);
    if (errs.length) { h2(doc, 'Most common problems'); table(doc, [{ title: 'Event', width: 150 }, { title: 'Detail', width: 280 }, { title: 'Times', width: 85 }], errs.map((r) => [r.action, r.message ?? '', String(Number(r.n))])); }
  }

  if (kind === 'security') {
    const logins = await prisma.$queryRaw<{ d: Date; ok: bigint; bad: bigint; lock: bigint }[]>(Prisma.sql`SELECT date_trunc('day', "occurredAt") AS d, count(*) FILTER (WHERE action = 'security.login_ok') AS ok, count(*) FILTER (WHERE action = 'security.login_failed') AS bad, count(*) FILTER (WHERE action = 'security.lockout') AS lock FROM audit_events WHERE ${inRange} AND category = 'security' GROUP BY 1 ORDER BY 1`);
    rows = logins.length;
    h2(doc, 'Sign-ins per day');
    table(doc, [{ title: 'Day', width: 150 }, { title: 'Successful', width: 120 }, { title: 'Failed', width: 120 }, { title: 'Lockouts', width: 125 }], logins.map((r) => [day(r.d), String(Number(r.ok)), String(Number(r.bad)), String(Number(r.lock))]), 400);
    const ips = await prisma.$queryRaw<{ ip: string | null; n: bigint }[]>(Prisma.sql`SELECT ip, count(*) AS n FROM audit_events WHERE ${inRange} AND action IN ('security.login_failed','security.lockout') GROUP BY 1 ORDER BY n DESC LIMIT 10`);
    if (ips.length) { h2(doc, 'Addresses with the most failed sign-ins'); table(doc, [{ title: 'Address', width: 300 }, { title: 'Failures', width: 215 }], ips.map((r) => [mask ? maskIp(r.ip) : r.ip ?? '-', String(Number(r.n))])); }
    const refused = await prisma.auditEvent.findMany({ where: { outcome: 'denied', occurredAt: { gte: f, lte: t } }, orderBy: { occurredAt: 'desc' }, take: 200 });
    h2(doc, `Refused requests (${refused.length}${refused.length === 200 ? '+' : ''})`);
    table(doc, [{ title: 'Time', width: 92 }, { title: 'Person', width: 100 }, { title: 'What was refused', width: 323 }], refused.map((e) => [iso(e.occurredAt), `${e.actorName ?? 'not signed in'}${e.actorRole ? ` (${e.actorRole.toLowerCase()})` : ''}`, e.message ?? e.action]), 200);
    const admin = await prisma.auditEvent.findMany({ where: { category: 'admin', action: { notIn: ['audit.view', 'admin.troubleshoot.view'] }, occurredAt: { gte: f, lte: t } }, orderBy: { occurredAt: 'desc' }, take: 200 });
    h2(doc, `Administrator changes and exports (${admin.length}${admin.length === 200 ? '+' : ''})`);
    table(doc, [{ title: 'Time', width: 92 }, { title: 'Administrator', width: 110 }, { title: 'Change', width: 313 }], admin.map((e) => [iso(e.occurredAt), e.actorName ?? '-', `${e.action}${e.message ? ` - ${e.message}` : ''}`]), 200);
    const downloads = await prisma.auditEvent.findMany({ where: { action: { in: ['report.download', 'photos.download'] }, occurredAt: { gte: f, lte: t } }, orderBy: { occurredAt: 'desc' }, take: 200 });
    h2(doc, `Report and photo downloads (${downloads.length}${downloads.length === 200 ? '+' : ''})`);
    table(doc, [{ title: 'Time', width: 92 }, { title: 'Person', width: 110 }, { title: 'Job', width: 80 }, { title: 'What', width: 233 }], downloads.map((e) => [iso(e.occurredAt), e.actorName ?? 'public link', e.jobNo ?? '-', e.message ?? e.action]), 200);
    const views = await prisma.$queryRaw<{ name: string | null; n: bigint }[]>(Prisma.sql`SELECT "actorName" AS name, count(*) AS n FROM audit_events WHERE ${inRange} AND action IN ('audit.view','audit.timeline.view','audit.verify','audit.export','audit.report') GROUP BY 1 ORDER BY n DESC LIMIT 15`);
    if (views.length) { h2(doc, 'Who has looked at the audit log'); table(doc, [{ title: 'Person', width: 300 }, { title: 'Times', width: 215 }], views.map((r) => [r.name ?? '-', String(Number(r.n))])); }
  }

  if (kind === 'incidents') {
    const evs = await prisma.auditEvent.findMany({ where: { occurredAt: { gte: f, lte: t }, OR: [{ outcome: { not: 'success' } }, { severity: { in: ['warning', 'error'] } }] }, orderBy: { occurredAt: 'asc' }, take: 5000 });
    rows = evs.length;
    const groups = new Map<string, typeof evs>();
    for (const e of evs) groups.set(e.inspectionId ?? 'none', [...(groups.get(e.inspectionId ?? 'none') ?? []), e]);
    const ids = [...groups.keys()].filter((k) => k !== 'none');
    const fixes = ids.length ? await prisma.auditEvent.findMany({ where: { inspectionId: { in: ids }, outcome: 'success', action: { in: ['inspection.submit', 'queue.delivered', 'sync.recovered'] }, occurredAt: { gte: f } }, select: { inspectionId: true, occurredAt: true } }) : [];
    h2(doc, 'Overview');
    kv(doc, [['Incidents recorded', String(evs.length)], ['Inspections affected', String(ids.length)], ['Incidents not tied to an inspection', String(groups.get('none')?.length ?? 0)], ['Period', `${iso(f)} - ${iso(t)}`]]);
    h2(doc, 'By inspection');
    const lines: string[][] = [];
    for (const id of ids) {
      const g = groups.get(id)!;
      const lastBad = g[g.length - 1]!.occurredAt;
      const fixed = fixes.filter((x) => x.inspectionId === id && x.occurredAt > lastBad).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0];
      const kinds = [...new Set(g.map((e) => e.action))].slice(0, 4).join(', ');
      lines.push([g.find((e) => e.jobNo)?.jobNo ?? id.slice(0, 8), String(g.length), kinds, iso(g[0]!.occurredAt), iso(lastBad), fixed ? `Resolved ${iso(fixed.occurredAt)}` : 'Open']);
    }
    table(doc, [{ title: 'Job', width: 60 }, { title: 'Count', width: 36 }, { title: 'Kinds', width: 170 }, { title: 'First', width: 85 }, { title: 'Last', width: 85 }, { title: 'Status', width: 79 }], lines, 400);
    h2(doc, 'All incidents (oldest first)');
    table(doc, [{ title: 'Time', width: 88 }, { title: 'Job', width: 55 }, { title: 'Event', width: 112 }, { title: 'Who', width: 85 }, { title: 'Detail', width: 175 }], evs.map((e) => [iso(e.occurredAt).replace(' UTC', ''), e.jobNo ?? '-', `${e.action} [${e.outcome}]`, e.actorName ?? 'System', e.message ?? '']), 600);
  }

  integrityBlock(doc, verify, 'the whole audit log');
  compliancePage(doc);
  finish(doc, `ACE SPECT ${title.toLowerCase()} - ${day(f)} to ${day(t)} - produced ${iso(new Date())}`);
  const buffer = await done;
  const sha256 = hashOf(buffer);
  await audit({ category: 'admin', action: 'audit.report', target: { type: 'AuditReport', id: kind, label: title }, message: `${title} produced for ${day(f)} to ${day(t)}`, metadata: { type: kind, from: f.toISOString(), to: t.toISOString(), rows, integrityOk: verify.ok, masked: mask, sha256, bytes: buffer.length } });
  return { buffer, mime: 'application/pdf', fileName: `audit-${kind}-${day(f)}-to-${day(t)}.pdf`, sha256, rows };
}
