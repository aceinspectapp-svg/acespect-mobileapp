import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { requireAuth, requireRole } from '../../middleware/auth';
import { audit, rebindAuditContext } from '../../lib/auditTrail';
import { webService } from '../web/web.service';
import { isReportLocked } from '../../lib/reportLock';
import {
  assertDocx, cleanFileName, cleanNote, DOCX_CONTENT_TYPE, FINAL_REPORT_ROLES, finalReportPath, jobFolder, latestOf, MAX_FINAL_REPORT_BYTES, parseBasedOn,
  parseMode, planUpload, tooLarge,
} from './finalReports.rules';
import { defaultStore, prismaRepo, type FinalReportRepo, type FinalReportStore, type FinalVersionRow } from './finalReports.service';

/**
 * Final Report Versions (web, ADMIN and REVIEWER only), under /api/v1/inspections/:id/final-versions:
 *
 *   GET  /                    the uploaded versions, newest first (Version 0, the live generated report, is the existing report-jobs download)
 *   POST /                    upload a .docx (multipart: file, note?, mode = new | replace, basedOn = the latest version number seen)
 *   GET  /:versionId/file     download one version, through the API (never a storage link)
 *   DELETE /:versionId        soft delete (ADMIN only): hidden and marked deleted; the row and the file are kept; its number is never reused
 *
 * and /api/v1/inspections/:id/report-lock: whether the generated report is locked (anyone who may open the inspection; see lib/reportLock.ts).
 *
 * Every route checks the role on the server (403 for INSPECTOR, CLIENT and FIELD_USER) before anything else -- the upload is refused before
 * its body is read. A reviewer must also be allowed to open the inspection (the review page's rule). Each upload, replace and download is
 * written to the audit trail, as is the inspection becoming locked (its first listed version) and unlocked (its last one deleted).
 */
export interface FinalReportDeps {
  repo: FinalReportRepo;
  store: FinalReportStore;
  audit: typeof audit;
  requireAuth: RequestHandler;
  /** Where an upload is written while it is checked (on disk, so a 50 MB file is never held in memory). */
  uploadDir?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function serialize(v: FinalVersionRow, latestNumber: number) {
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    fileName: v.fileName,
    sizeBytes: v.sizeBytes,
    note: v.note,
    uploadedAt: v.uploadedAt.toISOString(),
    uploadedBy: { id: v.uploadedBy.id, name: v.uploadedBy.name, email: v.uploadedBy.email },
    current: v.versionNumber === latestNumber,
  };
}

const summary = (v: FinalVersionRow) => ({ id: v.id, versionNumber: v.versionNumber, fileName: v.fileName, sizeBytes: v.sizeBytes, blobPath: v.blobPath, uploadedById: v.uploadedBy.id, uploadedAt: v.uploadedAt.toISOString() });

