/**
 * Dashboards, reports and the evidence pack (REQ-RPT-*, REQ-AUD-005; E37).
 *
 * Every report is generated for the caller's own client and the projects they
 * can see, stored once (so it can be downloaded again), logged, and served only
 * through a short-lived signed link. Report format version 1.0.
 */
import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../lib/audit';
import { logSecurityEvent } from '../../lib/securityLog';
import { fetchPhotoStream, uploadDocument } from '../../lib/storage';
import { mediaIdOf, signMediaUrl } from '../../lib/mediaLinks';
import { QcContext } from './qc.context';
import { visibilityWhere } from './qc.defects.service';
import { inspectionScope } from './qc.inspections.service';
import { dlpSummary } from './qc.dlp.service';
import { listStages } from './qc.templates.service';

export const REPORT_FORMAT_VERSION = '1.0';
const asJson = (v: unknown) => v as Prisma.InputJsonValue;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const fmt = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short', year: 'numeric' }) : '');
const fmtDT = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }) : '');

// ───────────────────────── Filters ─────────────────────────

export interface ReportFilters {
  projectId?: string;
  siteId?: string;
  propertyIds?: string[];
  stageKey?: string;
  from?: string;
  to?: string;
  severity?: string;
  status?: string;
  tradeCompanyId?: string;
  dlpOnly?: boolean;
  includePhotos?: boolean;
}

export function filtersFrom(q: Record<string, unknown>): ReportFilters {
  const list = (v: unknown) => (typeof v === 'string' && v ? v.split(',') : undefined);
  return {
    projectId: str(q.projectId) || undefined, siteId: str(q.siteId) || undefined, propertyIds: list(q.propertyIds), stageKey: str(q.stageKey) || undefined, from: str(q.from) || undefined, to: str(q.to) || undefined,
    severity: str(q.severity) || undefined, status: str(q.status) || undefined, tradeCompanyId: str(q.tradeCompanyId) || undefined, dlpOnly: q.dlpOnly === 'true' || q.dlpOnly === true, includePhotos: q.includePhotos === 'true' || q.includePhotos === true,
  };
}

async function defectWhere(ctx: QcContext, f: ReportFilters): Promise<Prisma.QcDefectWhereInput> {
  const scope = await visibilityWhere(ctx);
  return {
    AND: [
      scope,
      {
        isDraft: false,
        property: { projectId: f.projectId, siteId: f.siteId, id: f.propertyIds ? { in: f.propertyIds } : undefined },
        severity: f.severity ? { key: f.severity } : undefined,
        status: f.status ? { key: f.status } : undefined,
        allocatedTradeCompanyId: f.tradeCompanyId,
        dlpDefect: f.dlpOnly ? true : undefined,
        foundAtStage: f.stageKey ? ((await listStages()) as unknown as Array<{ id: string; stage_name: string }>).find((s) => s.id === f.stageKey)?.stage_name : undefined,
        createdAt: { gte: f.from ? new Date(f.from) : undefined, lte: f.to ? new Date(`${f.to}T23:59:59Z`) : undefined },
      },
    ],
  };
}

const defectInclude = {
  status: true, severity: true, tradeCategory: true, allocatedTradeCompany: { select: { id: true, name: true } },
  property: { include: { site: { select: { name: true } }, project: { select: { id: true, name: true, jobNumber: true, builder: { select: { name: true } }, client: { select: { name: true, data: true } } } } } },
  assignedTo: { select: { name: true } },
} as const;

// ───────────────────────── Dashboard (REQ-RPT-001) ─────────────────────────

