/**
 * Service-level clocks, overdue flags and escalation (REQ-SLA-001..006).
 *
 * `applyActionClocks` runs after every lifecycle action and (re)sets the due
 * dates the policy in force at that moment gives. `runSlaScan` is the
 * scheduled job: it flags defects that have breached their current clock as
 * Overdue and raises escalation levels as the project policy says. On-hold
 * defects are paused: their clocks are shifted by the time spent on hold.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../../lib/audit';
import { addDuration, businessDaysBetween } from './qc.calendar';
import { calendarFor, getProjectPolicy, getSlaPolicy, EscalationLevel, SEVERITY_KEYS, SeverityKey } from './qc.policy.service';
import { builderRecipients, developerRecipients, inspectorRecipients, notify, supervisorRecipients, tradeRecipients } from './qc.notify';
import { createHash } from 'crypto';

const SYSTEM_EMAIL = 'system@acespect.local';

/** Automatic events (overdue, escalation) are attributed to a built-in system account. */
export async function systemUserId(): Promise<string> {
  const u = await prisma.user.upsert({
    where: { email: SYSTEM_EMAIL },
    create: { email: SYSTEM_EMAIL, name: 'ACE SPECT (automatic)', role: 'FIELD_USER', isActive: false },
    update: {},
    select: { id: true },
  });
  return u.id;
}

async function appendSystemEvent(defectId: string, type: string, note: string, changes: Record<string, unknown> = {}, statusId?: string): Promise<void> {
  const actorId = await systemUserId();
  const prev = await prisma.qcDefectEvent.findFirst({ where: { defectId }, orderBy: { createdAt: 'desc' }, select: { hash: true } });
  const createdAt = new Date();
  const hash = createHash('sha256')
    .update([prev?.hash ?? '', defectId, type, statusId ?? '', statusId ?? '', actorId, note, JSON.stringify(changes), createdAt.toISOString()].join('|'))
    .digest('hex');
  await prisma.qcDefectEvent.create({
    data: { defectId, type, fromStatusId: statusId ?? null, toStatusId: statusId ?? null, actorId, actorRole: 'SYSTEM', note, changes: changes as Prisma.InputJsonValue, prevHash: prev?.hash ?? null, hash, createdAt },
  });
}

const defectInclude = {
  status: true,
  severity: true,
  property: { include: { project: { select: { id: true, clientId: true, builderId: true, name: true } } } },
} as const;

/** The date of the next planned inspection on the lot, if any ("or by next stage inspection, whichever is sooner"). */
async function nextInspectionDate(propertyId: string, after: Date): Promise<Date | null> {
  const insp = await prisma.qcInspection.findFirst({
    where: { propertyId, status: { in: ['PLANNED', 'SCHEDULED', 'REQUESTED'] }, plannedFrom: { gt: after } },
    orderBy: { plannedFrom: 'asc' },
    select: { plannedFrom: true },
  });
  return insp?.plannedFrom ?? null;
}

/** Work out the three due dates for a severity from a start instant under the policy in force now. */
export async function computeDueDates(projectId: string, clientId: string, propertyId: string, severity: SeverityKey, from: Date) {
  const [{ effective }, policy, cal] = await Promise.all([getSlaPolicy(clientId, projectId), getProjectPolicy(clientId, projectId), calendarFor(projectId)]);
  const rule = effective[severity];
  const ackDuration = severity === 'safety_hazard' ? { value: policy.effective.safetyAckHours, unit: 'hours' as const } : rule.acknowledge;
  const ackDueAt = ackDuration ? addDuration(from, ackDuration, cal) : null;
  let rectifyDueAt = rule.rectifyFrom ? addDuration(from, rule.rectifyTo ?? rule.rectifyFrom, cal) : null;
  if (rule.orByNextStage) {
    const next = await nextInspectionDate(propertyId, from);
    if (next && (!rectifyDueAt || next < rectifyDueAt)) rectifyDueAt = next;
  }
  return { ackDueAt, rectifyDueAt, rule, cal };
}

/**
 * Called after a lifecycle action committed. Sets timestamps and due dates
 * (REQ-SLA-002..): targets set after a change apply to defects released after
 * it because they are computed here, at release, and never recomputed later
 * except by an explicit severity revision or rework.
 */
