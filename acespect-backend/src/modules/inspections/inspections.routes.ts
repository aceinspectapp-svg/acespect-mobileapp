import { Router } from 'express';
import { rebindAuditContext } from '../../lib/auditTrail';
import multer from 'multer';
import { inspectionsService } from './inspections.service';
import { inspectionsController } from './inspections.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { stripSignedMediaLinks } from '../../middleware/stripMediaSignatures';
import { makeOriginalPhotosZip, makeSectionPhotosZip } from './photosZip';
import { webService } from '../web/web.service';
import { fetchOriginalPhoto, fetchPhotoStream } from '../../lib/storage';
import { audit } from '../../lib/auditTrail';
import { logSecurityEvent } from '../../lib/securityLog';
import { submitInspectionSchema, syncSectionSchema, updateInspectionSchema } from './inspections.schemas';

export const sectionPhotosZip = makeSectionPhotosZip({
  assertCanViewSection: webService.assertCanViewSection,
  getSectionPhotos: inspectionsService.getSectionPhotos,
  fetchPhotoStream,
  audit: audit as never,
  logSecurityEvent,
  requireAuth,
});

export const originalPhotosZip = makeOriginalPhotosZip({
  assertCanViewInspection: webService.assertCanViewInspection,
  getInspectionPhotos: inspectionsService.getInspectionPhotos,
  fetchOriginalPhoto,
  audit: audit as never,
  logSecurityEvent,
  requireAuth,
});

const router = Router();
router.use(stripSignedMediaLinks);

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
// "Download all photos": signed-in and allowed to see the inspection, or a short-lived signed link from /photos-link. Never public.
router.get('/sections/:sectionId/photos-link', requireAuth, sectionPhotosZip.link);
router.get('/sections/:sectionId/photos.zip', sectionPhotosZip.access, sectionPhotosZip.download);
// "Download all original photos" (the link printed under the report's description): the link is made for a signed-in user who may open
// the inspection; the zip opens with that long-lived signed link, or for a signed-in user who may open it. Never public.
router.get('/:id/original-photos-link', requireAuth, originalPhotosZip.link);
router.get('/:id/original-photos.zip', originalPhotosZip.access, originalPhotosZip.download);
router.get('/:id', requireAuth, inspectionsController.getById);

export const inspectionsRouter = router;
