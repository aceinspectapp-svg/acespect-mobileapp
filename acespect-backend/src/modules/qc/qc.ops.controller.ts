/**
 * Operational endpoints: SLA and escalation policy, escalations, the DLP,
 * notifications, the audit and security logs, support sessions, privacy and
 * tenant export. Capability checks sit in the routes; tenant scoping sits here.
 */
import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../lib/prisma';
import { recordAudit, verifyAuditChain } from '../../lib/audit';
import { actorOf, assertClientAccess, ctxOf, requireTenant } from './qc.context';
import { guardEntity, ownerOf } from './qc.guard';
import { can } from './qc.permissions';
import * as policy from './qc.policy.service';
import * as master from './qc.master.service';
import * as sla from './qc.sla.service';
import * as dlp from './qc.dlp.service';
import * as privacy from './qc.privacy.service';
import { EVENT_TYPES } from './qc.notify';
import { payloadOf } from './qc.admin.controller';
import { validateOrThrow } from './spec/qcSpec';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const id = (req: Request) => String(req.params.id ?? '');

/** Which client a policy call is about: a project's client, or the caller's own tenant. */
async function policyScope(req: Request): Promise<{ clientId: string; projectId: string | null }> {
  const projectId = q(req.query.projectId) ?? q((req.body ?? {}).projectId) ?? null;
  if (projectId) {
    const owner = await guardEntity(req, 'project', projectId);
    return { clientId: owner.clientId!, projectId };
  }
  return { clientId: requireTenant(ctxOf(req)), projectId: null };
}