export async function applyActionClocks(defectId: string, action: string): Promise<void> {
  const d = await prisma.qcDefect.findUnique({ where: { id: defectId }, include: defectInclude });
  if (!d) return;
  const now = new Date();
  const sev = (d.severity?.key ?? 'minor') as SeverityKey;
  const project = d.property.project;
  const data: Prisma.QcDefectUncheckedUpdateInput = {};
  const statusKey = d.status.key;

  const startClocks = async (from: Date, includeAck: boolean) => {
    if (!(SEVERITY_KEYS as readonly string[]).includes(sev)) return;
    const due = await computeDueDates(project.id, project.clientId, d.propertyId, sev, from);
    if (includeAck) data.ackDueAt = due.ackDueAt;
    data.rectifyDueAt = due.rectifyDueAt;
  };

  switch (action) {
    case 'release':
    case 'confirm':
    case 'resolve_urgent':
      // Released (assigned): the clocks start now. A defect that is not yet released has none.
      if (statusKey === 'assigned' && !d.ackDueAt) {
        data.releasedAt = d.releasedAt ?? now;
        await startClocks(d.releasedAt ?? now, true);
      }
      break;
    case 'resolve_dispute':
    case 'review_trade_dispute':
    case 'inspector_review':
      break;
    case 'revise_severity':
      if (!['open'].includes(statusKey) && !d.isDraft) {
        // New severity, new target: counted from the revision (REQ-DEF-005's "new SLA dates").
        await startClocks(now, !d.acknowledgedAt);
      }
      break;
    case 'acknowledge':
      data.acknowledgedAt = now;
      break;
    case 'mark_rectified':
      data.rectifiedAt = now;
      break;
    case 'submit_reinspection': {
      if (statusKey === 'pending_re_inspection') {
        const { effective } = await getSlaPolicy(project.clientId, project.id);
        const cal = await calendarFor(project.id);
        const rule = effective[sev];
        data.reinspectDueAt = rule.reinspect ? addDuration(now, rule.reinspect, cal) : null;
      }
      break;
    }
    case 'verify_or_reject':
      data.reinspectDueAt = null;
      if (statusKey === 'reopened') {
        // Rework: a fresh rectification clock from the rejection.
        data.acknowledgedAt = null;
        data.rectifiedAt = null;
        await startClocks(now, false);
      } else {
        data.verifiedAt = now;
      }
      break;
    case 'resume': {
      // Shift every running clock by the time spent on hold.
      const heldEvent = await prisma.qcDefectEvent.findFirst({ where: { defectId, type: 'Placed on hold' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (heldEvent) {
        const shift = now.getTime() - heldEvent.createdAt.getTime();
        if (d.ackDueAt) data.ackDueAt = new Date(d.ackDueAt.getTime() + shift);
        if (d.rectifyDueAt) data.rectifyDueAt = new Date(d.rectifyDueAt.getTime() + shift);
        if (d.reinspectDueAt) data.reinspectDueAt = new Date(d.reinspectDueAt.getTime() + shift);
      }
      break;
    }
    default:
      break;
  }

  // Leaving a breached state clears the Overdue flag; terminal records carry no flags.
  const flags = new Set(d.flags);
  if (['closed', 'withdrawn', 'accepted_exception', 'verified'].includes(statusKey)) {
    flags.delete('overdue');
    flags.delete('escalated');
  }
  // A step forward ends the breach that was open for the previous step.
  const stepForward = ['acknowledge', 'mark_rectified', 'submit_reinspection', 'verify_or_reject', 'close', 'allocate'].includes(action);
  if (stepForward) {
    flags.delete('overdue');
    await prisma.qcEscalation.updateMany({ where: { defectId, resolvedAt: null, manual: false }, data: { resolvedAt: now, resolveNote: `Resolved by ${action}` } });
    flags.delete('escalated');
    flags.delete('contract_review');
  }
  if (Object.keys(data).length || flags.size !== d.flags.length) {
    await prisma.qcDefect.update({ where: { id: defectId }, data: { ...data, flags: [...flags] } });
  }
  if (['closed', 'withdrawn', 'accepted_exception'].includes(statusKey)) {
    await prisma.qcEscalation.updateMany({ where: { defectId, resolvedAt: null }, data: { resolvedAt: now, resolveNote: `Defect ${statusKey}` } });
  }
}

// ───────────────────────── Overdue scan and escalation ─────────────────────────

type DefectRowForScan = Prisma.QcDefectGetPayload<{ include: typeof defectInclude }>;

/** Which clock a defect is currently running against, if any. */
function activeClock(d: DefectRowForScan): { kind: 'ack' | 'rectify' | 'reinspect'; dueAt: Date } | null {
  switch (d.status.key) {
    case 'assigned':
    case 'allocated':
      if (!d.acknowledgedAt && d.ackDueAt) return { kind: 'ack', dueAt: d.ackDueAt };
      return null;
    case 'acknowledged':
    case 'in_progress':
    case 'reopened':
      return d.rectifyDueAt ? { kind: 'rectify', dueAt: d.rectifyDueAt } : null;
    case 'pending_re_inspection':
      return d.reinspectDueAt ? { kind: 'reinspect', dueAt: d.reinspectDueAt } : null;
    default:
      return null;
  }
}

const TRIGGER_FOR_CLOCK: Record<string, string> = {
  ack: 'Acknowledgement SLA missed',
  rectify: 'Rectification SLA missed',
  reinspect: 'Rectification SLA missed',
};

async function recipientsFor(level: EscalationLevel, d: DefectRowForScan, clock: 'ack' | 'rectify' | 'reinspect'): Promise<string[]> {
  const dn = d as unknown as Parameters<typeof builderRecipients>[0];
  const ids = new Set<string>();
  const add = (xs: string[]) => xs.forEach((x) => ids.add(x));
  if (level.level === 1) {
    // Level 1 goes to whoever owes the next step.
    if (clock === 'ack') add([...(await tradeRecipients(dn)), ...(await builderRecipients(dn))]);
    else if (clock === 'rectify') add([...(await tradeRecipients(dn)), ...(await supervisorRecipients(dn)), ...(await builderRecipients(dn))]);
    else add(inspectorRecipients(dn));
  } else {
    add(await builderRecipients(dn));
    add(await developerRecipients(dn));
    if (level.level === 2) add(inspectorRecipients(dn));
  }
  return [...ids];
}

/** Raise one escalation level for a defect and tell the people the level names. */
async function raise(d: DefectRowForScan, level: EscalationLevel, trigger: string, clock: 'ack' | 'rectify' | 'reinspect', rule: Record<string, unknown>, manual?: { by: string; reason: string }) {
  const recipients = await recipientsFor(level, d, clock);
  const esc = await prisma.qcEscalation.create({
    data: {
      defectId: d.id, level: level.level, trigger, rule: rule as Prisma.InputJsonValue, manual: !!manual, raisedById: manual?.by ?? null,
      reason: manual?.reason ?? null, recipients: recipients as Prisma.InputJsonValue,
    },
  });
  const flags = new Set(d.flags);
  if (level.level >= 2) flags.add('escalated');
  if (level.level >= 3) flags.add('contract_review');
  await prisma.qcDefect.update({ where: { id: d.id }, data: { escalationLevel: Math.max(d.escalationLevel, level.level), lastEscalatedAt: new Date(), flags: [...flags] } });
  await appendSystemEvent(d.id, level.level === 1 ? 'Reminder sent' : 'Escalated', `${level.name} (level ${level.level}): ${trigger}`, { level: level.level, trigger, manual: !!manual });
  const ref = d.defectRef ?? 'Defect';
  await notify({
    clientId: d.property.project.clientId, entityType: 'QcDefect', entityId: d.id, type: level.level === 1 ? 'defect.overdue' : 'defect.escalated',
    userIds: recipients, title: level.level === 1 ? `${ref} is overdue` : `${ref} escalated to level ${level.level}: ${level.name}`,
    mandatory: level.level >= 3,
  });
  await recordAudit({ clientId: d.property.project.clientId, entityType: 'Defect', entityId: d.id, action: `escalation.level${level.level}`, actor: { id: manual?.by ?? null, role: manual ? 'USER' : 'SYSTEM' }, reason: trigger });
  return esc;
}

/** Manual escalation by an authorised user (REQ-SLA-004 / F34). `level` is the target level number. */
export async function escalateManually(defectId: string, level: number, reason: string, byUserId: string) {
  const d = await prisma.qcDefect.findUnique({ where: { id: defectId }, include: defectInclude });
  if (!d) return null;
  const { effective } = await getProjectPolicy(d.property.project.clientId, d.property.project.id);
  const def = effective.levels.find((l) => l.level === level) ?? effective.levels[0]!;
  return raise(d, def, 'Developer elects', 'rectify', { manual: true }, { by: byUserId, reason });
}

/** Run once a few minutes: flag breaches and raise levels whose wait has passed. */
export async function runSlaScan(now = new Date()): Promise<{ flagged: number; escalated: number }> {
  let flagged = 0;
  let escalated = 0;
  const defects = await prisma.qcDefect.findMany({
    where: { isDraft: false, status: { terminal: false, key: { notIn: ['open', 'on_hold', 'disputed', 'verified'] } } },
    include: defectInclude,
    take: 2000,
  });
  const policyCache = new Map<string, Awaited<ReturnType<typeof getProjectPolicy>>>();
  const calCache = new Map<string, Awaited<ReturnType<typeof calendarFor>>>();

  for (const d of defects) {
    const clock = activeClock(d);
    const project = d.property.project;
    const policy = policyCache.get(project.id) ?? (await getProjectPolicy(project.clientId, project.id));
    policyCache.set(project.id, policy);

    if (!clock || clock.dueAt > now) {
      // Back inside the SLA: clear the flag once the defect moved on.
      if (d.flags.includes('overdue') && (!clock || clock.dueAt > now)) {
        await prisma.qcDefect.update({ where: { id: d.id }, data: { flags: d.flags.filter((f) => f !== 'overdue') } });
      }
      continue;
    }

    const existing = await prisma.qcEscalation.findMany({ where: { defectId: d.id, resolvedAt: null }, orderBy: { level: 'asc' } });
    const levels = policy.effective.levels;

    if (!d.flags.includes('overdue')) {
      await prisma.qcDefect.update({ where: { id: d.id }, data: { flags: [...d.flags, 'overdue'] } });
      flagged++;
    }
    const triggerName = TRIGGER_FOR_CLOCK[clock.kind]!;

    // Level 1: the first level whose trigger matches the breached clock.
    const first = levels.find((l) => l.trigger === triggerName) ?? levels[0]!;
    if (!existing.some((e) => e.level === first.level) && existing.length === 0) {
      await raise(d, first, triggerName, clock.kind, { clock: clock.kind, dueAt: clock.dueAt });
      escalated++;
      continue;
    }

    // Later levels: wait N business days after the previous level, if still unresolved.
    const cal = calCache.get(project.id) ?? (await calendarFor(project.id));
    calCache.set(project.id, cal);
    const topRaised = Math.max(0, ...existing.map((e) => e.level));
    const next = levels.find((l) => l.level === topRaised + 1);
    if (next && next.level <= 3) {
      const prev = existing.find((e) => e.level === topRaised);
      let due = false;
      let trigger = next.trigger;
      if (next.trigger === 'Previous level unresolved' && prev && next.waitDays !== null) {
        due = businessDaysBetween(prev.triggeredAt, now, cal) >= next.waitDays;
      } else if (next.trigger === 'Failed re-inspections on the same item' && next.failedCount !== null) {
        due = d.reworkCount >= next.failedCount;
      } else if (next.trigger === triggerName) {
        due = true;
      }
      if (due) {
        await raise(d, next, trigger, clock.kind, { clock: clock.kind, waitDays: next.waitDays });
        escalated++;
      }
    }
  }

  // Repeat failures escalate regardless of the clock (REQ-SLA-006).
  const repeat = await prisma.qcDefect.findMany({
    where: { isDraft: false, status: { terminal: false }, reworkCount: { gte: 2 }, escalationLevel: { lt: 2 } },
    include: defectInclude,
    take: 500,
  });
  for (const d of repeat) {
    const policy = await getProjectPolicy(d.property.project.clientId, d.property.project.id);
    if (d.reworkCount < policy.effective.repeatFailureCount) continue;
    const level = policy.effective.levels.find((l) => l.level === 2) ?? policy.effective.levels[0]!;
    await raise(d, level, 'Failed re-inspections on the same item', 'rectify', { reworkCount: d.reworkCount });
    escalated++;
  }
  return { flagged, escalated };
}

/** Resolve an escalation (manually, or when the defect moves on). */
export async function resolveEscalations(defectId: string, note: string, byUserId: string | null) {
  const res = await prisma.qcEscalation.updateMany({ where: { defectId, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: byUserId, resolveNote: note } });
  const d = await prisma.qcDefect.findUnique({ where: { id: defectId }, select: { flags: true } });
  if (d) await prisma.qcDefect.update({ where: { id: defectId }, data: { flags: d.flags.filter((f) => !['escalated', 'contract_review'].includes(f)) } });
  return res.count;
}
