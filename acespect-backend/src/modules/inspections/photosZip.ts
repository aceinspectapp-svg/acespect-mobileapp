import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { ZIP_LINK_SECONDS, signOriginalPhotosQuery, signSectionZipQuery, verifyOriginalPhotosSignature, verifySectionZipSignature } from '../../lib/mediaLinks';
import type { logSecurityEvent } from '../../lib/securityLog';

type User = { id: string; role: string };

/** What the "download all photos" endpoints need from the outside, so a test can stand in for the database, storage and audit log. */
export interface ZipDeps {
  /** Throws unless the signed-in user may open the inspection the section belongs to (the same rule as viewing it in the web app). */
  assertCanViewSection: (sectionId: string, user: User) => Promise<void>;
  getSectionPhotos: (sectionId: string) => Promise<{ name: string; photos: string[] }>;
  fetchPhotoStream: (id: string) => Promise<{ body: unknown; contentType: string } | null>;
  audit: (e: Record<string, unknown>) => Promise<unknown>;
  logSecurityEvent: typeof logSecurityEvent;
  /** The normal sign-in check (sets req.user, or fails with 401). */
  requireAuth: RequestHandler;
}

/** A photo URL is this backend's own `/api/v1/media/:id` proxy link -- pull the id back off the end of it. */
const photoIdFromUrl = (url: string): string | null => /\/media\/([0-9a-f-]+)\/?(?:\?.*)?$/i.exec(url)?.[1] ?? null;

const noStore = (res: Response) => res.setHeader('Cache-Control', 'private, no-store');