export async function dashboard(ctx: QcContext, f: ReportFilters) {
  const where = await defectWhere(ctx, f);
  const defects = await prisma.qcDefect.findMany({ where, include: defectInclude, take: 5000 });
  const open = defects.filter((d) => !d.status.terminal);
  const by = <T extends string>(rows: typeof defects, key: (d: (typeof defects)[number]) => T | null | undefined) => {
    const m = new Map<string, number>();
    for (const d of rows) m.set(key(d) ?? 'None', (m.get(key(d) ?? 'None') ?? 0) + 1);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  };
  const now = Date.now();
  const age = (d: { createdAt: Date }) => Math.floor((now - d.createdAt.getTime()) / 86_400_000);
  const aging = [
    { name: '0-7 days', count: open.filter((d) => age(d) <= 7).length },
    { name: '8-14 days', count: open.filter((d) => age(d) > 7 && age(d) <= 14).length },
    { name: '15-30 days', count: open.filter((d) => age(d) > 14 && age(d) <= 30).length },
    { name: 'Over 30 days', count: open.filter((d) => age(d) > 30).length },
  ];
  const monthly = new Map<string, { raised: number; closed: number }>();
  for (const d of defects) {
    const k = d.createdAt.toISOString().slice(0, 7);
    monthly.set(k, { raised: (monthly.get(k)?.raised ?? 0) + 1, closed: monthly.get(k)?.closed ?? 0 });
    if (d.closedAt) {
      const c = d.closedAt.toISOString().slice(0, 7);
      monthly.set(c, { raised: monthly.get(c)?.raised ?? 0, closed: (monthly.get(c)?.closed ?? 0) + 1 });
    }
  }
  const inspWhere = { AND: [inspectionScope(ctx), { projectId: f.projectId }] };
  const inspections = await prisma.qcInspection.groupBy({ by: ['status'], where: inspWhere, _count: true });
  const upcoming = await prisma.qcInspection.count({ where: { AND: [inspectionScope(ctx), { projectId: f.projectId, status: 'PLANNED', plannedFrom: { gte: new Date(), lte: new Date(now + 14 * 86_400_000) } }] } });
  const unplanned = await prisma.qcInspection.count({ where: { AND: [inspectionScope(ctx), { projectId: f.projectId, status: 'REQUESTED' }] } });
  return {
    generatedAt: new Date().toISOString(),
    totals: { all: defects.length, open: open.length, overdue: open.filter((d) => d.flags.includes('overdue')).length, escalated: open.filter((d) => d.flags.includes('escalated')).length, urgent: open.filter((d) => d.flags.includes('urgent')).length, closed: defects.filter((d) => d.status.key === 'closed').length, dlpOpen: open.filter((d) => d.dlpDefect).length },
    bySeverity: by(open, (d) => d.severity?.label),
    byStatus: by(defects, (d) => d.status.label),
    byTrade: by(open, (d) => d.allocatedTradeCompany?.name ?? d.tradeCategory?.name),
    byBuilder: by(open, (d) => d.property.project.builder?.name),
    byProject: by(open, (d) => d.property.project.name),
    aging,
    trend: [...monthly.entries()].sort().map(([month, v]) => ({ month, ...v })),
    inspections: { byStatus: inspections.map((i) => ({ name: i.status, count: i._count })), upcoming14Days: upcoming, awaitingPlanning: unplanned },
  };
}

// ───────────────────────── PDF helpers ─────────────────────────

type Doc = InstanceType<typeof PDFDocument>;

