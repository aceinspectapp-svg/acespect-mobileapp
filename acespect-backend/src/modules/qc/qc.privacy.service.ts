/**
 * Privacy and records governance (REQ-PRV-*, REQ-AUD-004): privacy requests
 * (E33), the breach register (E34), the sub-processor register (E35), legal
 * holds (E36), retention, and tenant export / offboarding (F42). Registers are
 * Super Admin business; a Client Admin can place and release legal holds on
 * their own projects.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../lib/audit';
import { validateOrThrow } from './spec/qcSpec';
import { QcContext } from './qc.context';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const actor = (ctx: QcContext) => ({ id: ctx.userId, role: ctx.role });

// ───────────────────────── Privacy requests (E33) ─────────────────────────

const REQUEST_STATUS = ['Received', 'Identity check', 'In progress', 'Completed', 'Refused (with reason)'];

export async function createPrivacyRequest(ctx: QcContext, input: Record<string, unknown>) {
  const data = validateOrThrow('E33', { ...input, identity_verified_by_and_date: input.identity_verified_by_and_date ?? [''] }, { skipRequired: ['identity_verified_by_and_date', 'clients_involved'] });
  const received = new Date(`${str(data.date_received)}T00:00:00Z`);
  const row = await prisma.qcRecord.create({
    data: {
      kind: 'privacy_request', status: 'Received', title: `${str(data.request_type)}: ${str(data.requester_name_and_contact).slice(0, 60)}`, createdById: ctx.userId,
      data: asJson({ ...data, due_date: addDays(received, 30).toISOString().slice(0, 10), identityVerified: false, clients_involved: data.clients_involved ?? [] }),
    },
  });
  await recordAudit({ entityType: 'PrivacyRequest', entityId: row.id, action: 'privacy.create', actor: actor(ctx), after: { type: data.request_type } });
  return row;
}

export async function listPrivacyRequests() {
  const rows = await prisma.qcRecord.findMany({ where: { kind: 'privacy_request' }, orderBy: { createdAt: 'desc' } });
  const now = new Date().toISOString().slice(0, 10);
  return rows.map((r) => ({ ...r, overdue: !['Completed', 'Refused (with reason)'].includes(r.status) && String((r.data as Record<string, unknown>).due_date) < now }));
}

export async function updatePrivacyRequest(ctx: QcContext, id: string, input: Record<string, unknown>) {
  const row = await prisma.qcRecord.findFirst({ where: { id, kind: 'privacy_request' } });
  if (!row) throw ApiError.notFound('Privacy request not found');
  const data = { ...(row.data as Record<string, unknown>) };
  let status = row.status;
  if (input.identityVerified === true) {
    data.identityVerified = true;
    data.identity_verified_by_and_date = [ctx.userId, new Date().toISOString().slice(0, 10)];
  }
  if (typeof input.outcome_notes_and_redactions === 'string') data.outcome_notes_and_redactions = input.outcome_notes_and_redactions;
  if (typeof input.status === 'string') {
    if (!REQUEST_STATUS.includes(input.status)) throw ApiError.badRequest('Unknown status');
    // Nothing is released to a requester until their identity has been verified.
    if (['In progress', 'Completed'].includes(input.status) && data.identityVerified !== true) throw ApiError.badRequest('Verify the requester\'s identity first');
    if (input.status === 'Refused (with reason)' && !str(input.outcome_notes_and_redactions ?? data.outcome_notes_and_redactions).trim()) throw ApiError.badRequest('A refusal needs a reason in the outcome notes');
    status = input.status;
  }
  const updated = await prisma.qcRecord.update({ where: { id }, data: { status, data: asJson(data) } });
  await recordAudit({ entityType: 'PrivacyRequest', entityId: id, action: 'privacy.update', actor: actor(ctx), after: { status } });
  return updated;
}

/** Everything the platform holds about one person (an Access request), for the Super Admin to review before release. */
export async function exportPersonalData(ctx: QcContext, requestId: string, userId: string) {
  const row = await prisma.qcRecord.findFirst({ where: { id: requestId, kind: 'privacy_request' } });
  if (!row) throw ApiError.notFound('Privacy request not found');
  if ((row.data as Record<string, unknown>).identityVerified !== true) throw ApiError.badRequest('Verify the requester\'s identity before exporting their data');
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, phone: true, position: true, whiteCardNumber: true, whiteCardState: true, role: true, createdAt: true, lastSignInAt: true,
      termsVersion: true, termsAcceptedAt: true, privacyVersion: true, privacyAcceptedAt: true,
      qcMemberships: { select: { role: true, status: true, client: { select: { name: true } }, createdAt: true } },
      qcInspectorCredential: { select: { status: true, data: true } },
    },
  });
  if (!user) throw ApiError.notFound('Person not found');
  const [events, comments, notifications, security] = await Promise.all([
    prisma.qcDefectEvent.findMany({ where: { actorId: userId }, select: { type: true, note: true, createdAt: true, defectId: true } }),
    prisma.qcDefectComment.findMany({ where: { authorId: userId }, select: { text: true, createdAt: true, defectId: true } }),
    prisma.qcNotification.findMany({ where: { userId }, select: { type: true, title: true, createdAt: true } }),
    prisma.qcSecurityEvent.findMany({ where: { userId }, select: { type: true, createdAt: true, ip: true }, take: 1000 }),
  ]);
  await recordAudit({ entityType: 'PrivacyRequest', entityId: requestId, action: 'privacy.export', actor: actor(ctx), reason: `Personal data export for ${userId}` });
  return { exportedAt: new Date().toISOString(), user, defectEvents: events, comments, notifications, securityEvents: security };
}

