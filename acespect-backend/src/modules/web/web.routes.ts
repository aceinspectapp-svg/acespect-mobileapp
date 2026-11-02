import { Router } from 'express';
import { webController } from './web.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { assignSchema, damageUpdateSchema, transferRespondSchema, inspectionUpdateSchema, sectionUpdateSchema, userUpdateSchema } from './web.schemas';

const router = Router();
const reviewers = requireRole('REVIEWER', 'ADMIN');
const admins = requireRole('ADMIN');

router.get('/users', requireAuth, reviewers, webController.listUsers);
router.patch('/users/:id', requireAuth, admins, validate(userUpdateSchema), webController.updateUser);
router.get('/assignments', requireAuth, reviewers, webController.assignmentOverview);
router.post('/inspections/:id/assign', requireAuth, reviewers, validate(assignSchema), webController.assignInspection);
router.post('/inspections/:id/transfer-requests', requireAuth, reviewers, webController.requestTransfer);
router.post('/transfer-requests/:id/respond', requireAuth, reviewers, validate(transferRespondSchema), webController.respondTransfer);
router.delete('/transfer-requests/:id', requireAuth, reviewers, webController.cancelTransfer);
router.get('/inspections', requireAuth, webController.listInspections);
router.get('/inspections/:id', requireAuth, webController.getInspection);
router.patch(
  '/inspections/:id',
  requireAuth,
  reviewers,
  validate(inspectionUpdateSchema),
  webController.updateInspection,
);
router.post('/inspections/:id/approve-all', requireAuth, reviewers, webController.approveAll);
router.post('/inspections/:id/egnyte/resolve', requireAuth, reviewers, webController.resolveEgnyte);
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
router.get('/submission-logs', requireAuth, admins, webController.listSubmissionLogs);
router.get('/mail-status', requireAuth, admins, webController.mailStatus);
router.post('/mail-test', requireAuth, admins, webController.mailTest);
router.get('/submission-health', requireAuth, admins, webController.submissionHealth);

export const webRouter = router;
