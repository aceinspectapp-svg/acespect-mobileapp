import { Router } from 'express';
import { templatesController } from './templates.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createTemplateSchema, updateTemplateSchema } from './templates.schemas';

const router = Router();
const admin = requireRole('ADMIN');

// Mobile + web: the template THIS inspector is currently accepted onto for a profile+section.
router.get('/active/:inspectionType/:propertyType/:sectionKey', requireAuth, templatesController.getActive);

// Inspector: pending updates across their accepted lineages, and accepting them (profile-bundled).
// Must be declared before the admin `/:id` routes below so "updates" isn't captured as an id.
router.get('/updates', requireAuth, templatesController.listUpdates);
router.post('/updates/:inspectionType/:propertyType/accept', requireAuth, templatesController.acceptUpdates);

// Admin: per-inspector adoption status for a profile.
router.get('/adoption/:inspectionType/:propertyType', requireAuth, admin, templatesController.adoption);

// Admin: template CRUD + publish.
router.get('/summary', requireAuth, admin, templatesController.summary);
router.get('/', requireAuth, admin, templatesController.list);
router.get('/:id', requireAuth, admin, templatesController.getById);
router.post('/', requireAuth, admin, validate(createTemplateSchema), templatesController.create);
router.patch('/:id', requireAuth, admin, validate(updateTemplateSchema), templatesController.update);
router.post('/:id/publish', requireAuth, admin, templatesController.publish);

export const templatesRouter = router;