// ───────────────────────── Breach register (E34) ─────────────────────────

export async function createBreach(ctx: QcContext, input: Record<string, unknown>) {
  const data = validateOrThrow('E34', { assessment_decision: 'Pending', ...input }, { skipRequired: ['incident_id', 'clients_affected'] });
  const detected = new Date(str(data.detected_at_and_by) || Date.now());
  const count = await prisma.qcRecord.count({ where: { kind: 'breach' } });
  const incidentId = `INC-${new Date().getUTCFullYear()}-${String(count + 1).padStart(3, '0')}`;
  const row = await prisma.qcRecord.create({
    data: {
      kind: 'breach', status: 'Open', title: incidentId, createdById: ctx.userId,
      data: asJson({ ...data, incident_id: incidentId, assessment_due: addDays(Number.isNaN(detected.getTime()) ? new Date() : detected, 30).toISOString().slice(0, 10) }),
    },
  });
  await recordAudit({ entityType: 'Breach', entityId: row.id, action: 'breach.create', actor: actor(ctx), after: { incidentId } });
  return row;
}

export async function updateBreach(ctx: QcContext, id: string, input: Record<string, unknown>) {
  const row = await prisma.qcRecord.findFirst({ where: { id, kind: 'breach' } });
  if (!row) throw ApiError.notFound('Incident not found');
  const data = { ...(row.data as Record<string, unknown>), ...input };
  if (data.assessment_decision === 'Eligible data breach') {
    // An eligible breach must record who was told, or when notification is planned.
    if (!data.regulator_notified && !input.allowIncomplete) throw ApiError.badRequest('Record the date the regulator (OAIC) was notified, or save with allowIncomplete while notification is prepared');
  }
  const status = input.closed === true ? 'Closed' : row.status;
  const updated = await prisma.qcRecord.update({ where: { id }, data: { status, data: asJson(data) } });
  await recordAudit({ entityType: 'Breach', entityId: id, action: 'breach.update', actor: actor(ctx), after: { fields: Object.keys(input) } });
  return updated;
}

export async function listByKind(kind: string) {
  return prisma.qcRecord.findMany({ where: { kind }, orderBy: { createdAt: 'desc' } });
}

