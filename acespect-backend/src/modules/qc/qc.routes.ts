import { Router } from 'express';
import multer from 'multer';
import { qcController } from './qc.controller';
import { qcAdminController as a } from './qc.admin.controller';
import { qcPlatformController as pl } from './qc.platform.controller';
import { qcOpsController as op } from './qc.ops.controller';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { requireCap } from './qc.context';
import { ownerOf } from './qc.guard';
import { Capability } from './qc.permissions';
import {
  createPropertyTypeSchema,
  postTaskUpdateSchema,
  updatePropertyTypeSchema,
  updateTaskStatusSchema,
} from './qc.schemas';

/**
 * Every route below names the capability it needs (qc.permissions.ts). A route
 * that names none is a mistake: the guard is the first thing that runs after
 * authentication, refusals are logged, and tenant scoping happens inside the
 * handlers (qc.guard.ts). REQ-AUT-003: deny by default.
 */
const router = Router();
// Up to 12 photos per request, 15 MB each -- same cap as inspection photo uploads.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const cap = requireCap;
/** For /defects/:id routes the defect's client picks the context (a Private Inspector may work for several clients). */
const capDefect = (c: Capability) => requireCap(c, async (req) => (await ownerOf('defect', String(req.params.id)))?.clientId ?? undefined);
const self = [requireAuth, cap('account.self')];

// ─── Who am I, support mode ─────────────────────────────────────────────────
router.get('/me', ...self, pl.me);
router.post('/support/start', requireAuth, cap('support.enter'), pl.startSupport);
router.post('/support/end', requireAuth, cap('support.enter'), pl.endSupport);

// ─── Config bundle — any authenticated caller (dashboard + mobile both read this) ──
router.get('/config', requireAuth, qcController.getConfig);
// Field definitions for every entity and form in the requirements spec.
router.get('/spec', ...self, a.getSpec);
router.get('/permissions', ...self, pl.permissionMatrix);

// ─── Clients (E01) ──────────────────────────────────────────────────────────
router.get('/clients', requireAuth, cap('client.manage'), a.listClients);
router.post('/clients', requireAuth, cap('client.manage'), a.createClient);
router.get('/clients/:id', ...self, a.getClient);
router.patch('/clients/:id', requireAuth, cap('client.manage'), a.updateClient);
router.post('/clients/:id/status', requireAuth, cap('client.manage'), a.setClientStatus);
router.delete('/clients/:id', requireAuth, cap('client.manage'), a.deleteClient);

// ─── Master contractors (E02), trade companies (E03), trade categories (E19) ─
router.get('/master-contractors', requireAuth, cap('users.view'), a.listMasterContractors);
router.post('/master-contractors', requireAuth, cap('users.mcOrg'), a.createMasterContractor);
router.patch('/master-contractors/:id', requireAuth, cap('users.mcOrg'), a.updateMasterContractor);
router.delete('/master-contractors/:id', requireAuth, cap('users.mcOrg'), a.deleteMasterContractor);

router.get('/trade-companies', requireAuth, cap('users.view'), a.listTradeCompanies);
router.post('/trade-companies', requireAuth, cap('users.trade'), a.createTradeCompany);
router.patch('/trade-companies/:id', requireAuth, cap('users.trade'), a.updateTradeCompany);
router.delete('/trade-companies/:id', requireAuth, cap('users.trade'), a.deleteTradeCompany);

router.get('/trade-categories', ...self, a.listTradeCategories);
router.post('/trade-categories', requireAuth, cap('client.manage'), a.createTradeCategory);
router.patch('/trade-categories/:id', requireAuth, cap('client.manage'), a.updateTradeCategory);
router.delete('/trade-categories/:id', requireAuth, cap('client.manage'), a.deleteTradeCategory);

