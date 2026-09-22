import { Router } from 'express';
import { webController } from './web.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { damageUpdateSchema, inspectionUpdateSchema, sectionUpdateSchema, userUpdateSchema } from './web.schemas';

const router = Router();
const reviewers = requireRole('REVIEWER', 'ADMIN');
const admins = requireRole('ADMIN');

router.get('/users', requireAuth, reviewers, webController.listUsers);
router.patch('/users/:id', requireAuth, admins, validate(userUpdateSchema), webController.updateUser);
router.get('/inspections', requireAuth, webController.listInspections);
router.get('/inspections/:id', requireAuth, webController.getInspection);
router.patch(
  '/inspections/:id',
  requireAuth,
  reviewers,
  validate(inspectionUpdateSchema),
  webController.updateInspection,
);
router.patch(
  '/sections/:id',
  requireAuth,
  reviewers,
  validate(sectionUpdateSchema),
  webController.updateSection,
);
router.patch(
  '/damages/:id',
  requireAuth,
  reviewers,
  validate(damageUpdateSchema),
  webController.updateDamage,
);

export const webRouter = router;
