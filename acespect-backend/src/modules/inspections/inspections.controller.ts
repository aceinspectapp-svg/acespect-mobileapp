import { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { inspectionsService } from './inspections.service';
import { fetchPhotoStream } from '../../lib/storage';

/** A photo URL is this backend's own `/api/v1/media/:id` proxy link -- pull the id back off the end of it. */
function photoIdFromUrl(url: string): string | null {
  const match = /\/media\/([0-9a-f-]+)\/?$/i.exec(url);
  return match?.[1] ?? null;
}

/** Thin HTTP layer for inspection submission + lookup. */
export const inspectionsController = {
  // Saves as a DRAFT the inspector still owns — review only starts at finalize.
  submit: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { inspection } = await inspectionsService.submit(req.user.id, req.body);
    res.status(201).json({ inspectionId: inspection.id, status: inspection.status });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await inspectionsService.update(id, req.user.id, req.body);
    res.status(200).json({ inspectionId: inspection.id, status: inspection.status });
  }),

  // Point of no return: assigns a reviewer and enqueues the async review.
  finalize: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const { inspection, reviewJob } = await inspectionsService.finalize(id, req.user.id);
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
