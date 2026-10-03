import { Request, Response } from 'express';
import { Readable } from 'stream';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { fetchPhotoStream } from '../../lib/storage';
import { prisma } from '../../lib/prisma';
import { verifyMediaSignature } from '../../lib/mediaLinks';
import { logSecurityEvent } from '../../lib/securityLog';

/** Files that belong to a tenant (evidence, project documents, generated reports) are only served through a signed, expiring link. */
async function isTenantFile(id: string): Promise<boolean> {
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

export const mediaController = {
  // Public (no auth) -- matches the previous Supabase public-bucket posture.
  get: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || !UUID_RE.test(id)) throw ApiError.badRequest('Invalid photo id');

    const tenantFile = await isTenantFile(id);
    if (tenantFile) {
      if (!verifyMediaSignature(id, req.query.e, req.query.s)) {
        await logSecurityEvent({ type: 'MEDIA_DENIED', detail: { id }, ip: req.ip ?? null });
        throw ApiError.forbidden('This link has expired or is not valid. Open the file again from ACE SPECT.');
      }
      await logSecurityEvent({ type: 'FILE_ACCESS', detail: { id }, ip: req.ip ?? null });
    }

    const photo = await fetchPhotoStream(id);
    if (!photo) throw ApiError.notFound('Photo not found');

    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', tenantFile ? 'private, max-age=60' : 'public, max-age=31536000, immutable');
    // Without this, Chrome's Cross-Origin-Resource-Policy enforcement blocks
    // <img> tags from loading this photo whenever the web app and backend
    // are on different origins (net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin)
    // -- which is always true here, since each runs behind its own separate
    // Cloudflare tunnel hostname. A plain `fetch()` to the same URL isn't
    // subject to this check, which is why the request "worked" when tested
    // directly but every <img> in the app rendered a broken-image icon.
    // This photo is meant to be publicly embeddable, so opt in explicitly.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    Readable.fromWeb(photo.body as import('stream/web').ReadableStream).pipe(res);
  }),
};
