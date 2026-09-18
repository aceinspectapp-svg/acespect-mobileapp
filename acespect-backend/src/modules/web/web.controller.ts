import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { webService } from './web.service';

export const webController = {
  listInspections: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const inspections = await webService.listInspections(req.user);
    res.status(200).json({ inspections });
  }),

  getInspection: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await webService.getInspection(id);
    res.status(200).json({ inspection });
  }),

  listUsers: asyncHandler(async (_req: Request, res: Response) => {
    const users = await webService.listUsers();
    res.status(200).json({ users });
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Section id is required');
    const section = await webService.updateSection(id, req.body);
    res.status(200).json({ section });
  }),

  updateInspection: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await webService.updateInspection(id, req.body);
    res.status(200).json({ inspection });
  }),

  updateDamage: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Damage id is required');
    const damage = await webService.updateDamage(id, req.body);
    res.status(200).json({ damage });
  }),
};
