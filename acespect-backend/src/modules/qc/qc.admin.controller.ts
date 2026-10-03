import { Request } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../lib/prisma';
import { recordAudit } from '../../lib/audit';
import * as master from './qc.master.service';
import * as people from './qc.people.service';
import * as defects from './qc.defects.service';
import { createPerson } from './qc.people.service';
import { serializeComment, serializeDefect, serializeEvent } from './qc.serializers';
import { getSpecPayload } from './spec/qcSpec';
import { ROLE_LABEL, MEMBER_ROLES, DEACTIVATION_REASONS } from './qc.people.service';
import { ACTIONS } from './qc.lifecycle';
import { actorOf, assertClientAccess, ctxOf, projectScope } from './qc.context';
import { guardEntity, tenantOf } from './qc.guard';
import { OPTIONAL_PERMISSIONS, can } from './qc.permissions';
import { authService } from '../auth/auth.service';

function requireId(req: Request, label = 'id'): string {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest(`${label} is required`);
  return id;
}

/** The authenticated user plus the QC context, so the defect service acts as the right role in the right client. */
function requester(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return { id: req.user.id, role: req.user.role, ctx: ctxOf(req) };
}

/** Multipart requests carry the JSON body in a `payload` field next to the files; plain JSON bodies are used as-is. */
export function payloadOf(req: Request): Record<string, unknown> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.payload === 'string') {
    try {
      const parsed = JSON.parse(body.payload);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      throw ApiError.badRequest('payload must be valid JSON');
    }
  }
  return body;
}

async function storeUploads(req: Request): Promise<string[]> {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) return [];
  const { uploadPhoto } = await import('../../lib/storage');
  const urls: string[] = [];
  for (const file of files) {
    const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const uploaded = await uploadPhoto(file.buffer, file.mimetype || 'image/jpeg', ext);
    urls.push(uploaded.url);
  }
  return urls;
}

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const actorFor = (req: Request) => actorOf(ctxOf(req));

