import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { qcService } from './qc.service';
import { serializeDefect, serializeTask } from './qc.serializers';

function requireId(req: Request, label = 'id'): string {
  const { id } = req.params;
  if (!id) throw ApiError.badRequest(`${label} is required`);
  return id;
}

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const qcController = {
  // ─── Config: Clients ───────────────────────────────────────────────────
  listClients: asyncHandler(async (_req, res) => {
    res.status(200).json({ clients: await qcService.listClients() });
  }),
  createClient: asyncHandler(async (req, res) => {
    res.status(201).json({ client: await qcService.createClient(req.body) });
  }),
  updateClient: asyncHandler(async (req, res) => {
    res.status(200).json({ client: await qcService.updateClient(requireId(req), req.body) });
  }),
  deleteClient: asyncHandler(async (req, res) => {
    await qcService.deleteClient(requireId(req));
    res.status(204).send();
  }),

  // ─── Config: Projects ──────────────────────────────────────────────────
  listProjects: asyncHandler(async (req, res) => {
    const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
    res.status(200).json({ projects: await qcService.listProjects(clientId) });
  }),
  createProject: asyncHandler(async (req, res) => {
    res.status(201).json({ project: await qcService.createProject(req.body) });
  }),
  updateProject: asyncHandler(async (req, res) => {
    res.status(200).json({ project: await qcService.updateProject(requireId(req), req.body) });
  }),
  deleteProject: asyncHandler(async (req, res) => {
    await qcService.deleteProject(requireId(req));
    res.status(204).send();
  }),

  // ─── Config: Properties ────────────────────────────────────────────────
  listProperties: asyncHandler(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    res.status(200).json({ properties: await qcService.listProperties(projectId) });
  }),
  createProperty: asyncHandler(async (req, res) => {
    res.status(201).json({ property: await qcService.createProperty(req.body) });
  }),
  updateProperty: asyncHandler(async (req, res) => {
    res.status(200).json({ property: await qcService.updateProperty(requireId(req), req.body) });
  }),
  deleteProperty: asyncHandler(async (req, res) => {
    await qcService.deleteProperty(requireId(req));
    res.status(204).send();
  }),

  // ─── Config: Property Types ────────────────────────────────────────────
  listPropertyTypes: asyncHandler(async (_req, res) => {
    res.status(200).json({ propertyTypes: await qcService.listPropertyTypes() });
  }),
  createPropertyType: asyncHandler(async (req, res) => {
    res.status(201).json({ propertyType: await qcService.createPropertyType(req.body) });
  }),
  updatePropertyType: asyncHandler(async (req, res) => {
    res.status(200).json({ propertyType: await qcService.updatePropertyType(requireId(req), req.body) });
  }),
  deletePropertyType: asyncHandler(async (req, res) => {
    await qcService.deletePropertyType(requireId(req));
    res.status(204).send();
  }),

  // ─── Config: Severities ────────────────────────────────────────────────
  listSeverities: asyncHandler(async (_req, res) => {
    res.status(200).json({ severities: await qcService.listSeverities() });
  }),
  createSeverity: asyncHandler(async (req, res) => {
    res.status(201).json({ severity: await qcService.createSeverity(req.body) });
  }),
  updateSeverity: asyncHandler(async (req, res) => {
    res.status(200).json({ severity: await qcService.updateSeverity(requireId(req), req.body) });
  }),
  deleteSeverity: asyncHandler(async (req, res) => {
    await qcService.deleteSeverity(requireId(req));
    res.status(204).send();
  }),

  // ─── Config: Statuses ──────────────────────────────────────────────────
  listStatuses: asyncHandler(async (_req, res) => {
    res.status(200).json({ statuses: await qcService.listStatuses() });
  }),
  createStatus: asyncHandler(async (req, res) => {
    res.status(201).json({ status: await qcService.createStatus(req.body) });
  }),
  updateStatus: asyncHandler(async (req, res) => {
    res.status(200).json({ status: await qcService.updateStatus(requireId(req), req.body) });
  }),
  deleteStatus: asyncHandler(async (req, res) => {
    await qcService.deleteStatus(requireId(req));
    res.status(204).send();
  }),

  // ─── Assignee roster ───────────────────────────────────────────────────
  listAssignableUsers: asyncHandler(async (_req, res) => {
    res.status(200).json({ users: await qcService.listAssignableUsers() });
  }),
  createFieldUser: asyncHandler(async (req, res) => {
    res.status(201).json({ user: await qcService.createFieldUser(req.body) });
  }),

  // ─── Defects ────────────────────────────────────────────────────────────
  listDefects: asyncHandler(async (req, res) => {
    const { propertyId, statusId, assignedToId } = req.query;
    const defects = await qcService.listDefects({
      propertyId: typeof propertyId === 'string' ? propertyId : undefined,
      statusId: typeof statusId === 'string' ? statusId : undefined,
      assignedToId: typeof assignedToId === 'string' ? assignedToId : undefined,
    });
    res.status(200).json({ defects: defects.map(serializeDefect) });
  }),
  getDefect: asyncHandler(async (req, res) => {
    const defect = await qcService.getDefectById(requireId(req));
    res.status(200).json({ defect: serializeDefect(defect) });
  }),
  createDefect: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const defect = await qcService.createDefect(user.id, req.body);
    res.status(201).json({ defect: serializeDefect(defect) });
  }),
  updateDefect: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const defect = await qcService.updateDefect(requireId(req), req.body, user.id, user.role);
    res.status(200).json({ defect: serializeDefect(defect) });
  }),

  // ─── Tasks (field-user facing) ─────────────────────────────────────────
  listMyTasks: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const tasks = await qcService.listMyTasks(user.id);
    res.status(200).json({ tasks: tasks.map(serializeTask) });
  }),
  getTask: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const task = await qcService.getTaskById(requireId(req), user.id, user.role);
    res.status(200).json({ task: serializeTask(task) });
  }),
  postTaskUpdate: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const { uploadPhoto } = await import('../../lib/storage');
    const photoUrls: string[] = [];
    for (const file of files) {
      const ext = (file.originalname.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const uploaded = await uploadPhoto(file.buffer, file.mimetype || 'image/jpeg', ext);
      photoUrls.push(uploaded.url);
    }
    const update = await qcService.postTaskUpdate(requireId(req, 'Task id'), user.id, user.role, req.body, photoUrls);
    res.status(201).json({ update });
  }),

  // ─── Config bundle ─────────────────────────────────────────────────────
  getConfig: asyncHandler(async (_req, res) => {
    res.status(200).json(await qcService.getConfig());
  }),
};
