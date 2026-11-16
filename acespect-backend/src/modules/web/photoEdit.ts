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

/** The report copy every photo is brought to: fits inside 1024 x 768 (a portrait photo becomes 576 x 768), never enlarged, and no more than 200 KB. */
export const OPTIMIZE_MAX_WIDTH = 1024;
export const OPTIMIZE_MAX_HEIGHT = 768;
export const OPTIMIZE_MAX_BYTES = 200 * 1024;
const QUALITIES = [92, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72, 70, 66, 62, 58, 54, 50];

/**
 * Shrinks a photo to fit 1024 x 768 and saves it as a JPEG of the HIGHEST quality that still fits in 200 KB -- it starts at 92 and only
 * steps down as far as it must. (Under 200 KB at this size is normally quality 80-90, which is visually the same picture.) A photo so
 * detailed that even quality 50 is too big is made a little smaller instead. The orientation the phone recorded is applied; the shape is never
 * changed, and a photo already smaller than the box is not enlarged.
 */
export async function optimizePhoto(input: Buffer): Promise<{ bytes: Buffer; width: number; height: number; quality: number }> {
  let box = { w: OPTIMIZE_MAX_WIDTH, h: OPTIMIZE_MAX_HEIGHT };
  for (let shrink = 0; shrink < 12; shrink++) {
    const pipeline = () => sharp(input).rotate().resize({ width: box.w, height: box.h, fit: 'inside', withoutEnlargement: true });
    for (const quality of QUALITIES) {
      const bytes = await pipeline().jpeg({ quality, mozjpeg: true }).toBuffer();
      if (bytes.length <= OPTIMIZE_MAX_BYTES) {
        const m = await sharp(bytes).metadata();
        return { bytes, width: m.width ?? 0, height: m.height ?? 0, quality };
      }
    }
    box = { w: Math.round(box.w * 0.9), h: Math.round(box.h * 0.9) };
  }
  throw new Error('The photo could not be brought under 200 KB');
}

/** True when a stored report copy is not yet 1024 x 768 / 200 KB. */
export function needsOptimizing(bytes: number, width: number, height: number): boolean {
  return bytes > OPTIMIZE_MAX_BYTES || width > OPTIMIZE_MAX_WIDTH || height > OPTIMIZE_MAX_HEIGHT;
}
