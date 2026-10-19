import { Router } from 'express';
import { rebindAuditContext } from '../../lib/auditTrail';
import multer from 'multer';
import { inspectionsController } from './inspections.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { submitInspectionSchema, syncSectionSchema, updateInspectionSchema } from './inspections.schemas';

const router = Router();

// In-memory upload (buffer forwarded to Egnyte); 40 MB cap per photo (a 50-megapixel phone photo can pass 20 MB).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024 } });

router.post('/submit', requireAuth, validate(submitInspectionSchema), inspectionsController.submit);
router.post('/client-error', requireAuth, inspectionsController.clientError);
router.put('/:id/sync', requireAuth, validate(syncSectionSchema), inspectionsController.syncSection);
router.post('/photos', requireAuth, upload.single('photo'), rebindAuditContext, inspectionsController.uploadPhoto);
// Post-Dilapidation jobs admin has pushed to the calling inspector, not yet
// picked up -- must come before the /:id routes below.
router.get('/assigned', requireAuth, inspectionsController.listAssigned);
// Draft editing + hand-off to review, both restricted to the owning inspector.
router.patch('/:id', requireAuth, validate(updateInspectionSchema), inspectionsController.update);
router.post('/:id/finalize', requireAuth, inspectionsController.finalize);
router.get('/:id/baseline-sections', requireAuth, inspectionsController.getBaselineSections);
router.get('/:id/report.pdf', requireAuth, inspectionsController.downloadReportPdf);
router.get('/:id/report.docx', requireAuth, inspectionsController.downloadReportDocx);
router.get('/sections/:sectionId/photos.zip', inspectionsController.downloadSectionPhotos);
router.get('/:id', requireAuth, inspectionsController.getById);

export const inspectionsRouter = router;
