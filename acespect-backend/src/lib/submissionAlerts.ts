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

/** Photos stored in a draft-id folder whose inspection never reached the server (the phone uploaded them, then the submission did not land). */
export async function findOrphanUploads(olderThanMinutes = 0, limit = 50) {
  const { egnyteRootFolder } = await import('./storage');
  const root = egnyteRootFolder();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  return prisma.$queryRaw<{ folder: string; photos: number; firstAt: Date; lastAt: Date; sections: string[] }[]>`
    SELECT split_part(substring(p."storageKey" from ${root.length + 2}::int), '/', 1) AS folder,
           count(*)::int AS photos, min(p."createdAt") AS "firstAt", max(p."createdAt") AS "lastAt",
           array_agg(DISTINCT split_part(substring(p."storageKey" from ${root.length + 2}::int), '/', 2)) AS sections
    FROM photos p
    WHERE p."storageKey" LIKE ${root + '/%'}
      AND split_part(substring(p."storageKey" from ${root.length + 2}::int), '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND NOT EXISTS (SELECT 1 FROM inspections i WHERE i.id = split_part(substring(p."storageKey" from ${root.length + 2}::int), '/', 1))
    GROUP BY 1
    HAVING max(p."createdAt") < ${cutoff}
    ORDER BY max(p."createdAt") DESC LIMIT ${limit}`;
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
      `${o.photos} photo(s) from draft ${o.folder.slice(0, 8)} reached Egnyte (${o.sections.filter(Boolean).join(', ')}), last at ${o.lastAt.toISOString()}.`,
      'The inspection that goes with them has not been received. It is probably still waiting in the inspector\'s sync queue: ask them to open the app and tap the "waiting to sync" banner.',
    ]);
  }
}
