/**
 * Reading the audit trail: who may see which entries, search and paging, per-inspection timelines, facets for the filter boxes, and
 * accepting the events a phone recorded while offline.
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { AuditEvent } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { audit, auditHealth } from '../../lib/auditTrail';
import { recordSubmissionEvent } from '../../lib/submissionLog';

export type Viewer = { id: string; role: string };

// ───────────────────────── who sees what ─────────────────────────

/**
 * Admin: everything. A reviewer: the history of the inspections assigned to them. An inspector (and the other roles that share this login):
 * the history of their own inspections. Never anything about sign-ins, admin changes or other people's inspections.
 */
export async function scopeFor(viewer: Viewer): Promise<Prisma.AuditEventWhereInput> {
  if (viewer.role === 'ADMIN') return {};
  const own =
    viewer.role === 'REVIEWER'
      ? await prisma.inspection.findMany({ where: { reviewerId: viewer.id, status: { not: 'DRAFT' } }, select: { id: true }, take: 20000 })
      : await prisma.inspection.findMany({ where: { inspectorId: viewer.id }, select: { id: true }, take: 20000 });
  return { inspectionId: { in: own.map((i) => i.id) }, category: { in: ['mobile', 'web'] } };
}

export const canSeeNetwork = (viewer: Viewer) => viewer.role === 'ADMIN';

/** What a viewer is shown of one entry: the address and browser details are for admins only. */
export function present(e: AuditEvent, viewer: Viewer) {
  const full = canSeeNetwork(viewer);
  return {
    id: e.id,
    seq: e.seq.toString(),
    occurredAt: e.occurredAt.toISOString(),
    clientTime: e.clientTime ? e.clientTime.toISOString() : null,
    clientSkewMs: e.clientSkewMs,
    category: e.category,
    action: e.action,
    outcome: e.outcome,
    severity: e.severity,
    actor: { id: e.actorId, name: e.actorName, role: e.actorRole, type: e.actorType },
    source: e.source,
    client: { app: e.appName, version: e.appVersion, updateId: e.updateId, platform: e.platform, os: e.osVersion, device: e.deviceModel },
    ip: full ? e.ip : null,
    userAgent: full ? e.userAgent : null,
    target: { type: e.targetType, id: e.targetId, label: e.targetLabel },
    inspectionId: e.inspectionId,
    jobNo: e.jobNo,
    correlationId: e.correlationId,
    requestId: full ? e.requestId : null,
    before: e.before,
    after: e.after,
    reason: e.reason,
    message: e.message,
    metadata: e.metadata,
    integrity: { stream: e.stream, prevHash: e.prevHash, hash: e.hash },
  };
}

// ───────────────────────── search ─────────────────────────

export interface Filters {
  from?: string;
  to?: string;
  category?: string;
  action?: string;
  outcome?: string;
  severity?: string;
  source?: string;
  actorId?: string;
  inspectionId?: string;
  jobNo?: string;
  appVersion?: string;
  ip?: string;
  correlationId?: string;
  q?: string;
}