// ───────────────────────── Sub-processor register (E35) ─────────────────────────

export async function saveSubProcessor(ctx: QcContext, id: string | null, input: Record<string, unknown>) {
  const outside = input.outside_australia === true;
  const data = validateOrThrow('E35', { ...input, approved_by_and_date: input.approved_by_and_date ?? [''] }, { skipRequired: ['app_8_assessment', 'approved_by_and_date', 'status'] });
  const status = ['Proposed', 'Approved', 'Retired'].includes(str(input.status)) ? str(input.status) : 'Proposed';
  if (status === 'Approved') {
    if (outside && !input.app_8_assessment) throw ApiError.badRequest('A sub-processor outside Australia needs an APP 8 assessment on file before approval');
    data.approved_by_and_date = [ctx.userId, new Date().toISOString().slice(0, 10)];
  }
  const row = id
    ? await prisma.qcRecord.update({ where: { id }, data: { status, title: str(data.name), data: asJson(data) } })
    : await prisma.qcRecord.create({ data: { kind: 'subprocessor', status, title: str(data.name), data: asJson(data), createdById: ctx.userId } });
  await recordAudit({ entityType: 'SubProcessor', entityId: row.id, action: id ? 'subprocessor.update' : 'subprocessor.create', actor: actor(ctx), after: { name: data.name, status } });
  return row;
}

/**
 * The services that handle personal information, listed once so the register is never empty. Their hosting regions are
 * infrastructure settings this code cannot see, so they are recorded as unconfirmed overseas: an administrator must complete
 * the APP 8 assessment and the real location before approving each one (REQ-TEN-004).
 */
export async function ensureSubProcessors(): Promise<void> {
  if ((await prisma.qcRecord.count({ where: { kind: 'subprocessor' } })) > 0) return;
  const rows = [
    ['Railway', 'Hosting of the API, web app and database', 'All platform data'],
    ['Egnyte', 'Storage of photos, documents and reports', 'Photos, documents, reports'],
    ['Expo (EAS)', 'Mobile app updates and push notifications', 'Device push tokens, notification titles'],
    ['Email provider (to be chosen)', 'Sending invitation, reset and alert emails', 'Names and email addresses'],
  ];
  for (const [name, purpose, data_types] of rows) {
    await prisma.qcRecord.create({
      data: { kind: 'subprocessor', status: 'Proposed', title: name, data: asJson({ name, purpose, data_types, processing_location: 'To be confirmed', outside_australia: true, note: 'Location unconfirmed: complete the APP 8 assessment before approving.' }) },
    });
  }
}

// ───────────────────────── Legal holds (E36) ─────────────────────────

/** Is there an active hold covering this project, lot or defect? Deletion and retention must check this. */
export async function activeHoldFor(scope: { projectId?: string; propertyId?: string; defectId?: string }): Promise<boolean> {
  const subjects = [scope.projectId, scope.propertyId, scope.defectId].filter((x): x is string => !!x);
  if (subjects.length === 0) return false;
  const holds = await prisma.qcRecord.findMany({ where: { kind: 'legal_hold', status: 'ACTIVE' } });
  return holds.some((h) => subjects.includes(str((h.data as Record<string, unknown>).subject)));
}

export async function placeLegalHold(ctx: QcContext, clientId: string, input: Record<string, unknown>) {
  const data = validateOrThrow('E36', input, { skipRequired: ['placed_by_and_at', 'released_by_at_and_reason'] });
  const row = await prisma.qcRecord.create({
    data: {
      kind: 'legal_hold', clientId, status: 'ACTIVE', title: `${str(data.scope)} hold`, createdById: ctx.userId,
      data: asJson({ ...data, placedBy: ctx.userId, placedAt: new Date().toISOString() }),
    },
  });
  await recordAudit({ clientId, entityType: 'LegalHold', entityId: row.id, action: 'legalhold.place', actor: actor(ctx), supportSessionId: ctx.supportSession?.id ?? null, reason: str(data.reason), after: { scope: data.scope, subject: data.subject } });
  return row;
}

