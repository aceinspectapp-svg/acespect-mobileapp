/**
 * Notifications (REQ-NOT-001/002/003, E29/E30).
 *
 * - In-app notification for every event that needs someone's attention.
 * - Email per preference: immediate, daily digest or off. Emails carry the event
 *   and a sign-in link only: no photos, no defect text (REQ-NOT-001 scenario 2).
 * - Mandatory alerts (Safety Hazard, security) ignore preferences and go to
 *   every channel (REQ-NOT-002 scenario 2, REQ-NOT-003).
 * - If the intended recipient is deactivated, the organisation's Manager (or the
 *   Client Admin) gets it instead and the redirect is audited (scenario 3).
 */
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { sendMail, sendSms } from '../../lib/mailer';
import { recordAudit } from '../../lib/audit';

export interface NotificationEventDef {
  label: string;
  /** Mandatory events cannot be switched off. */
  mandatory?: boolean;
}

export const EVENT_TYPES: Record<string, NotificationEventDef> = {
  'defect.released': { label: 'A defect is assigned to the Builder' },
  'defect.safety_hazard': { label: 'A Safety Hazard is released', mandatory: true },
  'defect.severity_revised': { label: 'A defect\'s severity changes' },
  'defect.urgent_flagged': { label: 'An urgent safety concern is flagged' },
  'defect.urgent_resolved': { label: 'An urgent concern is confirmed or declined' },
  'defect.disputed': { label: 'A defect is disputed' },
  'defect.dispute_resolved': { label: 'A dispute is resolved' },
  'defect.allocated': { label: 'A defect is allocated to a trade' },
  'defect.acknowledged': { label: 'A trade acknowledges a defect' },
  'defect.rectified': { label: 'A trade marks a defect rectified' },
  'defect.reinspection': { label: 'A defect is ready for re-inspection' },
  'defect.verified': { label: 'A defect is verified' },
  'defect.reopened': { label: 'A defect fails re-inspection' },
  'defect.closed': { label: 'A defect is closed' },
  'defect.hold': { label: 'A defect is put on hold or resumed' },
  'defect.exception': { label: 'A defect is accepted as an exception' },
  'defect.overdue': { label: 'A defect becomes overdue' },
  'defect.escalated': { label: 'A defect is escalated' },
  'inspection.assigned': { label: 'An inspection is assigned or rescheduled' },
  'inspection.requested': { label: 'A stage inspection is requested' },
  'inspection.completed': { label: 'An inspection is completed' },
  'dlp.reminder': { label: 'A DLP expiry reminder' },
  'account.invitation': { label: 'Account invitation', mandatory: true },
  'security.alert': { label: 'A security alert', mandatory: true },
  'credential.expiry': { label: 'A credential or insurance is expiring' },
};

export interface NotifyInput {
  type: string;
  userIds: string[];
  clientId?: string | null;
  title: string;
  /** Kept short and free of defect detail: it also goes into emails. */
  body?: string;
  entityType?: string;
  entityId?: string;
  mandatory?: boolean;
  /** Send to every channel including SMS when configured. */
  allChannels?: boolean;
}

const link = (path = '') => `${env.WEB_APP_URL.replace(/\/$/, '')}${path}`;

/** A deactivated recipient's notice goes to their organisation's Manager, else the Client Admin (REQ-NOT-001 scenario 3). */
async function resolveRecipient(userId: string, clientId: string | null | undefined): Promise<{ id: string; fallbackFor?: string }[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
  if (user?.isActive) return [{ id: userId }];

  const membership = await prisma.qcMembership.findFirst({ where: { userId, ...(clientId ? { clientId } : {}) }, orderBy: { createdAt: 'asc' } });
  const cid = clientId ?? membership?.clientId;
  if (!cid) return [];
  let fallbacks: { userId: string }[] = [];
  if (membership?.masterContractorId) {
    fallbacks = await prisma.qcMembership.findMany({ where: { clientId: cid, status: 'ACTIVE', role: 'MC_MANAGER', masterContractorId: membership.masterContractorId, user: { isActive: true } }, select: { userId: true } });
  }
  if (fallbacks.length === 0) {
    fallbacks = await prisma.qcMembership.findMany({ where: { clientId: cid, status: 'ACTIVE', role: 'CLIENT_ADMIN', user: { isActive: true } }, select: { userId: true } });
  }
  for (const f of fallbacks) {
    await recordAudit({
      clientId: cid, entityType: 'Notification', entityId: userId, action: 'notification.fallback',
      actor: { id: null, role: 'SYSTEM' }, reason: `Recipient unavailable; redirected to ${f.userId}`,
    });
  }
  return fallbacks.map((f) => ({ id: f.userId, fallbackFor: userId }));
}

