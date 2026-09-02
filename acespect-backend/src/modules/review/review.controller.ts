import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { reviewService } from './review.service';

export const reviewController = {
  getJob: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Review job id is required');
    const job = await reviewService.getJob(id);
    res.status(200).json({ job });
  }),

  listInspectors: asyncHandler(async (_req: Request, res: Response) => {
    const inspectors = await reviewService.listInspectors();
    res.status(200).json({ inspectors });
  }),

  listInspections: asyncHandler(async (_req: Request, res: Response) => {
    const inspections = await reviewService.listInspections();
    res.status(200).json({ inspections });
  }),

  getInspectionDetail: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await reviewService.getInspectionDetail(id);
    res.status(200).json({ inspection });
  }),

  createPostDilapidation: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const { inspectorId } = req.body as { inspectorId: string };
    const assignment = await reviewService.createPostDilapidation(id, inspectorId);
    res.status(201).json({ assignment });
  }),

  decide: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Summary id is required');
    const decision = await reviewService.recordDecision(id, req.user.id, req.body);
    res.status(201).json({ decision });
  }),
};
