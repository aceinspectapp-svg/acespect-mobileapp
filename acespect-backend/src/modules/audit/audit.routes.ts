import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { auditController } from './audit.controller';
import { clientEventsSchema } from './audit.service';

const router = Router();
const admins = requireRole('ADMIN');

// What each person may see is decided in the service (admin: all; reviewer / inspector: the inspections that are theirs).
router.get('/events', requireAuth, auditController.list);
router.get('/events/:id', requireAuth, auditController.one);
router.get('/inspections/:id/timeline', requireAuth, auditController.timeline);
router.get('/facets', requireAuth, auditController.facets);
router.get('/verify', requireAuth, auditController.verify);
router.get('/health', requireAuth, admins, auditController.health);

// Exports and reports are for administrators; each one is itself recorded in the log.
router.get('/export', requireAuth, admins, auditController.export);
router.get('/reports/inspection/:id', requireAuth, admins, auditController.inspectionReport);
router.get('/reports/:kind', requireAuth, admins, auditController.periodReport);

// Events the phone recorded (some while offline); idempotent by event id.
router.post('/client-events', requireAuth, validate(clientEventsSchema), auditController.clientEvents);

export const auditRouter = router;