/** `filename` for old browsers (ASCII only) and `filename*` with the real name. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function makeFinalReportsRouter(deps: FinalReportDeps) {
  const router = Router({ mergeParams: true });
  const allowed = requireRole(...FINAL_REPORT_ROLES);
  const adminOnly = requireRole('ADMIN');
  const upload = multer({ dest: deps.uploadDir ?? tmpdir(), limits: { fileSize: MAX_FINAL_REPORT_BYTES, files: 1, fields: 10 } });

  const inspectionIdOf = (req: Request): string => {
    const id = req.params.id;
    if (!id || !UUID_RE.test(id)) throw ApiError.badRequest('Invalid inspection id');
    return id;
  };

  /** multer's own errors (over 50 MB, a second file) as clear messages; the photo upload's 40 MB wording does not apply here. */
  const receiveFile = (req: Request, res: Response, next: NextFunction) =>
    upload.single('file')(req, res, (err?: unknown) => {
      if (!err) return next();
      const code = (err as { code?: string }).code;
      if (code === 'LIMIT_FILE_SIZE') return next(tooLarge());
      if (code === 'LIMIT_UNEXPECTED_FILE' || code === 'LIMIT_FILE_COUNT') return next(ApiError.badRequest('Upload one Word file, in the field "file".'));
      return next(err);
    });

  router.get('/', deps.requireAuth, allowed, asyncHandler(async (req, res) => {
    const id = inspectionIdOf(req);
    const inspection = await deps.repo.assertCanView(id, req.user!);
    const rows = await deps.repo.listCurrent(id);
    const latest = latestOf(rows)?.versionNumber ?? 0;
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      latestVersion: latest,
      locked: rows.length > 0,
      // No job number: files go under final-reports/_Unassigned/<inspectionId>/ (the section says so).
      unassigned: !jobFolder(inspection.jobNo).replace(/^-+|-+$/g, ''),
      versions: rows.sort((a, b) => b.versionNumber - a.versionNumber).map((v) => serialize(v, latest)),
    });
  }));

  router.post('/', deps.requireAuth, allowed, receiveFile, rebindAuditContext, asyncHandler(async (req, res) => {
    const file = req.file;
    try {
      const id = inspectionIdOf(req);
      const inspection = await deps.repo.assertCanView(id, req.user!);
      if (!file) throw ApiError.badRequest('No file was sent (the field must be "file").');
      await assertDocx(file.path, file.originalname, file.size);
      const note = cleanNote(req.body?.note);
      const mode = parseMode(req.body?.mode);
      if (req.body?.mode !== undefined && req.body?.mode !== '' && !mode) throw ApiError.badRequest('mode must be "new" or "replace"');
      const basedOn = parseBasedOn(req.body?.basedOn);

      const current = await deps.repo.listCurrent(id);
      const seenLatest = latestOf(current)?.versionNumber ?? 0;
      const plan = planUpload(current, mode, basedOn, await deps.repo.highestVersion(id));
      const uploadId = randomUUID();
      const blobPath = finalReportPath({ id, ...inspection }, plan.versionNumber, uploadId);
      await deps.store.put(blobPath, file.path, DOCX_CONTENT_TYPE);

      let result: Awaited<ReturnType<FinalReportRepo['commit']>>;
      try {
        result = await deps.repo.commit({
          plan, mode, seenLatest,
          row: { id: uploadId, inspectionId: id, blobPath, fileName: cleanFileName(file.originalname), sizeBytes: file.size, contentType: DOCX_CONTENT_TYPE, note, uploadedById: req.user!.id },
        });
      } catch (err) {
        // Not saved (someone else uploaded first): the file just stored belongs to no version, so it goes. Saved and replaced files are never removed.
        await deps.store.discard(blobPath).catch(() => undefined);
        throw err;
      }
      const { saved, replaced, wasLocked } = result;
      await deps.audit({
        req,
        category: 'web',
        action: replaced ? 'report.final_version.replace' : 'report.final_version.upload',
        inspectionId: id,
        jobNo: inspection.jobNo,
        target: { type: 'ReportFinalVersion', id: saved.id, label: `v${saved.versionNumber} ${saved.fileName}` },
        message: replaced ? `Final report Version ${saved.versionNumber} replaced` : `Final report Version ${saved.versionNumber} uploaded`,
        before: replaced ? summary(replaced) : undefined,
        after: summary(saved),
        metadata: { versionNumber: saved.versionNumber, bytes: saved.sizeBytes, note: saved.note, mode: plan.kind, ...(replaced ? { replacedUploadId: replaced.id } : {}) },
      });
      if (!wasLocked) {
        await deps.audit({
          req, category: 'web', action: 'report.locked', inspectionId: id, jobNo: inspection.jobNo,
          target: { type: 'Inspection', id, label: inspection.jobNo }, message: 'Generated report locked: a final version was uploaded',
          metadata: { versionNumber: saved.versionNumber, finalVersionId: saved.id },
        });
      }
      res.status(201).json({ version: serialize(saved, saved.versionNumber), replacedId: replaced?.id ?? null });
    } finally {
      if (file) await unlink(file.path).catch(() => undefined);
    }
  }));

  router.get('/:versionId/file', deps.requireAuth, allowed, asyncHandler(async (req, res) => {
    const id = inspectionIdOf(req);
    const versionId = req.params.versionId;
    if (!versionId || !UUID_RE.test(versionId)) throw ApiError.badRequest('Invalid version id');
    const inspection = await deps.repo.assertCanView(id, req.user!);
    const version = await deps.repo.findVersion(id, versionId);
    if (!version) throw ApiError.notFound('That version was not found');
    const blob = await deps.store.get(version.blobPath);
    if (!blob) throw ApiError.notFound('The file for that version was not found in storage');
    await deps.audit({
      req,
      category: 'web',
      action: 'report.final_version.download',
      inspectionId: id,
      jobNo: inspection.jobNo,
      target: { type: 'ReportFinalVersion', id: version.id, label: `v${version.versionNumber} ${version.fileName}` },
      message: `Final report Version ${version.versionNumber} downloaded`,
      metadata: { versionNumber: version.versionNumber, bytes: version.sizeBytes },
    });
    res.setHeader('Content-Type', DOCX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', contentDisposition(version.fileName));
    res.setHeader('Cache-Control', 'private, no-store');
    if (Number.isFinite(blob.length)) res.setHeader('Content-Length', String(blob.length));
    blob.stream.on('error', (e) => res.destroy(e as Error));
    blob.stream.pipe(res);
  }));

  router.delete('/:versionId', deps.requireAuth, adminOnly, asyncHandler(async (req, res) => {
    const id = inspectionIdOf(req);
    const versionId = req.params.versionId;
    if (!versionId || !UUID_RE.test(versionId)) throw ApiError.badRequest('Invalid version id');
    const inspection = await deps.repo.assertCanView(id, req.user!);
    const { deleted, remaining } = await deps.repo.softDelete(id, versionId, req.user!.id);
    await deps.audit({
      req, category: 'web', action: 'report.final_version.delete', inspectionId: id, jobNo: inspection.jobNo,
      target: { type: 'ReportFinalVersion', id: deleted.id, label: `v${deleted.versionNumber} ${deleted.fileName}` },
      message: `Final report Version ${deleted.versionNumber} deleted`, before: summary(deleted),
      metadata: { versionNumber: deleted.versionNumber, remaining, fileKept: deleted.blobPath },
    });
    if (remaining === 0) {
      await deps.audit({
        req, category: 'web', action: 'report.unlocked', inspectionId: id, jobNo: inspection.jobNo,
        target: { type: 'Inspection', id, label: inspection.jobNo }, message: 'Generated report unlocked: every final version was deleted',
        metadata: { lastDeletedVersion: deleted.versionNumber },
      });
    }
    res.json({ deletedId: deleted.id, remaining });
  }));

  return router;
}

/** GET /api/v1/inspections/:id/report-lock -> { locked }: for the report page, so it can show the lock instead of the report. */
export function makeReportLockRouter(deps: Pick<FinalReportDeps, 'repo' | 'requireAuth'> & { isLocked?: (id: string) => Promise<boolean> }) {
  const router = Router({ mergeParams: true });
  router.get('/', deps.requireAuth, asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!id || !UUID_RE.test(id)) throw ApiError.badRequest('Invalid inspection id');
    await deps.repo.assertCanView(id, req.user!);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ locked: await (deps.isLocked ?? isReportLocked)(id) });
  }));
  return router;
}

const prodRepo = prismaRepo(webService.assertCanViewInspection);
export const reportLockRouter = makeReportLockRouter({ repo: prodRepo, requireAuth });

export const finalReportsRouter = makeFinalReportsRouter({
  repo: prodRepo,
  get store() { return defaultStore(); },
  audit,
  requireAuth,
});