function newDoc(title: string, client: { name: string; data: unknown }, subtitle: string): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: title, Author: client.name, Producer: `ACE SPECT report format ${REPORT_FORMAT_VERSION}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const d = client.data as Record<string, unknown>;
  doc.fillColor('#111').font('Helvetica-Bold').fontSize(18).text(title);
  doc.font('Helvetica').fontSize(10).fillColor('#444').text(str(d.trading_name) || client.name);
  if (subtitle) doc.text(subtitle);
  doc.moveDown(0.5).strokeColor('#bbb').lineWidth(0.5).moveTo(40, doc.y).lineTo(555, doc.y).stroke().moveDown(0.6);
  doc.fillColor('#111');
  return { doc, done };
}

function finish(doc: Doc, client: { name: string; data: unknown }) {
  const footer = str((client.data as Record<string, unknown>).report_footer_text);
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font('Helvetica').fontSize(8).fillColor('#777');
    doc.text(`${footer ? `${footer}  |  ` : ''}Generated ${fmtDT(new Date())}  |  Format ${REPORT_FORMAT_VERSION}  |  Page ${i + 1} of ${range.count}`, 40, 806, { align: 'center', width: 515, lineBreak: false });
  }
  doc.end();
}

function ensureSpace(doc: Doc, h: number) {
  if (doc.y + h > 790) doc.addPage();
}

function table(doc: Doc, cols: Array<{ title: string; width: number }>, rows: string[][]) {
  const x0 = 40;
  const draw = (cells: string[], header = false) => {
    doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i]!.width - 6 }))) + 6;
    ensureSpace(doc, h);
    const y = doc.y;
    if (header) doc.rect(x0, y, cols.reduce((a, c) => a + c.width, 0), h).fill('#eef1f5').fillColor('#111');
    let x = x0;
    cells.forEach((c, i) => {
      doc.fillColor('#111').text(c, x + 3, y + 3, { width: cols[i]!.width - 6 });
      x += cols[i]!.width;
    });
    doc.y = y + h;
    doc.strokeColor('#ddd').lineWidth(0.3).moveTo(x0, doc.y).lineTo(x0 + cols.reduce((a, c) => a + c.width, 0), doc.y).stroke();
  };
  draw(cols.map((c) => c.title), true);
  for (const r of rows) draw(r);
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  const id = mediaIdOf(url);
  if (!id) return null;
  try {
    const f = await fetchPhotoStream(id);
    if (!f) return null;
    const chunks: Buffer[] = [];
    for await (const c of f.body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

async function storeReport(ctx: QcContext, args: { clientId: string; projectId?: string | null; reportType: string; format: 'PDF' | 'Excel (XLSX)' | 'ZIP evidence pack'; params: unknown; buffer: Buffer; fileName: string; mime: string }) {
  const hash = createHash('sha256').update(args.buffer).digest('hex');
  const file = await uploadDocument(args.buffer, args.mime, args.fileName.split('.').pop() ?? 'bin', 'reports', args.clientId);
  const row = await prisma.qcRecord.create({
    data: {
      kind: 'report', clientId: args.clientId, projectId: args.projectId ?? null, status: 'READY', title: args.reportType, createdById: ctx.userId,
      data: asJson({ report_type: args.reportType, format: args.format, parameters: args.params, report_format_version: REPORT_FORMAT_VERSION, generatedBy: ctx.userId, generatedAt: new Date().toISOString(), fileUrl: file.url, fileName: args.fileName, fileHash: hash, fileSize: args.buffer.length, downloads: [] }),
    },
  });
  await recordAudit({ clientId: args.clientId, entityType: 'Report', entityId: row.id, action: 'report.generate', actor: { id: ctx.userId, role: ctx.role }, supportSessionId: ctx.supportSession?.id ?? null, after: { type: args.reportType, hash } });
  return { id: row.id, fileName: args.fileName, hash, size: args.buffer.length, url: signMediaUrl(file.url) };
}

export async function listReports(ctx: QcContext, projectId?: string) {
  if (!ctx.clientId) throw new ApiError(409, 'Start support mode in a client first', 'SUPPORT_MODE_REQUIRED');
  const rows = await prisma.qcRecord.findMany({ where: { kind: 'report', clientId: ctx.clientId, projectId, ...(ctx.isSA || ctx.role === 'CLIENT_ADMIN' ? {} : { createdById: ctx.userId }) }, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map((r) => {
    const { fileUrl: _u, downloads, ...rest } = r.data as Record<string, unknown>;
    return { id: r.id, createdAt: r.createdAt, ...rest, downloadCount: Array.isArray(downloads) ? downloads.length : 0 };
  });
}

/** Issue a short-lived link for a stored report and record who asked (E37 download log). */
export async function downloadLink(ctx: QcContext, id: string) {
  const row = await prisma.qcRecord.findFirst({ where: { id, kind: 'report', clientId: ctx.clientId ?? undefined } });
  if (!row) throw ApiError.notFound('Report not found');
  if (!ctx.isSA && ctx.role !== 'CLIENT_ADMIN' && row.createdById !== ctx.userId) throw ApiError.notFound('Report not found');
  const d = row.data as Record<string, unknown>;
  const downloads = [...((d.downloads as unknown[]) ?? []), { userId: ctx.userId, at: new Date().toISOString() }];
  await prisma.qcRecord.update({ where: { id }, data: { data: asJson({ ...d, downloads }) } });
  await logSecurityEvent({ type: 'REPORT_DOWNLOAD', clientId: ctx.clientId, userId: ctx.userId, detail: { reportId: id, type: d.report_type }, ip: ctx.ip });
  return { url: signMediaUrl(str(d.fileUrl)), fileName: d.fileName, hash: d.fileHash, expiresInMinutes: 15 };
}

// ───────────────────────── Open Items Register (RPT-002) ─────────────────────────

export async function openItemsRegister(ctx: QcContext, f: ReportFilters, format: 'pdf' | 'xlsx') {
  const where = await defectWhere(ctx, f);
  const rows = await prisma.qcDefect.findMany({ where: { AND: [where, { status: { terminal: false } }] }, include: defectInclude, orderBy: [{ property: { name: 'asc' } }, { createdAt: 'asc' }], take: 5000 });
  if (rows.length === 0) throw ApiError.badRequest('There are no open items matching these filters');
  const first = rows[0]!.property.project;
  const client = first.client;
  const clientId = ctx.clientId!;
  const header = ['Ref', 'Lot', 'Title', 'Severity', 'Status', 'Trade', 'Raised', 'Due', 'Flags'];
  const data = rows.map((d) => [d.defectRef ?? '', d.property.name, d.title ?? '', d.severity?.label ?? '', d.status.label, d.allocatedTradeCompany?.name ?? d.tradeCategory?.name ?? '', fmt(d.createdAt), fmt(d.rectifyDueAt ?? d.ackDueAt), d.flags.join(', ')]);
  const subtitle = `${f.projectId ? first.name : 'All projects in scope'}  |  ${rows.length} open item${rows.length === 1 ? '' : 's'}  |  ${fmt(new Date())}`;
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Open items');
    ws.columns = header.map((h, i) => ({ header: h, width: [14, 14, 40, 14, 22, 24, 14, 14, 18][i] }));
    ws.getRow(1).font = { bold: true };
    data.forEach((r) => ws.addRow(r));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return storeReport(ctx, { clientId, projectId: f.projectId, reportType: 'Open Items Register', format: 'Excel (XLSX)', params: f, buffer: buf, fileName: `open-items-register-${new Date().toISOString().slice(0, 10)}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const { doc, done } = newDoc('Open Items Register', client, subtitle);
  table(doc, [{ title: 'Ref', width: 60 }, { title: 'Lot', width: 45 }, { title: 'Title', width: 130 }, { title: 'Severity', width: 55 }, { title: 'Status', width: 70 }, { title: 'Trade', width: 65 }, { title: 'Due', width: 50 }, { title: 'Flags', width: 40 }], data.map((r) => [r[0]!, r[1]!, r[2]!, r[3]!, r[4]!, r[5]!, r[7]!, r[8]!]));
  finish(doc, client);
  return storeReport(ctx, { clientId, projectId: f.projectId, reportType: 'Open Items Register', format: 'PDF', params: f, buffer: await done, fileName: `open-items-register-${new Date().toISOString().slice(0, 10)}.pdf`, mime: 'application/pdf' });
}

