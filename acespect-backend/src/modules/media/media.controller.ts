import { Request, Response } from 'express';
import { Readable } from 'stream';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { fetchPhotoStream } from '../../lib/storage';

// Strict UUID check -- also the primary key lookup, so it must never be
// allowed to contain anything but a well-formed id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const mediaController = {
  // Public (no auth) -- matches the previous Supabase public-bucket posture.
  get: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || !UUID_RE.test(id)) throw ApiError.badRequest('Invalid photo id');

    const photo = await fetchPhotoStream(id);
    if (!photo) throw ApiError.notFound('Photo not found');

    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
