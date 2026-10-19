/**
 * The audit trail: an append-only, tamper-evident record of who did what to which inspection (or to the system), when, from where and how it
 * ended. Everything that matters in the phone -> server -> portal flow goes through `audit()`.
 *
 *  - Rows are never changed or removed (a database trigger refuses it; see the audit_events migration).
 *  - Each row carries the hash of the previous row in its stream ("insp:<id>" or "system"), written under a per-stream lock, so changing
 *    a row breaks the chain after it.
 *  - Daily "anchors" seal the hashes of every event in order, so removing a row or a whole stream is detectable as well.
 *  - Time is the server's (UTC). A phone's own clock is stored beside it and marked untrusted.
 *  - Secrets are redacted and large values truncated before anything is stored.
 *  - Auditing never breaks the request that triggered it: a failed write is counted, logged to the console as JSON (so the hosting log
 *    keeps it) and surfaced in `auditHealth()`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

export type AuditCategory = 'mobile' | 'web' | 'admin' | 'system' | 'security' | 'qc';
export type AuditOutcome = 'success' | 'failure' | 'denied';
export type AuditSeverity = 'info' | 'notice' | 'warning' | 'error';
export type AuditSource = 'mobile' | 'web' | 'api' | 'system';

export interface AuditClient {
  appName?: string | null;
  appVersion?: string | null;
  updateId?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  deviceModel?: string | null;
}

export interface AuditInput {
  category: AuditCategory;
  action: string;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  actor?: { id?: string | null; name?: string | null; role?: string | null; type?: 'user' | 'system' | 'device' };
  source?: AuditSource;
  client?: AuditClient;
  ip?: string | null;
  userAgent?: string | null;
  target?: { type: string; id?: string | null; label?: string | null };
  inspectionId?: string | null;
  jobNo?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  clientEventId?: string | null;
  clientTime?: Date | null;
  clientSkewMs?: number | null;
  occurredAt?: Date;
  /** The request this event belongs to, for code that may run outside the request's async context (after a file upload, in the error handler). */
  req?: Request;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  message?: string | null;
  metadata?: unknown;
}

// ───────────────────────── request context ─────────────────────────

interface Store {
  req: Request;
  requestId: string;
  /** An explicit audit() call already described this request, so the catch-all must not add a second entry. */
  audited: boolean;
}
const als = new AsyncLocalStorage<Store>();

const header = (req: Request, name: string, max = 120): string | null => {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : null;
};

export function sourceOf(req: Request): AuditSource {
  const app = header(req, 'x-app-client', 20)?.toLowerCase();
  if (app === 'web') return 'web';
  if (app === 'mobile' || app === 'ios' || app === 'android') return 'mobile';
  const ua = String(req.headers['user-agent'] ?? '');
  if (/okhttp|CFNetwork|acespectmobile|Expo/i.test(ua)) return 'mobile';
  if (/Mozilla\//.test(ua)) return 'web';
  return 'api';
}

export function clientOf(req: Request): AuditClient {
  return {
    appName: header(req, 'x-app-client', 20),
    appVersion: header(req, 'x-app-version', 40),
    updateId: header(req, 'x-app-update', 60),
    platform: header(req, 'x-app-platform', 40),
    osVersion: header(req, 'x-app-os', 40),
    deviceModel: header(req, 'x-app-device', 80),
  };
}

/** Starts a request context (actor, address, app details are read from the request when an event is written). Mount early. */
export function auditContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = header(req, 'x-request-id', 64);
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const store: Store = { req, requestId, audited: false };
  (req as Request & { auditStore?: Store }).auditStore = store;
  als.run(store, () => {
    res.on('finish', () => {
      void catchAll(store, res).catch(() => undefined);
    });
    next();
  });
}

/** Restores the request context after middleware that loses it (multipart uploads): mount directly after such middleware. */
export function rebindAuditContext(req: Request, _res: Response, next: NextFunction): void {
  const store = (req as Request & { auditStore?: Store }).auditStore;
  if (store) als.run(store, next);
  else next();
}

/** Marks the current request as already audited (the catch-all then stays quiet). */
export function markAudited(): void {
  const s = als.getStore();
  if (s) s.audited = true;
}
export const currentRequest = (): Request | undefined => als.getStore()?.req;

