import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { inspectionsService, receiptFor, referencedPhotoIds, missingPhotoIds } from './inspections.service';
import { alertAdmins } from '../../lib/submissionAlerts';
import { fetchPhotoStream } from '../../lib/storage';
import { generateInspectionReportPdf } from '../../lib/reportPdf';
import { generateInspectionReportDocx } from '../../lib/reportDocx';
import { recordSubmissionEvent } from '../../lib/submissionLog';

/** A photo URL is this backend's own `/api/v1/media/:id` proxy link -- pull the id back off the end of it. */
function photoIdFromUrl(url: string): string | null {
  const match = /\/media\/([0-9a-f-]+)\/?$/i.exec(url);
  return match?.[1] ?? null;
}

/**
 * Every one of these is a step in mobile's local-draft -> queued -> uploaded
 * -> saved pipeline (see acespect-mobile's syncManager.ts) where "it never
 * showed up" has historically meant digging through a raw DB query to find
 * out what actually happened. Tagged `[submit]` in the console (grep-able
 * live via `railway logs`) AND persisted to SubmissionLogEntry (queryable
 * later from the admin dashboard's Troubleshooting page) -- the same event,
 * two destinations, so neither a live-tailing engineer nor an admin looking
 * back at yesterday's failed job is left without an answer.
 */
function logSubmit(
  event: 'received' | 'saved' | 'updated' | 'finalized' | 'photo_uploaded' | 'warning',
  ctx: { inspectorId?: string | null; inspectionId?: string | null; jobNo?: string | null },
  detail: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console.log('[submit]', event, JSON.stringify({ ...ctx, ...detail }));
  void recordSubmissionEvent({ event, ...ctx, detail });
}

/** Thin HTTP layer for inspection submission + lookup. */
/** The inspection date as the report footer prints it: "3 October 2026". */
const footerDate = (date: Date | string): string => new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

