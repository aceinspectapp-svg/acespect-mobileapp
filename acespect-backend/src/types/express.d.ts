import 'express';
import type { QcContext } from '../modules/qc/qc.context';

/** Augments Express's Request with the authenticated principal and the resolved QC tenant context. */
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
      };
      qc?: QcContext;
    }
  }
}

export {};
