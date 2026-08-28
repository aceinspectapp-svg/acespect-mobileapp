import { Router } from 'express';
import multer from 'multer';
import { inspectionsController } from './inspections.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { submitInspectionSchema, updateInspectionSchema } from './inspections.schemas';

const router = Router();

// In-memory upload (buffer forwarded to Egnyte); 15 MB cap per photo.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/submit', requireAuth, validate(submitInspectionSchema), inspectionsController.submit);
router.post('/photos', requireAuth, upload.single('photo'), inspectionsController.uploadPhoto);
// Draft editing + hand-off to review, both restricted to the owning inspector.
router.patch('/:id', requireAuth, validate(updateInspectionSchema), inspectionsController.update);
router.post('/:id/finalize', requireAuth, inspectionsController.finalize);
router.get('/:id', requireAuth, inspectionsController.getById);

export const inspectionsRouter = router;