async function sendPush(userId: string, title: string, body: string, data: Record<string, unknown>): Promise<void> {
  const tokens = await prisma.qcPushToken.findMany({ where: { userId }, select: { token: true } });
  if (tokens.length === 0) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) },
      body: JSON.stringify(tokens.map((t) => ({ to: t.token, title, body, data, sound: 'default' }))),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[notify] push failed', err instanceof Error ? err.message : err);
  }
}

/** Create the notifications and fan them out over the channels each recipient has chosen. */
export async function notify(input: NotifyInput): Promise<number> {
  const def = EVENT_TYPES[input.type];
  const mandatory = input.mandatory ?? def?.mandatory ?? false;
  const seen = new Set<string>();
  let created = 0;

  for (const rawId of Array.from(new Set(input.userIds))) {
    for (const rec of await resolveRecipient(rawId, input.clientId)) {
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);

      const user = await prisma.user.findUnique({ where: { id: rec.id }, select: { id: true, email: true, phone: true, isActive: true } });
      if (!user?.isActive) continue;
      const pref = await prisma.qcNotificationPref.findUnique({ where: { userId_eventType: { userId: user.id, eventType: input.type } } });
      const inApp = mandatory || pref?.inApp !== false;
      const emailMode = mandatory ? 'IMMEDIATE' : pref?.email ?? 'IMMEDIATE';
      if (!inApp && emailMode === 'OFF') continue;

      const title = rec.fallbackFor ? `${input.title} (redirected: recipient unavailable)` : input.title;
      const note = await prisma.qcNotification.create({
        data: {
          userId: user.id,
          clientId: input.clientId ?? null,
          type: input.type,
          title,
          body: input.body ?? 'Sign in to ACE SPECT to view the details.',
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          mandatory,
          readAt: inApp ? null : new Date(),
          emailStatus: emailMode === 'OFF' ? 'NONE' : emailMode === 'DIGEST' ? 'DIGEST_PENDING' : 'NONE',
        },
      });
      created++;

      if (emailMode === 'IMMEDIATE' && user.email) {
        const result = await sendMail(user.email, title, `${title}\n\nSign in to view it: ${link('/qc')}\n`);
        await prisma.qcNotification.update({ where: { id: note.id }, data: { emailStatus: result, emailedAt: result === 'SENT' ? new Date() : null } });
      }
      if (mandatory || input.allChannels) {
        void sendPush(user.id, title, note.body, { notificationId: note.id, entityType: input.entityType, entityId: input.entityId });
        if (input.allChannels && user.phone) void sendSms(user.phone, `${title}. Sign in to ACE SPECT.`);
      }
    }
  }
  return created;
}

/** Melbourne's current hour (the spec's default zone), for the daily digest window. */
function melbourneParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour) % 24, ymd: `${p.year}-${p.month}-${p.day}` };
}

/**
 * Daily digest (REQ-NOT-002 scenario 1): once local time passes 7am, send one
 * email per user listing yesterday's pending items by title only.
 */
export async function sendDigests(now = new Date()): Promise<number> {
  const { hour } = melbourneParts(now);
  if (hour < 7) return 0;
  const cutoff = new Date(now);
  cutoff.setUTCMinutes(0, 0, 0);
  // Anything queued before the most recent 7am Melbourne boundary.
  const cutoffMelb = new Date(now.getTime() - (hour - 7) * 3_600_000);
  cutoffMelb.setUTCMinutes(0, 0, 0);

  const pending = await prisma.qcNotification.findMany({
    where: { emailStatus: 'DIGEST_PENDING', createdAt: { lt: cutoffMelb } },
    include: { user: { select: { id: true, email: true, isActive: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const byUser = new Map<string, typeof pending>();
  for (const n of pending) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);

  let sent = 0;
  for (const [, items] of byUser) {
    const user = items[0]!.user;
    if (!user.isActive || !user.email) {
      await prisma.qcNotification.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { emailStatus: 'NONE' } });
      continue;
    }
    const lines = items.map((i) => `- ${i.title}`).join('\n');
    const result = await sendMail(user.email, `ACE SPECT daily summary (${items.length})`, `${lines}\n\nSign in to view them: ${link('/qc')}\n`);
    await prisma.qcNotification.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { emailStatus: result === 'SENT' ? 'DIGESTED' : result, emailedAt: new Date() } });
    sent++;
  }
  return sent;
}