export const qcAdminController = {
  // ─── Spec, so the web/mobile form renderers share the server's field definitions ───
  getSpec: asyncHandler(async (_req, res) => {
    res.status(200).json({
      spec: getSpecPayload(),
      roles: MEMBER_ROLES.map((code) => ({ code, label: ROLE_LABEL[code] })),
      deactivationReasons: DEACTIVATION_REASONS,
      optionalPermissions: OPTIONAL_PERMISSIONS,
      actions: ACTIONS.map((a) => ({ key: a.key, label: a.label, form: a.form })),
    });
  }),

  // ─── Clients (E01): the Super Admin manages them; a client's own people can read their client ───
  listClients: asyncHandler(async (_req, res) => {
    res.status(200).json({ clients: await master.listClients() });
  }),
  getClient: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const id = requireId(req);
    if (!ctx.isSA) await assertClientAccess(ctx, id);
    res.status(200).json({ client: await master.getClient(id) });
  }),
  createClient: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const { client, firstAdmin } = await master.createClient(payloadOf(req));
    // E01 creates the first Client Admin with the client; they get an activation link.
    const created = await createPerson(
      {
        email_address: firstAdmin.email,
        first_name: firstAdmin.name.split(' ')[0] || firstAdmin.name,
        last_name: firstAdmin.name.split(' ').slice(1).join(' ') || '-',
        role: 'CLIENT_ADMIN',
        clientId: client.id,
      },
      ctx,
      { platformOnboarding: true },
    ).catch(async (err) => {
      await prisma.qcClient.delete({ where: { id: client.id } });
      throw err;
    });
    await recordAudit({ clientId: client.id, entityType: 'Client', entityId: client.id, action: 'client.create', actor: actorFor(req), after: { name: client.name } });
    res.status(201).json({ client, firstAdmin: created.person, invitation: created.invitation });
  }),
  updateClient: asyncHandler(async (req, res) => {
    const before = await master.getClient(requireId(req));
    const client = await master.updateClient(requireId(req), payloadOf(req));
    await recordAudit({ clientId: client.id, entityType: 'Client', entityId: client.id, action: 'client.update', actor: actorFor(req), before: before.data, after: client.data });
    res.status(200).json({ client });
  }),
  setClientStatus: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    const client = await master.setClientStatus(requireId(req), String(body.status), q(body.reason));
    await recordAudit({ clientId: client.id, entityType: 'Client', entityId: client.id, action: `client.${String(body.status).toLowerCase()}`, actor: actorFor(req), reason: q(body.reason) ?? null });
    // A suspended client's sessions end within a minute.
    if (client.status !== 'ACTIVE') {
      const members = await prisma.qcMembership.findMany({ where: { clientId: client.id }, select: { userId: true } });
      for (const m of members) await authService.revokeSessionsIfOnlyClient(m.userId, client.id, `client ${client.status}`);
    }
    res.status(200).json({ client });
  }),
  deleteClient: asyncHandler(async (req, res) => {
    await master.deleteClient(requireId(req));
    res.status(204).send();
  }),

  // ─── Master contractors (E02) ───
  listMasterContractors: asyncHandler(async (req, res) => {
    const rows = await master.listMasterContractors(tenantOf(req));
    res.status(200).json({ masterContractors: rows.map((r) => ({ ...r, insuranceStatus: master.insuranceStatus(r.data as Record<string, unknown>) })) });
  }),
  createMasterContractor: asyncHandler(async (req, res) => {
    const row = await master.createMasterContractor({ ...payloadOf(req), clientId: tenantOf(req) });
    await recordAudit({ clientId: row.clientId, entityType: 'MasterContractor', entityId: row.id, action: 'mc.create', actor: actorFor(req), after: { name: row.name } });
    res.status(201).json({ masterContractor: row });
  }),
  updateMasterContractor: asyncHandler(async (req, res) => {
    const owner = await guardEntity(req, 'masterContractor', requireId(req));
    const row = await master.updateMasterContractor(requireId(req), payloadOf(req));
    await recordAudit({ clientId: owner.clientId, entityType: 'MasterContractor', entityId: row.id, action: 'mc.update', actor: actorFor(req), after: { name: row.name, status: row.status } });
    res.status(200).json({ masterContractor: row });
  }),
  deleteMasterContractor: asyncHandler(async (req, res) => {
    const owner = await guardEntity(req, 'masterContractor', requireId(req));
    await master.deleteMasterContractor(requireId(req));
    await recordAudit({ clientId: owner.clientId, entityType: 'MasterContractor', entityId: requireId(req), action: 'mc.delete', actor: actorFor(req) });
    res.status(204).send();
  }),

  // ─── Trade categories (E19) and trade companies (E03) ───
  listTradeCategories: asyncHandler(async (_req, res) => {
    res.status(200).json({ tradeCategories: await master.listTradeCategories() });
  }),
  createTradeCategory: asyncHandler(async (req, res) => {
    res.status(201).json({ tradeCategory: await master.createTradeCategory(payloadOf(req)) });
  }),
  updateTradeCategory: asyncHandler(async (req, res) => {
    res.status(200).json({ tradeCategory: await master.updateTradeCategory(requireId(req), payloadOf(req)) });
  }),
  deleteTradeCategory: asyncHandler(async (req, res) => {
    res.status(200).json(await master.deleteTradeCategory(requireId(req)));
  }),
  listTradeCompanies: asyncHandler(async (req, res) => {
    res.status(200).json({ tradeCompanies: await master.listTradeCompanies(tenantOf(req)) });
  }),
  createTradeCompany: asyncHandler(async (req, res) => {
    const clientId = tenantOf(req);
    const body = payloadOf(req);
    const ctx = ctxOf(req);
    // The company must be engaged by contractors of this client; a Master Contractor engages their own.
    let engaged = Array.isArray(body.engaged_by) ? (body.engaged_by as string[]) : [];
    if (ctx.role === 'MC_MANAGER' || ctx.role === 'MC_PROJECT_MANAGER') engaged = [ctx.membership!.masterContractorId!].filter(Boolean);
    if (engaged.length === 0) throw ApiError.badRequest('Choose the Master Contractor that engages this company');
    const owners = await prisma.qcMasterContractor.findMany({ where: { id: { in: engaged } }, select: { id: true, clientId: true } });
    if (owners.length !== engaged.length || owners.some((o) => o.clientId !== clientId)) throw ApiError.badRequest('A selected Master Contractor belongs to a different client');
    const row = await master.createTradeCompany({ ...body, engaged_by: engaged });
    await recordAudit({ clientId, entityType: 'TradeCompany', entityId: row.id, action: 'trade.create', actor: actorFor(req), after: { name: row.name } });
    res.status(201).json({ tradeCompany: row });
  }),
  updateTradeCompany: asyncHandler(async (req, res) => {
    const owner = await guardEntity(req, 'tradeCompany', requireId(req));
    const row = await master.updateTradeCompany(requireId(req), payloadOf(req));
    await recordAudit({ clientId: owner.clientId, entityType: 'TradeCompany', entityId: row.id, action: 'trade.update', actor: actorFor(req), after: { name: row.name, status: row.status } });
    res.status(200).json({ tradeCompany: row });
  }),
  deleteTradeCompany: asyncHandler(async (req, res) => {
    const owner = await guardEntity(req, 'tradeCompany', requireId(req));
    await master.deleteTradeCompany(requireId(req));
    await recordAudit({ clientId: owner.clientId, entityType: 'TradeCompany', entityId: requireId(req), action: 'trade.delete', actor: actorFor(req) });
    res.status(204).send();
  }),

  // ─── Projects (E07), sites (E08), lots (E09) ───
  listProjects: asyncHandler(async (req, res) => {
    res.status(200).json({ projects: await master.listProjects(projectScope(ctxOf(req))) });
  }),
  getProject: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', requireId(req));
    res.status(200).json({ project: await master.getProject(requireId(req)) });
  }),
  createProject: asyncHandler(async (req, res) => {
    const clientId = tenantOf(req);
    const project = await master.createProject({ ...payloadOf(req), developer: clientId });
    await recordAudit({ clientId, entityType: 'Project', entityId: project.id, action: 'project.create', actor: actorFor(req), after: { name: project.name } });
    res.status(201).json({ project });
  }),
  updateProject: asyncHandler(async (req, res) => {
    const owner = await guardEntity(req, 'project', requireId(req));
    const body = { ...payloadOf(req), developer: owner.clientId };
    if ('status' in body) throw ApiError.badRequest('Project status changes through POST /qc/projects/:id/status, which checks the guards for each move');
    // Status moves and policy switches have their own capabilities and guards.
    const ctx = ctxOf(req);
    if (('status' in body || 'closurePolicy' in body || 'deskReviewAllowed' in body || 'safetyAutoRelease' in body) && !can(ctx, 'projects.status')) {
      throw ApiError.forbidden('You cannot change project status or policy');
    }
    const before = await master.getProject(requireId(req));
    const project = await master.updateProject(requireId(req), body);
    await recordAudit({
      clientId: owner.clientId, entityType: 'Project', entityId: project.id, action: 'project.update', actor: actorFor(req),
      before: { name: before.name, status: before.status, closurePolicy: before.closurePolicy },
      after: { name: project.name, status: project.status, closurePolicy: project.closurePolicy },
    });
    res.status(200).json({ project });
  }),
  deleteProject: asyncHandler(async (req, res) => {
    const owner = await guardEntity(req, 'project', requireId(req));
    await master.deleteProject(requireId(req));
    await recordAudit({ clientId: owner.clientId, entityType: 'Project', entityId: requireId(req), action: 'project.delete', actor: actorFor(req) });
    res.status(204).send();
  }),
  listSites: asyncHandler(async (req, res) => {
    const projectId = q(req.query.projectId);
    if (projectId) await guardEntity(req, 'project', projectId);
    res.status(200).json({ sites: await master.listSites(projectId, projectScope(ctxOf(req))) });
  }),
  createSite: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    await guardEntity(req, 'project', String(body.projectId ?? ''));
    res.status(201).json({ site: await master.createSite(body) });
  }),
  updateSite: asyncHandler(async (req, res) => {
    await guardEntity(req, 'site', requireId(req));
    res.status(200).json({ site: await master.updateSite(requireId(req), payloadOf(req)) });
  }),
  deleteSite: asyncHandler(async (req, res) => {
    await guardEntity(req, 'site', requireId(req));
    await master.deleteSite(requireId(req));
    res.status(204).send();
  }),
  listLots: asyncHandler(async (req, res) => {
    const projectId = q(req.query.projectId);
    if (projectId) await guardEntity(req, 'project', projectId);
    res.status(200).json({ lots: await master.listLots({ projectId, siteId: q(req.query.siteId) }, projectScope(ctxOf(req))) });
  }),
  createLot: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    await guardEntity(req, 'site', String(body.siteId ?? ''));
    res.status(201).json({ lot: await master.createLot(body) });
  }),
  updateLot: asyncHandler(async (req, res) => {
    await guardEntity(req, 'lot', requireId(req));
    res.status(200).json({ lot: await master.updateLot(requireId(req), payloadOf(req)) });
  }),
  deleteLot: asyncHandler(async (req, res) => {
    await guardEntity(req, 'lot', requireId(req));
    await master.deleteLot(requireId(req));
    res.status(204).send();
  }),

  // ─── People (E04/E05/E06) and the project team (E10) ───
  listPeople: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    // The Super Admin manages Private Inspector credentials platform-wide; everything else is per client.
    if (ctx.isSA && !ctx.clientId) {
      res.status(200).json({ people: await people.listPeople({ role: 'PRIVATE_INSPECTOR', q: q(req.query.q) }) });
      return;
    }
    const clientId = tenantOf(req);
    const mc = ctx.role === 'MC_MANAGER' || ctx.role === 'MC_PROJECT_MANAGER' ? ctx.membership?.masterContractorId ?? undefined : undefined;
    const role = q(req.query.role);
    res.status(200).json({ people: await people.listPeople({ clientId, role, q: q(req.query.q), masterContractorId: mc && role !== 'TRADE_USER' ? mc : undefined }) });
  }),
  createPerson: asyncHandler(async (req, res) => {
    res.status(201).json(await people.createPerson(payloadOf(req), ctxOf(req)));
  }),
  updatePerson: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const id = requireId(req);
    await guardEntity(req, 'person', id);
    const body = payloadOf(req);
    const target = await prisma.qcMembership.findFirst({ where: { userId: id, clientId: ctx.clientId ?? undefined } });
    if (target) people.assertMayManage(ctx, target.role, target.masterContractorId);
    else if (!ctx.isSA && id !== ctx.userId) throw ApiError.forbidden('You cannot edit this person');
    if ('optionalPermissions' in body && !can(ctx, 'users.grantPermissions')) throw ApiError.forbidden('You cannot grant permissions');
    const person = await people.updatePerson(id, body);
    await recordAudit({ clientId: ctx.clientId, entityType: 'User', entityId: id, action: 'user.update', actor: actorFor(req), after: { fields: Object.keys(body) } });
    res.status(200).json({ person });
  }),
  deactivatePerson: asyncHandler(async (req, res) => {
    const id = requireId(req);
    await guardEntity(req, 'person', id);
    const body = payloadOf(req);
    res.status(200).json(await people.deactivatePerson(id, { reason: String(body.reason ?? ''), reassignToId: q(body.reassignToId) }, ctxOf(req)));
  }),
  reactivatePerson: asyncHandler(async (req, res) => {
    await guardEntity(req, 'person', requireId(req));
    await people.reactivatePerson(requireId(req), ctxOf(req));
    res.status(204).send();
  }),
  resendInvitation: asyncHandler(async (req, res) => {
    const id = requireId(req);
    await guardEntity(req, 'person', id);
    const ctx = ctxOf(req);
    const target = await prisma.qcMembership.findFirst({ where: { userId: id, clientId: ctx.clientId ?? undefined } });
    if (target) people.assertMayManage(ctx, target.role, target.masterContractorId);
    res.status(200).json({ invitation: await people.sendInvitation(id, ctx.userId) });
  }),
  saveCredentials: asyncHandler(async (req, res) => {
    res.status(200).json({ credentials: await people.saveCredentials(requireId(req), payloadOf(req)) });
  }),
  setCredentialStatus: asyncHandler(async (req, res) => {
    const credentials = await people.setCredentialStatus(requireId(req), String(payloadOf(req).status));
    await recordAudit({ clientId: null, entityType: 'InspectorCredential', entityId: requireId(req), action: 'credential.status', actor: actorFor(req), after: { status: credentials.status } });
    res.status(200).json({ credentials });
  }),
  listTeam: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', requireId(req));
    res.status(200).json({ team: await people.listTeam(requireId(req)) });
  }),
  addTeamMember: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', requireId(req));
    res.status(201).json({ member: await people.addTeamMember(requireId(req), payloadOf(req)) });
  }),
  removeTeamMember: asyncHandler(async (req, res) => {
    await guardEntity(req, 'team', requireId(req));
    await people.removeTeamMember(requireId(req), q(payloadOf(req).removalReason));
    res.status(204).send();
  }),

  // ─── Defects ───
  listDefects: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const draft = req.query.draft === 'true' ? true : req.query.draft === 'false' ? false : undefined;
    const projectId = q(req.query.projectId);
    if (projectId) await guardEntity(req, 'project', projectId);
    const rows = await defects.listDefects(
      {
        propertyId: q(req.query.propertyId),
        projectId,
        statusKey: q(req.query.status),
        severityKey: q(req.query.severity),
        assignedToId: q(req.query.assignedToId),
        q: q(req.query.q),
        draft,
        flag: q(req.query.flag),
        limit: Math.min(Number(req.query.limit) || 500, 1000),
        offset: Number(req.query.offset) || 0,
      },
      ctx,
    );
    res.status(200).json({ defects: rows.map((d) => serializeDefect(d)) });
  }),
  createDefect: asyncHandler(async (req, res) => {
    const user = requester(req);
    const body = payloadOf(req) as Parameters<typeof defects.createDefect>[1];
    await guardEntity(req, 'lot', String(body.propertyId ?? ''));
    const defect = await defects.createDefect(user, body);
    res.status(201).json({ defect: serializeDefect(defect) });
  }),
  getDefect: asyncHandler(async (req, res) => {
    const detail = await defects.getDefectDetail(requireId(req), requester(req));
    const statusById = new Map(detail.statuses.map((s) => [s.id, { key: s.key, label: s.label }]));
    res.status(200).json({
      defect: serializeDefect(detail.defect, { allowedActions: detail.allowedActions }),
      events: detail.events.map((e) => serializeEvent(e, statusById)),
      comments: detail.comments.map(serializeComment),
      actorRole: detail.actor.role,
    });
  }),
  updateDefect: asyncHandler(async (req, res) => {
    const defect = await defects.updateDefect(requireId(req), payloadOf(req), requester(req));
    res.status(200).json({ defect: serializeDefect(defect) });
  }),
  performAction: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    const fileUrls = await storeUploads(req);
    const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : undefined;
    const detail = await defects.performAction({
      defectId: requireId(req),
      action: String(req.params.action),
      input: body,
      fileUrls,
      requester: requester(req),
      expectedUpdatedAt: expected,
    });
    const statusById = new Map(detail.statuses.map((s) => [s.id, { key: s.key, label: s.label }]));
    res.status(200).json({
      defect: serializeDefect(detail.defect, { allowedActions: detail.allowedActions }),
      events: detail.events.map((e) => serializeEvent(e, statusById)),
      comments: detail.comments.map(serializeComment),
      actorRole: detail.actor.role,
    });
  }),
  postComment: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    const comment = await defects.postComment(requireId(req), requester(req), { text: String(body.text ?? ''), visibleTo: q(body.visibleTo) }, await storeUploads(req));
    res.status(201).json({ comment: serializeComment(comment) });
  }),
  addPhotos: asyncHandler(async (req, res) => {
    const defect = await defects.addDefectPhotos(requireId(req), requester(req), await storeUploads(req));
    res.status(200).json({ defect: serializeDefect(defect) });
  }),
};
