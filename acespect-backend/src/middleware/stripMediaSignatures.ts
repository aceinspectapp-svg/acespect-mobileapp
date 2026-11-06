import type { NextFunction, Request, Response } from 'express';
import { stripMediaSignatures } from '../lib/mediaLinks';

/**
 * The apps are handed photo links that carry a short-lived signature, and send what they edit back (a reviewer saving a section, a phone
 * re-sending a baseline photo). A signed link must never be stored -- it stops working when it lapses -- so the signature is removed from
 * every media link in the request body before anything reads it. A body without such links is left exactly as it was.
 */
export function stripSignedMediaLinks(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') req.body = stripMediaSignatures(req.body);
  next();
}
