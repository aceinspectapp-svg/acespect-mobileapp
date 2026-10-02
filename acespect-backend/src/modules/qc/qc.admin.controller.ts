import { Request } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../lib/prisma';
import * as master from './qc.master.service';
import * as people from './qc.people.service';
import * as defects from './qc.defects.service';
import { createPerson } from './qc.people.service';
import { serializeDefect, serializeEvent } from './qc.serializers';
import { getSpecPayload } from './spec/qcSpec';
import { ROLE_LABEL, MEMBER_ROLES, DEACTIVATION_REASONS } from './qc.people.service';
import { ACTIONS } from './qc.lifecycle';

function requireId(req: Request, label = 'id'): string {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest(`${label} is required`);
  return id;
}

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

/** Multipart requests carry the JSON body in a `payload` field next to the files; plain JSON bodies are used as-is. */
function payloadOf(req: Request): Record<string, unknown> {
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

export const qcAdminController = {
  // ─── Spec, so the web/mobile form renderers share the server's field definitions ───
  getSpec: asyncHandler(async (_req, res) => {
    res.status(200).json({
      spec: getSpecPayload(),
      roles: MEMBER_ROLES.map((code) => ({ code, label: ROLE_LABEL[code] })),
      deactivationReasons: DEACTIVATION_REASONS,
      actions: ACTIONS.map((a) => ({ key: a.key, label: a.label, form: a.form })),
    });
  }),

  // ─── Clients (E01) ───
  listClients: asyncHandler(async (_req, res) => {
    res.status(200).json({ clients: await master.listClients() });
  }),
  getClient: asyncHandler(async (req, res) => {
    res.status(200).json({ client: await master.getClient(requireId(req)) });
  }),
  createClient: asyncHandler(async (req, res) => {
    const { client, firstAdmin } = await master.createClient(payloadOf(req));
    // E01 creates the first Client Admin with the client.
    const created = await createPerson({
      email_address: firstAdmin.email,
      first_name: firstAdmin.name.split(' ')[0] || firstAdmin.name,
      last_name: firstAdmin.name.split(' ').slice(1).join(' ') || '-',
      role: 'CLIENT_ADMIN',
      clientId: client.id,
    }).catch(async (err) => {
      await prisma.qcClient.delete({ where: { id: client.id } });
      throw err;
    });
    res.status(201).json({ client, firstAdmin: created.person, temporaryPassword: created.temporaryPassword });
  }),
  updateClient: asyncHandler(async (req, res) => {
    res.status(200).json({ client: await master.updateClient(requireId(req), payloadOf(req)) });
  }),
  setClientStatus: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    res.status(200).json({ client: await master.setClientStatus(requireId(req), String(body.status), q(body.reason)) });
  }),
  deleteClient: asyncHandler(async (req, res) => {
    await master.deleteClient(requireId(req));
    res.status(204).send();
  }),

  // ─── Master contractors (E02) ───
  listMasterContractors: asyncHandler(async (req, res) => {
    const rows = await master.listMasterContractors(q(req.query.clientId));
    res.status(200).json({ masterContractors: rows.map((r) => ({ ...r, insuranceStatus: master.insuranceStatus(r.data as Record<string, unknown>) })) });
  }),
  createMasterContractor: asyncHandler(async (req, res) => {
    res.status(201).json({ masterContractor: await master.createMasterContractor(payloadOf(req)) });
  }),
  updateMasterContractor: asyncHandler(async (req, res) => {
    res.status(200).json({ masterContractor: await master.updateMasterContractor(requireId(req), payloadOf(req)) });
  }),
  deleteMasterContractor: asyncHandler(async (req, res) => {
    await master.deleteMasterContractor(requireId(req));
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
  listTradeCompanies: asyncHandler(async (_req, res) => {
    res.status(200).json({ tradeCompanies: await master.listTradeCompanies() });
  }),
  createTradeCompany: asyncHandler(async (req, res) => {
    res.status(201).json({ tradeCompany: await master.createTradeCompany(payloadOf(req)) });
  }),
  updateTradeCompany: asyncHandler(async (req, res) => {
    res.status(200).json({ tradeCompany: await master.updateTradeCompany(requireId(req), payloadOf(req)) });
  }),
  deleteTradeCompany: asyncHandler(async (req, res) => {
    await master.deleteTradeCompany(requireId(req));
    res.status(204).send();
  }),

  // ─── Projects (E07), sites (E08), lots (E09) ───
  listProjects: asyncHandler(async (req, res) => {
    res.status(200).json({ projects: await master.listProjects(q(req.query.clientId)) });
  }),
  getProject: asyncHandler(async (req, res) => {
    res.status(200).json({ project: await master.getProject(requireId(req)) });
  }),
  createProject: asyncHandler(async (req, res) => {
    res.status(201).json({ project: await master.createProject(payloadOf(req)) });
  }),
  updateProject: asyncHandler(async (req, res) => {
    res.status(200).json({ project: await master.updateProject(requireId(req), payloadOf(req)) });
  }),
  deleteProject: asyncHandler(async (req, res) => {
    await master.deleteProject(requireId(req));
    res.status(204).send();
  }),
  listSites: asyncHandler(async (req, res) => {
    res.status(200).json({ sites: await master.listSites(q(req.query.projectId)) });
  }),
  createSite: asyncHandler(async (req, res) => {
    res.status(201).json({ site: await master.createSite(payloadOf(req)) });
  }),
  updateSite: asyncHandler(async (req, res) => {
    res.status(200).json({ site: await master.updateSite(requireId(req), payloadOf(req)) });
  }),
  deleteSite: asyncHandler(async (req, res) => {
    await master.deleteSite(requireId(req));
    res.status(204).send();
  }),
  listLots: asyncHandler(async (req, res) => {
    res.status(200).json({ lots: await master.listLots({ projectId: q(req.query.projectId), siteId: q(req.query.siteId) }) });
  }),
  createLot: asyncHandler(async (req, res) => {
    res.status(201).json({ lot: await master.createLot(payloadOf(req)) });
  }),
  updateLot: asyncHandler(async (req, res) => {
    res.status(200).json({ lot: await master.updateLot(requireId(req), payloadOf(req)) });
  }),
  deleteLot: asyncHandler(async (req, res) => {
    await master.deleteLot(requireId(req));
    res.status(204).send();
  }),

  // ─── People (E04/E05/E06) and the project team (E10) ───
  listPeople: asyncHandler(async (req, res) => {
    res.status(200).json({ people: await people.listPeople({ clientId: q(req.query.clientId), role: q(req.query.role), q: q(req.query.q) }) });
  }),
  createPerson: asyncHandler(async (req, res) => {
    res.status(201).json(await people.createPerson(payloadOf(req)));
  }),
  updatePerson: asyncHandler(async (req, res) => {
    res.status(200).json({ person: await people.updatePerson(requireId(req), payloadOf(req)) });
  }),
  deactivatePerson: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    res.status(200).json(await people.deactivatePerson(requireId(req), { reason: String(body.reason ?? ''), reassignToId: q(body.reassignToId) }));
  }),
  reactivatePerson: asyncHandler(async (req, res) => {
    await people.reactivatePerson(requireId(req));
    res.status(204).send();
  }),
  saveCredentials: asyncHandler(async (req, res) => {
    res.status(200).json({ credentials: await people.saveCredentials(requireId(req), payloadOf(req)) });
  }),
  setCredentialStatus: asyncHandler(async (req, res) => {
    res.status(200).json({ credentials: await people.setCredentialStatus(requireId(req), String(payloadOf(req).status)) });
  }),
  listTeam: asyncHandler(async (req, res) => {
    res.status(200).json({ team: await people.listTeam(requireId(req)) });
  }),
  addTeamMember: asyncHandler(async (req, res) => {
    res.status(201).json({ member: await people.addTeamMember(requireId(req), payloadOf(req)) });
  }),
  removeTeamMember: asyncHandler(async (req, res) => {
    await people.removeTeamMember(requireId(req), q(payloadOf(req).removalReason));
    res.status(204).send();
  }),

  // ─── Defects ───
  listDefects: asyncHandler(async (req, res) => {
    const draft = req.query.draft === 'true' ? true : req.query.draft === 'false' ? false : undefined;
    const rows = await defects.listDefects({
      propertyId: q(req.query.propertyId),
      projectId: q(req.query.projectId),
      clientId: q(req.query.clientId),
      statusKey: q(req.query.status),
      severityKey: q(req.query.severity),
      assignedToId: q(req.query.assignedToId),
      q: q(req.query.q),
      draft,
      flag: q(req.query.flag),
    });
    res.status(200).json({ defects: rows.map((d) => serializeDefect(d)) });
  }),
  createDefect: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const body = payloadOf(req) as Parameters<typeof defects.createDefect>[1];
    const defect = await defects.createDefect(user, body);
    res.status(201).json({ defect: serializeDefect(defect) });
  }),
  getDefect: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const detail = await defects.getDefectDetail(requireId(req), user);
    const statusById = new Map(detail.statuses.map((s) => [s.id, { key: s.key, label: s.label }]));
    res.status(200).json({
      defect: serializeDefect(detail.defect, { allowedActions: detail.allowedActions }),
      events: detail.events.map((e) => serializeEvent(e, statusById)),
      comments: detail.comments,
      actorRole: detail.actor.role,
    });
  }),
  updateDefect: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const defect = await defects.updateDefect(requireId(req), payloadOf(req), user);
    res.status(200).json({ defect: serializeDefect(defect) });
  }),
  performAction: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const body = payloadOf(req);
    const fileUrls = await storeUploads(req);
    const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : undefined;
    const detail = await defects.performAction({
      defectId: requireId(req),
      action: String(req.params.action),
      input: body,
      fileUrls,
      requester: user,
      expectedUpdatedAt: expected,
    });
    const statusById = new Map(detail.statuses.map((s) => [s.id, { key: s.key, label: s.label }]));
    res.status(200).json({
      defect: serializeDefect(detail.defect, { allowedActions: detail.allowedActions }),
      events: detail.events.map((e) => serializeEvent(e, statusById)),
      comments: detail.comments,
      actorRole: detail.actor.role,
    });
  }),
  postComment: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const body = payloadOf(req);
    const comment = await defects.postComment(requireId(req), user, { text: String(body.text ?? ''), visibleTo: q(body.visibleTo) }, await storeUploads(req));
    res.status(201).json({ comment });
  }),
  addPhotos: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const defect = await defects.addDefectPhotos(requireId(req), user, await storeUploads(req));
    res.status(200).json({ defect: serializeDefect(defect) });
  }),
};
