import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { prisma } from './prisma';
import { env } from '../config/env';

// Every photo used in the review UI and the generated report is resized to
// one consistent size at upload time -- this replaces the old manual
// "select all, right-click, Resize Pictures to Medium" desktop workflow.
// 1366x768 mirrors that tool's "Medium" preset; it keeps reports fast to
// generate without a visible quality loss.
const REPORT_MAX_WIDTH = 1366;
const REPORT_MAX_HEIGHT = 768;
const REPORT_JPEG_QUALITY = 82;

/**
 * Inspection photo storage, backed directly by Postgres (a `photos` table
 * holding the resized bytes) rather than an external provider -- previously
 * Egnyte, removed because it requires credentials this deployment doesn't
 * have, which meant every real inspection submission was silently failing
 * at the photo-upload step (`isStorageEnabled()` was always false) while
 * only the seeded demo data ever showed up anywhere. No external
 * credentials to configure means uploads just work.
 *
 * Kept the exact same function signatures (`isStorageEnabled`, `uploadPhoto`,
 * `fetchPhotoStream`, `ensureBucket`) so nothing calling into this module --
 * the media proxy route, the inspections submit/photo endpoints, server
 * startup -- needed to change.
 *
 * Simplification versus the old Egnyte version: only the resized report
 * copy is kept now, not a second full-resolution "original" alongside it --
 * that original was already unused anywhere in the app.
 */
export function isStorageEnabled(): boolean {
  return true;
}

/** No external bucket to provision for Postgres-backed storage -- kept as a no-op so server.ts's startup check doesn't need its own special case. */
export async function ensureBucket(): Promise<boolean> {
  return true;
}

export interface UploadedPhoto {
  id: string;
  storageKey: string;
  url: string;
}

/** Resize, store in Postgres, and return this backend's proxy URL for it. */
export async function uploadPhoto(
  buffer: Buffer,
  _contentType: string,
  _ext: string,
): Promise<UploadedPhoto> {
  const id = randomUUID();

  // rotate() with no args bakes in the EXIF orientation tag (phone photos are
  // often stored sideways/upside-down relative to how they should display)
  // then strips it, so the resized copy always renders right-side-up.
  const resized = await sharp(buffer)
    .rotate()
    .resize({
      width: REPORT_MAX_WIDTH,
      height: REPORT_MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: REPORT_JPEG_QUALITY })
    .toBuffer();

  await prisma.photo.create({
    // Prisma's Bytes field wants a plain Uint8Array backed by a real
    // ArrayBuffer -- Buffer's own type is wider (allows SharedArrayBuffer),
    // which TS rejects here even though the actual bytes are fine either way.
    data: { id, data: new Uint8Array(resized), contentType: 'image/jpeg' },
  });

  return { id, storageKey: id, url: `${env.PUBLIC_BASE_URL}/api/v1/media/${id}` };
}

/** Reads back one stored photo's bytes for the media proxy route. */
export async function fetchPhotoStream(
  id: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) return null;
  return { data: Buffer.from(photo.data), contentType: photo.contentType };
}