// ─── Projects (E07), sites (E08), lots (E09) and the project team (E10) ────
router.get('/projects', requireAuth, cap('projects.view'), a.listProjects);
router.post('/projects', requireAuth, cap('projects.create'), a.createProject);
router.get('/projects/:id', requireAuth, cap('projects.view'), a.getProject);
router.patch('/projects/:id', requireAuth, cap('projects.create'), a.updateProject);
router.delete('/projects/:id', requireAuth, cap('projects.override'), a.deleteProject);
router.get('/projects/:id/team', requireAuth, cap('projects.view'), a.listTeam);
router.post('/projects/:id/team', requireAuth, cap('projects.team'), a.addTeamMember);
router.delete('/team/:id', requireAuth, cap('projects.team'), a.removeTeamMember);

router.get('/sites', requireAuth, cap('projects.view'), a.listSites);
router.post('/sites', requireAuth, cap('projects.create'), a.createSite);
router.patch('/sites/:id', requireAuth, cap('projects.create'), a.updateSite);
router.delete('/sites/:id', requireAuth, cap('projects.create'), a.deleteSite);

router.get('/lots', requireAuth, cap('projects.view'), a.listLots);
router.post('/lots', requireAuth, cap('projects.create'), a.createLot);
router.patch('/lots/:id', requireAuth, cap('projects.create'), a.updateLot);
router.delete('/lots/:id', requireAuth, cap('projects.create'), a.deleteLot);

// ─── Property types (lot dwelling types shown on mobile) ────────────────────
router.get('/property-types', ...self, qcController.listPropertyTypes);
router.post('/property-types', requireAuth, cap('client.manage'), validate(createPropertyTypeSchema), qcController.createPropertyType);
router.patch('/property-types/:id', requireAuth, cap('client.manage'), validate(updatePropertyTypeSchema), qcController.updatePropertyType);
router.delete('/property-types/:id', requireAuth, cap('client.manage'), qcController.deletePropertyType);

// ─── People: users, roles (memberships), inspector credentials ──────────────
router.get('/users', requireAuth, cap('defects.view'), pl.assignableInspectors);
router.get('/inspectors', requireAuth, cap('defects.view'), pl.assignableInspectors);
router.get('/people', requireAuth, cap('users.view'), a.listPeople);
// Creating, editing and deactivating check the capability for the person's role inside the handler.
router.post('/people', requireAuth, cap('users.view'), a.createPerson);
router.patch('/people/:id', requireAuth, cap('users.view'), a.updatePerson);
router.post('/people/:id/deactivate', requireAuth, cap('users.deactivate'), a.deactivatePerson);
router.post('/people/:id/reactivate', requireAuth, cap('users.deactivate'), a.reactivatePerson);
router.post('/people/:id/invitation', requireAuth, cap('users.view'), a.resendInvitation);
router.put('/people/:id/credentials', requireAuth, cap('users.credentialInspector'), a.saveCredentials);
router.post('/people/:id/credentials/status', requireAuth, cap('users.credentialInspector'), a.setCredentialStatus);

// ─── Defects ────────────────────────────────────────────────────────────────
router.get('/defects', requireAuth, cap('defects.view'), a.listDefects);
router.post('/defects', requireAuth, cap('defects.create'), a.createDefect);
// Single-defect reads/edits/actions are scoped per caller inside the service
// (role, client, project and assignment) -- see resolveActor.
router.get('/defects/:id', requireAuth, capDefect('defects.view'), a.getDefect);
router.patch('/defects/:id', requireAuth, capDefect('defects.view'), a.updateDefect);
router.post('/defects/:id/actions/:action', requireAuth, capDefect('defects.view'), upload.array('photos', 12), a.performAction);
router.post('/defects/:id/comments', requireAuth, capDefect('defects.comment'), upload.array('photos', 6), a.postComment);
router.post('/defects/:id/photos', requireAuth, capDefect('defects.view'), upload.array('photos', 12), a.addPhotos);

// ─── SLA targets (E13) and escalation / project policy (E14) ────────────────
router.get('/sla', requireAuth, cap('projects.view'), op.getSla);
router.put('/sla/:severity', requireAuth, cap('sla.configure'), op.saveSla);
router.delete('/sla', requireAuth, cap('sla.configure'), op.revertSla);
router.get('/policy', requireAuth, cap('projects.view'), op.getPolicy);
router.put('/policy', requireAuth, cap('sla.configure'), op.savePolicy);
router.delete('/policy', requireAuth, cap('sla.configure'), op.revertPolicy);