// ───────────────────────── Stage inspection report (RPT-003) ─────────────────────────

export async function stageInspectionReport(ctx: QcContext, inspectionId: string, includePhotos = true) {
  const insp = await prisma.qcInspection.findFirst({ where: { AND: [{ id: inspectionId }, inspectionScope(ctx)] }, include: { results: { orderBy: { itemNumber: 'asc' } } } });
  if (!insp) throw ApiError.notFound('Inspection not found');
  if (insp.status !== 'COMPLETED') throw ApiError.conflict('The report is produced once the inspection is completed and signed', 'NOT_COMPLETED');
  const [project, lot, inspector, cred, stages, client] = await Promise.all([
    prisma.qcProject.findUniqueOrThrow({ where: { id: insp.projectId }, include: { builder: { select: { name: true } } } }),
    insp.propertyId ? prisma.qcProperty.findUnique({ where: { id: insp.propertyId }, include: { site: { select: { name: true } } } }) : null,
    insp.inspectorId ? prisma.user.findUnique({ where: { id: insp.inspectorId }, select: { name: true, email: true } }) : null,
    insp.inspectorId ? prisma.qcInspectorCredential.findUnique({ where: { userId: insp.inspectorId } }) : null,
    listStages(),
    prisma.qcClient.findUniqueOrThrow({ where: { id: insp.clientId }, select: { name: true, data: true } }),
  ]);
  const stage = (stages as unknown as Array<{ id: string; stage_name: string }>).find((s) => s.id === insp.stageKey);
  const header = insp.headerData as Record<string, unknown>;
  const summary = insp.summaryData as Record<string, unknown>;
  const counts = (summary.counts as Record<string, number>) ?? {};
  const credData = (cred?.data as Record<string, unknown>) ?? {};

  const { doc, done } = newDoc(`${stage?.stage_name ?? 'Stage'} Inspection Report`, client, `${insp.ref}  |  ${project.name}${lot ? `  |  Lot ${lot.name}` : ''}`);
  doc.font('Helvetica').fontSize(9);
  const line = (k: string, v: string) => doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(v || '-');
  line('Project', `${project.name}${project.jobNumber ? ` (${project.jobNumber})` : ''}`);
  line('Builder', project.builder?.name ?? '');
  line('Site / Lot', `${lot?.site?.name ?? ''} ${lot ? `/ ${lot.name}` : ''}`);
  line('Inspection type', insp.type);
  line('Inspector', `${inspector?.name ?? ''}${str(credData.registration_number) ? `  (Reg. ${str(credData.registration_number)})` : ''}`);
  line('Inspected', `${fmtDT(insp.startedAt)} to ${fmtDT(insp.finishedAt)}`);
  line('Weather / access', `${str(header.weather)}${header.temperature ? `, ${header.temperature} degrees` : ''}  |  ${str(header.site_access)}${str(header.access_limitations) ? ` (${str(header.access_limitations)})` : ''}`);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(11).text('Result summary');
  doc.font('Helvetica').fontSize(9).text(Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join('   |   '));
  if (str(summary.overall_summary_notes)) doc.moveDown(0.4).font('Helvetica-Bold').text('Summary notes').font('Helvetica').text(str(summary.overall_summary_notes));
  if (str(summary.limitations_statement)) doc.moveDown(0.4).font('Helvetica-Bold').text('Limitations').font('Helvetica').text(str(summary.limitations_statement));
  doc.moveDown(0.6);

  // Items by section.
  const bySection = new Map<string, typeof insp.results>();
  for (const r of insp.results) {
    const sec = str((r.itemSnapshot as Record<string, unknown>).section) || 'General';
    bySection.set(sec, [...(bySection.get(sec) ?? []), r]);
  }
  let photoBudget = includePhotos ? 40 : 0;
  for (const [section, items] of bySection) {
    ensureSpace(doc, 60);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(section);
    doc.moveDown(0.2);
    table(doc, [{ title: 'Item', width: 38 }, { title: 'Check', width: 190 }, { title: 'Result', width: 70 }, { title: 'Notes / location', width: 217 }], items.map((r) => {
      const it = r.itemSnapshot as Record<string, unknown>;
      const meas = r.measurement as { value?: number; unit?: string } | null;
      return [r.itemNumber, str(it.check_description), r.resultCode ?? '', [r.comments, r.locationDetail ? `(${r.locationDetail})` : '', meas ? `${meas.value} ${meas.unit ?? ''}` : '', r.reason].filter(Boolean).join(' ')];
    }));
    for (const r of items.filter((x) => ['Minor Defect', 'Major Defect', 'Safety Hazard', 'Monitor / Serviceability'].includes(x.resultCode ?? ''))) {
      const photos = ((r.photoUrls as string[]) ?? []).slice(0, 3);
      if (!photos.length || photoBudget <= 0) continue;
      ensureSpace(doc, 120);
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#555').text(`Photos for item ${r.itemNumber}`);
      let x = 40;
      const y = doc.y + 2;
      for (const u of photos) {
        if (photoBudget <= 0) break;
        const buf = await fetchBuffer(u);
        if (!buf) continue;
        try { doc.image(buf, x, y, { fit: [150, 105] }); x += 160; photoBudget--; } catch { /* unreadable image */ }
      }
      doc.y = y + 112;
      doc.fillColor('#111');
    }
    doc.moveDown(0.5);
  }
  const addenda = (summary.addenda as Array<Record<string, unknown>>) ?? [];
  if (addenda.length) {
    ensureSpace(doc, 60);
    doc.font('Helvetica-Bold').fontSize(11).text('Addenda');
    for (const a of addenda) doc.font('Helvetica').fontSize(9).text(`${fmtDT(str(a.at))} (${str(a.reason)}): ${str(a.text)}`);
  }
  ensureSpace(doc, 90);
  doc.moveDown(1).font('Helvetica-Bold').fontSize(10).text('Declaration and signature');
  doc.font('Helvetica').fontSize(9).text('I inspected the items as recorded and the results are accurate.');
  doc.moveDown(0.3).text(`${inspector?.name ?? ''}  |  Signed ${fmtDT(insp.signedAt)}`);
  const sig = str(credData.signature_image);
  if (sig) {
    const buf = await fetchBuffer(sig);
    if (buf) { try { doc.image(buf, 40, doc.y + 4, { fit: [160, 50] }); } catch { /* signature unreadable */ } }
  }
  finish(doc, client);
  return storeReport(ctx, { clientId: insp.clientId, projectId: insp.projectId, reportType: 'Stage Inspection Report', format: 'PDF', params: { inspectionId, includePhotos }, buffer: await done, fileName: `${insp.ref}-report.pdf`, mime: 'application/pdf' });
}

