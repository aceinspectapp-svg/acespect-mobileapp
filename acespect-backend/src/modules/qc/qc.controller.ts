import { Request } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { qcService } from './qc.service';
import { serializeTask } from './qc.serializers';
import { getDefectForUser } from './qc.defects.service';
import { availableActions } from './qc.lifecycle';

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
  // ─── Config: Property types ────────────────────────────────────────────
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

  // ─── Assignee roster ───────────────────────────────────────────────────
  listAssignableUsers: asyncHandler(async (_req, res) => {
    res.status(200).json({ users: await qcService.listAssignableUsers() });
  }),

  // ─── Tasks (field-user facing) ─────────────────────────────────────────
  listMyTasks: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const tasks = await qcService.listMyTasks(user.id);
    res.status(200).json({ tasks: tasks.map((t) => serializeTask(t)) });
  }),
  getTask: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const task = await qcService.getTaskById(requireId(req), user.id, user.role);
    // The task screen links into its defect, so hand over what this user may do to it.
    const { defect, actor } = await getDefectForUser(task.defectId, user);
    const view = {
      statusKey: defect.status.key,
      isDraft: defect.isDraft,
      severityKey: defect.severity?.key ?? null,
      disputeBy: defect.disputeBy,
      disputeReviewRequested: defect.disputeReviewRequested,
      flags: defect.flags ?? [],
      closurePolicy: defect.property.project.closurePolicy,
      deskReviewAllowed: defect.property.project.deskReviewAllowed,
    };
    res.status(200).json({ task: serializeTask(task, availableActions(actor, view)) });
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
  updateTaskStatus: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const task = await qcService.updateTaskStatus(requireId(req, 'Task id'), req.body.status, user.id, user.role);
    res.status(200).json({ task: serializeTask(task) });
  }),

  // ─── Config bundle ─────────────────────────────────────────────────────
  getConfig: asyncHandler(async (req, res) => {
    res.status(200).json(await qcService.getConfig(requireUser(req)));
  }),
};