const list = (v?: string) => (v ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
const day = (v: string, end: boolean): Date | null => {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00.000'}Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function buildWhere(viewer: Viewer, f: Filters): Promise<Prisma.AuditEventWhereInput> {
  const and: Prisma.AuditEventWhereInput[] = [await scopeFor(viewer)];
  const from = f.from ? day(f.from, false) : null;
  const to = f.to ? day(f.to, true) : null;
  // Without a date or an inspection to look at, a search covers the last 30 days (a free-text search over every year would scan the table).
  const defaultFrom = !from && !f.inspectionId && !f.correlationId && !f.jobNo ? new Date(Date.now() - 30 * 24 * 3600 * 1000) : null;
  if (from || defaultFrom || to) and.push({ occurredAt: { ...(from || defaultFrom ? { gte: (from ?? defaultFrom)! } : {}), ...(to ? { lte: to } : {}) } });
  const cats = list(f.category);
  if (cats.length) and.push({ category: { in: cats } });
  const actions = list(f.action);
  if (actions.length) and.push({ OR: actions.map((a) => (a.endsWith('*') ? { action: { startsWith: a.slice(0, -1) } } : { action: a })) });
  const outcomes = list(f.outcome);
  if (outcomes.length) and.push({ outcome: { in: outcomes } });
  const sev = list(f.severity);
  if (sev.length) and.push({ severity: { in: sev } });
  const src = list(f.source);
  if (src.length) and.push({ source: { in: src } });
  if (f.actorId) and.push({ actorId: f.actorId });
  if (f.inspectionId) and.push({ inspectionId: f.inspectionId });
  if (f.jobNo) and.push({ jobNo: { contains: f.jobNo, mode: 'insensitive' } });
  if (f.appVersion) and.push({ appVersion: f.appVersion });
  if (f.ip && canSeeNetwork(viewer)) and.push({ ip: { startsWith: f.ip } });
  if (f.correlationId) and.push({ correlationId: f.correlationId });
  if (f.q) {
    const q = f.q.slice(0, 80);
    and.push({ OR: [{ message: { contains: q, mode: 'insensitive' } }, { targetLabel: { contains: q, mode: 'insensitive' } }, { jobNo: { contains: q, mode: 'insensitive' } }, { actorName: { contains: q, mode: 'insensitive' } }, { action: { contains: q, mode: 'insensitive' } }] });
  }
  return { AND: and };
}

export async function searchEvents(viewer: Viewer, f: Filters, opts: { cursor?: string; limit?: number }) {
  const take = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where = await buildWhere(viewer, f);
  const cursor = opts.cursor && /^\d{1,18}$/.test(opts.cursor) ? BigInt(opts.cursor) : null;
  const rows = await prisma.auditEvent.findMany({ where: cursor ? { AND: [where, { seq: { lt: cursor } }] } : where, orderBy: { seq: 'desc' }, take: take + 1 });
  const page = rows.slice(0, take);
  return { events: page.map((r) => present(r, viewer)), nextCursor: rows.length > take ? page[page.length - 1]!.seq.toString() : null };
}

export async function getEvent(viewer: Viewer, id: string) {
  const row = await prisma.auditEvent.findFirst({ where: { AND: [await scopeFor(viewer), { id }] } });
  if (!row) throw ApiError.notFound('Audit entry not found');
  return present(row, viewer);
}

/** One inspection's complete history, oldest first (what a reviewer sees on the inspection's History tab). */
export async function inspectionTimeline(viewer: Viewer, inspectionId: string) {
  const insp = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { id: true, jobNo: true, inspectorId: true, reviewerId: true, status: true, address: true, client: true, inspectionType: true, createdAt: true, submittedAt: true } });
  const allowed = viewer.role === 'ADMIN' || (insp && (insp.inspectorId === viewer.id || insp.reviewerId === viewer.id));
  // A history may remain after the inspection itself is gone; only an admin may read one with no inspection to check against.
  if (!allowed) throw ApiError.notFound('Inspection not found');
  const rows = await prisma.auditEvent.findMany({
    where: { AND: [await scopeFor(viewer), { inspectionId }] },
    orderBy: [{ occurredAt: 'asc' }, { seq: 'asc' }],
    take: 5000,
  });
  return { inspection: insp, events: rows.map((r) => present(r, viewer)), truncated: rows.length === 5000 };
}

/** The values the filter boxes offer: what has actually been recorded recently. */
export async function facets(viewer: Viewer) {
  const since = new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const where = { AND: [await scopeFor(viewer), { occurredAt: { gte: since } }] } as Prisma.AuditEventWhereInput;
  const [cats, actions, versions, actors] = await Promise.all([
    prisma.auditEvent.groupBy({ by: ['category'], where, _count: true }),
    prisma.auditEvent.groupBy({ by: ['action'], where, _count: true, orderBy: { _count: { action: 'desc' } }, take: 200 }),
    prisma.auditEvent.groupBy({ by: ['appVersion'], where: { AND: [where, { appVersion: { not: null } }] }, _count: true }),
    prisma.auditEvent.groupBy({ by: ['actorId', 'actorName'], where: { AND: [where, { actorId: { not: null } }] }, _count: true, orderBy: { _count: { actorId: 'desc' } }, take: 100 }),
  ]);
  return {
    categories: cats.map((c) => ({ value: c.category, count: c._count })),
    actions: actions.map((a) => ({ value: a.action, count: a._count })),
    appVersions: versions.map((v) => ({ value: v.appVersion, count: v._count })),
    actors: actors.map((a) => ({ id: a.actorId, name: a.actorName, count: a._count })),
  };
}