// ───────────────────────── Defect recipients ─────────────────────────

interface DefectForNotify {
  id: string;
  defectRef: string | null;
  assignedToId: string | null;
  builderContactId: string | null;
  allocatedTradeUserId: string | null;
  allocatedTradeCompanyId: string | null;
  property: { projectId: string; project: { id: string; clientId: string; builderId: string | null } };
}

export async function builderRecipients(d: DefectForNotify): Promise<string[]> {
  const ids = new Set<string>();
  if (d.builderContactId) ids.add(d.builderContactId);
  const rows = await prisma.qcMembership.findMany({
    where: {
      clientId: d.property.project.clientId, status: 'ACTIVE', role: { in: ['MC_PROJECT_MANAGER', 'MC_MANAGER'] },
      masterContractorId: d.property.project.builderId ?? undefined,
      OR: [{ role: 'MC_MANAGER' }, { projects: { some: { id: d.property.projectId } } }],
    },
    select: { userId: true },
  });
  rows.forEach((r) => ids.add(r.userId));
  return [...ids];
}

export async function supervisorRecipients(d: DefectForNotify): Promise<string[]> {
  const rows = await prisma.qcMembership.findMany({
    where: { clientId: d.property.project.clientId, status: 'ACTIVE', role: 'MC_SITE_SUPERVISOR', masterContractorId: d.property.project.builderId ?? undefined, projects: { some: { id: d.property.projectId } } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function developerRecipients(d: DefectForNotify): Promise<string[]> {
  const rows = await prisma.qcMembership.findMany({
    where: {
      clientId: d.property.project.clientId, status: 'ACTIVE', role: { in: ['CLIENT_ADMIN', 'CLIENT_USER'] },
      OR: [{ role: 'CLIENT_ADMIN' }, { projects: { some: { id: d.property.projectId } } }],
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function tradeRecipients(d: DefectForNotify): Promise<string[]> {
  if (d.allocatedTradeUserId) return [d.allocatedTradeUserId];
  if (!d.allocatedTradeCompanyId) return [];
  const rows = await prisma.qcMembership.findMany({ where: { tradeCompanyId: d.allocatedTradeCompanyId, status: 'ACTIVE', role: 'TRADE_USER' }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

export const inspectorRecipients = (d: DefectForNotify): string[] => (d.assignedToId ? [d.assignedToId] : []);

/** Fan a lifecycle action out to the people who need to know (REQ-NOT-001 event-to-recipient matrix). */
export async function onDefectAction(defectId: string, action: string, extra: { safetyHazard?: boolean; actorId?: string; severityLabel?: string; level?: number } = {}): Promise<void> {
  const d = await prisma.qcDefect.findUnique({
    where: { id: defectId },
    include: { property: { include: { project: { select: { id: true, clientId: true, builderId: true } } } }, status: true, severity: true },
  });
  if (!d) return;
  const ref = d.defectRef ?? 'Defect';
  const clientId = d.property.project.clientId;
  const base = { clientId, entityType: 'QcDefect', entityId: d.id };
  const exceptActor = (ids: string[]) => ids.filter((x) => x !== extra.actorId);

  switch (action) {
    case 'release':
    case 'confirm': {
      if (d.status.key !== 'assigned') return;
      const safety = d.severity?.key === 'safety_hazard';
      const builders = await builderRecipients(d);
      const devs = await developerRecipients(d);
      if (safety) {
        await notify({ ...base, type: 'defect.safety_hazard', userIds: [...builders, ...devs], title: `SAFETY HAZARD released: ${ref}`, mandatory: true, allChannels: true });
      } else {
        await notify({ ...base, type: 'defect.released', userIds: builders, title: `${ref} has been assigned to you` });
        await notify({ ...base, type: 'defect.released', userIds: devs, title: `${ref} released to the Builder (for your visibility)` });
      }
      return;
    }
    case 'resolve_urgent':
      if (d.severity?.key === 'safety_hazard' && d.status.key === 'assigned') {
        await notify({ ...base, type: 'defect.safety_hazard', userIds: [...(await builderRecipients(d)), ...(await developerRecipients(d))], title: `SAFETY HAZARD released: ${ref}`, mandatory: true, allChannels: true });
      }
      await notify({ ...base, type: 'defect.urgent_resolved', userIds: exceptActor(inspectorRecipients(d)), title: `Urgent concern on ${ref} was answered` });
      return;
    case 'flag_urgent':
      await notify({ ...base, type: 'defect.urgent_flagged', userIds: inspectorRecipients(d), title: `URGENT safety concern flagged on ${ref}`, mandatory: true, allChannels: true });
      return;
    case 'revise_severity':
      await notify({ ...base, type: 'defect.severity_revised', userIds: exceptActor([...(await builderRecipients(d)), ...(await developerRecipients(d))]), title: `Severity of ${ref} changed${extra.severityLabel ? ` to ${extra.severityLabel}` : ''}` });
      return;
    case 'dispute_assignment':
      await notify({ ...base, type: 'defect.disputed', userIds: exceptActor(await developerRecipients(d)), title: `${ref} was disputed by the Builder`, mandatory: d.severity?.key === 'safety_hazard' });
      return;
    case 'dispute_trade':
      await notify({ ...base, type: 'defect.disputed', userIds: exceptActor(await builderRecipients(d)), title: `${ref} was disputed by the trade` });
      return;
    case 'resolve_dispute':
    case 'inspector_review':
    case 'review_trade_dispute':
      await notify({ ...base, type: 'defect.dispute_resolved', userIds: exceptActor([...(await builderRecipients(d)), ...inspectorRecipients(d), ...(await tradeRecipients(d))]), title: `Dispute on ${ref} was decided` });
      return;
    case 'allocate':
      await notify({ ...base, type: 'defect.allocated', userIds: await tradeRecipients(d), title: `${ref} has been allocated to you` });
      return;
    case 'acknowledge':
      await notify({ ...base, type: 'defect.acknowledged', userIds: exceptActor(await builderRecipients(d)), title: `${ref} was acknowledged by the trade` });
      return;
    case 'mark_rectified':
      await notify({ ...base, type: 'defect.rectified', userIds: exceptActor(await builderRecipients(d)), title: `${ref} was marked rectified` });
      return;
    case 'submit_reinspection':
      if (d.status.key === 'pending_re_inspection') await notify({ ...base, type: 'defect.reinspection', userIds: inspectorRecipients(d), title: `${ref} is ready for re-inspection` });
      else await notify({ ...base, type: 'defect.rectified', userIds: await tradeRecipients(d), title: `${ref} was returned to you for more work` });
      return;
    case 'verify_or_reject': {
      const ids = [...(await builderRecipients(d)), ...(await tradeRecipients(d))];
      if (d.status.key === 'reopened') await notify({ ...base, type: 'defect.reopened', userIds: [...ids, ...(await developerRecipients(d))], title: `${ref} failed re-inspection` });
      else await notify({ ...base, type: d.status.key === 'closed' ? 'defect.closed' : 'defect.verified', userIds: ids, title: `${ref} was ${d.status.key === 'closed' ? 'closed' : 'verified'}` });
      return;
    }
    case 'close':
      await notify({ ...base, type: 'defect.closed', userIds: exceptActor([...(await builderRecipients(d)), ...inspectorRecipients(d)]), title: `${ref} was closed` });
      return;
    case 'hold':
    case 'resume':
      await notify({ ...base, type: 'defect.hold', userIds: exceptActor([...(await builderRecipients(d)), ...inspectorRecipients(d), ...(await developerRecipients(d)), ...(await tradeRecipients(d))]), title: `${ref} was ${action === 'hold' ? 'put on hold' : 'resumed'}` });
      return;
    case 'accept_exception':
      await notify({ ...base, type: 'defect.exception', userIds: exceptActor([...(await builderRecipients(d)), ...inspectorRecipients(d)]), title: `${ref} was accepted as an exception` });
      return;
    default:
      return;
  }
}
