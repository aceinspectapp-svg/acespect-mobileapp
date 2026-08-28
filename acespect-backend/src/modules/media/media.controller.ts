import { Request, Response } from 'express';
import { Readable } from 'stream';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { fetchPhotoStream } from '../../lib/storage';

// Strict UUID check -- the id feeds directly into an Egnyte file path, so it
// must never be allowed to contain "/" or "..".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const mediaController = {
  // Public (no auth) -- matches the previous Supabase public-bucket posture.
  // The Egnyte API token itself never leaves this server; only the resized
  // report copy's bytes are streamed through.
  get: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id || !UUID_RE.test(id)) throw ApiError.badRequest('Invalid photo id');

    const photo = await fetchPhotoStream(id);
    if (!photo) throw ApiError.notFound('Photo not found');

    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    Readable.fromWeb(photo.body as import('stream/web').ReadableStream).pipe(res);
  }),
};
