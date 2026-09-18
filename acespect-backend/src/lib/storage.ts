import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { env } from '../config/env';
import { prisma } from './prisma';

// Every photo used in the review UI and the generated report is resized to
// one consistent size at upload time -- this replaces the old manual
// "select all, right-click, Resize Pictures to Medium" desktop workflow.
// 1366x768 mirrors that tool's "Medium" preset; it keeps reports fast to
// generate without a visible quality loss.
const REPORT_MAX_WIDTH = 1366;
const REPORT_MAX_HEIGHT = 768;
const REPORT_JPEG_QUALITY = 82;

/**
 * Egnyte Storage for inspection photos, via Egnyte's Public API. Express owns
 * the upload (long-lived API token) -- the mobile app never talks to Egnyte
 * directly, and the token never reaches the client. Egnyte's own shareable
 * links open a web viewer page rather than serving raw image bytes, so
 * uploadPhoto() hands back a URL on THIS backend (see media.routes.ts) which
 * proxies the file through using the same token.
 *
 * Folder layout: {EGNYTE_ROOT_FOLDER}/{inspectionId}/{sectionKey parts.../}{photoId}.jpg
 * -- one folder per inspection, then one subfolder per colon-separated part
 * of `sectionKey` (e.g. "internal_areas:ceilings" -> internal_areas/ceilings/),
 * so photos are browsable in Egnyte grouped by sub-area, not dumped into one
 * folder per section. `inspectionId`/`sectionKey` are optional on
 * `uploadPhoto()`: when absent (a caller with no section context) it falls
 * back to the old flat `{root}/inspections/{photoId}.jpg` layout.
 *
 * The public `/api/v1/media/:id` URL stays a plain opaque id either way --
 * it never leaks the folder structure to clients -- because the `photos`
 * table is a small id -> Egnyte-path index (see prisma/schema.prisma),
 * looked up on fetch.
 */
function egnyteBase(): string {
  return `https://${env.EGNYTE_DOMAIN}.egnyte.com`;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${env.EGNYTE_API_TOKEN}` };
}

export function isStorageEnabled(): boolean {
  return !!env.EGNYTE_DOMAIN && !!env.EGNYTE_API_TOKEN;
}

/**
 * Outbound calls to Egnyte occasionally fail with a generic "fetch failed"
 * whose root cause (confirmed via logging, same symptom as the old Supabase
 * integration) is a transient DNS resolution miss (ENOTFOUND) from the
 * container's resolver -- the same host resolves fine moments before/after.
 * Node's fetch/undici doesn't retry DNS misses on its own, so a short bounded
 * retry absorbs the blip instead of failing the whole request.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Create the root inspection-photos folder if it doesn't exist. Safe to call on boot. */
export async function ensureBucket(): Promise<boolean> {
  if (!isStorageEnabled()) return false;
  const path = encodeEgnytePath(env.EGNYTE_ROOT_FOLDER);
  const res = await withRetry(() =>
    fetch(`${egnyteBase()}/pubapi/v1/fs${path}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_folder' }),
    }),
  );
  // 200/201 created, 409 already exists -- both fine. This Egnyte instance
  // reports "already exists" as a 403 rather than 409, so check the body too
  // rather than trusting the status code alone. Anything else is a real problem.
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && /already exists/i.test(body)) return true;
    throw new Error(`Failed to create Egnyte root folder (${res.status}): ${body}`);
  }
  return true;
}

export interface UploadedPhoto {
  id: string;
  storageKey: string;
  url: string;
}

