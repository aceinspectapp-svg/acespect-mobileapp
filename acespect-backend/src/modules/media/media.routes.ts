import { Router, type RequestHandler } from 'express';
import { mediaController } from './media.controller';

/** Photos and files are only ever read: the route answers GET (and HEAD, which Express adds to GET); every other method falls through to the 404 handler. */
export function createMediaRouter(get: RequestHandler = mediaController.get) {
  const router = Router();
  router.get('/:id', get);
  return router;
}

export const mediaRouter = createMediaRouter();
