import { randomUUID } from 'crypto';
import sharp from 'sharp';
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
 * Egnyte Storage for inspection photos, via Egnyte's Public API. Express owns
 * the upload (long-lived API token) -- the mobile app never talks to Egnyte
 * directly, and the token never reaches the client. Egnyte's own shareable
 * links open a web viewer page rather than serving raw image bytes, so
 * uploadPhoto() hands back a URL on THIS backend (see media.routes.ts) which
 * proxies the file through using the same token.
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
  // 200/201 created, 409 already exists -- both fine. Anything else is a real problem.
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => '');
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

function photoPath(id: string, suffix = ''): string {
  return `${env.EGNYTE_ROOT_FOLDER}/inspections/${id}${suffix}`;
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

/** Upload one image; resizes it for the report/UI and returns its storage key + this backend's proxy URL. */
export async function uploadPhoto(
  buffer: Buffer,
  contentType: string,
  ext: string,
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

  const storageKey = photoPath(id, '.jpg');
  await uploadToEgnyte(storageKey, resized, 'image/jpeg');

  // Keep the untouched original alongside it -- not linked anywhere in the
  // app today, but preserved in case a full-resolution copy is ever needed.
  // Non-fatal: the report copy above is what the app actually depends on.
  try {
    await uploadToEgnyte(photoPath(id, `-original.${ext}`), buffer, contentType);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Failed to store the original photo (resized report copy still saved).', err);
  }

  return { id, storageKey, url: `${env.PUBLIC_BASE_URL}/api/v1/media/${id}` };
}

/** Streams the resized report copy for a given photo id straight from Egnyte. Used by the media proxy route. */
export async function fetchPhotoStream(
  id: string,
): Promise<{ body: ReadableStream; contentType: string } | null> {
  if (!isStorageEnabled()) return null;
  const res = await withRetry(() =>
    fetch(`${egnyteBase()}/pubapi/v1/fs-content${encodeEgnytePath(photoPath(id, '.jpg'))}`, {
      headers: authHeaders(),
    }),
  );
  if (res.status === 404) return null;
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`Egnyte fetch failed (${res.status}): ${body}`);
  }
  return { body: res.body, contentType: res.headers.get('content-type') ?? 'image/jpeg' };
}
