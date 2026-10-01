import { Router } from 'express';
import multer from 'multer';
import { qcController } from './qc.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createClientSchema,
  createDefectSchema,
  createFieldUserSchema,
  createProjectSchema,
  createPropertySchema,
  createPropertyTypeSchema,
  createSeveritySchema,
  createStatusSchema,
  postTaskUpdateSchema,
  updateClientSchema,
  updateDefectSchema,
  updateProjectSchema,
  updatePropertySchema,
  updatePropertyTypeSchema,
  updateSeveritySchema,
  updateStatusSchema,
} from './qc.schemas';

const router = Router();
const admin = requireRole('ADMIN');
// Up to 6 photos per task update, 15 MB each — same cap as inspection photo uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ─── Config bundle — any authenticated caller (dashboard + mobile both read this) ──
router.get('/config', requireAuth, qcController.getConfig);

// ─── Clients ────────────────────────────────────────────────────────────────
router.get('/clients', requireAuth, admin, qcController.listClients);
router.post('/clients', requireAuth, admin, validate(createClientSchema), qcController.createClient);
router.patch('/clients/:id', requireAuth, admin, validate(updateClientSchema), qcController.updateClient);
router.delete('/clients/:id', requireAuth, admin, qcController.deleteClient);

// ─── Projects ───────────────────────────────────────────────────────────────
router.get('/projects', requireAuth, admin, qcController.listProjects);
router.post('/projects', requireAuth, admin, validate(createProjectSchema), qcController.createProject);
router.patch('/projects/:id', requireAuth, admin, validate(updateProjectSchema), qcController.updateProject);
router.delete('/projects/:id', requireAuth, admin, qcController.deleteProject);

// ─── Properties ─────────────────────────────────────────────────────────────
router.get('/properties', requireAuth, admin, qcController.listProperties);
router.post('/properties', requireAuth, admin, validate(createPropertySchema), qcController.createProperty);
router.patch('/properties/:id', requireAuth, admin, validate(updatePropertySchema), qcController.updateProperty);
router.delete('/properties/:id', requireAuth, admin, qcController.deleteProperty);

// ─── Property Types ─────────────────────────────────────────────────────────
router.get('/property-types', requireAuth, admin, qcController.listPropertyTypes);
router.post('/property-types', requireAuth, admin, validate(createPropertyTypeSchema), qcController.createPropertyType);
router.patch('/property-types/:id', requireAuth, admin, validate(updatePropertyTypeSchema), qcController.updatePropertyType);
router.delete('/property-types/:id', requireAuth, admin, qcController.deletePropertyType);

// ─── Severities ─────────────────────────────────────────────────────────────
router.get('/severities', requireAuth, admin, qcController.listSeverities);
router.post('/severities', requireAuth, admin, validate(createSeveritySchema), qcController.createSeverity);
router.patch('/severities/:id', requireAuth, admin, validate(updateSeveritySchema), qcController.updateSeverity);
router.delete('/severities/:id', requireAuth, admin, qcController.deleteSeverity);

// ─── Statuses ───────────────────────────────────────────────────────────────
router.get('/statuses', requireAuth, admin, qcController.listStatuses);
router.post('/statuses', requireAuth, admin, validate(createStatusSchema), qcController.createStatus);
router.patch('/statuses/:id', requireAuth, admin, validate(updateStatusSchema), qcController.updateStatus);
router.delete('/statuses/:id', requireAuth, admin, qcController.deleteStatus);

// ─── Assignee roster ────────────────────────────────────────────────────────
router.get('/users', requireAuth, admin, qcController.listAssignableUsers);
router.post('/users', requireAuth, admin, validate(createFieldUserSchema), qcController.createFieldUser);

// ─── Defects ────────────────────────────────────────────────────────────────
router.get('/defects', requireAuth, admin, qcController.listDefects);
router.post('/defects', requireAuth, admin, validate(createDefectSchema), qcController.createDefect);
// Not admin-only anymore -- the field user a defect is assigned to can also
// fill in location/summary/severity from mobile; qc.service's updateDefect
// enforces that (admin, or assignedToId === caller) and that only an admin
// can reassign.
router.patch('/defects/:id', requireAuth, validate(updateDefectSchema), qcController.updateDefect);
// Read-only single-defect lookup: any authenticated caller (mobile's "Defect" link from a task).
router.get('/defects/:id', requireAuth, qcController.getDefect);

// ─── Tasks — field-user facing, self-scoped (enforced in qc.service) ────────
// Must come before /tasks/:id so "assigned" isn't captured as an id.
router.get('/tasks/assigned', requireAuth, qcController.listMyTasks);
router.get('/tasks/:id', requireAuth, qcController.getTask);
router.post(
  '/tasks/:id/updates',
  requireAuth,
  upload.array('photos', 6),
  validate(postTaskUpdateSchema),
  qcController.postTaskUpdate,
);

export const qcRouter = router;