// ───────────────────────── redaction and size limits ─────────────────────────

const SECRET_KEYS = new Set([
  'password', 'passwordhash', 'newpassword', 'currentpassword', 'mfasecret', 'mfabackupcodes', 'tokenhash', 'token', 'accesstoken', 'refreshtoken',
  'authorization', 'secret', 'apikey', 'smtp_url', 'smtpurl', 'otp', 'totp', 'idtoken', 'clientsecret',
]);
const MAX_STRING = 2000;
const MAX_ARRAY = 25;
const MAX_JSON_BYTES = 8000;

export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… [+${value.length - MAX_STRING} chars]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (depth > 6) return '[nested]';
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => sanitize(v, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `[+${value.length - MAX_ARRAY} more]`] : head;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Sanitised and, if still large, replaced by a short description of what was dropped. */
function bounded(value: unknown): unknown {
  if (value === undefined) return undefined;
  const clean = sanitize(value);
  const text = JSON.stringify(clean) ?? 'null';
  if (text.length <= MAX_JSON_BYTES) return clean;
  return { truncated: true, bytes: text.length, keys: clean && typeof clean === 'object' && !Array.isArray(clean) ? Object.keys(clean as object).slice(0, 40) : undefined };
}

/** What changed between two objects: only the keys whose values differ, each side bounded. */
export function diffFields(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, keys?: string[]): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  const names = keys ?? [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  for (const k of names) {
    const x = (before ?? {})[k];
    const y = (after ?? {})[k];
    if (y === undefined && keys === undefined) continue; // a key the update did not touch
    if (canon(x) !== canon(y)) {
      b[k] = bounded(x);
      a[k] = bounded(y);
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

// ───────────────────────── hashing ─────────────────────────

/** JSON with sorted keys and no undefined, so a hash does not depend on key order (Postgres jsonb reorders keys on the way back). */
export function canon(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === 'bigint') return JSON.stringify(v.toString());
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

const CONTENT_KEYS = [
  'stream', 'occurredAt', 'clientTime', 'clientSkewMs', 'category', 'action', 'outcome', 'severity', 'actorId', 'actorName', 'actorRole', 'actorType',
  'source', 'appName', 'appVersion', 'updateId', 'platform', 'osVersion', 'deviceModel', 'ip', 'userAgent', 'targetType', 'targetId', 'targetLabel',
  'inspectionId', 'jobNo', 'correlationId', 'requestId', 'clientEventId', 'before', 'after', 'reason', 'message', 'metadata',
] as const;

type Row = Record<(typeof CONTENT_KEYS)[number], unknown>;

export function hashOf(prevHash: string | null, row: Partial<Row>): string {
  const content: Record<string, unknown> = {};
  for (const k of CONTENT_KEYS) content[k] = row[k] ?? null;
  return createHash('sha256').update(`${prevHash ?? ''}|${canon(content)}`).digest('hex');
}

// ───────────────────────── writing ─────────────────────────

const stats = { written: 0, failed: 0, lastError: null as string | null, lastFailureAt: null as string | null };
export const auditHealth = () => ({ ...stats });

const nameCache = new Map<string, { name: string | null; role: string | null; until: number }>();
async function labelOf(userId: string): Promise<{ name: string | null; role: string | null }> {
  const hit = nameCache.get(userId);
  if (hit && hit.until > Date.now()) return hit;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, role: true } }).catch(() => null);
  const entry = { name: u ? (u.name ?? u.email) : null, role: u?.role ?? null, until: Date.now() + 5 * 60_000 };
  if (nameCache.size > 5000) nameCache.clear();
  nameCache.set(userId, entry);
  return entry;
}

const s = (v: unknown, max = 300): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null);