export const inspectionsController = {
  // Saves as a DRAFT the inspector still owns — review only starts at finalize.
  submit: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const body = req.body as { jobNo?: string; id?: string; sections?: { key?: string; answers?: unknown; photos?: unknown; damages?: unknown }[]; verifyPhotos?: boolean };
    // The completeness gate: an app build that asks for it is never given an inspection that points at photos the server does not hold. It is
    // told which ones, sends just those again, and submits again; nothing is stored in the meantime.
    if (body.verifyPhotos) {
      const missing = await missingPhotoIds(referencedPhotoIds(body.sections ?? []));
      if (missing.length > 0) {
        const message = `${missing.length} photo(s) in this inspection are not on the server yet.`;
        logSubmit('warning', { inspectorId: req.user.id, jobNo: body.jobNo }, { reason: 'photos_missing', message, missing: missing.length });
        throw new ApiError(409, message, 'PHOTOS_MISSING', { missing: missing.slice(0, 2000) });
      }
    }
    logSubmit(
      'received',
      { inspectorId: req.user.id, jobNo: body.jobNo },
      { draftId: body.id, sections: body.sections?.length ?? 0 },
    );
    const { inspection } = await inspectionsService.submit(req.user.id, req.body);
    logSubmit(
      'saved',
      { inspectorId: req.user.id, inspectionId: inspection.id, jobNo: inspection.jobNo },
      { status: inspection.status },
    );
    // Only Job Information arrived: the inspection's real sections and photos are not in this submission (a blank draft was sent, or the
    // full one is still waiting on the phone). The admin Troubleshoot page lists these.
    if (!(body.sections ?? []).some((s) => s.key && s.key !== 'job-info')) {
      logSubmit(
        'warning',
        { inspectorId: req.user.id, inspectionId: inspection.id, jobNo: inspection.jobNo },
        { reason: 'only_job_information', message: 'Only Job Information was received -- no sections or photos came with this submission.' },
      );
      void alertAdmins(`blank:${inspection.id}`, `Submission ${inspection.jobNo ?? ''} contains only Job Information`, ['No sections or photos came with this submission; the full inspection may still be waiting on the inspector\'s phone.'], { inspectorId: req.user.id, inspectionId: inspection.id, jobNo: inspection.jobNo });
    }
    // The receipt: what the server actually stored. The phone keeps its copy until this matches what it sent.
    const receipt = await receiptFor(inspection.id);
    const expected = (req.body as { expected?: { sections: number; photos: number } }).expected;
    if (expected && (expected.sections !== receipt.sections || expected.photos !== receipt.photos)) {
      const message = `The phone sent ${expected.sections} section(s) and ${expected.photos} photo(s); the server stored ${receipt.sections} and ${receipt.photos}.`;
      logSubmit('warning', { inspectorId: req.user.id, inspectionId: inspection.id, jobNo: inspection.jobNo }, { reason: 'receipt_mismatch', message });
      void alertAdmins(`mismatch:${inspection.id}`, `Submission ${inspection.jobNo ?? ''} arrived incomplete`, [message], { inspectorId: req.user.id, inspectionId: inspection.id, jobNo: inspection.jobNo });
    }
    res.status(201).json({ inspectionId: inspection.id, status: inspection.status, receipt });
  }),

  // The phone saying why an attempt failed on its side (the server never saw that request): kept in the trail for the Troubleshoot page.
  clientError: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const b = req.body as { where?: unknown; message?: unknown; status?: unknown; code?: unknown; context?: unknown; level?: unknown };
    const where = String(b.where ?? '').slice(0, 60);
    const message = String(b.message ?? '').slice(0, 300);
    const context = b.context && typeof b.context === 'object' ? (b.context as Record<string, unknown>) : {};
    await recordSubmissionEvent({
      event: b.level === 'info' ? 'received' : 'failed',
      inspectorId: req.user.id,
      jobNo: typeof context.jobNo === 'string' ? context.jobNo.slice(0, 40) : null,
      statusCode: typeof b.status === 'number' ? b.status : null,
      message: b.level === 'info' ? `Phone: ${where}` : `Phone: ${where} failed: ${message}`,
      detail: { source: 'phone', where, code: typeof b.code === 'string' ? b.code.slice(0, 40) : undefined, context: JSON.parse(JSON.stringify(context).slice(0, 1000) || '{}') },
    });
    res.status(204).end();
  }),

  // Saves one section while the inspector is still working (see inspectionsService.syncSection).
  syncSection: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const result = await inspectionsService.syncSection(req.user.id, id, req.body);
    res.status(200).json(result);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await inspectionsService.update(id, req.user.id, req.body);
    logSubmit(
      'updated',
      { inspectorId: req.user.id, inspectionId: inspection.id, jobNo: inspection.jobNo },
      { status: inspection.status },
    );
    res.status(200).json({ inspectionId: inspection.id, status: inspection.status });
  }),

  // Point of no return: assigns a reviewer and enqueues the async review.
  finalize: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const { inspection, reviewJob } = await inspectionsService.finalize(id, req.user.id);
    logSubmit(
      'finalized',
      { inspectorId: req.user.id, inspectionId: inspection.id, jobNo: inspection.jobNo },
      { reviewJobId: reviewJob.id, status: inspection.status },
    );
    res.status(202).json({
      inspectionId: inspection.id,
      reviewJobId: reviewJob.id,
      status: inspection.status,
    });
  }),

  listAssigned: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const jobs = await inspectionsService.listAssigned(req.user.id);
    res.status(200).json({ jobs });
  }),

  getBaselineSections: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const sections = await inspectionsService.getBaselineSections(id, req.user.id);
    res.status(200).json({ sections });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await inspectionsService.getById(id);
    res.status(200).json({ inspection });
  }),

  // Renders the same `/report/:id` page a reviewer already sees into a real
  // PDF file -- see lib/reportPdf.ts for why this reuses that page rather
  // than a second, PDF-specific layout.
  downloadReportPdf: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.slice('Bearer '.length).trim();

    const inspection = await inspectionsService.getById(id);
    const kind = /construction/i.test(inspection.inspectionType ?? '') ? 'construction' : 'dilapidation';
    const pdf = await generateInspectionReportPdf(id, token, {
      clientName: inspection.client ?? '',
      jobNo: await inspectionsService.reportJobNo(id, inspection.jobNo),
      inspectionDate: footerDate(inspection.date),
    });

    const fileName = `${inspection.jobNo || id}-${kind}-report.pdf`.replace(/[^a-z0-9.-]+/gi, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdf);
  }),

  // The same report as an editable Word file -- built from the same `/report/:id` page the PDF is printed from (lib/reportDocx.ts).
  downloadReportDocx: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.slice('Bearer '.length).trim();

    const inspection = await inspectionsService.getById(id);
    const kind = /construction/i.test(inspection.inspectionType ?? '') ? 'construction' : 'dilapidation';
    const reportJobNo = await inspectionsService.reportJobNo(id, inspection.jobNo);
    const docx = await generateInspectionReportDocx(id, token, {
      clientName: inspection.client ?? '',
      jobNo: reportJobNo,
      title: `${kind === 'construction' ? 'Construction' : 'Dilapidation'} Report ${reportJobNo}`.trim(),
      inspectionDate: footerDate(inspection.date),
    });

    const fileName = `${inspection.jobNo || id}-${kind}-report.docx`.replace(/[^a-z0-9.-]+/gi, '-');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(docx);
  }),

  // multipart/form-data with a "photo" file, plus optional "inspectionId"/
  // "sectionKey" text fields (mobile always sends them; a caller with no
  // section context, e.g. an ad-hoc upload, can omit them for a flat,
  // ungrouped upload) → { id, storageKey, url }.
  uploadPhoto: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const file = req.file;
    if (!file) throw ApiError.badRequest('No photo file (field name must be "photo")');
    const inspectionId = typeof req.body.inspectionId === 'string' ? req.body.inspectionId : undefined;
    const sectionKey = typeof req.body.sectionKey === 'string' ? req.body.sectionKey : undefined;
    // The job number lets the server put the photo straight into its batch/job folder in Egnyte; the photo id (a uuid the phone
    // makes up from the photo) makes a repeated upload return the stored copy instead of saving a second one.
    const jobNo = typeof req.body.jobNo === 'string' ? req.body.jobNo : undefined;
    const photoId = typeof req.body.photoId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.body.photoId) ? req.body.photoId.toLowerCase() : undefined;
    const n = Number(req.body.photoNumber);
    const photoNumber = Number.isInteger(n) && n >= 1 && n <= 99999 ? n : undefined;
    const result = await inspectionsService.uploadPhoto(
      file.buffer,
      file.mimetype,
      file.originalname,
      inspectionId,
      sectionKey,
      jobNo,
      photoId,
      photoNumber,
    );
    logSubmit(
      'photo_uploaded',
      { inspectorId: req.user.id, inspectionId },
      { sectionKey, bytes: file.buffer.length, photoId: result.id, ...(jobNo ? { jobNo } : {}) },
    );
    res.status(201).json(result);
  }),

  // A section's "additional photos" (attached outside any specific template
  // field, e.g. extra shots from an external camera) bundled as one zip so a
  // reviewer isn't stuck opening them one at a time. Public (no auth) --
  // same trust model as the media proxy above; the section id is an opaque
  // UUID, not enumerable.
  downloadSectionPhotos: asyncHandler(async (req: Request, res: Response) => {
    const { sectionId } = req.params;
    if (!sectionId) throw ApiError.badRequest('Section id is required');
    const { name, photos } = await inspectionsService.getSectionPhotos(sectionId);
    if (photos.length === 0) throw ApiError.notFound('No additional photos for this section');

    const fileName = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'section'}-photos.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err: Error) => res.destroy(err));
    archive.pipe(res);

    for (const [i, url] of photos.entries()) {
      const id = photoIdFromUrl(url);
      const stored = id ? await fetchPhotoStream(id) : null;
      if (!stored) continue;
      // fetchPhotoStream hands back the raw WHATWG stream fetch() returns --
      // archiver wants a Node Readable.
      archive.append(Readable.fromWeb(stored.body as import('stream/web').ReadableStream), { name: `photo-${i + 1}.jpg` });
    }

    await archive.finalize();
  }),
};