export async function trailHealth() {
  const [total, lastEvent, lastAnchor, last24, failures] = await Promise.all([
    prisma.auditEvent.count(),
    prisma.auditEvent.findFirst({ orderBy: { seq: 'desc' }, select: { occurredAt: true } }),
    prisma.auditAnchor.findFirst({ orderBy: { seq: 'desc' }, select: { createdAt: true, upToSeq: true, eventCount: true } }),
    prisma.auditEvent.count({ where: { occurredAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
    prisma.auditEvent.count({ where: { outcome: { not: 'success' }, occurredAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
  ]);
  return {
    totalEvents: total,
    eventsLast24h: last24,
    problemsLast24h: failures,
    lastEventAt: lastEvent?.occurredAt.toISOString() ?? null,
    lastAnchor: lastAnchor ? { at: lastAnchor.createdAt.toISOString(), upToSeq: lastAnchor.upToSeq.toString(), events: lastAnchor.eventCount } : null,
    writer: auditHealth(),
    retentionDays: Number(process.env.AUDIT_RETENTION_DAYS ?? 2557),
  };
}

// ───────────────────────── events recorded by the phone ─────────────────────────

const ACTION = /^(app|photo|submit|sync|network|draft|queue|auth|section)\.[a-z0-9_.]{1,60}$/;
export const clientEventsSchema = z.object({
  sentAt: z.string().datetime(),
  device: z
    .object({
      appVersion: z.string().max(40).optional(),
      updateId: z.string().max(60).optional(),
      platform: z.string().max(40).optional(),
      osVersion: z.string().max(40).optional(),
      deviceModel: z.string().max(80).optional(),
    })
    .default({}),
  events: z
    .array(
      z.object({
        id: z.string().uuid(),
        at: z.string().datetime(),
        action: z.string().regex(ACTION),
        outcome: z.enum(['success', 'failure']).default('success'),
        severity: z.enum(['info', 'notice', 'warning', 'error']).default('info'),
        inspectionId: z.string().uuid().optional(),
        jobNo: z.string().max(60).optional(),
        correlationId: z.string().max(64).optional(),
        message: z.string().max(300).optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type ClientEvents = z.infer<typeof clientEventsSchema>;

/**
 * Stores a batch of events the phone recorded (some while it was offline). The phone's clock is not trusted: each event keeps the device time
 * as sent, and the time it is filed under is the device time corrected by how far the device's clock was from the server's at the moment of
 * sending (never later than now, never more than a week back). A phone can only add to inspections that are its own (or that the server has not
 * seen yet), and uploading the same batch twice stores nothing twice.
 */
export async function acceptClientEvents(viewer: Viewer, input: ClientEvents) {
  const now = Date.now();
  const skew = now - Date.parse(input.sentAt);
  const ids = [...new Set(input.events.map((e) => e.inspectionId).filter((x): x is string => !!x))];
  const known = ids.length ? await prisma.inspection.findMany({ where: { id: { in: ids } }, select: { id: true, inspectorId: true } }) : [];
  const owner = new Map(known.map((k) => [k.id, k.inspectorId]));
  let accepted = 0;
  let duplicates = 0;
  let foreign = 0;
  for (const e of input.events) {
    const mine = !e.inspectionId || !owner.has(e.inspectionId) || owner.get(e.inspectionId) === viewer.id;
    if (!mine) { foreign++; continue; }
    const at = Date.parse(e.at);
    const estimated = Math.min(now, Math.max(now - 7 * 24 * 3600 * 1000, at + skew));
    const ok = await audit({
      category: 'mobile',
      action: e.action,
      outcome: e.outcome,
      severity: e.severity,
      actor: { id: viewer.id, role: viewer.role },
      source: 'mobile',
      client: input.device,
      inspectionId: e.inspectionId,
      jobNo: e.jobNo,
      correlationId: e.correlationId,
      clientEventId: e.id,
      clientTime: new Date(at),
      clientSkewMs: skew,
      occurredAt: new Date(estimated),
      message: e.message,
      metadata: { ...(e.metadata ?? {}), recordedOnDevice: true, receivedAt: new Date(now).toISOString(), ...(e.inspectionId && !owner.has(e.inspectionId) ? { inspectionNotYetOnServer: true } : {}) },
    });
    if (ok) accepted++; else duplicates++;
    if (ok && e.outcome === 'failure') {
      void recordSubmissionEvent({ event: 'failed', inspectorId: viewer.id, inspectionId: e.inspectionId ?? null, jobNo: e.jobNo ?? null, message: `Phone: ${e.message ?? e.action}`.slice(0, 400), detail: { source: 'phone', action: e.action, ...(e.metadata ? { context: e.metadata } : {}) } });
    }
  }
  return { accepted, duplicates, rejected: foreign };
}