export const qcOpsController = {
  // ─── SLA targets (E13) ───
  getSla: asyncHandler(async (req, res) => {
    const { clientId, projectId } = await policyScope(req);
    res.status(200).json({ sla: await policy.getSlaPolicy(clientId, projectId), severities: policy.SEVERITY_KEYS.map((k) => ({ key: k, label: policy.SEVERITY_LABEL[k] })) });
  }),
  saveSla: asyncHandler(async (req, res) => {
    const { clientId, projectId } = await policyScope(req);
    res.status(200).json({ sla: await policy.saveSlaRule(ctxOf(req), clientId, projectId, String(req.params.severity), payloadOf(req)) });
  }),
  revertSla: asyncHandler(async (req, res) => {
    const { clientId, projectId } = await policyScope(req);
    if (!projectId) throw ApiError.badRequest('Only a project override can be reverted');
    res.status(200).json({ sla: await policy.revertSlaOverride(ctxOf(req), clientId, projectId, q(req.query.severity) ?? null) });
  }),

  // ─── Escalation levels and project policies (E14) ───
  getPolicy: asyncHandler(async (req, res) => {
    const { clientId, projectId } = await policyScope(req);
    res.status(200).json({ policy: await policy.getProjectPolicy(clientId, projectId) });
  }),
  savePolicy: asyncHandler(async (req, res) => {
    const { clientId, projectId } = await policyScope(req);
    res.status(200).json({ policy: await policy.saveProjectPolicy(ctxOf(req), clientId, projectId, payloadOf(req)) });
  }),
  revertPolicy: asyncHandler(async (req, res) => {
    const { clientId, projectId } = await policyScope(req);
    if (!projectId) throw ApiError.badRequest('Only a project override can be reverted');
    const keys = q(req.query.keys)?.split(',').filter(Boolean) ?? null;
    res.status(200).json({ policy: await policy.revertProjectPolicy(ctxOf(req), clientId, projectId, keys) });
  }),

  // ─── Escalations (E27, F34, F35) ───
  defectEscalations: asyncHandler(async (req, res) => {
    await guardEntity(req, 'defect', id(req));
    res.status(200).json({ escalations: await prisma.qcEscalation.findMany({ where: { defectId: id(req) }, orderBy: { triggeredAt: 'asc' } }) });
  }),
  escalate: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    await guardEntity(req, 'defect', id(req));
    const body = validateOrThrow('F34', payloadOf(req), { skipRequired: [] });
    if (body.action === 'Escalate') {
      const level = Number(body.target_level);
      if (![2, 3, 4].includes(level)) throw ApiError.badRequest('Choose level 2, 3 or 4');
      const esc = await sla.escalateManually(id(req), level, String(body.reason_or_resolution_note), ctx.userId);
      res.status(201).json({ escalation: esc });
      return;
    }
    const resolved = await sla.resolveEscalations(id(req), String(body.reason_or_resolution_note), ctx.userId);
    await recordAudit({ clientId: ctx.clientId, entityType: 'Defect', entityId: id(req), action: 'escalation.resolve', actor: actorOf(ctx), reason: String(body.reason_or_resolution_note) });
    res.status(200).json({ resolved });
  }),
  recordReferral: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const esc = await prisma.qcEscalation.findUnique({ where: { id: id(req) } });
    if (!esc) throw ApiError.notFound('Escalation not found');
    await guardEntity(req, 'defect', esc.defectId);
    if (esc.level !== 4) throw ApiError.badRequest('External referrals are recorded on a level 4 escalation');
    const data = validateOrThrow('F35', payloadOf(req));
    const updated = await prisma.qcEscalation.update({
      where: { id: esc.id },
      data: { referralType: String(data.referral_type), referralDate: new Date(`${String(data.referral_date)}T00:00:00Z`), referralRef: data.reference_number ? String(data.reference_number) : null, outcome: data.notes ? String(data.notes) : null },
    });
    await recordAudit({ clientId: ctx.clientId, entityType: 'Defect', entityId: esc.defectId, action: 'escalation.referral', actor: actorOf(ctx), after: { type: data.referral_type, ref: data.reference_number } });
    res.status(200).json({ escalation: updated });
  }),
  ackEscalation: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const esc = await prisma.qcEscalation.findUnique({ where: { id: id(req) } });
    if (!esc) throw ApiError.notFound('Escalation not found');
    await guardEntity(req, 'defect', esc.defectId);
    res.status(200).json({ escalation: await prisma.qcEscalation.update({ where: { id: esc.id }, data: { ackById: ctx.userId, ackAt: new Date() } }) });
  }),
  /** The escalation log report (REQ-RPT-006): every escalation in scope, newest first. */
  escalationLog: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const clientId = requireTenant(ctx);
    const projectId = q(req.query.projectId);
    if (projectId) await guardEntity(req, 'project', projectId);
    const rows = await prisma.qcEscalation.findMany({
      where: { defect: { property: { project: { clientId, id: projectId ?? (ctx.projectIds === 'all' ? undefined : { in: ctx.projectIds }) } } } },
      include: { defect: { select: { id: true, defectRef: true, title: true, status: { select: { label: true } }, severity: { select: { label: true } }, property: { select: { name: true, project: { select: { name: true } } } } } } },
      orderBy: { triggeredAt: 'desc' },
      take: 1000,
    });
    res.status(200).json({ escalations: rows });
  }),

  // ─── Practical completion and DLP (F36/F37, E28) ───
  getDlp: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    const project = await prisma.qcProject.findUniqueOrThrow({ where: { id: id(req) }, select: { practicalCompletionDate: true, dlpLengthMonths: true, dlpStartDate: true, dlpEndDate: true, dlpSignedOffAt: true, status: true } });
    const signoff = await prisma.qcRecord.findFirst({ where: { kind: 'dlp_signoff', projectId: id(req) }, orderBy: { createdAt: 'desc' } });
    res.status(200).json({ dlp: { ...project, summary: await dlp.dlpSummary(id(req)), signoff } });
  }),
  startDlp: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    res.status(200).json({ project: await dlp.setPracticalCompletion(ctxOf(req), id(req), payloadOf(req)) });
  }),
  closeOutDlp: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    res.status(201).json(await dlp.closeOutDlp(ctxOf(req), id(req), payloadOf(req)));
  }),

  // ─── Notifications (E29, E30) ───
  listNotifications: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const unreadOnly = req.query.unread === 'true';
    const rows = await prisma.qcNotification.findMany({
      where: { userId: ctx.userId, ...(unreadOnly ? { readAt: null } : {}), ...(ctx.clientId && !ctx.isSA ? { OR: [{ clientId: ctx.clientId }, { clientId: null }] } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 50, 200),
    });
    const unread = await prisma.qcNotification.count({ where: { userId: ctx.userId, readAt: null } });
    res.status(200).json({ notifications: rows, unread });
  }),
  markRead: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    await prisma.qcNotification.updateMany({ where: { userId: ctx.userId, readAt: null, ...(req.params.id && req.params.id !== 'all' ? { id: req.params.id } : {}) }, data: { readAt: new Date() } });
    res.status(200).json({ success: true });
  }),
  /** Safety Hazard alerts must be acknowledged, not just read (REQ-NOT-003). */
  ackNotification: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const n = await prisma.qcNotification.findFirst({ where: { id: id(req), userId: ctx.userId } });
    if (!n) throw ApiError.notFound('Notification not found');
    await prisma.qcNotification.update({ where: { id: n.id }, data: { ackedAt: new Date(), readAt: n.readAt ?? new Date() } });
    res.status(200).json({ success: true });
  }),
  getPrefs: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const prefs = await prisma.qcNotificationPref.findMany({ where: { userId: ctx.userId } });
    res.status(200).json({
      events: Object.entries(EVENT_TYPES).map(([type, def]) => {
        const p = prefs.find((x) => x.eventType === type);
        return { type, label: def.label, mandatory: !!def.mandatory, inApp: def.mandatory ? true : p?.inApp ?? true, email: def.mandatory ? 'IMMEDIATE' : p?.email ?? 'IMMEDIATE' };
      }),
    });
  }),
  savePrefs: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = payloadOf(req) as { events?: Array<{ type: string; inApp: boolean; email: string }> };
    for (const e of body.events ?? []) {
      const def = EVENT_TYPES[e.type];
      if (!def) throw ApiError.badRequest(`Unknown event "${e.type}"`);
      if (def.mandatory) continue; // cannot be switched off
      if (!['IMMEDIATE', 'DIGEST', 'OFF'].includes(e.email)) throw ApiError.badRequest('Email must be immediate, digest or off');
      await prisma.qcNotificationPref.upsert({
        where: { userId_eventType: { userId: ctx.userId, eventType: e.type } },
        create: { userId: ctx.userId, eventType: e.type, inApp: e.inApp !== false, email: e.email },
        update: { inApp: e.inApp !== false, email: e.email },
      });
    }
    res.status(200).json({ success: true });
  }),
  registerPush: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = payloadOf(req);
    const token = String(body.token ?? '');
    if (!/^ExponentPushToken\[.+\]$|^ExpoPushToken\[.+\]$/.test(token)) throw ApiError.badRequest('Not a valid push token');
    await prisma.qcPushToken.upsert({ where: { token }, create: { token, userId: ctx.userId, platform: String(body.platform ?? 'unknown') }, update: { userId: ctx.userId } });
    res.status(200).json({ success: true });
  }),
  unregisterPush: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    await prisma.qcPushToken.deleteMany({ where: { userId: ctx.userId, token: String(payloadOf(req).token ?? '') } });
    res.status(200).json({ success: true });
  }),

  // ─── Audit trail and security log (E31) ───
  listAudit: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const clientId = ctx.isSA && !ctx.clientId ? null : requireTenant(ctx);
    const where: Prisma.QcAuditEntryWhereInput = {
      clientId,
      entityType: q(req.query.entityType),
      entityId: q(req.query.entityId),
      action: q(req.query.action) ? { startsWith: q(req.query.action)! } : undefined,
      actorId: q(req.query.actorId),
      createdAt: { gte: q(req.query.from) ? new Date(String(req.query.from)) : undefined, lte: q(req.query.to) ? new Date(`${String(req.query.to)}T23:59:59Z`) : undefined },
    };
    const rows = await prisma.qcAuditEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(Number(req.query.limit) || 100, 500), skip: Number(req.query.offset) || 0 });
    const actors = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actorId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } });
    res.status(200).json({ entries: rows.map((r) => ({ ...r, actor: actors.find((a) => a.id === r.actorId) ?? null })) });
  }),
  verifyAudit: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    res.status(200).json(await verifyAuditChain(ctx.isSA && !ctx.clientId ? null : requireTenant(ctx)));
  }),
  listSecurity: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const clientId = ctx.isSA && !ctx.clientId ? undefined : requireTenant(ctx);
    const rows = await prisma.qcSecurityEvent.findMany({
      where: { clientId, type: q(req.query.type), userId: q(req.query.userId), createdAt: { gte: q(req.query.from) ? new Date(String(req.query.from)) : undefined } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 100, 500),
      skip: Number(req.query.offset) || 0,
    });
    const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter((x): x is string => !!x) } }, select: { id: true, name: true, email: true } });
    res.status(200).json({ events: rows.map((r) => ({ ...r, user: users.find((u) => u.id === r.userId) ?? null })) });
  }),
  /** Support sessions are visible to the client they touched (E32). */
  listSupportSessions: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const clientId = requireTenant(ctx);
    const rows = await prisma.qcSupportSession.findMany({ where: { clientId }, orderBy: { startedAt: 'desc' }, take: 100, include: { user: { select: { id: true, name: true, email: true } } } });
    const audits = await prisma.qcAuditEntry.groupBy({ by: ['supportSessionId'], where: { clientId, supportSessionId: { not: null } }, _count: true });
    res.status(200).json({ sessions: rows.map((r) => ({ ...r, actionsPerformed: audits.find((a) => a.supportSessionId === r.id)?._count ?? 0 })) });
  }),

  // ─── Client defaults (REQ-CLT-003): settings a Client Admin controls for their own client ───
  getClientDefaults: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    await assertClientAccess(ctx, id(req));
    const client = await prisma.qcClient.findUniqueOrThrow({ where: { id: id(req) } });
    const d = client.data as Record<string, unknown>;
    res.status(200).json({
      defaults: {
        idle_session_timeout: d.idle_session_timeout ?? 30,
        mfa_required_for_all_roles: d.mfa_required_for_all_roles ?? false,
        report_footer_text: d.report_footer_text ?? '',
        privacy_contact_email: d.privacy_contact_email ?? '',
        default_time_zone: d.default_time_zone ?? null,
        retention_period: d.retention_period ?? null,
      },
      plan: d.plan_and_limits ?? null,
    });
  }),
  saveClientDefaults: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    await assertClientAccess(ctx, id(req));
    const body = payloadOf(req);
    const allowed = ['idle_session_timeout', 'mfa_required_for_all_roles', 'report_footer_text', 'privacy_contact_email', 'default_time_zone'];
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    if ('idle_session_timeout' in patch) {
      const n = Number(patch.idle_session_timeout);
      if (!Number.isInteger(n) || n < 5 || n > 120) throw ApiError.badRequest('Idle session timeout must be 5 to 120 minutes');
      patch.idle_session_timeout = n;
    }
    const client = await prisma.qcClient.findUniqueOrThrow({ where: { id: id(req) } });
    const before = client.data as Record<string, unknown>;
    await prisma.qcClient.update({ where: { id: id(req) }, data: { data: { ...before, ...patch } as Prisma.InputJsonValue } });
    await recordAudit({
      clientId: id(req), entityType: 'Client', entityId: id(req), action: 'client.defaults', actor: actorOf(ctx), supportSessionId: ctx.supportSession?.id ?? null,
      before: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k] ?? null])), after: patch,
    });
    res.status(200).json({ success: true });
  }),

  // ─── Legal holds, tenant export and offboarding ───
  listHolds: asyncHandler(async (req, res) => {
    const clientId = requireTenant(ctxOf(req));
    res.status(200).json({ holds: await prisma.qcRecord.findMany({ where: { kind: 'legal_hold', clientId }, orderBy: { createdAt: 'desc' } }) });
  }),
  placeHold: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const clientId = requireTenant(ctx);
    const body = payloadOf(req);
    const kind = body.scope === 'Project' ? 'project' : body.scope === 'Lot' ? 'lot' : 'defect';
    const owner = await ownerOf(kind, String(body.subject ?? ''));
    if (!owner || owner.clientId !== clientId) throw ApiError.notFound('Subject not found');
    res.status(201).json({ hold: await privacy.placeLegalHold(ctx, clientId, body) });
  }),
  releaseHold: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const hold = await prisma.qcRecord.findFirst({ where: { id: id(req), kind: 'legal_hold' } });
    if (!hold) throw ApiError.notFound('Legal hold not found');
    await assertClientAccess(ctx, hold.clientId);
    res.status(200).json({ hold: await privacy.releaseLegalHold(ctx, id(req), String(payloadOf(req).reason ?? '')) });
  }),
  exportTenant: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    await assertClientAccess(ctx, id(req));
    const body = payloadOf(req);
    const contents = Array.isArray(body.export_contents) ? (body.export_contents as string[]) : ['Data (CSV, JSON)'];
    const data = await privacy.exportTenant(ctx, id(req), contents);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="tenant-export-${id(req)}.json"`);
    res.status(200).send(JSON.stringify(data, null, 2));
  }),
  offboard: asyncHandler(async (req, res) => {
    res.status(200).json(await privacy.startOffboarding(ctxOf(req), id(req), payloadOf(req)));
  }),
  destroy: asyncHandler(async (req, res) => {
    res.status(200).json({ record: await privacy.destroyTenant(ctxOf(req), id(req)) });
  }),

  // ─── Platform privacy registers (Super Admin) ───
  listPrivacyRequests: asyncHandler(async (_req, res) => {
    res.status(200).json({ requests: await privacy.listPrivacyRequests() });
  }),
  createPrivacyRequest: asyncHandler(async (req, res) => {
    res.status(201).json({ request: await privacy.createPrivacyRequest(ctxOf(req), payloadOf(req)) });
  }),
  updatePrivacyRequest: asyncHandler(async (req, res) => {
    res.status(200).json({ request: await privacy.updatePrivacyRequest(ctxOf(req), id(req), payloadOf(req)) });
  }),
  exportPersonal: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    const data = await privacy.exportPersonalData(ctxOf(req), id(req), String(body.userId ?? ''));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="personal-data-${id(req)}.json"`);
    res.status(200).send(JSON.stringify(data, null, 2));
  }),
  listBreaches: asyncHandler(async (_req, res) => {
    res.status(200).json({ incidents: await privacy.listByKind('breach') });
  }),
  createBreach: asyncHandler(async (req, res) => {
    res.status(201).json({ incident: await privacy.createBreach(ctxOf(req), payloadOf(req)) });
  }),
  updateBreach: asyncHandler(async (req, res) => {
    res.status(200).json({ incident: await privacy.updateBreach(ctxOf(req), id(req), payloadOf(req)) });
  }),
  listSubProcessors: asyncHandler(async (_req, res) => {
    res.status(200).json({ subProcessors: await privacy.listByKind('subprocessor') });
  }),
  saveSubProcessor: asyncHandler(async (req, res) => {
    const rid = req.params.id ?? null;
    res.status(rid ? 200 : 201).json({ subProcessor: await privacy.saveSubProcessor(ctxOf(req), rid, payloadOf(req)) });
  }),
  listRetentionDue: asyncHandler(async (_req, res) => {
    res.status(200).json({ due: await privacy.listByKind('retention_due'), destroyed: await privacy.listByKind('destruction_record') });
  }),

  // ─── Plan, for the Super Admin and the client's own admin ───
  usage: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const clientId = requireTenant(ctx);
    const [users, projects] = await Promise.all([
      prisma.qcMembership.count({ where: { clientId, status: 'ACTIVE' } }),
      prisma.qcProject.count({ where: { clientId, status: { notIn: ['ARCHIVED', 'DLP_COMPLETE'] } } }),
    ]);
    const client = await prisma.qcClient.findUniqueOrThrow({ where: { id: clientId }, select: { data: true } });
    const plan = (client.data as Record<string, unknown>).plan_and_limits;
    const storageBytes = await master.storageUsedBytes(clientId);
    res.status(200).json({ users, projects, storageBytes, plan: plan ?? null, canView: can(ctx, 'client.defaults') });
  }),
};
