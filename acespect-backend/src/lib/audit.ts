import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/** Fields that must never be copied into an audit trail. */
const REDACT = new Set(['passwordHash', 'mfaSecret', 'mfaBackupCodes', 'tokenHash', 'password']);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !REDACT.has(k))
        .map(([k, v]) => [k, redact(v)]),
    );
  }
  return value;
}

export interface AuditInput {
  clientId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  actor: { id: string | null; role: string };
  supportSessionId?: string | null;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

/** JSON with sorted keys, so the hash does not depend on key order (Postgres jsonb reorders keys on the way back). */
function canon(v: unknown): string {
  if (v === undefined || v === null) return 'null';
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (typeof v === 'object') {
    // Keys holding undefined vanish when the value is stored as JSON, so they must not count here either.
    return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function entryHash(prev: string | null, e: Pick<AuditInput, 'clientId' | 'entityType' | 'entityId' | 'action' | 'actor' | 'reason'>, createdAt: Date, before: unknown, after: unknown): string {
  return createHash('sha256')
    .update([
      prev ?? '', e.clientId ?? '', e.entityType, e.entityId, e.action, e.actor.id ?? '', e.actor.role, e.reason ?? '',
      canon(before), canon(after), createdAt.toISOString(),
    ].join('|'))
    .digest('hex');
}

/**
 * REQ-AUD-001: append an entry to the audit trail. Entries are never edited; a
 * correction is a new entry. Each stores the hash of the previous entry in the
 * same chain (one chain per client, one for platform-level data), serialised by
 * an advisory lock so concurrent writers cannot fork it.
 */
export async function recordAudit(e: AuditInput, tx?: Prisma.TransactionClient): Promise<void> {
  const run = async (db: Prisma.TransactionClient) => {
    const key = e.clientId ?? 'platform';
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'audit:' + key}))`;
    const prev = await db.qcAuditEntry.findFirst({ where: { clientId: e.clientId ?? null }, orderBy: { createdAt: 'desc' }, select: { hash: true, createdAt: true } });
    // Strictly increasing timestamps keep the chain order unambiguous when two entries land in the same millisecond.
    const now = new Date();
    const createdAt = prev && now.getTime() <= prev.createdAt.getTime() ? new Date(prev.createdAt.getTime() + 1) : now;
    const before = redact(e.before);
    const after = redact(e.after);
    await db.qcAuditEntry.create({
      data: {
        clientId: e.clientId ?? null,
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        actorId: e.actor.id,
        actorRole: e.actor.role,
        supportSessionId: e.supportSessionId ?? null,
        reason: e.reason ?? null,
        before: before === undefined ? undefined : (before as Prisma.InputJsonValue),
        after: after === undefined ? undefined : (after as Prisma.InputJsonValue),
        prevHash: prev?.hash ?? null,
        hash: entryHash(prev?.hash ?? null, e, createdAt, before, after),
        createdAt,
      },
    });
  };
  if (tx) return run(tx);
  await prisma.$transaction(run);
}

/** Recompute a chain and report the first entry whose link or hash does not match (tamper evidence). */
export async function verifyAuditChain(clientId: string | null): Promise<{ ok: boolean; checked: number; brokenAt?: string }> {
  const entries = await prisma.qcAuditEntry.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } });
  let prev: string | null = null;
  for (const row of entries) {
    const expected = entryHash(
      prev,
      { clientId: row.clientId, entityType: row.entityType, entityId: row.entityId, action: row.action, actor: { id: row.actorId, role: row.actorRole }, reason: row.reason },
      row.createdAt,
      row.before,
      row.after,
    );
    if (row.prevHash !== prev || row.hash !== expected) return { ok: false, checked: entries.length, brokenAt: row.id };
    prev = row.hash;
  }
  return { ok: true, checked: entries.length };
}