async function build(input: AuditInput): Promise<Record<string, unknown>> {
  const store = als.getStore();
  const req = input.req ?? store?.req;
  const actorId = input.actor && 'id' in input.actor ? input.actor.id ?? null : req?.user?.id ?? null;
  const actorType = input.actor?.type ?? (actorId ? 'user' : 'system');
  let name = input.actor?.name ?? null;
  let role = input.actor?.role ?? (input.actor ? null : req?.user?.role ?? null);
  if (actorId && actorType === 'user' && !name) {
    const l = await labelOf(actorId);
    name = l.name;
    role = role ?? l.role;
  }
  const client = { ...(req ? clientOf(req) : {}), ...(input.client ?? {}) };
  const inspectionId = s(input.inspectionId, 64);
  return {
    stream: inspectionId ? `insp:${inspectionId}` : 'system',
    occurredAt: input.occurredAt ?? new Date(),
    clientTime: input.clientTime ?? null,
    clientSkewMs: input.clientSkewMs ?? null,
    category: input.category,
    action: input.action.slice(0, 80),
    outcome: input.outcome ?? 'success',
    severity: input.severity ?? 'info',
    actorId,
    actorName: s(name, 200),
    actorRole: s(role, 40),
    actorType,
    source: input.source ?? (req ? sourceOf(req) : 'system'),
    appName: s(client.appName, 20),
    appVersion: s(client.appVersion, 40),
    updateId: s(client.updateId, 60),
    platform: s(client.platform, 40),
    osVersion: s(client.osVersion, 40),
    deviceModel: s(client.deviceModel, 80),
    ip: (input.ip ?? (req?.ip ? String(req.ip).slice(0, 64) : null))?.replace(/^::ffff:/i, '') ?? null, // an IPv4 address that arrives wrapped as IPv6 is stored as plain IPv4
    userAgent: input.userAgent ?? s(req?.headers['user-agent'], 300),
    targetType: s(input.target?.type, 60),
    targetId: s(input.target?.id, 80),
    targetLabel: s(input.target?.label, 200),
    inspectionId,
    jobNo: s(input.jobNo, 60),
    correlationId: s(input.correlationId ?? (req ? header(req, 'x-correlation-id', 64) : null), 64),
    requestId: s(input.requestId ?? store?.requestId ?? (req ? (req as Request & { auditStore?: Store }).auditStore?.requestId : null), 64),
    clientEventId: s(input.clientEventId, 64),
    before: bounded(input.before) ?? null,
    after: bounded(input.after) ?? null,
    reason: s(input.reason, 500),
    message: s(input.message, 500),
    metadata: bounded(input.metadata) ?? null,
  };
}

const json = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue));

/**
 * Records one event. Never throws. Returns false when the write failed (counted in auditHealth) or the event was a duplicate phone upload.
 * Events of one stream are chained in the order they commit (a per-stream advisory lock serialises the writers).
 */
