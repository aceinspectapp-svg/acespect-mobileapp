import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { templatesService } from './templates.service';
import { serializeTemplate } from './templates.serializers';
import { TEMPLATABLE_SECTION_KEYS } from './templates.sections';

function requireLineage(req: Request): { inspectionType: string; propertyType: string; sectionKey: string } {
  const { inspectionType, propertyType, sectionKey } = req.params;
  if (!inspectionType || !propertyType || !sectionKey) {
    throw ApiError.badRequest('inspectionType, propertyType and sectionKey are required');
  }
  return { inspectionType, propertyType, sectionKey };
}

function requireProfile(req: Request): { inspectionType: string; propertyType: string } {
  const { inspectionType, propertyType } = req.params;
  if (!inspectionType || !propertyType) {
    throw ApiError.badRequest('inspectionType and propertyType are required');
  }
  return { inspectionType, propertyType };
}

export const templatesController = {
  getActive: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const template = await templatesService.getActiveForInspector(req.user.id, requireLineage(req));
    res.status(200).json({ template: serializeTemplate(template) });
  }),

  listUpdates: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const updates = await templatesService.listPendingUpdates(req.user.id);
    res.status(200).json({ updates });
  }),

  acceptUpdates: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const acceptances = await templatesService.acceptProfileUpdates(req.user.id, requireProfile(req));
    res.status(200).json({ acceptances: acceptances.map((a) => ({ sectionKey: a.sectionKey, version: a.acceptedTemplate.version, acceptedAt: a.acceptedAt })) });
  }),

  adoption: asyncHandler(async (req: Request, res: Response) => {
    const adoption = await templatesService.getAdoption(requireProfile(req));
    res.status(200).json({ adoption });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const { inspectionType, propertyType, sectionKey } = req.query;
    if (typeof inspectionType !== 'string' || typeof propertyType !== 'string' || typeof sectionKey !== 'string') {
      throw ApiError.badRequest('inspectionType, propertyType and sectionKey query params are required');
    }
    const templates = await templatesService.list({ inspectionType, propertyType, sectionKey });
    res.status(200).json({ templates: templates.map(serializeTemplate) });
  }),

  summary: asyncHandler(async (req: Request, res: Response) => {
    const { inspectionType, propertyType } = req.query;
    if (typeof inspectionType !== 'string' || typeof propertyType !== 'string') {
      throw ApiError.badRequest('inspectionType and propertyType query params are required');
    }
    const summary = await templatesService.summary(inspectionType, propertyType, TEMPLATABLE_SECTION_KEYS);
    res.status(200).json({ summary });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Template id is required');
    const template = await templatesService.getById(id);
    res.status(200).json({ template: serializeTemplate(template) });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const template = await templatesService.create(req.user.id, req.body);
    res.status(201).json({ template: serializeTemplate(template) });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Template id is required');
    const template = await templatesService.update(id, req.body);
    res.status(200).json({ template: serializeTemplate(template) });
  }),

  publish: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Template id is required');
    const template = await templatesService.publish(id);
    res.status(200).json({ template: serializeTemplate(template) });
  }),
};
