import type { NextFunction, Request, Response } from 'express';
import { prisma } from './prisma';
import { ApiError } from '../utils/ApiError';

/**
 * The generated report is locked once a hand-edited final version has been uploaded (Final Report Versions): while an inspection has at
 * least one uploaded version that is not deleted (nor replaced -- a replace always leaves its successor listed), NO role can generate or
 * download the system report. The lock lifts only when every uploaded version has been deleted.
 *
 * Enforced on the server, in two places: on each report route (`requireReportUnlocked`) and inside the report printer itself
 * (`withReportPage` in reportPdf.ts calls `assertReportUnlocked`), so any other or future caller of the printer is refused too.
 */
export const REPORT_LOCKED_MESSAGE = 'A final report has been uploaded for this inspection. Download it from Final Report Versions.';

export const reportLockedError = () => new ApiError(423, REPORT_LOCKED_MESSAGE, 'REPORT_LOCKED');

/** How many listed final versions an inspection has. Replaceable by a test (the routes and the printer read it through this object). */
export const reportLock = {
  countListed: (inspectionId: string): Promise<number> =>
    prisma.reportFinalVersion.count({ where: { inspectionId, replacedAt: null, deletedAt: null } }),
};

export async function isReportLocked(inspectionId: string): Promise<boolean> {
  return (await reportLock.countListed(inspectionId)) > 0;
}

/** Throws 423 REPORT_LOCKED while the inspection has a final version. */
export async function assertReportUnlocked(inspectionId: string): Promise<void> {
  if (await isReportLocked(inspectionId)) throw reportLockedError();
}

/** Route guard for the report routes (after requireAuth): 423 while locked, for every role. */
export function requireReportUnlocked(req: Request, _res: Response, next: NextFunction): void {
  const id = req.params.id;
  if (!id) return next();
  assertReportUnlocked(id).then(() => next(), next);
}