export async function audit(input: AuditInput): Promise<boolean> {
  const store = als.getStore();
  if (store) store.audited = true;
  try {
    const row = await build(input);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'audit:' + String(row.stream)}))`;
      const prev = await tx.auditEvent.findFirst({ where: { stream: String(row.stream) }, orderBy: { seq: 'desc' }, select: { hash: true } });
      const prevHash = prev?.hash ?? null;
      await tx.auditEvent.create({
        data: {
          ...(row as Omit<Prisma.AuditEventUncheckedCreateInput, 'before' | 'after' | 'metadata' | 'prevHash' | 'hash'>),
          before: json(row.before),
          after: json(row.after),
          metadata: json(row.metadata),
          prevHash,
          hash: hashOf(prevHash, row as Partial<Row>),
        },
      });
    });
    stats.written++;
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.clientEventId) return false; // already recorded
    stats.failed++;
    stats.lastError = err instanceof Error ? err.message.slice(0, 300) : 'unknown';
    stats.lastFailureAt = new Date().toISOString();
    // The hosting log keeps what the database could not.
    // eslint-disable-next-line no-console
    console.error('[audit:FAILED]', JSON.stringify({ action: input.action, category: input.category, inspectionId: input.inspectionId, error: stats.lastError, at: stats.lastFailureAt }));
    return false;
  }
}

/** True the first time `key` is seen within `ttlMs` (used to keep "viewed" events from repeating on every refresh). */
const seen = new Map<string, number>();
export function firstWithin(key: string, ttlMs: number): boolean {
  const now = Date.now();
  const at = seen.get(key);
  if (at && now - at < ttlMs) return false;
  if (seen.size > 20000) for (const [k, t] of seen) if (now - t > ttlMs) seen.delete(k);
  seen.set(key, now);
  return true;
}

// ───────────────────────── photo uploads: one summary entry per batch, not one chain entry per photo ─────────────────────────

interface Batch {
  inspectionId: string;
  jobNo: string | null;
  actorId: string | null;
  count: number;
  bytes: number;
  min: number | null;
  max: number | null;
  sections: Set<string>;
  digest: ReturnType<typeof createHash>;
  firstAt: Date;
  lastAt: Date;
  ctx: { source: AuditSource; client: AuditClient; ip: string | null; userAgent: string | null; role: string | null };
}
const batches = new Map<string, Batch>();

/** Notes one stored photo; the batch is written as a single `photos.upload` entry after 30 s of quiet (or when the inspection is next audited). */
export function notePhotoUpload(p: { req?: Request; inspectionId: string; jobNo?: string | null; photoId: string; photoNumber?: number | null; sectionKey?: string | null; bytes?: number }): void {
  const req = p.req ?? als.getStore()?.req;
  const actorId = req?.user?.id ?? null;
  const key = `${p.inspectionId}|${actorId ?? ''}`;
  let b = batches.get(key);
  const now = new Date();
  if (!b) {
    b = {
      inspectionId: p.inspectionId, jobNo: p.jobNo ?? null, actorId, count: 0, bytes: 0, min: null, max: null, sections: new Set(), digest: createHash('sha256'), firstAt: now, lastAt: now,
      ctx: { source: req ? sourceOf(req) : 'api', client: req ? clientOf(req) : {}, ip: req?.ip ? String(req.ip) : null, userAgent: s(req?.headers['user-agent'], 300), role: req?.user?.role ?? null },
    };
    batches.set(key, b);
  }
  b.count++;
  b.bytes += p.bytes ?? 0;
  b.lastAt = now;
  if (p.jobNo) b.jobNo = p.jobNo;
  if (p.photoNumber != null) {
    b.min = b.min === null ? p.photoNumber : Math.min(b.min, p.photoNumber);
    b.max = b.max === null ? p.photoNumber : Math.max(b.max, p.photoNumber);
  }
  if (p.sectionKey) b.sections.add(p.sectionKey.split(':')[0]!);
  b.digest.update(p.photoId);
}

export async function flushPhotoBatches(inspectionId?: string): Promise<void> {
  for (const [key, b] of [...batches]) {
    if (inspectionId && b.inspectionId !== inspectionId) continue;
    batches.delete(key);
    await audit({
      category: 'mobile',
      action: 'photos.upload',
      actor: b.actorId ? { id: b.actorId, role: b.ctx.role } : { type: 'system' },
      source: b.ctx.source,
      client: b.ctx.client,
      ip: b.ctx.ip,
      userAgent: b.ctx.userAgent,
      inspectionId: b.inspectionId,
      jobNo: b.jobNo,
      target: { type: 'Inspection', id: b.inspectionId, label: b.jobNo },
      occurredAt: b.lastAt,
      message: `${b.count} photo${b.count === 1 ? '' : 's'} stored`,
      metadata: {
        count: b.count,
        bytes: b.bytes,
        photoNumbers: b.min !== null ? { from: b.min, to: b.max } : undefined,
        sections: [...b.sections],
        from: b.firstAt.toISOString(),
        to: b.lastAt.toISOString(),
        idsDigest: b.digest.digest('hex'),
      },
    });
  }
}

let flusher: ReturnType<typeof setInterval> | null = null;
/** Starts the quiet-period flush of photo batches (call once at start-up). */
export function startAuditFlusher(): void {
  if (flusher) return;
  flusher = setInterval(() => {
    const quiet = Date.now() - 30_000;
    for (const b of [...batches.values()]) if (b.lastAt.getTime() < quiet || Date.now() - b.firstAt.getTime() > 5 * 60_000) void flushPhotoBatches(b.inspectionId).catch(() => undefined);
  }, 10_000);
  flusher.unref();
}

// ───────────────────────── catch-all: every state-changing request is on record ─────────────────────────

const SKIP_PATHS = [/\/auth\/refresh$/, /\/inspections\/photos$/, /\/inspections\/client-error$/, /\/audit\/client-events$/];

async function catchAll(store: Store, res: Response): Promise<void> {
  const req = store.req;
  if (store.audited) return;
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  if (!req.user) return; // refused before sign-in: the security log and the error handler cover those
  if (req.baseUrl.startsWith('/api/v1/qc')) return; // the QC area keeps its own trail (mirrored from recordAudit)
  const route = `${req.baseUrl}${req.route?.path ?? ''}`;
  if (SKIP_PATHS.some((re) => re.test(route))) return;
  const status = res.statusCode;
  const src = sourceOf(req);
  await audit({
    category: /\/(templates|web\/users|web\/mail)/.test(route) ? 'admin' : src === 'mobile' ? 'mobile' : 'web',
    action: 'api.change',
    outcome: status >= 500 ? 'failure' : status === 401 || status === 403 ? 'denied' : status >= 400 ? 'failure' : 'success',
    severity: status >= 500 ? 'error' : status >= 400 ? 'warning' : 'info',
    message: `${req.method} ${route} → ${status}`,
    metadata: { route, status, params: sanitize(req.params) },
    target: { type: 'Route', id: route },
    inspectionId: typeof req.params?.id === 'string' && /\/(inspections|web\/inspections)\//.test(route) ? req.params.id : null,
  });
}

// ───────────────────────── anchors and verification ─────────────────────────

const GRACE_MS = 120_000;

/** Seals every event older than two minutes that is not yet sealed. Returns the new anchor, or null when there was nothing new. */
export async function anchorAudit(): Promise<{ upToSeq: string; eventCount: number; digest: string } | null> {
  const last = await prisma.auditAnchor.findFirst({ orderBy: { seq: 'desc' } });
  const from = last?.upToSeq ?? BigInt(0);
  const bound = await prisma.auditEvent.findFirst({ where: { seq: { gt: from }, occurredAt: { lt: new Date(Date.now() - GRACE_MS) } }, orderBy: { seq: 'desc' }, select: { seq: true } });
  if (!bound) return null;
  // Only events that are safely committed: nothing newer than the grace period can still be in flight below `bound`.
  const upTo = bound.seq;
  let digest = last?.digest ?? '';
  let count = 0;
  let cursor = from;
  for (;;) {
    const rows = await prisma.auditEvent.findMany({ where: { seq: { gt: cursor, lte: upTo } }, orderBy: { seq: 'asc' }, take: 5000, select: { seq: true, hash: true } });
    if (rows.length === 0) break;
    const h = createHash('sha256').update(digest);
    for (const r of rows) h.update(`|${r.hash}`);
    digest = h.digest('hex');
    count += rows.length;
    cursor = rows[rows.length - 1]!.seq;
  }
  if (count === 0) return null;
  await prisma.auditAnchor.create({ data: { upToSeq: upTo, eventCount: count, digest, prevDigest: last?.digest ?? null } });
  return { upToSeq: upTo.toString(), eventCount: count, digest };
}

export interface VerifyResult {
  ok: boolean;
  eventsChecked: number;
  streams: number;
  anchorsChecked: number;
  unsealedEvents: number;
  problems: { kind: 'hash' | 'link' | 'anchor'; id?: string; seq?: string; detail: string }[];
  verifiedAt: string;
  headHash: string | null;
}

/** Recomputes every hash and every anchor. `inspectionId` limits the chain check to that inspection's stream. */
export async function verifyAudit(opts: { inspectionId?: string } = {}): Promise<VerifyResult> {
  const problems: VerifyResult['problems'] = [];
  const tails = new Map<string, string>();
  let checked = 0;
  let cursor = BigInt(0);
  let headHash: string | null = null;
  const where: Prisma.AuditEventWhereInput = opts.inspectionId ? { stream: `insp:${opts.inspectionId}` } : {};
  // Entries removed by the retention job are on record (audit.purge); the start of a stream may therefore legitimately begin mid-chain.
  const purges = await prisma.auditEvent.findMany({ where: { stream: 'system', action: 'audit.purge' }, select: { metadata: true } });
  const purgedBefore = purges.reduce((m, p) => Math.max(m, Date.parse(String((p.metadata as { cutoff?: string } | null)?.cutoff ?? '')) || 0), 0);
  const minSeqRow = purges.length ? await prisma.auditEvent.findFirst({ orderBy: { seq: 'asc' }, select: { seq: true } }) : null;
  for (;;) {
    const rows = await prisma.auditEvent.findMany({ where: { ...where, seq: { gt: cursor } }, orderBy: { seq: 'asc' }, take: 2000 });
    if (rows.length === 0) break;
    for (const r of rows) {
      const expectedPrev = tails.get(r.stream) ?? null;
      const startsAfterPurge = !tails.has(r.stream) && purgedBefore > 0;
      if (r.prevHash !== expectedPrev && !startsAfterPurge) problems.push({ kind: 'link', id: r.id, seq: r.seq.toString(), detail: `Chain link broken in ${r.stream}: an earlier entry is missing or was changed.` });
      const recomputed = hashOf(r.prevHash, r as unknown as Partial<Row>);
      if (recomputed !== r.hash) problems.push({ kind: 'hash', id: r.id, seq: r.seq.toString(), detail: `Entry ${r.action} no longer matches its hash: it was changed after it was written.` });
      tails.set(r.stream, r.hash);
      headHash = r.hash;
      checked++;
      cursor = r.seq;
    }
  }
  // Anchors cover the whole table, so they are only re-checked for a full verification.
  let anchorsChecked = 0;
  let unsealed = 0;
  if (!opts.inspectionId) {
    let digest = '';
    let from = BigInt(0);
    const anchors = await prisma.auditAnchor.findMany({ orderBy: { seq: 'asc' } });
    for (const a of anchors) {
      // An anchor over events the retention job has since removed can no longer be recomputed; the purge itself is on record.
      if (minSeqRow && from < minSeqRow.seq) {
        // Sealed events that the retention job has since removed (wholly or partly): the anchor is trusted as it stands.
        digest = a.digest;
        from = a.upToSeq;
        continue;
      }
      if (a.prevDigest !== (digest || null)) problems.push({ kind: 'anchor', id: a.id, detail: 'Anchor chain broken: an earlier anchor is missing.' });
      let count = 0;
      let cur = from;
      let d = digest;
      for (;;) {
        const rows = await prisma.auditEvent.findMany({ where: { seq: { gt: cur, lte: a.upToSeq } }, orderBy: { seq: 'asc' }, take: 5000, select: { seq: true, hash: true } });
        if (rows.length === 0) break;
        const h = createHash('sha256').update(d);
        for (const r of rows) h.update(`|${r.hash}`);
        d = h.digest('hex');
        count += rows.length;
        cur = rows[rows.length - 1]!.seq;
      }
      if (count !== a.eventCount || d !== a.digest) problems.push({ kind: 'anchor', id: a.id, detail: `Anchor ${a.seq} does not match the events it sealed (${count} found, ${a.eventCount} expected): an event was removed or changed.` });
      digest = a.digest;
      from = a.upToSeq;
      anchorsChecked++;
    }
    unsealed = await prisma.auditEvent.count({ where: { seq: { gt: from } } });
  }
  return { ok: problems.length === 0, eventsChecked: checked, streams: tails.size, anchorsChecked, unsealedEvents: unsealed, problems: problems.slice(0, 50), verifiedAt: new Date().toISOString(), headHash };
}

// ───────────────────────── retention ─────────────────────────

/** Deletes events older than the retention period (default 7 years), the only deletion the database trigger permits. Returns the number removed. */
export async function purgeExpiredAudit(retentionDays = Number(process.env.AUDIT_RETENTION_DAYS ?? 2557)): Promise<number> {
  if (!Number.isFinite(retentionDays) || retentionDays < 365) return 0; // never purge on a nonsense setting
  const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000);
  const removed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_purge', 'on', true)`;
    return tx.$executeRaw`DELETE FROM audit_events WHERE "occurredAt" < ${cutoff}`;
  });
  if (removed > 0) {
    await audit({ category: 'system', action: 'audit.purge', actor: { type: 'system' }, severity: 'notice', message: `${removed} audit entries older than ${retentionDays} days removed by the retention job`, metadata: { cutoff: cutoff.toISOString(), removed, retentionDays } });
  }
  return removed;
}
