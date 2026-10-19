/**
 * Watches the audit trail itself and tells the administrators when something looks wrong: the log could not be written, sealing has
 * stopped, one address is failing to sign in again and again, or one person keeps being refused. Run every ten minutes by the scheduler.
 * Each alert is sent at most once per hour for the same cause (see alertAdmins).
 */
import { prisma } from './prisma';
import { alertAdmins } from './submissionAlerts';
import { auditHealth } from './auditTrail';

let lastFailed = 0;

export async function scanAuditAnomalies(now = new Date()): Promise<string[]> {
  const found: string[] = [];
  const hour = now.toISOString().slice(0, 13);
  const since = new Date(now.getTime() - 10 * 60_000);

  // 1. The log could not be written (the database refused an entry): everything done since then may be missing from it.
  const w = auditHealth();
  if (w.failed > lastFailed) {
    found.push('write');
    await alertAdmins(`audit-write:${hour}`, 'The audit log could not record some events', [`${w.failed - lastFailed} audit entr${w.failed - lastFailed === 1 ? 'y' : 'ies'} could not be written since the last check.`, `Last error: ${w.lastError ?? 'unknown'}`, 'The hosting log keeps a JSON line for each missing entry ("[audit:FAILED]").']);
  }
  lastFailed = w.failed;

  // 2. Sealing has stopped: events older than three hours are still not sealed.
  const last = await prisma.auditAnchor.findFirst({ orderBy: { seq: 'desc' }, select: { upToSeq: true } });
  const unsealed = await prisma.auditEvent.count({ where: { seq: { gt: last?.upToSeq ?? BigInt(0) }, occurredAt: { lt: new Date(now.getTime() - 3 * 3600_000) } } });
  if (unsealed > 0) {
    found.push('sealing');
    await alertAdmins(`audit-sealing:${hour}`, 'The audit log is not being sealed', [`${unsealed} entries older than three hours have not been sealed.`, 'Sealing runs hourly; check the server logs for "audit.anchor".']);
  }

  // 3. The same address failing to sign in again and again.
  const bad = await prisma.auditEvent.groupBy({ by: ['ip'], where: { action: 'security.login_failed', occurredAt: { gte: since }, ip: { not: null } }, _count: true, having: { ip: { _count: { gte: 8 } } } });
  for (const g of bad) {
    found.push(`logins:${g.ip}`);
    await alertAdmins(`audit-logins:${g.ip}:${hour}`, 'Repeated failed sign-ins', [`${g._count} failed sign-ins from ${g.ip} in the last 10 minutes.`, 'Accounts lock after repeated failures; check the Audit log > Sign-ins & security view.']);
  }

  // 4. One person being refused again and again.
  const refused = await prisma.auditEvent.groupBy({ by: ['actorId', 'actorName'], where: { outcome: 'denied', occurredAt: { gte: since }, actorId: { not: null } }, _count: true, having: { actorId: { _count: { gte: 5 } } } });
  for (const g of refused) {
    found.push(`refused:${g.actorId}`);
    await alertAdmins(`audit-refused:${g.actorId}:${hour}`, 'Repeated refused requests', [`${g.actorName ?? g.actorId} was refused ${g._count} times in the last 10 minutes.`, 'See Audit log > Problems for what was attempted.']);
  }
  return found;
}
