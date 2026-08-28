import { Router } from 'express';
import { mediaController } from './media.controller';

const router = Router();

router.get('/:id', mediaController.get);

export const mediaRouter = router;
