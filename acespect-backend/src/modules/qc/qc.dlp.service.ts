/**
 * Practical completion, the defects liability period and its close-out
 * (REQ-DLP-001..004, forms F36 and F37, entity E28).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../lib/audit';
import { validateOrThrow } from './spec/qcSpec';
import { QcContext } from './qc.context';
import { getProjectPolicy } from './qc.policy.service';
import { developerRecipients, notify } from './qc.notify';
import { escalateManually, systemUserId } from './qc.sla.service';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;

export function addMonths(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 Jan + 1 month lands on the last day of February, not in March.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}

const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

/** F36: record practical completion and start the DLP clock. */
export async function setPracticalCompletion(ctx: QcContext, projectId: string, input: Record<string, unknown>) {
  const project = await prisma.qcProject.findUniqueOrThrow({ where: { id: projectId } });
  const data = validateOrThrow('F36', input, { skipRequired: ['dlp_end_date'] });
  const pc = new Date(`${String(data.practical_completion_date)}T00:00:00Z`);
  const months = Number(data.dlp_length);
  if (!Number.isInteger(months) || months < 1 || months > 120) throw ApiError.badRequest('DLP length must be a whole number of months (1 to 120)');
  if (project.dlpSignedOffAt) throw ApiError.conflict('This project\'s DLP has already been closed out', 'DLP_CLOSED');
  const end = addMonths(pc, months);
  const lotIds = Array.isArray(input.lotIds) ? (input.lotIds as string[]) : [];
  if (data.applies_to === 'Selected lots' && lotIds.length === 0) throw ApiError.badRequest('Choose the lots practical completion applies to');

  const before = { pc: project.practicalCompletionDate, end: project.dlpEndDate, status: project.status };
  const updated = await prisma.qcProject.update({
    where: { id: projectId },
    data: {
      practicalCompletionDate: pc,
      dlpLengthMonths: months,
      dlpStartDate: pc,
      dlpEndDate: end,
      status: 'DLP',
      data: asJson({ ...(project.data as object), dlp: { basis: data.basis, permit: data.permit_or_certificate_number ?? null, handoverDate: data.handover_date ?? null, appliesTo: data.applies_to, lotIds } }),
    },
  });
  if (lotIds.length) await prisma.qcProperty.updateMany({ where: { projectId, id: { in: lotIds } }, data: { lotStatus: 'DLP' } });
  else await prisma.qcProperty.updateMany({ where: { projectId }, data: { lotStatus: 'DLP' } });
  await recordAudit({
    clientId: project.clientId, entityType: 'Project', entityId: projectId, action: 'dlp.start', actor: { id: ctx.userId, role: ctx.role },
    supportSessionId: ctx.supportSession?.id ?? null, before, after: { pc: dateOnly(pc), end: dateOnly(end), months },
  });
  return updated;
}

/** Counts shown on the sign-off form and the close-out report (E28 system fields). */
export async function dlpSummary(projectId: string) {
  const project = await prisma.qcProject.findUniqueOrThrow({ where: { id: projectId } });
  const where = { property: { projectId }, isDraft: false, dlpDefect: true } satisfies Prisma.QcDefectWhereInput;
  const [total, closed, exceptions, nonTerminal] = await Promise.all([
    prisma.qcDefect.count({ where }),
    prisma.qcDefect.count({ where: { ...where, status: { key: 'closed' } } }),
    prisma.qcDefect.count({ where: { ...where, status: { key: 'accepted_exception' } } }),
    prisma.qcDefect.count({ where: { ...where, status: { terminal: false } } }),
  ]);
  const exceptionRows = await prisma.qcDefect.findMany({ where: { ...where, status: { key: 'accepted_exception' } }, select: { id: true, defectRef: true, title: true, exceptionReason: true } });
  const daysLeft = project.dlpEndDate ? Math.ceil((project.dlpEndDate.getTime() - Date.now()) / 86_400_000) : null;
  return {
    start: project.dlpStartDate, end: project.dlpEndDate, daysLeft, signedOffAt: project.dlpSignedOffAt,
    total, closed, exceptions, nonTerminal, exceptionList: exceptionRows,
  };
}

