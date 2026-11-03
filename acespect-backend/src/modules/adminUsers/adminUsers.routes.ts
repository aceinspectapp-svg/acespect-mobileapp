import { Router, type Request, type Response } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { createUser, createUserSchema } from './adminUsers.service';

/** The Admin creates inspector and reviewer accounts. Admin only. */
const router = Router();
router.post('/', requireAuth, requireRole('ADMIN'), validate(createUserSchema), asyncHandler(async (req: Request, res: Response) => {
  res.status(201).json(await createUser(req.body));
}));

export const adminUsersRouter = router;
