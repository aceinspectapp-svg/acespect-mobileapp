/**
 * One-time (and safe to repeat) import of the existing submission log into the audit trail, so the history before the audit log existed is
 * not lost. Each old entry becomes a `legacy.<event>` entry filed under its original time; photo uploads are summarised per inspection
 * (one entry, not one per photo). Re-running adds nothing: every imported entry carries a fixed id.
 * Run: npm run audit:backfill     (against the database in DATABASE_URL)
 */
import { prisma } from '../lib/prisma';
import { audit } from '../lib/auditTrail';

async function main() {
  // Only what happened before the audit log went live (afterwards the same events are written to it directly).
  const firstLive = await prisma.auditEvent.findFirst({ where: { NOT: { action: { startsWith: 'legacy.' } } }, orderBy: { seq: 'asc' }, select: { occurredAt: true } });
  const rows = await prisma.submissionLogEntry.findMany({ where: firstLive ? { createdAt: { lt: firstLive.occurredAt } } : {}, orderBy: { createdAt: 'asc' } });
  const users = new Map((await prisma.user.findMany({ select: { id: true, name: true, email: true, role: true } })).map((u) => [u.id, u]));
  let imported = 0;
  let skipped = 0;
  const photos = new Map<string, { count: number; first: Date; last: Date; inspectorId: string | null; jobNo: string | null; inspectionId: string | null; bytes: number }>();

  for (const r of rows) {
    if (r.event === 'photo_uploaded') {
      const key = `${r.inspectionId ?? 'none'}|${r.inspectorId ?? 'none'}`;
      const p = photos.get(key) ?? { count: 0, first: r.createdAt, last: r.createdAt, inspectorId: r.inspectorId, jobNo: r.jobNo, inspectionId: r.inspectionId, bytes: 0 };
      p.count++;
      p.last = r.createdAt;
      p.bytes += Number((r.detail as { bytes?: number } | null)?.bytes ?? 0);
      if (r.jobNo) p.jobNo = r.jobNo;
      photos.set(key, p);
      continue;
    }
    const u = r.inspectorId ? users.get(r.inspectorId) : undefined;
    const bad = r.event === 'failed' || r.event === 'rejected';
    const ok = await audit({
      category: 'mobile',
      action: `legacy.${r.event}`,
      outcome: bad ? 'failure' : 'success',
      severity: r.event === 'failed' ? 'error' : r.event === 'rejected' || r.event === 'warning' ? 'warning' : 'info',
      actor: r.inspectorId ? { id: r.inspectorId, name: u ? u.name ?? u.email : null, role: u?.role ?? null, type: 'user' } : { id: null, type: 'system' },
      source: 'mobile',
      inspectionId: r.inspectionId,
      jobNo: r.jobNo,
      occurredAt: r.createdAt,
      clientEventId: `legacy:${r.id}`,
      message: (r.message ?? r.event).slice(0, 400),
      metadata: { imported: true, from: 'submission_log_entries', statusCode: r.statusCode, ...(r.detail && typeof r.detail === 'object' ? { detail: r.detail } : {}) },
    });
    if (ok) imported++; else skipped++;
  }
  for (const [key, p] of photos) {
    const u = p.inspectorId ? users.get(p.inspectorId) : undefined;
    const ok = await audit({
      category: 'mobile',
      action: 'legacy.photos_uploaded',
      actor: p.inspectorId ? { id: p.inspectorId, name: u ? u.name ?? u.email : null, role: u?.role ?? null, type: 'user' } : { id: null, type: 'system' },
      source: 'mobile',
      inspectionId: p.inspectionId,
      jobNo: p.jobNo,
      occurredAt: p.last,
      clientEventId: `legacy:photos:${key}`,
      message: `${p.count} photo(s) stored`,
      metadata: { imported: true, from: 'submission_log_entries', count: p.count, bytes: p.bytes, firstAt: p.first.toISOString(), lastAt: p.last.toISOString() },
    });
    if (ok) imported++; else skipped++;
  }
  console.log(`audit backfill: ${imported} entries imported, ${skipped} already present (of ${rows.length} log rows)`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
