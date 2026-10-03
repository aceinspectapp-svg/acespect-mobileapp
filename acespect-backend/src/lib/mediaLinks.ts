import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';

/**
 * Short-lived signed links for evidence and report files (REQ-AUD-005): a file
 * that belongs to a tenant is never served from a permanent public URL. The
 * link carries an expiry and an HMAC over `id.expiry`, so it cannot be edited
 * or reused after it lapses (MEDIA_LINK_MINUTES, default 15).
 */
const secret = () => `${env.JWT_ACCESS_SECRET}:media`;

const sign = (id: string, exp: number) => createHmac('sha256', secret()).update(`${id}.${exp}`).digest('base64url');

export function mediaIdOf(url: string): string | null {
  const m = /\/media\/([0-9a-f-]{36})/i.exec(url);
  return m ? m[1]! : null;
}

/** `/api/v1/media/<id>` -> the same path with `?e=<expiry>&s=<signature>`. Non-media URLs pass through. */
export function signMediaUrl(url: string, minutes = env.MEDIA_LINK_MINUTES): string {
  const id = mediaIdOf(url);
  if (!id) return url;
  const exp = Math.floor(Date.now() / 1000) + minutes * 60;
  return `/api/v1/media/${id}?e=${exp}&s=${sign(id, exp)}`;
}

export function verifyMediaSignature(id: string, e: unknown, s: unknown): boolean {
  const exp = Number(e);
  if (!Number.isFinite(exp) || typeof s !== 'string' || exp < Math.floor(Date.now() / 1000)) return false;
  const a = Buffer.from(sign(id, exp));
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}