// ───────────────────────── DLP close-out report, escalation log, portfolio ─────────────────────────

export async function dlpCloseOutReport(ctx: QcContext, projectId: string) {
  const project = await prisma.qcProject.findFirst({ where: { id: projectId, clientId: ctx.clientId ?? undefined }, include: { client: { select: { name: true, data: true } }, builder: { select: { name: true } } } });
  if (!project) throw ApiError.notFound('Project not found');
  const summary = await dlpSummary(projectId);
  const signoff = await prisma.qcRecord.findFirst({ where: { kind: 'dlp_signoff', projectId }, orderBy: { createdAt: 'desc' } });
  const defects = await prisma.qcDefect.findMany({ where: { property: { projectId }, isDraft: false, dlpDefect: true }, include: defectInclude, orderBy: { createdAt: 'asc' } });
  const { doc, done } = newDoc('DLP Close-out Report', project.client, `${project.name}  |  Builder: ${project.builder?.name ?? ''}`);
  doc.font('Helvetica').fontSize(9);
  doc.text(`DLP: ${fmt(summary.start)} to ${fmt(summary.end)}`);
  doc.text(`Defects raised during the DLP: ${summary.total}   Closed: ${summary.closed}   Accepted exceptions: ${summary.exceptions}   Still open: ${summary.nonTerminal}`);
  doc.moveDown(0.6);
  table(doc, [{ title: 'Ref', width: 70 }, { title: 'Lot', width: 50 }, { title: 'Title', width: 190 }, { title: 'Severity', width: 65 }, { title: 'Final status', width: 80 }, { title: 'Closed', width: 60 }], defects.map((d) => [d.defectRef ?? '', d.property.name, d.title ?? '', d.severity?.label ?? '', d.status.label, fmt(d.closedAt)]));
  if (summary.exceptionList.length) {
    doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10).text('Accepted exceptions');
    for (const e of summary.exceptionList) doc.font('Helvetica').fontSize(9).text(`${e.defectRef}: ${e.title ?? ''} (${e.exceptionReason ?? 'no reason recorded'})`);
  }
  if (signoff) {
    const d = signoff.data as Record<string, unknown>;
    ensureSpace(doc, 100);
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).text('Sign-off');
    doc.font('Helvetica').fontSize(9).text(`Developer: ${str(d.developer_sign_off_name_position_date)}`);
    if (d.builder_acknowledgement) doc.text(`Builder acknowledgement: ${str(d.builder_acknowledgement)}`);
    if (d.comments) doc.text(`Comments: ${str(d.comments)}`);
    doc.text('Declaration accepted: Yes');
  }
  finish(doc, project.client);
  return storeReport(ctx, { clientId: project.clientId, projectId, reportType: 'DLP Close-out Report', format: 'PDF', params: { projectId }, buffer: await done, fileName: `dlp-closeout-${project.jobNumber ?? project.id.slice(0, 6)}.pdf`, mime: 'application/pdf' });
}