export async function releaseLegalHold(ctx: QcContext, id: string, reason: string) {
  const row = await prisma.qcRecord.findFirst({ where: { id, kind: 'legal_hold' } });
  if (!row) throw ApiError.notFound('Legal hold not found');
  if (row.status !== 'ACTIVE') throw ApiError.conflict('This hold is already released');
  if (reason.trim().length < 5) throw ApiError.badRequest('A reason for releasing the hold is required');
  const updated = await prisma.qcRecord.update({
    where: { id },
    data: { status: 'RELEASED', data: asJson({ ...(row.data as object), releasedBy: ctx.userId, releasedAt: new Date().toISOString(), releaseReason: reason.trim() }) },
  });
  await recordAudit({ clientId: row.clientId, entityType: 'LegalHold', entityId: id, action: 'legalhold.release', actor: actor(ctx), supportSessionId: ctx.supportSession?.id ?? null, reason });
  return updated;
}

// ───────────────────────── Retention ─────────────────────────

/**
 * Daily housekeeping: remove spent credentials and stale tokens, trim personal
 * data in logs after 12 months (E31), and list projects that have passed their
 * retention period for the Super Admin. Records under a legal hold are never
 * touched. Business records are not deleted automatically.
 */
export async function enforceRetention(now = new Date()): Promise<{ invitations: number; resets: number; tokens: number; ips: number; notifications: number; dueForReview: number }> {
  const day = 86_400_000;
  const invitations = await prisma.qcInvitation.deleteMany({ where: { OR: [{ usedAt: { lt: new Date(now.getTime() - 30 * day) } }, { expiresAt: { lt: new Date(now.getTime() - 30 * day) } }] } });
  const resets = await prisma.qcPasswordReset.deleteMany({ where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] } });
  const tokens = await prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 30 * day) } }] } });
  // IP addresses are personal information, kept 12 months.
  const ips = await prisma.qcSecurityEvent.updateMany({ where: { createdAt: { lt: new Date(now.getTime() - 365 * day) }, ip: { not: null } }, data: { ip: null } });
  const notifications = await prisma.qcNotification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 365 * day) }, readAt: { not: null } } });

  const cutoff = new Date(now.getTime() - 7 * 365 * day);
  const archived = await prisma.qcProject.findMany({ where: { status: 'ARCHIVED', updatedAt: { lt: cutoff } }, select: { id: true, clientId: true, name: true } });
  let dueForReview = 0;
  for (const p of archived) {
    if (await activeHoldFor({ projectId: p.id })) continue;
    const exists = await prisma.qcRecord.findFirst({ where: { kind: 'retention_due', projectId: p.id } });
    if (!exists) {
      await prisma.qcRecord.create({ data: { kind: 'retention_due', clientId: p.clientId, projectId: p.id, title: p.name, data: asJson({ reason: 'Archived more than seven years ago' }) } });
      dueForReview++;
    }
  }
  return { invitations: invitations.count, resets: resets.count, tokens: tokens.count, ips: ips.count, notifications: notifications.count, dueForReview };
}

// ───────────────────────── Tenant export and offboarding (F42) ─────────────────────────

