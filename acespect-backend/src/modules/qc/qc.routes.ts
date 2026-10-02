import { Router } from 'express';
import multer from 'multer';
import { qcController } from './qc.controller';
import { qcAdminController as a } from './qc.admin.controller';
import { requireAuth, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  createPropertyTypeSchema,
  postTaskUpdateSchema,
  updatePropertyTypeSchema,
  updateTaskStatusSchema,
} from './qc.schemas';

const router = Router();
const admin = requireRole('ADMIN');
// Up to 12 photos per request, 15 MB each -- same cap as inspection photo uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ─── Config bundle — any authenticated caller (dashboard + mobile both read this) ──
router.get('/config', requireAuth, qcController.getConfig);
// Field definitions for every entity and form in the requirements spec: the web
// admin and the mobile app render their forms from this.
router.get('/spec', requireAuth, a.getSpec);

// ─── Clients (E01) ──────────────────────────────────────────────────────────
router.get('/clients', requireAuth, admin, a.listClients);
router.post('/clients', requireAuth, admin, a.createClient);
router.get('/clients/:id', requireAuth, admin, a.getClient);
router.patch('/clients/:id', requireAuth, admin, a.updateClient);
router.post('/clients/:id/status', requireAuth, admin, a.setClientStatus);
router.delete('/clients/:id', requireAuth, admin, a.deleteClient);

// ─── Master contractors (E02), trade companies (E03), trade categories (E19) ─
router.get('/master-contractors', requireAuth, admin, a.listMasterContractors);
router.post('/master-contractors', requireAuth, admin, a.createMasterContractor);
router.patch('/master-contractors/:id', requireAuth, admin, a.updateMasterContractor);
router.delete('/master-contractors/:id', requireAuth, admin, a.deleteMasterContractor);

router.get('/trade-companies', requireAuth, admin, a.listTradeCompanies);
router.post('/trade-companies', requireAuth, admin, a.createTradeCompany);
router.patch('/trade-companies/:id', requireAuth, admin, a.updateTradeCompany);
router.delete('/trade-companies/:id', requireAuth, admin, a.deleteTradeCompany);

router.get('/trade-categories', requireAuth, a.listTradeCategories);
router.post('/trade-categories', requireAuth, admin, a.createTradeCategory);
router.patch('/trade-categories/:id', requireAuth, admin, a.updateTradeCategory);
router.delete('/trade-categories/:id', requireAuth, admin, a.deleteTradeCategory);

// ─── Projects (E07), sites (E08), lots (E09) and the project team (E10) ────
router.get('/projects', requireAuth, admin, a.listProjects);
router.post('/projects', requireAuth, admin, a.createProject);
router.get('/projects/:id', requireAuth, admin, a.getProject);
router.patch('/projects/:id', requireAuth, admin, a.updateProject);
router.delete('/projects/:id', requireAuth, admin, a.deleteProject);
router.get('/projects/:id/team', requireAuth, admin, a.listTeam);
router.post('/projects/:id/team', requireAuth, admin, a.addTeamMember);
router.delete('/team/:id', requireAuth, admin, a.removeTeamMember);

router.get('/sites', requireAuth, admin, a.listSites);
router.post('/sites', requireAuth, admin, a.createSite);
router.patch('/sites/:id', requireAuth, admin, a.updateSite);
router.delete('/sites/:id', requireAuth, admin, a.deleteSite);

router.get('/lots', requireAuth, admin, a.listLots);
router.post('/lots', requireAuth, admin, a.createLot);
router.patch('/lots/:id', requireAuth, admin, a.updateLot);
router.delete('/lots/:id', requireAuth, admin, a.deleteLot);

// ─── Property types (lot dwelling types shown on mobile) ────────────────────
router.get('/property-types', requireAuth, admin, qcController.listPropertyTypes);
router.post('/property-types', requireAuth, admin, validate(createPropertyTypeSchema), qcController.createPropertyType);
router.patch('/property-types/:id', requireAuth, admin, validate(updatePropertyTypeSchema), qcController.updatePropertyType);
router.delete('/property-types/:id', requireAuth, admin, qcController.deletePropertyType);

// ─── People: users, roles (memberships), inspector credentials ──────────────
router.get('/users', requireAuth, admin, qcController.listAssignableUsers);
router.get('/people', requireAuth, admin, a.listPeople);
router.post('/people', requireAuth, admin, a.createPerson);
router.patch('/people/:id', requireAuth, admin, a.updatePerson);
router.post('/people/:id/deactivate', requireAuth, admin, a.deactivatePerson);
router.post('/people/:id/reactivate', requireAuth, admin, a.reactivatePerson);
router.put('/people/:id/credentials', requireAuth, admin, a.saveCredentials);
router.post('/people/:id/credentials/status', requireAuth, admin, a.setCredentialStatus);

// ─── Defects ────────────────────────────────────────────────────────────────
router.get('/defects', requireAuth, admin, a.listDefects);
router.post('/defects', requireAuth, admin, a.createDefect);
// Single-defect reads/edits/actions are scoped per caller inside the service
// (Super Admin, or a role with a stake in this defect) -- see resolveActor.
router.get('/defects/:id', requireAuth, a.getDefect);
router.patch('/defects/:id', requireAuth, a.updateDefect);
router.post('/defects/:id/actions/:action', requireAuth, upload.array('photos', 12), a.performAction);
router.post('/defects/:id/comments', requireAuth, upload.array('photos', 6), a.postComment);
router.post('/defects/:id/photos', requireAuth, upload.array('photos', 12), a.addPhotos);

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
// Direct task-progress change -- the Tasks list's inline status pill (self-scoped in qc.service).
router.patch('/tasks/:id/status', requireAuth, validate(updateTaskStatusSchema), qcController.updateTaskStatus);

export const qcRouter = router;
