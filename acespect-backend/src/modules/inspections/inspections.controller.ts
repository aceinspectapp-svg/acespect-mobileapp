import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { inspectionsService } from './inspections.service';
import { fetchPhotoStream } from '../../lib/storage';
import { generateInspectionReportPdf } from '../../lib/reportPdf';
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
  event: 'received' | 'saved' | 'updated' | 'finalized' | 'photo_uploaded',
  ctx: { inspectorId?: string | null; inspectionId?: string | null; jobNo?: string | null },
  detail: Record<string, unknown>,
): void {
  // eslint-disable-next-line no-console
  console.log('[submit]', event, JSON.stringify({ ...ctx, ...detail }));
  void recordSubmissionEvent({ event, ...ctx, detail });
}

/** Thin HTTP layer for inspection submission + lookup. */
export const inspectionsController = {
  // Saves as a DRAFT the inspector still owns — review only starts at finalize.
  submit: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const body = req.body as { jobNo?: string; id?: string; sections?: unknown[] };
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
    res.status(201).json({ inspectionId: inspection.id, status: inspection.status });
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
    const pdf = await generateInspectionReportPdf(id, token, {
      clientName: inspection.client ?? '',
      jobNo: inspection.jobNo ?? '',
    });

    const fileName = `${inspection.jobNo || id}-dilapidation-report.pdf`.replace(/[^a-z0-9.-]+/gi, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdf);
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
    const result = await inspectionsService.uploadPhoto(
      file.buffer,
      file.mimetype,
      file.originalname,
      inspectionId,
      sectionKey,
    );
    logSubmit(
      'photo_uploaded',
      { inspectorId: req.user.id, inspectionId },
      { sectionKey, bytes: file.buffer.length, photoId: result.id },
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
