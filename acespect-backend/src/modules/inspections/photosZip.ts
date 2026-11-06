import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { ZIP_LINK_SECONDS, signSectionZipQuery, verifySectionZipSignature } from '../../lib/mediaLinks';
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
