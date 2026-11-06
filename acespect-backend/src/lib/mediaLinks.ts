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

/** The old unsigned inspection-photo links still work until this moment (MEDIA_ALLOW_UNSIGNED_UNTIL); never when it is not set. */
export function unsignedAllowed(now = Date.now()): boolean {
  const until = env.MEDIA_ALLOW_UNSIGNED_UNTIL ? Date.parse(env.MEDIA_ALLOW_UNSIGNED_UNTIL) : NaN;
  return Number.isFinite(until) && now < until;
}

/** Seconds a signed link has left, 0 when it has lapsed. */
export const secondsLeft = (e: unknown): number => Math.max(0, Number(e) - Math.floor(Date.now() / 1000));

// A whole string that is one of this backend's media links (relative, or with an old host in front), optionally already signed.
const MEDIA_LINK = /^((?:https?:\/\/[^/\s]+)?\/api\/v1\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))(?:\?e=\d+&s=[A-Za-z0-9_-]+)?$/i;

function mapStrings<T>(value: T, f: (s: string) => string): T {
  if (typeof value === 'string') return f(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, f)) as unknown as T;
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value; // a Date, Buffer ...: leave alone
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, f)])) as T;
  }
  return value;
}

/**
 * Every inspection-photo link inside `value` (photos, answers, fields, damage records ... at any depth) comes back as a freshly signed,
 * expiring link. What is stored stays the plain `/api/v1/media/<id>`. The expiry is rounded down to the minute and chosen once for the
 * whole call, so the same photo inside one answer carries the same link everywhere (the web app matches excluded photos by link).
 */
export function signMediaLinks<T>(value: T, minutes = env.MEDIA_LINK_MINUTES): T {
  const exp = Math.floor((Math.floor(Date.now() / 1000) + minutes * 60) / 60) * 60;
  return mapStrings(value, (str) => {
    const m = MEDIA_LINK.exec(str);
    return m ? `${m[1]}?e=${exp}&s=${sign(m[2]!, exp)}` : str;
  });
}

/** The reverse, for anything a client sends back: a signed link must never be stored, it would stop working when it lapses. */
export function stripMediaSignatures<T>(value: T): T {
  return mapStrings(value, (str) => MEDIA_LINK.exec(str)?.[1] ?? str);
}

/** Lifetime of a "download all photos" link. Long enough to start the download, short enough that a copied link is useless. */
export const ZIP_LINK_SECONDS = 120;
const zipKey = (sectionId: string) => `zip:${sectionId}`;

/** `?e=<expiry>&s=<signature>` for a section's photos.zip; the signature covers `zip:<sectionId>`, so it cannot open a photo or another section. */
export function signSectionZipQuery(sectionId: string, seconds = ZIP_LINK_SECONDS): string {
  const exp = Math.floor(Date.now() / 1000) + seconds;
  return `e=${exp}&s=${sign(zipKey(sectionId), exp)}`;
}

export const verifySectionZipSignature = (sectionId: string, e: unknown, s: unknown): boolean => verifyMediaSignature(zipKey(sectionId), e, s);
