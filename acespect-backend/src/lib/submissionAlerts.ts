/**
 * Tells the admins when a submission goes wrong, instead of waiting for someone to open the Troubleshoot page: a failed
 * submit or photo upload, a submission that arrived incomplete, or photos that reached Egnyte for an inspection that never arrived.
 *
 * Each problem is mailed once (the trail row that records it carries an `alertKey`). With no mail server configured the alert is
 * still recorded, so it shows on the Troubleshoot page.
 */
import { prisma } from './prisma';
import { sendMail } from './mailer';
import { recordSubmissionEvent } from './submissionLog';
import { env } from '../config/env';

/** Mails the admins about `lines` unless this `alertKey` was already mailed. Never throws. */
export async function alertAdmins(alertKey: string, subject: string, lines: string[], meta: { inspectorId?: string | null; inspectionId?: string | null; jobNo?: string | null } = {}): Promise<void> {
  try {
    const seen = await prisma.submissionLogEntry.findFirst({ where: { event: 'warning', detail: { path: ['alertKey'], equals: alertKey } }, select: { id: true } });
    if (seen) return;
    const listed = env.ALERT_EMAILS.split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email }));
    const admins = listed.length ? listed : await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true, email: { not: '' } }, select: { email: true } });
    const text = [...lines, '', 'Open the Troubleshoot page in the review portal for details.'].join('\n');
    let sent = 0;
    for (const a of admins) if ((await sendMail(a.email, `[ACE SPECT] ${subject}`, text)) === 'SENT') sent++;
    await recordSubmissionEvent({
      event: 'warning',
      inspectorId: meta.inspectorId ?? null,
      inspectionId: meta.inspectionId ?? null,
      jobNo: meta.jobNo ?? null,
      message: subject,
      detail: { alertKey, reason: 'admin_alert', emailed: sent, admins: admins.length, lines: lines.slice(0, 6), mailConfigured: !!env.SMTP_URL },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Could not alert the admins.', err);
  }
}

/**
 * Photos on the server that no inspection refers to, older than `olderThanMinutes`: the phone uploaded them, but the inspection that goes
 * with them never arrived. Grouped by the draft folder they sit in, or by job number for photos filed straight into a job folder.
 */
export async function findOrphanUploads(olderThanMinutes = 0, limit = 50) {
  const { egnyteRootFolder } = await import('./storage');
  const root = egnyteRootFolder();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const rel = (n: number) => root.length + 2 + n;
  return prisma.$queryRaw<{ folder: string; photos: number; firstAt: Date; lastAt: Date; sections: string[] }[]>`
    WITH p AS (
      SELECT id, "createdAt", substring("storageKey" from ${rel(0)}::int) AS rel FROM photos
      WHERE "storageKey" LIKE ${root + '/%'} AND "createdAt" > now() - interval '30 days'
    ), k AS MATERIALIZED (
      SELECT id, "createdAt", rel,
             CASE WHEN split_part(rel, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN split_part(rel, '/', 1)
                  WHEN split_part(rel, '/', 1) ~ '^V[0-9]+-V?[0-9]+$' THEN split_part(rel, '/', 2)
                  ELSE NULL END AS folder,
             CASE WHEN split_part(rel, '/', 1) ~ '^V[0-9]+-V?[0-9]+$' THEN split_part(rel, '/', 3) ELSE split_part(rel, '/', 2) END AS section
      FROM p
    ), c AS MATERIALIZED (
      SELECT * FROM k WHERE folder IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inspections i WHERE i.id = k.folder)
    )
    SELECT folder, count(*)::int AS photos, min("createdAt") AS "firstAt", max("createdAt") AS "lastAt", array_agg(DISTINCT section) AS sections
    FROM c
    WHERE NOT EXISTS (SELECT 1 FROM sections s WHERE position(c.id in coalesce(s.answers::text, '')) > 0 OR position(c.id in s.photos::text) > 0)
      AND NOT EXISTS (SELECT 1 FROM damages d WHERE position(c.id in d.photos::text) > 0)
    GROUP BY folder
    HAVING max("createdAt") < ${cutoff}
    ORDER BY max("createdAt") DESC LIMIT ${limit}`;
}

/** Recurring check: photos that have waited 15+ minutes with no inspection are mailed to the admins (once each). */
export async function scanOrphanUploads(): Promise<void> {
  const orphans = await findOrphanUploads(15, 20);
  const fresh: typeof orphans = [];
  for (const o of orphans) {
    const seen = await prisma.submissionLogEntry.findFirst({ where: { event: 'warning', detail: { path: ['alertKey'], equals: `orphan:${o.folder}` } }, select: { id: true } });
    if (!seen) fresh.push(o);
  }
  if (fresh.length === 0) return;
  for (const o of fresh) {
    await alertAdmins(`orphan:${o.folder}`, 'Photos uploaded but the inspection never arrived', [
      `${o.photos} photo(s) in folder ${o.folder.length > 20 ? o.folder.slice(0, 8) : o.folder} reached Egnyte (${o.sections.filter(Boolean).join(', ')}), last at ${o.lastAt.toISOString()}.`,
      'The inspection that goes with them has not been received. It is probably still waiting in the inspector\'s sync queue: ask them to open the app and tap the "waiting to sync" banner.',
    ]);
  }
}
