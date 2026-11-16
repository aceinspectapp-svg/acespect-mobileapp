/**
 * The pure parts of the reviewer's photo tools: reading a photo's id from its link, swapping or removing a photo everywhere inside a
 * section's saved data, and rotating / cropping the picture itself. No database here, so each can be tested on its own
 * (photoEdit.test.ts); photoTools.service.ts does the saving.
 */
import sharp from 'sharp';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const MEDIA_RE = new RegExp(`/media/(${UUID})`, 'i');

/** The photo id in a `/api/v1/media/<id>` link (any prefix, signed or not), or null when the text is not a photo link. */
export function mediaIdOf(url: string): string | null {
  const m = MEDIA_RE.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * `value` with every link to photo `fromId` pointing at photo `toId` instead -- in photo lists, answers, the composed report text,
 * anywhere. The link's own prefix and signature are kept; only the id changes.
 */
export function swapMediaId<T>(value: T, fromId: string, toId: string): T {
  const re = new RegExp(`/media/${fromId}`, 'gi');
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(re, `/media/${toId}`);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/**
 * `value` with photo `id` taken out: dropped from every photo list, and from the `PHOTOS::a,b,c` markers inside composed report text
 * (so no stray comma or empty marker is left behind).
 */
export function removeMediaId<T>(value: T, id: string): T {
  // A link: an optional http(s) host, then a path (no colon, so a "PHOTOS::" marker in front of it is not taken for part of it), then its query.
  const link = new RegExp(`(?:https?://[^\\s,"]*?)?[^\\s,":]*/media/${id}[^\\s,"]*`, 'gi');
  const has = (s: string) => new RegExp(`/media/${id}`, 'i').test(s);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (!has(v)) return v;
      return v
        .replace(link, '')
        .replace(/,{2,}/g, ',')
        .replace(/(PHOTOS::),/g, '$1')
        .replace(/,(?=\r?\n|$)/g, '')
        .replace(/^PHOTOS::(\r?\n|$)/gm, '$1')
        .replace(/\n{3,}/g, '\n\n');
    }
    if (Array.isArray(v)) return v.filter((x) => !(typeof x === 'string' && has(x) && mediaIdOf(x) === id)).map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

export interface PhotoEdit {
  /** Clockwise turns, in degrees. */
  rotate: 0 | 90 | 180 | 270;
  /** A box inside the rotated photo, as fractions (0..1) of its width and height. */
  crop?: { x: number; y: number; w: number; h: number };
}

/** The smallest a cropped photo may be, in pixels. */
const MIN_SIDE = 32;

/**
 * Rotates, then crops, a photo: JPEG out. The photo's own orientation (the phone's EXIF turn) is applied first so "rotate" always means
 * what the reviewer sees on screen.
 */
export async function applyPhotoEdit(input: Buffer, edit: PhotoEdit): Promise<{ bytes: Buffer; width: number; height: number }> {
  const upright = await sharp(input).rotate().toBuffer();
  const turned = edit.rotate ? await sharp(upright).rotate(edit.rotate).toBuffer() : upright;
  const meta = await sharp(turned).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error('The photo could not be read');
  let pipeline = sharp(turned);
  if (edit.crop) {
    const left = Math.min(W - MIN_SIDE, Math.max(0, Math.round(edit.crop.x * W)));
    const top = Math.min(H - MIN_SIDE, Math.max(0, Math.round(edit.crop.y * H)));
    const width = Math.max(MIN_SIDE, Math.min(W - left, Math.round(edit.crop.w * W)));
    const height = Math.max(MIN_SIDE, Math.min(H - top, Math.round(edit.crop.h * H)));
    pipeline = pipeline.extract({ left, top, width, height });
  }
  const bytes = await pipeline.jpeg({ quality: 88 }).toBuffer();
  const out = await sharp(bytes).metadata();
  return { bytes, width: out.width ?? W, height: out.height ?? H };
}

/** The sizes a photo can print at: the standard grid (default), or alone on its own row at the page's width. */
export const PHOTO_SIZES = ['standard', 'large'] as const;
export type PhotoSize = (typeof PHOTO_SIZES)[number];