export function makeSectionPhotosZip(deps: ZipDeps) {
  /**
   * Signed-in users get a link to the zip, after the same visibility check as opening the inspection. The web app's plain `<a href>` cannot
   * send the sign-in token, so the download itself is opened with this short-lived link.
   */
  const link = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const sectionId = String(req.params.sectionId ?? '');
    if (!sectionId) throw ApiError.badRequest('Section id is required');
    await deps.assertCanViewSection(sectionId, req.user);
    noStore(res);
    res.status(200).json({ url: `/api/v1/inspections/sections/${sectionId}/photos.zip?${signSectionZipQuery(sectionId)}`, expiresInSeconds: ZIP_LINK_SECONDS });
  });

  /** Opens the download: a valid unexpired link (made above) passes; otherwise the caller must be signed in and allowed to see the inspection. */
  const access: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const sectionId = String(req.params.sectionId ?? '');
    if (verifySectionZipSignature(sectionId, req.query.e, req.query.s)) {
      res.locals.zipViaLink = true;
      return next();
    }
    if (!req.headers.authorization) {
      void deps.logSecurityEvent({ type: 'MEDIA_DENIED', detail: { zip: sectionId, hasSignature: req.query.s !== undefined }, ip: req.ip ?? null });
      return next(ApiError.unauthorized('Sign in, or open the download again from ACE SPECT.', 'NO_TOKEN'));
    }
    deps.requireAuth(req, res, next);
  };

  const download = asyncHandler(async (req: Request, res: Response) => {
    const sectionId = String(req.params.sectionId ?? '');
    if (!sectionId) throw ApiError.badRequest('Section id is required');
    const viaLink = res.locals.zipViaLink === true;
    if (!viaLink) {
      if (!req.user) throw ApiError.unauthorized();
      await deps.assertCanViewSection(sectionId, req.user);
    }
    const { name, photos } = await deps.getSectionPhotos(sectionId);
    if (photos.length === 0) throw ApiError.notFound('No additional photos for this section');

    await deps.audit({
      category: 'web', action: 'photos.download',
      ...(req.user ? {} : { actor: { id: null, name: 'Signed download link', type: 'user' } }),
      target: { type: 'Section', id: sectionId, label: name },
      message: `${photos.length} photo(s) downloaded as a zip`,
      metadata: { count: photos.length, authenticated: !!req.user, viaLink },
    });
    const fileName = `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'section'}-photos.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    noStore(res);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err: Error) => res.destroy(err));
    archive.pipe(res);
    for (const [i, url] of photos.entries()) {
      const id = photoIdFromUrl(url);
      const stored = id ? await deps.fetchPhotoStream(id) : null;
      if (!stored) continue;
      // fetchPhotoStream hands back the raw WHATWG stream fetch() returns -- archiver wants a Node Readable.
      archive.append(Readable.fromWeb(stored.body as import('stream/web').ReadableStream), { name: `photo-${i + 1}.jpg` });
    }
    await archive.finalize();
  });

  return { link, access, download };
}

/** What the "download all original photos" endpoints need from the outside (see makeOriginalPhotosZip). */
export interface OriginalsZipDeps {
  /** Throws unless the signed-in user may open the inspection. */
  assertCanViewInspection: (inspectionId: string, user: User) => Promise<void>;
  getInspectionPhotos: (inspectionId: string) => Promise<{ jobNo: string | null; sections: { name: string; photoIds: string[] }[] }>;
  fetchOriginalPhoto: (id: string) => Promise<{ body: Readable; fileName: string; original: boolean } | null>;
  audit: (e: Record<string, unknown>) => Promise<unknown>;
  logSecurityEvent: typeof logSecurityEvent;
  requireAuth: RequestHandler;
}

/** A folder or file name inside the zip: no slashes or odd characters, never empty. */
const zipName = (raw: string, fallback: string): string => raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || fallback;

/** Shown to someone who opens an expired or altered report link in a browser (they are not signed in, so JSON would mean nothing to them). */
const EXPIRED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Download link not available</title></head>
<body style="font-family: Inter, system-ui, sans-serif; color: #1a2a4a; padding: 48px 24px; text-align: center;">
<h1 style="font-size: 20px;">This download link is no longer available</h1>
<p style="font-size: 15px; color: #475569;">The link to the original photographs has expired or is not valid. Please contact Houspect for a new link.</p>
</body></html>`;

/**
 * "Download all original photos" for a whole inspection: one zip of every photo's full-quality original, one folder per section, in
 * report order. The report prints a long-lived signed link to it (ORIGINAL_PHOTOS_LINK_DAYS), so the client can download without an
 * account; a signed-in user who may open the inspection can also download it directly.
 *
 * The zip is streamed as each photo is read from storage, never held in memory, and the photos are stored, not compressed again
 * (JPEG/HEIC are already compressed -- recompressing a gigabyte gains nothing and costs the server time).
 */
export function makeOriginalPhotosZip(deps: OriginalsZipDeps) {
  /** The link to print in the report, after the same check as opening the inspection. `count` 0 means there is nothing to download. */
  const link = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const inspectionId = String(req.params.id ?? '');
    if (!inspectionId) throw ApiError.badRequest('Inspection id is required');
    await deps.assertCanViewInspection(inspectionId, req.user);
    const { sections } = await deps.getInspectionPhotos(inspectionId);
    const count = sections.reduce((n, s) => n + s.photoIds.length, 0);
    const { query, expiresAt } = signOriginalPhotosQuery(inspectionId);
    noStore(res);
    res.status(200).json({ url: `/api/v1/inspections/${inspectionId}/original-photos.zip?${query}`, count, expiresAt: expiresAt.toISOString() });
  });

  /** A valid unexpired report link passes; otherwise the caller must be signed in (and is checked in `download`). */
  const access: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const inspectionId = String(req.params.id ?? '');
    if (verifyOriginalPhotosSignature(inspectionId, req.query.e, req.query.s)) {
      res.locals.zipViaLink = true;
      return next();
    }
    if (!req.headers.authorization) {
      void deps.logSecurityEvent({ type: 'MEDIA_DENIED', detail: { originals: inspectionId, hasSignature: req.query.s !== undefined }, ip: req.ip ?? null });
      noStore(res);
      res.status(401).type('html').send(EXPIRED_PAGE);
      return;
    }
    deps.requireAuth(req, res, next);
  };

  const download = asyncHandler(async (req: Request, res: Response) => {
    const inspectionId = String(req.params.id ?? '');
    if (!inspectionId) throw ApiError.badRequest('Inspection id is required');
    const viaLink = res.locals.zipViaLink === true;
    if (!viaLink) {
      if (!req.user) throw ApiError.unauthorized();
      await deps.assertCanViewInspection(inspectionId, req.user);
    }
    const { jobNo, sections } = await deps.getInspectionPhotos(inspectionId);
    const count = sections.reduce((n, s) => n + s.photoIds.length, 0);
    if (count === 0) throw ApiError.notFound('This inspection has no photos');

    await deps.audit({
      category: 'web', action: 'photos.download_originals',
      ...(req.user ? {} : { actor: { id: null, name: 'Report download link', type: 'user' } }),
      target: { type: 'Inspection', id: inspectionId, label: jobNo ?? inspectionId },
      message: `${count} original photo(s) downloaded as a zip`,
      metadata: { count, authenticated: !!req.user, viaLink },
    });
    const job = (jobNo ?? '').replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'inspection';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${job}-original-photos.zip"`);
    noStore(res);

    const archive = new ZipArchive({ store: true });
    archive.on('error', (err: Error) => res.destroy(err));
    // A client that gives up half-way stops the work too.
    res.on('close', () => { if (!res.writableFinished) archive.abort(); });
    archive.pipe(res);
    const missing: string[] = [];
    const folders = new Set<string>();
    for (const [i, section] of sections.entries()) {
      let folder = `${String(i + 1).padStart(2, '0')} ${zipName(section.name, 'Section')}`;
      while (folders.has(folder)) folder += '_';
      folders.add(folder);
      const names = new Set<string>();
      for (const id of section.photoIds) {
        if (res.destroyed) return;
        const photo = await deps.fetchOriginalPhoto(id).catch(() => null);
        if (!photo) { missing.push(id); continue; }
        let name = zipName(photo.fileName, `${id}.jpg`);
        if (names.has(name)) name = name.replace(/(\.[^.]*)?$/, `-${id.slice(0, 8)}$1`);
        names.add(name);
        // One photo at a time: the next is read only once this one has gone into the zip, so memory stays flat however big the inspection.
        await new Promise<void>((resolve, reject) => {
          photo.body.once('end', resolve).once('error', reject);
          archive.append(photo.body, { name: `${folder}/${name}` });
        }).catch(() => missing.push(id));
      }
    }
    if (missing.length > 0) {
      archive.append(`${missing.length} photo(s) could not be read from storage and are not in this download:\n${missing.join('\n')}\n`, { name: 'MISSING PHOTOS.txt' });
    }
    await archive.finalize();
  });

  return { link, access, download };
}