// ─── Escalations (E27, F34, F35) ────────────────────────────────────────────
router.get('/escalations', requireAuth, cap('reports.dlpEscalation'), op.escalationLog);
router.get('/defects/:id/escalations', requireAuth, capDefect('defects.view'), op.defectEscalations);
router.post('/defects/:id/escalate', requireAuth, capDefect('sla.escalate'), op.escalate);
router.post('/escalations/:id/referral', requireAuth, cap('sla.escalate'), op.recordReferral);
router.post('/escalations/:id/ack', requireAuth, cap('defects.view'), op.ackEscalation);

// ─── Practical completion and the DLP (F36, F37, E28) ───────────────────────
router.get('/projects/:id/dlp', requireAuth, cap('projects.view'), op.getDlp);
router.post('/projects/:id/dlp/start', requireAuth, cap('dlp.manage'), op.startDlp);
router.post('/projects/:id/dlp/closeout', requireAuth, cap('dlp.manage'), op.closeOutDlp);

// ─── Notifications and preferences (E29, E30) ───────────────────────────────
router.get('/notifications', ...self, op.listNotifications);
router.post('/notifications/:id/read', ...self, op.markRead);
router.post('/notifications/:id/ack', ...self, op.ackNotification);
router.get('/notification-prefs', ...self, op.getPrefs);
router.put('/notification-prefs', ...self, op.savePrefs);
router.post('/push-token', ...self, op.registerPush);
router.delete('/push-token', ...self, op.unregisterPush);

// ─── Audit trail, security log, support sessions (E31, E32) ─────────────────
router.get('/audit', requireAuth, cap('audit.view'), op.listAudit);
router.get('/audit/verify', requireAuth, cap('audit.view'), op.verifyAudit);
router.get('/security-log', requireAuth, cap('securitylog.view'), op.listSecurity);
router.get('/support-sessions', requireAuth, cap('securitylog.view'), op.listSupportSessions);

// ─── Client defaults, usage, legal holds, tenant export / offboarding ──────
router.get('/clients/:id/defaults', requireAuth, cap('client.defaults'), op.getClientDefaults);
router.put('/clients/:id/defaults', requireAuth, cap('client.defaults'), op.saveClientDefaults);
router.get('/usage', requireAuth, cap('client.defaults'), op.usage);
router.get('/legal-holds', requireAuth, cap('retention.hold'), op.listHolds);
router.post('/legal-holds', requireAuth, cap('retention.hold'), op.placeHold);
router.post('/legal-holds/:id/release', requireAuth, cap('retention.hold'), op.releaseHold);
router.post('/clients/:id/export', requireAuth, cap('tenant.export'), op.exportTenant);
router.post('/clients/:id/offboard', requireAuth, cap('client.manage'), op.offboard);
router.post('/clients/:id/destroy', requireAuth, cap('client.manage'), op.destroy);

// ─── Platform privacy registers (Super Admin) ───────────────────────────────
router.get('/privacy/requests', requireAuth, cap('privacy.handle'), op.listPrivacyRequests);
router.post('/privacy/requests', requireAuth, cap('privacy.handle'), op.createPrivacyRequest);
router.patch('/privacy/requests/:id', requireAuth, cap('privacy.handle'), op.updatePrivacyRequest);
router.post('/privacy/requests/:id/export', requireAuth, cap('privacy.handle'), op.exportPersonal);
router.get('/privacy/breaches', requireAuth, cap('privacy.handle'), op.listBreaches);
router.post('/privacy/breaches', requireAuth, cap('privacy.handle'), op.createBreach);
router.patch('/privacy/breaches/:id', requireAuth, cap('privacy.handle'), op.updateBreach);
router.get('/privacy/subprocessors', requireAuth, cap('privacy.handle'), op.listSubProcessors);
router.post('/privacy/subprocessors', requireAuth, cap('privacy.handle'), op.saveSubProcessor);
router.put('/privacy/subprocessors/:id', requireAuth, cap('privacy.handle'), op.saveSubProcessor);
router.get('/privacy/retention', requireAuth, cap('privacy.handle'), op.listRetentionDue);

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