/** Egnyte paths are slash-separated but each segment must be URI-encoded individually. */
function encodeEgnytePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Keep only characters safe as a single Egnyte path segment -- ids/section keys come from the client, never trust them verbatim in a path. */
function safeSegment(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

/**
 * A section key can be nested (e.g. "internal_areas:ceilings" for a photo
 * captured on the Ceilings sub-area of Internal Areas, or
 * "elevations:other_doors_ext" for the Other External Doors group) -- each
 * colon-separated segment becomes its own Egnyte subfolder, so photos land
 * grouped by sub-area rather than dumped into one flat per-section folder.
 */
function sectionFolderPath(sectionKey: string): string {
  return sectionKey
    .split(':')
    .map(safeSegment)
    .filter(Boolean)
    .join('/');
}

function photoPath(id: string, inspectionId: string | undefined, sectionKey: string | undefined, suffix = ''): string {
  if (inspectionId && sectionKey) {
    return `${env.EGNYTE_ROOT_FOLDER}/${safeSegment(inspectionId)}/${sectionFolderPath(sectionKey)}/${id}${suffix}`;
  }
  return `${env.EGNYTE_ROOT_FOLDER}/inspections/${id}${suffix}`;
}

/**
 * Move an inspection's Egnyte folder from the draft-local id it was created
 * under (see `photoPath`'s `inspectionId`) to a name based on the job
 * number, once that's known at submit time -- so folders are browsable by
 * job number in Egnyte instead of an opaque UUID. Non-fatal: a collision
 * (two inspections landing on the same job number) or any other failure
 * leaves photos under their existing, still perfectly valid folder rather
 * than blocking submission.
 */
export async function renameInspectionFolder(oldId: string, jobNo: string): Promise<string | null> {
  if (!isStorageEnabled()) return null;
  const oldSegment = safeSegment(oldId);
  const newSegment = safeSegment(jobNo);
  if (!newSegment || newSegment === oldSegment) return null;

  const oldFolder = `${env.EGNYTE_ROOT_FOLDER}/${oldSegment}`;
  const newFolder = `${env.EGNYTE_ROOT_FOLDER}/${newSegment}`;

  const res = await withRetry(() =>
    fetch(`${egnyteBase()}/pubapi/v1/fs${encodeEgnytePath(oldFolder)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', destination: newFolder }),
    }),
  );
  if (res.status === 404) return null; // no photos were ever taken -- nothing to move
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error(`⚠️  Failed to rename Egnyte folder ${oldFolder} -> ${newFolder} (${res.status}): ${body}`);
    return null;
  }

  // The photos table indexes each photo by its full Egnyte path -- repoint
  // every one that lived under the old folder so future fetches still
  // resolve to where the file actually moved to.
  await prisma.$executeRaw`
    UPDATE photos
    SET "storageKey" = ${newFolder} || substring("storageKey" from ${oldFolder.length + 1}::int)
    WHERE "storageKey" LIKE ${oldFolder + '/%'}
  `;

  return newSegment;
}

async function uploadToEgnyte(path: string, buffer: Buffer, contentType: string): Promise<void> {
  const res = await withRetry(() =>
    fetch(`${egnyteBase()}/pubapi/v1/fs-content${encodeEgnytePath(path)}`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': contentType },
      body: buffer,
    }),
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Egnyte upload failed (${res.status}): ${body}`, { cause: body });
  }
}

/**
 * Upload one image, keeping two copies in Egnyte on purpose (not the earlier
 * accidental duplication, which this replaces with a deliberate, documented
 * one): the untouched full-quality original for archival/future reference,
 * and a resized/compressed copy for fast report and dashboard display. The
 * public `/api/v1/media/:id` URL and the returned `storageKey` always point
 * at the compressed copy -- that's what every in-app view renders, so
 * nothing downstream needs to know the original exists. `inspectionId`/
 * `sectionKey`, when given, group both files under that inspection's own
 * section subfolder in Egnyte (see the module doc above); omit them for a
 * flat, ungrouped upload.
 */
export async function uploadPhoto(
  buffer: Buffer,
  contentType: string,
  ext: string,
  inspectionId?: string,
  sectionKey?: string,
): Promise<UploadedPhoto> {
  if (!isStorageEnabled()) throw new Error('Photo storage is not configured');

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

  const storageKey = photoPath(id, inspectionId, sectionKey, '.jpg');
  await uploadToEgnyte(storageKey, resized, 'image/jpeg');

  // Full-quality original, alongside the compressed copy above. Non-fatal:
  // every in-app view depends on the compressed copy having uploaded (which
  // already happened by this point), not this one.
  try {
    await uploadToEgnyte(photoPath(id, inspectionId, sectionKey, `-original.${ext}`), buffer, contentType);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Failed to store the full-quality original (compressed report copy still saved).', err);
  }

  // Index id -> real path so the public URL can stay a plain opaque id.
  await prisma.photo.create({ data: { id, storageKey, contentType: 'image/jpeg' } });

  // Relative, not `${PUBLIC_BASE_URL}/api/v1/media/${id}`: PUBLIC_BASE_URL is a
  // Cloudflare quick tunnel that gets a new hostname every restart, so a
  // baked-in absolute URL would go dead (and break every already-submitted
  // photo) the next time the tunnel restarts. Clients resolve this path
  // against whatever API host they're currently configured for.
  return { id, storageKey, url: `/api/v1/media/${id}` };
}

/** Streams the resized report copy for a given photo id straight from Egnyte. Used by the media proxy route. */
export async function fetchPhotoStream(
  id: string,
): Promise<{ body: ReadableStream; contentType: string } | null> {
  if (!isStorageEnabled()) return null;

  // Look up the real Egnyte path from the index; fall back to the old flat
  // guess for photos uploaded before this index existed.
  const indexed = await prisma.photo.findUnique({ where: { id } });
  const path = indexed?.storageKey ?? photoPath(id, undefined, undefined, '.jpg');

  const res = await withRetry(() =>
    fetch(`${egnyteBase()}/pubapi/v1/fs-content${encodeEgnytePath(path)}`, {
      headers: authHeaders(),
    }),
  );
  if (res.status === 404) return null;
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`Egnyte fetch failed (${res.status}): ${body}`);
  }
  return { body: res.body, contentType: indexed?.contentType ?? res.headers.get('content-type') ?? 'image/jpeg' };
}
