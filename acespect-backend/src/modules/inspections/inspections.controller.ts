import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { inspectionsService } from './inspections.service';

/** Thin HTTP layer for inspection submission + lookup. */
export const inspectionsController = {
  // Saves as a DRAFT the inspector still owns — review only starts at finalize.
  submit: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { inspection } = await inspectionsService.submit(req.user.id, req.body);
    res.status(201).json({ inspectionId: inspection.id, status: inspection.status });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await inspectionsService.update(id, req.user.id, req.body);
    res.status(200).json({ inspectionId: inspection.id, status: inspection.status });
  }),

  // Point of no return: assigns a reviewer and enqueues the async review.
  finalize: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const { inspection, reviewJob } = await inspectionsService.finalize(id, req.user.id);
    res.status(202).json({
      inspectionId: inspection.id,
      reviewJobId: reviewJob.id,
      status: inspection.status,
    });
  }),

  listAssigned: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const jobs = await inspectionsService.listAssigned(req.user.id);
    res.status(200).json({ jobs });
  }),

  getBaselineSections: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const sections = await inspectionsService.getBaselineSections(id, req.user.id);
    res.status(200).json({ sections });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await inspectionsService.getById(id);
    res.status(200).json({ inspection });
  }),

  // multipart/form-data with a single "photo" file → { id, storageKey, url }.
  uploadPhoto: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const file = req.file;
    if (!file) throw ApiError.badRequest('No photo file (field name must be "photo")');
    const result = await inspectionsService.uploadPhoto(file.buffer, file.mimetype, file.originalname);
    res.status(201).json(result);
  }),
};
