/**
 * The platform's recurring jobs. Each is safe to run on every instance: the
 * scheduler's lease means only one runs per tick (lib/scheduler.ts).
 */
import { registerJob, startScheduler } from '../../lib/scheduler';
import { prisma } from '../../lib/prisma';
import { sendDigests, notify } from './qc.notify';
import { runSlaScan } from './qc.sla.service';
import { runDlpScan } from './qc.dlp.service';
import { enforceRetention } from './qc.privacy.service';
import { scanOrphanUploads } from '../../lib/submissionAlerts';
import { pruneSubmissionLog } from '../../lib/submissionLog';
import { anchorAudit, purgeExpiredAudit, verifyAudit } from '../../lib/auditTrail';
import { alertAdmins } from '../../lib/submissionAlerts';
import { scanAuditAnomalies } from '../../lib/auditMonitor';

const MIN = 60_000;
let registered = false;

export function registerQcJobs(): void {
  if (registered) return;
  registered = true;

  registerJob({ name: 'qc.sla-scan', everyMs: 5 * MIN, run: async () => void (await runSlaScan()) });
  registerJob({ name: 'qc.dlp-scan', everyMs: 60 * MIN, run: async () => void (await runDlpScan()) });
  // Photos that reached Egnyte for an inspection that never arrived are mailed to the admins (lib/submissionAlerts.ts).
  registerJob({ name: 'submissions.orphan-scan', everyMs: 10 * MIN, run: async () => void (await scanOrphanUploads()) });
  // The audit trail: sealed every hour, fully re-verified every night (an admin is told at once if anything does not match), and entries past
  // the retention period (7 years) are removed once a day.
  registerJob({ name: 'audit.monitor', everyMs: 10 * MIN, run: async () => void (await scanAuditAnomalies()) });
  registerJob({ name: 'audit.anchor', everyMs: 60 * MIN, run: async () => void (await anchorAudit()) });
  registerJob({
    name: 'audit.verify',
    everyMs: 24 * 60 * MIN,
    run: async () => {
      const r = await verifyAudit();
      if (!r.ok) await alertAdmins(`audit-broken:${new Date().toISOString().slice(0, 10)}`, 'The audit log failed its integrity check', [`${r.problems.length} problem(s) found; the first: ${r.problems[0]?.detail ?? 'unknown'}`, 'Open Admin > Audit log and run "Verify integrity" for the full list.']);
    },
  });
  registerJob({ name: 'audit.retention', everyMs: 24 * 60 * MIN, run: async () => void (await purgeExpiredAudit()) });
  registerJob({ name: 'submissions.log-retention', everyMs: 24 * 60 * MIN, run: async () => void (await pruneSubmissionLog()) });
  registerJob({ name: 'qc.digests', everyMs: 15 * MIN, run: async () => void (await sendDigests()) });

  // Safety Hazards repeat until someone acknowledges them (REQ-NOT-003).
  registerJob({
    name: 'qc.safety-repeat',
    everyMs: 30 * MIN,
    run: async () => {
      const cutoff = new Date(Date.now() - 30 * MIN);
      const hazards = await prisma.qcDefect.findMany({
        where: { isDraft: false, acknowledgedAt: null, status: { key: { in: ['assigned', 'allocated'] } }, severity: { key: 'safety_hazard' }, releasedAt: { lt: cutoff } },
        include: { property: { include: { project: { select: { id: true, clientId: true, builderId: true } } } } },
        take: 200,
      });
      const { builderRecipients, developerRecipients } = await import('./qc.notify');
      for (const d of hazards) {
        const recent = await prisma.qcNotification.findFirst({ where: { entityId: d.id, type: 'defect.safety_hazard', createdAt: { gt: cutoff } } });
        if (recent) continue;
        const users = [...(await builderRecipients(d)), ...(await developerRecipients(d))];
        await notify({ clientId: d.property.project.clientId, entityType: 'QcDefect', entityId: d.id, type: 'defect.safety_hazard', userIds: users, title: `REMINDER: Safety Hazard ${d.defectRef ?? ''} is not yet acknowledged`, mandatory: true, allChannels: true });
      }
    },
  });

  // Credentials and insurance nearing expiry (REQ-USR-003, REQ-ORG-002).
  registerJob({
    name: 'qc.credential-expiry',
    everyMs: 24 * 60 * MIN,
    run: async () => {
      const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const creds = await prisma.qcInspectorCredential.findMany({ where: { status: { in: ['APPROVED', 'PENDING'] } }, include: { user: { select: { id: true, name: true } } } });
      for (const c of creds) {
        const expiry = (c.data as Record<string, unknown>).registration_expiry;
        if (typeof expiry !== 'string') continue;
        if (expiry < today) {
          await prisma.qcInspectorCredential.update({ where: { userId: c.userId }, data: { status: 'EXPIRED' } });
          await notify({ type: 'credential.expiry', userIds: [c.userId], title: 'Your registration has expired, so you cannot take new defects', mandatory: true });
        } else if (expiry <= soon) {
          await notify({ type: 'credential.expiry', userIds: [c.userId], title: `Your registration expires on ${expiry}` });
        }
      }
    },
  });

  // Offboarded clients past their grace period are destroyed, unless a legal hold applies. Off unless the operator turns it on.
  if (process.env.QC_AUTO_DESTROY === 'on') {
    registerJob({
      name: 'qc.tenant-destruction',
      everyMs: 24 * 60 * MIN,
      run: async () => {
        const { destroyTenant } = await import('./qc.privacy.service');
        const clients = await prisma.qcClient.findMany({ where: { status: 'OFFBOARDED' } });
        for (const c of clients) {
          const off = (c.data as { offboarding?: { destroyOn?: string } }).offboarding;
          if (off?.destroyOn && new Date(off.destroyOn) <= new Date()) {
            await destroyTenant({ userId: 'system', role: 'SA', isSA: true } as never, c.id).catch((e) => console.warn('[tenant-destruction] skipped', c.id, e instanceof Error ? e.message : e));
          }
        }
      },
    });
  }

  registerJob({ name: 'qc.retention', everyMs: 24 * 60 * MIN, run: async () => void (await enforceRetention()) });
}

export function startQcJobs(): void {
  registerQcJobs();
  startScheduler();
}