export async function escalationLogReport(ctx: QcContext, f: ReportFilters, format: 'pdf' | 'xlsx') {
  const clientId = ctx.clientId;
  if (!clientId) throw new ApiError(409, 'Start support mode in a client first', 'SUPPORT_MODE_REQUIRED');
  const rows = await prisma.qcEscalation.findMany({
    where: { defect: { property: { projectId: f.projectId, project: { clientId, ...(ctx.projectIds === 'all' ? {} : { id: { in: ctx.projectIds } }) } } }, triggeredAt: { gte: f.from ? new Date(f.from) : undefined, lte: f.to ? new Date(`${f.to}T23:59:59Z`) : undefined } },
    include: { defect: { select: { defectRef: true, title: true, severity: { select: { label: true } }, status: { select: { label: true } }, property: { select: { name: true, project: { select: { name: true } } } } } } },
    orderBy: { triggeredAt: 'desc' }, take: 2000,
  });
  const client = await prisma.qcClient.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, data: true } });
  const header = ['When', 'Defect', 'Project / Lot', 'Level', 'Trigger', 'Raised by', 'Acknowledged', 'Resolved', 'Referral'];
  const data = rows.map((e) => [fmtDT(e.triggeredAt), `${e.defect.defectRef ?? ''} ${e.defect.title ?? ''}`.trim(), `${e.defect.property.project.name} / ${e.defect.property.name}`, `L${e.level}`, e.trigger, e.manual ? 'Manual' : 'Automatic', fmtDT(e.ackAt), fmtDT(e.resolvedAt), [e.referralType, e.referralRef].filter(Boolean).join(' ')]);
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Escalations');
    ws.columns = header.map((h) => ({ header: h, width: 24 }));
    ws.getRow(1).font = { bold: true };
    data.forEach((r) => ws.addRow(r));
    return storeReport(ctx, { clientId, projectId: f.projectId, reportType: 'Escalation Log', format: 'Excel (XLSX)', params: f, buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: 'escalation-log.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const { doc, done } = newDoc('Escalation Log', client, `${rows.length} escalation${rows.length === 1 ? '' : 's'}`);
  table(doc, [{ title: 'When', width: 80 }, { title: 'Defect', width: 120 }, { title: 'Project / Lot', width: 90 }, { title: 'Level', width: 30 }, { title: 'Trigger', width: 100 }, { title: 'By', width: 45 }, { title: 'Resolved', width: 50 }], data.map((r) => [r[0]!, r[1]!, r[2]!, r[3]!, r[4]!, r[5]!, r[7]!]));
  finish(doc, client);
  return storeReport(ctx, { clientId, projectId: f.projectId, reportType: 'Escalation Log', format: 'PDF', params: f, buffer: await done, fileName: 'escalation-log.pdf', mime: 'application/pdf' });
}

/** A Client Admin's portfolio view across projects (REQ-RPT-007). */
export async function portfolio(ctx: QcContext) {
  const clientId = ctx.clientId;
  if (!clientId) throw new ApiError(409, 'Start support mode in a client first', 'SUPPORT_MODE_REQUIRED');
  const projects = await prisma.qcProject.findMany({ where: { clientId }, include: { builder: { select: { name: true } }, _count: { select: { properties: true } } }, orderBy: { name: 'asc' } });
  const out = [];
  for (const p of projects) {
    const defects = await prisma.qcDefect.findMany({ where: { property: { projectId: p.id }, isDraft: false }, select: { flags: true, status: { select: { terminal: true, key: true } }, severity: { select: { key: true } }, createdAt: true, closedAt: true } });
    const open = defects.filter((d) => !d.status.terminal);
    const closed = defects.filter((d) => d.closedAt);
    const avgDays = closed.length ? Math.round(closed.reduce((a, d) => a + (d.closedAt!.getTime() - d.createdAt.getTime()) / 86_400_000, 0) / closed.length) : null;
    const insp = await prisma.qcInspection.groupBy({ by: ['status'], where: { projectId: p.id }, _count: true });
    out.push({
      projectId: p.id, name: p.name, jobNumber: p.jobNumber, status: p.status, builder: p.builder?.name ?? null, lots: p._count.properties, dlpEnd: p.dlpEndDate,
      defects: { total: defects.length, open: open.length, overdue: open.filter((d) => d.flags.includes('overdue')).length, escalated: open.filter((d) => d.flags.includes('escalated')).length, safetyOpen: open.filter((d) => d.severity?.key === 'safety_hazard').length, avgDaysToClose: avgDays },
      inspections: Object.fromEntries(insp.map((i) => [i.status, i._count])),
    });
  }
  return { generatedAt: new Date().toISOString(), projects: out };
}

export async function portfolioXlsx(ctx: QcContext) {
  const p = await portfolio(ctx);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Portfolio');
  const head = ['Project', 'Job number', 'Status', 'Builder', 'Lots', 'Open defects', 'Overdue', 'Escalated', 'Safety hazards open', 'Avg days to close', 'DLP end'];
  ws.columns = head.map((h) => ({ header: h, width: 18 }));
  ws.getRow(1).font = { bold: true };
  p.projects.forEach((r) => ws.addRow([r.name, r.jobNumber, r.status, r.builder, r.lots, r.defects.open, r.defects.overdue, r.defects.escalated, r.defects.safetyOpen, r.defects.avgDaysToClose, fmt(r.dlpEnd)]));
  return storeReport(ctx, { clientId: ctx.clientId!, reportType: 'Dashboard export', format: 'Excel (XLSX)', params: { portfolio: true }, buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: 'portfolio.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ───────────────────────── Evidence pack (REQ-AUD-005) ─────────────────────────

/** A ZIP for one defect: files, the full history, and a manifest of SHA-256 hashes. */
export async function defectEvidencePack(ctx: QcContext, defectId: string) {
  const defect = await prisma.qcDefect.findFirst({
    where: { AND: [{ id: defectId }, await visibilityWhere(ctx)] },
    include: { ...defectInclude, events: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true, email: true } } } }, comments: { orderBy: { createdAt: 'asc' } }, escalations: true },
  });
  if (!defect) throw ApiError.notFound('Defect not found');
  const clientId = ctx.clientId!;
  const zip = new JSZip();
  const manifest: Array<{ path: string; sha256: string; source: string }> = [];
  const add = (path: string, buf: Buffer, source: string) => {
    zip.file(path, buf);
    manifest.push({ path, sha256: createHash('sha256').update(buf).digest('hex'), source });
  };

  const urls = new Set<string>(((defect.photoUrls as string[]) ?? []));
  for (const e of defect.events) for (const a of (e.attachments as string[]) ?? []) urls.add(a);
  for (const c of defect.comments) for (const a of (c.attachments as string[]) ?? []) urls.add(a);
  if (defect.sourceInspectionId && defect.sourceItemNumber) {
    const res = await prisma.qcInspectionResult.findFirst({ where: { inspectionId: defect.sourceInspectionId, itemNumber: defect.sourceItemNumber } });
    for (const u of ((res?.photoUrls as string[]) ?? [])) urls.add(u);
  }
  let n = 0;
  const missing: string[] = [];
  for (const u of urls) {
    const buf = await fetchBuffer(u.split('?')[0]!);
    if (!buf) { missing.push(u); continue; }
    n++;
    add(`files/${String(n).padStart(3, '0')}-${mediaIdOf(u)?.slice(0, 8) ?? 'file'}${/^%PDF/.test(buf.subarray(0, 4).toString('latin1')) ? '.pdf' : '.jpg'}`, buf, u);
  }
  const record = {
    reference: defect.defectRef, title: defect.title, description: defect.summary, severity: defect.severity?.label, status: defect.status.label,
    lot: defect.property.name, project: defect.property.project.name, raisedAt: defect.createdAt, closedAt: defect.closedAt, dlpDefect: defect.dlpDefect,
    history: defect.events.map((e) => ({ at: e.createdAt, type: e.type, by: e.actor?.name ?? e.actor?.email, role: e.actorRole, note: e.note, changes: e.changes, hash: e.hash, previousHash: e.prevHash })),
    comments: defect.comments.map((c) => ({ at: c.createdAt, role: c.authorRole, text: c.text, visibleTo: c.visibleTo })),
    escalations: defect.escalations,
    historyChainIntact: defect.events.every((e, i) => (i === 0 ? e.prevHash === null : e.prevHash === defect.events[i - 1]!.hash)),
  };
  add('defect.json', Buffer.from(JSON.stringify(record, null, 2)), 'record');
  zip.file('manifest.json', JSON.stringify({ generatedAt: new Date().toISOString(), reportFormatVersion: REPORT_FORMAT_VERSION, defect: defect.defectRef, files: manifest, notFound: missing }, null, 2));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return storeReport(ctx, { clientId, projectId: defect.property.projectId, reportType: 'Defect evidence pack', format: 'ZIP evidence pack', params: { defectId }, buffer, fileName: `evidence-${defect.defectRef ?? defect.id.slice(0, 8)}.zip`, mime: 'application/zip' });
}