/** A complete JSON export of one client's data (defects with history, projects, people, inspections). */
export async function exportTenant(ctx: QcContext, clientId: string, contents: string[]) {
  const client = await prisma.qcClient.findUnique({ where: { id: clientId } });
  if (!client) throw ApiError.notFound('Client not found');
  const projects = await prisma.qcProject.findMany({ where: { clientId }, include: { sites: true, properties: true, team: true } });
  const projectIds = projects.map((p) => p.id);
  const defects = await prisma.qcDefect.findMany({ where: { property: { projectId: { in: projectIds } } }, include: { events: true, comments: true, escalations: true, status: true, severity: true } });
  const memberships = await prisma.qcMembership.findMany({ where: { clientId }, include: { user: { select: { id: true, name: true, email: true, position: true } } } });
  const inspections = await prisma.qcInspection.findMany({ where: { clientId }, include: { results: true } });
  const records = await prisma.qcRecord.findMany({ where: { clientId } });
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString(), client, projects, defects, memberships, inspections, records };
  if (contents.some((c) => c.startsWith('Audit'))) out.auditTrail = await prisma.qcAuditEntry.findMany({ where: { clientId }, orderBy: { createdAt: 'asc' } });
  await recordAudit({ clientId, entityType: 'Client', entityId: clientId, action: 'tenant.export', actor: actor(ctx), supportSessionId: ctx.supportSession?.id ?? null, after: { contents, defects: defects.length } });
  return out;
}

/** Start offboarding: suspend access now and set the destruction date after the grace period. */
export async function startOffboarding(ctx: QcContext, clientId: string, input: Record<string, unknown>) {
  const data = validateOrThrow('F42', { request_type: 'Offboard tenant', ...input }, { skipRequired: ['destruction_record'] });
  if (data.confirmation !== true) throw ApiError.badRequest('Confirm that you understand the data is destroyed after the grace period');
  const grace = Number(data.grace_period ?? 90);
  if (!Number.isInteger(grace) || grace < 30 || grace > 365) throw ApiError.badRequest('Grace period must be 30 to 365 days');
  const client = await prisma.qcClient.findUniqueOrThrow({ where: { id: clientId } });
  const destroyOn = addDays(new Date(), grace);
  await prisma.qcClient.update({ where: { id: clientId }, data: { status: 'OFFBOARDED', data: asJson({ ...(client.data as object), offboarding: { startedAt: new Date().toISOString(), destroyOn: destroyOn.toISOString(), exportContents: data.export_contents ?? [] } }) } });
  await recordAudit({ clientId, entityType: 'Client', entityId: clientId, action: 'tenant.offboard', actor: actor(ctx), after: { destroyOn: destroyOn.toISOString() } });
  return { destroyOn };
}

/** After the grace period, and with no legal hold, destroy the tenant's data and write a destruction record. */
export async function destroyTenant(ctx: QcContext, clientId: string) {
  const client = await prisma.qcClient.findUnique({ where: { id: clientId } });
  if (!client) throw ApiError.notFound('Client not found');
  const off = (client.data as { offboarding?: { destroyOn?: string } }).offboarding;
  if (client.status !== 'OFFBOARDED' || !off?.destroyOn) throw ApiError.conflict('Offboard the client first', 'NOT_OFFBOARDED');
  if (new Date(off.destroyOn) > new Date()) throw ApiError.conflict(`The grace period runs until ${off.destroyOn.slice(0, 10)}`, 'GRACE_PERIOD');
  const holds = await prisma.qcRecord.count({ where: { kind: 'legal_hold', clientId, status: 'ACTIVE' } });
  if (holds > 0) throw ApiError.conflict('An active legal hold prevents destruction', 'LEGAL_HOLD');
  const counts = {
    projects: await prisma.qcProject.count({ where: { clientId } }),
    defects: await prisma.qcDefect.count({ where: { property: { project: { clientId } } } }),
    people: await prisma.qcMembership.count({ where: { clientId } }),
  };
  await prisma.qcRecord.deleteMany({ where: { clientId } });
  await prisma.qcInspection.deleteMany({ where: { clientId } });
  await prisma.qcClient.delete({ where: { id: clientId } });
  const record = await prisma.qcRecord.create({
    data: { kind: 'destruction_record', title: `Destroyed: ${client.name}`, data: asJson({ clientId, clientName: client.name, destroyedAt: new Date().toISOString(), counts, by: ctx.userId }), createdById: ctx.userId },
  });
  await recordAudit({ entityType: 'Client', entityId: clientId, action: 'tenant.destroy', actor: actor(ctx), after: counts });
  return record;
}