/** F37: developer sign-off. Blocked while non-terminal DLP defects remain (REQ-DLP-004). */
export async function closeOutDlp(ctx: QcContext, projectId: string, input: Record<string, unknown>) {
  const project = await prisma.qcProject.findUniqueOrThrow({ where: { id: projectId } });
  if (!project.dlpEndDate) throw ApiError.conflict('Practical completion has not been recorded for this project', 'NO_DLP');
  if (project.dlpSignedOffAt) throw ApiError.conflict('This DLP is already signed off', 'DLP_CLOSED');
  const data = validateOrThrow('F37', input, { skipRequired: ['defect_position', 'exceptions_list'] });
  if (data.declaration !== true) throw ApiError.badRequest('The declaration must be accepted');
  const summary = await dlpSummary(projectId);
  if (summary.nonTerminal > 0) {
    throw new ApiError(409, `${summary.nonTerminal} DLP defect(s) are still open. Close each one or accept it as an exception before sign-off.`, 'OPEN_DEFECTS', { nonTerminal: summary.nonTerminal });
  }
  const record = await prisma.qcRecord.create({
    data: {
      kind: 'dlp_signoff', clientId: project.clientId, projectId, title: `DLP close-out: ${project.name}`, createdById: ctx.userId,
      data: asJson({ ...data, summary, signedByUserId: ctx.userId, signedAt: new Date().toISOString() }),
    },
  });
  await prisma.qcProject.update({ where: { id: projectId }, data: { dlpSignedOffAt: new Date(), status: 'DLP_COMPLETE' } });
  await prisma.qcProperty.updateMany({ where: { projectId, lotStatus: 'DLP' }, data: { lotStatus: 'DLP_COMPLETE' } });
  await recordAudit({
    clientId: project.clientId, entityType: 'Project', entityId: projectId, action: 'dlp.signoff', actor: { id: ctx.userId, role: ctx.role },
    supportSessionId: ctx.supportSession?.id ?? null, after: { recordId: record.id, ...summary, exceptionList: undefined },
  });
  return { record, summary };
}

/**
 * Scheduled: reminders at the policy's days before expiry (90/60/30/7 by
 * default), each sent once, and escalation of still-open DLP defects inside the
 * escalation window (REQ-DLP-002/003).
 */
export async function runDlpScan(now = new Date()): Promise<{ reminders: number; escalated: number }> {
  let reminders = 0;
  let escalated = 0;
  const projects = await prisma.qcProject.findMany({ where: { dlpEndDate: { not: null }, dlpSignedOffAt: null, status: 'DLP' } });
  for (const p of projects) {
    const daysLeft = Math.ceil((p.dlpEndDate!.getTime() - now.getTime()) / 86_400_000);
    const { effective } = await getProjectPolicy(p.clientId, p.id);
    const summary = await dlpSummary(p.id);

    // The nearest reminder day not yet sent that has been reached.
    const due = effective.dlpReminderDays.filter((day) => daysLeft <= day).sort((a, b) => a - b);
    for (const day of due) {
      const sent = await prisma.qcRecord.findFirst({ where: { kind: 'dlp_reminder', projectId: p.id, title: String(day) } });
      if (sent) continue;
      await prisma.qcRecord.create({ data: { kind: 'dlp_reminder', clientId: p.clientId, projectId: p.id, title: String(day), data: asJson({ daysLeft, openDefects: summary.nonTerminal }) } });
      const devs = await developerRecipients({ id: p.id, defectRef: null, assignedToId: null, builderContactId: null, allocatedTradeUserId: null, allocatedTradeCompanyId: null, property: { projectId: p.id, project: { id: p.id, clientId: p.clientId, builderId: p.builderId } } });
      await notify({
        clientId: p.clientId, entityType: 'QcProject', entityId: p.id, type: 'dlp.reminder', userIds: devs,
        title: `${p.name}: DLP ends in ${Math.max(daysLeft, 0)} day${daysLeft === 1 ? '' : 's'} (${summary.nonTerminal} defect${summary.nonTerminal === 1 ? '' : 's'} still open)`,
      });
      reminders++;
      break; // one reminder per scan; a catch-up never sends several at once
    }

    // Inside the escalation window every still-open DLP defect gets a notice, once.
    if (daysLeft <= effective.dlpEscalationWindowDays && summary.nonTerminal > 0 && !p.dlpEscalatedAt) {
      const open = await prisma.qcDefect.findMany({ where: { property: { projectId: p.id }, isDraft: false, dlpDefect: true, status: { terminal: false } }, select: { id: true }, take: 500 });
      const systemId = await systemUserId();
      for (const d of open) {
        await escalateManually(d.id, 2, `Within ${effective.dlpEscalationWindowDays} days of DLP expiry`, systemId).catch(() => undefined);
        escalated++;
      }
      await prisma.qcProject.update({ where: { id: p.id }, data: { dlpEscalatedAt: now } });
    }
  }
  return { reminders, escalated };
}
