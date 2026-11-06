import { Request, Response } from 'express';
import { Readable } from 'stream';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { fetchPhotoStream } from '../../lib/storage';
import { prisma } from '../../lib/prisma';
import { secondsLeft, unsignedAllowed, verifyMediaSignature } from '../../lib/mediaLinks';
import { logSecurityEvent } from '../../lib/securityLog';

/**
 * Every photo request asks this, and answering takes two database look-ups (one a scan of JSON text), so a page with a hundred photos meant
 * two hundred queries. The answer is remembered briefly: a "no" for a minute (a photo only becomes a tenant file once its record is saved,
 * and its id is not known to anyone else before then), a "yes" for ten. Bounded in size.
 */
const tenantAnswers = new Map<string, { tenant: boolean; until: number }>();
async function isTenantFile(id: string): Promise<boolean> {
  const known = tenantAnswers.get(id);
  if (known && known.until > Date.now()) return known.tenant;
  const tenant = await lookUpTenantFile(id);
  if (tenantAnswers.size > 20_000) tenantAnswers.delete(tenantAnswers.keys().next().value as string);
  tenantAnswers.set(id, { tenant, until: Date.now() + (tenant ? 10 * 60_000 : 60_000) });
  return tenant;
}

/** Files that belong to a tenant (evidence, project documents, generated reports) are only served through a signed, expiring link. */
async function lookUpTenantFile(id: string): Promise<boolean> {
  const needle = `/media/${id}`;
  const [evidence, doc] = await Promise.all([
    prisma.qcEvidence.findFirst({ where: { url: { contains: needle } }, select: { id: true, clientId: true } }),
    prisma.qcRecord.findFirst({ where: { kind: { in: ['project_document', 'report'] }, data: { path: ['fileUrl'], string_contains: needle } }, select: { id: true } }),
  ]);
  return !!evidence || !!doc;
}

// Strict UUID check -- also the primary key lookup, so it must never be
// allowed to contain anything but a well-formed id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the handler needs from the outside, so a test can stand in for the database, the storage and the security log. */
export interface MediaDeps {
  isTenantFile: (id: string) => Promise<boolean>;
  fetchPhotoStream: typeof fetchPhotoStream;
  logSecurityEvent: typeof logSecurityEvent;
}

export function makeMediaGet({ isTenantFile, fetchPhotoStream, logSecurityEvent }: MediaDeps) {
  // Every photo and file needs a valid, unexpired signed link (`?e=<expiry>&s=<signature>`) -- the API hands those out only to signed-in users.
  // The one exception is the roll-out window: until MEDIA_ALLOW_UNSIGNED_UNTIL an old unsigned link to an inspection photo (not a tenant's
  // file) still works, and each such access is logged.
  return asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || !UUID_RE.test(id)) throw ApiError.badRequest('Invalid photo id');

    const tenantFile = await isTenantFile(id);
    const signed = verifyMediaSignature(id, req.query.e, req.query.s);
    if (!signed) {
      if (!tenantFile && unsignedAllowed()) {
        await logSecurityEvent({ type: 'MEDIA_UNSIGNED', detail: { id, hasSignature: req.query.s !== undefined }, ip: req.ip ?? null });
      } else {
        await logSecurityEvent({ type: 'MEDIA_DENIED', detail: { id, hasSignature: req.query.s !== undefined }, ip: req.ip ?? null });
        throw ApiError.forbidden('This link has expired or is not valid. Open the file again from ACE SPECT.');
      }
    } else if (tenantFile) {
      await logSecurityEvent({ type: 'FILE_ACCESS', detail: { id }, ip: req.ip ?? null });
    }

    const photo = await fetchPhotoStream(id);
    if (!photo) throw ApiError.notFound('Photo not found');

    res.setHeader('Content-Type', photo.contentType);
    // Private only (never a shared cache), and never for longer than the link itself is good for.
    res.setHeader('Cache-Control', `private, max-age=${signed ? Math.min(60, secondsLeft(req.query.e)) : 0}`);
    // Without this, Chrome's Cross-Origin-Resource-Policy enforcement blocks
    // <img> tags from loading this photo whenever the web app and backend
    // are on different origins (net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin).
    // The link is a signed, expiring one the signed-in app puts in its own <img> tags, so opt in explicitly.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    Readable.fromWeb(photo.body as import('stream/web').ReadableStream).pipe(res);
  });
}

export const mediaController = { get: makeMediaGet({ isTenantFile, fetchPhotoStream, logSecurityEvent }) };
