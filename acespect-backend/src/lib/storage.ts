import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import { env } from '../config/env';
import { prisma } from './prisma';
import { mergeFolder, resolveInspectionFolder, type EgnyteFs, type Resolution } from './egnyteJobFolders';

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
  return env.EGNYTE_BASE_URL || `https://${env.EGNYTE_DOMAIN}.egnyte.com`;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${env.EGNYTE_API_TOKEN}` };
}

/** Local development only: with no Egnyte configured, files are kept in the `photos` table so the app and its tests still work. */
export const useDbStorage = (): boolean => !isStorageEnabled() && env.NODE_ENV !== 'production';

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

/**
 * Every call to Egnyte goes through here. This Egnyte account allows about 2 requests a second ("Spike arrest violation",
 * HTTP 429), so calls are spaced out, and a 429 is waited out and retried rather than failing the photo upload.
 */
const MIN_GAP_MS = 550;
let nextSlot = 0;
export async function egnyteFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const start = Math.max(now, nextSlot);
    nextSlot = start + MIN_GAP_MS;
    if (start > now) await new Promise((r) => setTimeout(r, start - now));
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= 6) return res;
    await res.arrayBuffer().catch(() => undefined);
    nextSlot = Math.max(nextSlot, Date.now() + 1000 * (attempt + 1));
  }
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

/**
 * The Egnyte web-interface link to the folder where this job's photos are
 * saved -- `{EGNYTE_ROOT_FOLDER}/{job number}` (the folder is created under
 * the draft id and moved to the job number at submit, see
 * `renameInspectionFolder`; a job with no job number yet stays under its id).
 * Derived from the job number alone, so it is always the link for THIS job and
 * needs no per-job setup. Null when photo storage isn't configured.
 */
export function inspectionFolderUrl(jobNo: string | null | undefined, inspectionId: string, egnytePath?: string | null): string | null {
  if (!isStorageEnabled()) return null;
  // The resolved folder (inside its batch) when the job was placed; the old {root}/{job} guess for older records.
  if (egnytePath) return `${egnyteBase()}/app/index.do#storage/files/1${encodeEgnytePath(egnytePath.startsWith('/') ? egnytePath : `/${egnytePath}`)}`;
  const segment = safeSegment((jobNo ?? '').trim()) || safeSegment(inspectionId);
  const root = env.EGNYTE_ROOT_FOLDER.startsWith('/') ? env.EGNYTE_ROOT_FOLDER : `/${env.EGNYTE_ROOT_FOLDER}`;
  return `${egnyteBase()}/app/index.do#storage/files/1${encodeEgnytePath(`${root}/${segment}`)}`;
}

export interface UploadedPhoto {
  id: string;
  storageKey: string;
  url: string;
  /** SHA-256 of the stored (served) copy, so evidence can later be proven unchanged. */
  storedHash?: string;
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

/**
 * The folder a QC project's files live in, named by the project's job number (the same way inspector inspections are named
 * by job number). A project without a job number, or whose job number another project also uses, gets a name that
 * cannot collide, so two projects never share a folder.
 */
export async function qcJobFolder(projectId: string): Promise<string> {
  const p = await prisma.qcProject.findUnique({ where: { id: projectId }, select: { id: true, name: true, jobNumber: true } });
  if (!p) return 'unassigned';
  const short = safeSegment(p.id).slice(0, 8);
  const job = safeSegment(p.jobNumber ?? '');
  if (!job) return `${safeSegment(p.name) || 'project'}_${short}`;
  const clash = await prisma.qcProject.count({ where: { id: { not: p.id }, jobNumber: { equals: p.jobNumber!, mode: 'insensitive' } } });
  return clash > 0 ? `${job}_${short}` : job;
}

function photoPath(id: string, inspectionId: string | undefined, sectionKey: string | undefined, suffix = '', tenantId?: string, jobFolder?: string, destination?: string): string {
  // An inspector's inspection whose job number is known: {batch}/{job}/{section}/{photo} (see lib/egnyteJobFolders.ts).
  if (destination && sectionKey) return `${destination}/${sectionFolderPath(sectionKey)}/${id}${suffix}`;
  if (destination) return `${destination}/${id}${suffix}`;
  // Client files live under their own folder so one client's files are never mixed with another's; a QC project's files
  // sit under its job-number folder instead.
  const root = jobFolder
    ? `${env.EGNYTE_ROOT_FOLDER}/${safeSegment(jobFolder)}`
    : tenantId
      ? `${env.EGNYTE_ROOT_FOLDER}/tenants/${safeSegment(tenantId)}`
      : env.EGNYTE_ROOT_FOLDER;
  if (inspectionId && sectionKey) {
    return `${root}/${safeSegment(inspectionId)}/${sectionFolderPath(sectionKey)}/${id}${suffix}`;
  }
  return `${root}/inspections/${id}${suffix}`;
}

// ───────────────────────── Folder placement (see lib/egnyteJobFolders.ts for the rules) ─────────────────────────

const egnyteRoot = () => (env.EGNYTE_ROOT_FOLDER.startsWith('/') ? env.EGNYTE_ROOT_FOLDER : `/${env.EGNYTE_ROOT_FOLDER}`).replace(/\/+$/, '');

async function egnyteRequest(path: string, init: { method: string; body?: unknown; query?: string }): Promise<Response> {
  return withRetry(() =>
    egnyteFetch(`${egnyteBase()}/pubapi/v1/fs${encodeEgnytePath(path)}${init.query ?? ''}`, {
      method: init.method,
      headers: { ...authHeaders(), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    }),
  );
}

/** The Egnyte calls the folder rules need. */
export const egnyteFs: EgnyteFs = {
  async list(path) {
    const folders: string[] = [];
    const files: string[] = [];
    const page = 500;
    for (let offset = 0; ; offset += page) {
      const res = await egnyteRequest(path, { method: 'GET', query: `?list_content=true&count=${page}&offset=${offset}` });
      if (res.status === 404) return offset === 0 ? null : { folders, files };
      if (!res.ok) throw new Error(`Egnyte could not list ${path} (${res.status}): ${await res.text().catch(() => '')}`);
      const body = (await res.json()) as { folders?: { name: string }[]; files?: { name: string }[]; total_count?: number };
      for (const f of body.folders ?? []) folders.push(f.name);
      for (const f of body.files ?? []) files.push(f.name);
      if (offset + page >= (body.total_count ?? 0)) break;
    }
    return { folders, files };
  },
  async createFolder(path) {
    const res = await egnyteRequest(path, { method: 'POST', body: { action: 'add_folder' } });
    if (res.ok || res.status === 409) return;
    const body = await res.text().catch(() => '');
    // This Egnyte instance reports "already exists" as 403 (or 405) rather than 409.
    if ((res.status === 403 || res.status === 405) && /already exists/i.test(body)) return;
    throw new Error(`Egnyte could not create ${path} (${res.status}): ${body}`);
  },
  async move(from, to) {
    const res = await egnyteRequest(from, { method: 'POST', body: { action: 'move', destination: to } });
    if (!res.ok) throw new Error(`Egnyte could not move ${from} to ${to} (${res.status}): ${await res.text().catch(() => '')}`);
  },
  async deleteFolder(path) {
    const res = await egnyteRequest(path, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Egnyte could not delete ${path} (${res.status}): ${await res.text().catch(() => '')}`);
  },
};

// One caller at a time per folder to create: in this process by chaining, across instances by a database advisory lock.
const localChains = new Map<string, Promise<unknown>>();
async function folderLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = localChains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const tail = previous.then(() => mine);
  localChains.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      return fn();
    }, { timeout: 60_000, maxWait: 60_000 });
  } finally {
    release();
    if (localChains.get(key) === tail) localChains.delete(key);
  }
}

const resolutionCache = new Map<string, { at: number; resolution: Resolution }>();
const resolutionInFlight = new Map<string, Promise<Resolution>>();
const CACHE_MS = 10 * 60 * 1000;

/**
 * The folder photos for this job go in, created if need be. `draftId` names the staging folder used when the job number cannot
 * be placed yet. Results are remembered briefly so a burst of uploads for one job lists Egnyte once, not once per photo.
 */
export async function resolveInspectionDestination(jobNo: string | null | undefined, draftId?: string, opts: { createJobFolder?: boolean; fresh?: boolean } = {}): Promise<Resolution> {
  const key = `${(jobNo ?? '').trim().toUpperCase()}|${draftId ?? ''}|${opts.createJobFolder === false ? 'nc' : 'c'}`;
  const hit = resolutionCache.get(key);
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.resolution;
  // Photos of one job arrive together: they share one lookup instead of each listing Egnyte.
  const running = resolutionInFlight.get(key);
  if (running) return running;
  const work = (async () => {
    const resolution = await resolveInspectionFolder(egnyteFs, egnyteRoot(), jobNo, { draftId, lock: folderLock, createJobFolder: opts.createJobFolder });
    if (resolution.status !== 'unassigned') resolutionCache.set(key, { at: Date.now(), resolution });
    return resolution;
  })().finally(() => resolutionInFlight.delete(key));
  resolutionInFlight.set(key, work);
  return work;
}

/** Move a folder into another (merging if the target exists) and repoint the photo index. Used by the one-off tidy-up script. */
export async function moveFolderAndRepoint(from: string, to: string): Promise<void> {
  await mergeFolder(egnyteFs, from, to);
  await prisma.$executeRaw`
    UPDATE photos
    SET "storageKey" = ${to} || substring("storageKey" from ${from.length + 1}::int)
    WHERE "storageKey" LIKE ${from + '/%'}
  `;
}

export const egnyteRootFolder = egnyteRoot;

/**
 * Once the job number is final (submit, or an admin correcting it), put the inspection's photos where they belong: move them
 * out of the draft's own folder (older app builds upload there) or the _Unassigned staging folder into the job's folder, and
 * repoint the photo index. Safe to repeat. Returns where the inspection's folder is, or null when Egnyte is not configured.
 */
export async function settleInspectionFolder(inspectionId: string, jobNo: string | null | undefined, previousPath?: string | null): Promise<Resolution | null> {
  if (!isStorageEnabled()) return null;
  const resolution = await resolveInspectionDestination(jobNo, inspectionId, { createJobFolder: false, fresh: true });
  if (resolution.status === 'unassigned') return resolution;

  const root = egnyteRoot();
  const seg = safeSegment(inspectionId);
  const sources = [`${root}/${seg}`, `${root}/_Unassigned/${seg}`, ...(previousPath && previousPath !== resolution.path ? [previousPath] : [])];
  for (const from of sources) {
    await mergeFolder(egnyteFs, from, resolution.path);
    await prisma.$executeRaw`
      UPDATE photos
      SET "storageKey" = ${resolution.path} || substring("storageKey" from ${from.length + 1}::int)
      WHERE "storageKey" LIKE ${from + '/%'}
    `;
  }
  // An inspection that never had photos still gets its folder, so the office finds it.
  await egnyteFs.createFolder(resolution.path);
  return resolution;
}

async function uploadToEgnyte(path: string, buffer: Buffer, contentType: string): Promise<void> {
  const res = await withRetry(() =>
    egnyteFetch(`${egnyteBase()}/pubapi/v1/fs-content${encodeEgnytePath(path)}`, {
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
  tenantId?: string,
  jobFolder?: string,
  opts: { jobNo?: string | null; photoId?: string } = {},
): Promise<UploadedPhoto & { folder?: { status: string; message?: string; path: string } }> {
  if (!isStorageEnabled() && !useDbStorage()) throw new Error('Photo storage is not configured');

  // The phone gives each photo a fixed id, so sending it again (after a dropped connection) returns the stored copy
  // instead of making a second one.
  if (opts.photoId) {
    const existing = await prisma.photo.findUnique({ where: { id: opts.photoId }, select: { id: true, storageKey: true } });
    if (existing) return { id: existing.id, storageKey: existing.storageKey ?? `db:${existing.id}`, url: `/api/v1/media/${existing.id}` };
  }
  const id = opts.photoId ?? randomUUID();

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

  if (useDbStorage()) {
    await prisma.photo.create({ data: { id, data: new Uint8Array(resized), contentType: 'image/jpeg' } });
    return { id, storageKey: `db:${id}`, url: `/api/v1/media/${id}`, storedHash: createHash('sha256').update(resized).digest('hex') };
  }
  // An inspector's photo with a job number goes straight into {batch}/{job}/; one without (an older app build) goes in the draft's own folder
  // and is moved at submit (settleInspectionFolder).
  const place = !tenantId && !jobFolder && inspectionId && opts.jobNo !== undefined ? await resolveInspectionDestination(opts.jobNo, inspectionId) : undefined;
  const destination = place?.path;
  const storageKey = photoPath(id, inspectionId, sectionKey, '.jpg', tenantId, jobFolder, destination);
  await uploadToEgnyte(storageKey, resized, 'image/jpeg');

  // Full-quality original, alongside the compressed copy above. Non-fatal:
  // every in-app view depends on the compressed copy having uploaded (which
  // already happened by this point), not this one.
  try {
    await uploadToEgnyte(photoPath(id, inspectionId, sectionKey, `-original.${ext}`, tenantId, jobFolder, destination), buffer, contentType);
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
  return {
    id, storageKey, url: `/api/v1/media/${id}`, storedHash: createHash('sha256').update(resized).digest('hex'),
    ...(place ? { folder: { status: place.status, path: place.path, ...(place.message ? { message: place.message } : {}) } } : {}),
  };
}

/**
 * Store a non-image file (PDF, report, document) unchanged. Same opaque
 * `/api/v1/media/:id` URL as photos; the index row remembers the content type.
 * `folder` groups files in Egnyte, e.g. "documents/<projectId>".
 */
export async function uploadDocument(buffer: Buffer, contentType: string, ext: string, folder = 'documents', tenantId?: string, jobFolder?: string): Promise<UploadedPhoto> {
  if (!isStorageEnabled() && !useDbStorage()) throw new Error('File storage is not configured');
  const id = randomUUID();
  if (useDbStorage()) {
    await prisma.photo.create({ data: { id, data: new Uint8Array(buffer), contentType } });
    return { id, storageKey: `db:${id}`, url: `/api/v1/media/${id}`, storedHash: createHash('sha256').update(buffer).digest('hex') };
  }
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const storageKey = `${env.EGNYTE_ROOT_FOLDER}${jobFolder ? `/${safeSegment(jobFolder)}` : tenantId ? `/tenants/${safeSegment(tenantId)}` : ''}/${folder.split('/').map(safeSegment).filter(Boolean).join('/')}/${id}.${safeExt}`;
  await uploadToEgnyte(storageKey, buffer, contentType);
  await prisma.photo.create({ data: { id, storageKey, contentType } });
  return { id, storageKey, url: `/api/v1/media/${id}`, storedHash: createHash('sha256').update(buffer).digest('hex') };
}

// ---- serving photos back ---------------------------------------------------------------------------------------------------
// A report page (and so a PDF or Word build) asks for all of its photographs at the same moment, and Egnyte allows only about two
// requests a second -- so a download goes through the same spacing and 429 wait as an upload (`egnyteFetch`), and the photographs are
// kept in memory once fetched: a photograph never changes, so a second request (the PDF after the preview, the Word file after the PDF,
// the same photograph used twice) is answered without asking Egnyte again, and requests for one photograph that arrive together share
// a single call.
const PHOTO_CACHE_MAX_BYTES = 100 * 1024 * 1024;
/** Report photographs are resized to a few hundred KB; anything bigger (a QC document, say) is streamed through and not kept. */
const PHOTO_CACHE_MAX_ITEM_BYTES = 4 * 1024 * 1024;

type FetchedPhoto =
  | { kind: 'bytes'; bytes: Buffer; contentType: string }
  | { kind: 'stream'; body: ReadableStream; contentType: string }
  | { kind: 'none' };

const photoCache = new Map<string, { bytes: Buffer; contentType: string }>(); // oldest first
let photoCacheBytes = 0;
const photoInFlight = new Map<string, Promise<FetchedPhoto>>();

/** Empties the in-memory photo cache (for tests). */
export function clearPhotoCache(): void {
  photoCache.clear();
  photoCacheBytes = 0;
}

function keepPhoto(id: string, bytes: Buffer, contentType: string): void {
  photoCache.set(id, { bytes, contentType });
  photoCacheBytes += bytes.length;
  for (const [oldId, old] of photoCache) {
    if (photoCacheBytes <= PHOTO_CACHE_MAX_BYTES) break;
    photoCache.delete(oldId);
    photoCacheBytes -= old.bytes.length;
  }
}

async function loadPhotoFromEgnyte(id: string): Promise<FetchedPhoto> {
  // Look up the real Egnyte path from the index; fall back to the old flat
  // guess for photos uploaded before this index existed.
  const indexed = await prisma.photo.findUnique({ where: { id } });
  const path = indexed?.storageKey ?? photoPath(id, undefined, undefined, '.jpg');

  const res = await withRetry(() => egnyteFetch(`${egnyteBase()}/pubapi/v1/fs-content${encodeEgnytePath(path)}`, { headers: authHeaders() }));
  if (res.status === 404) return { kind: 'none' };
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`Egnyte fetch failed (${res.status}): ${body}`);
  }
  const contentType = indexed?.contentType ?? res.headers.get('content-type') ?? 'image/jpeg';
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > PHOTO_CACHE_MAX_ITEM_BYTES) return { kind: 'stream', body: res.body, contentType };
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length <= PHOTO_CACHE_MAX_ITEM_BYTES) keepPhoto(id, bytes, contentType);
  return { kind: 'bytes', bytes, contentType };
}

/** Streams the resized report copy for a given photo id straight from Egnyte. Used by the media proxy route. */
export async function fetchPhotoStream(
  id: string,
): Promise<{ body: ReadableStream; contentType: string } | null> {
  if (useDbStorage()) {
    const row = await prisma.photo.findUnique({ where: { id } });
    if (!row?.data) return null;
    const bytes = Buffer.from(row.data);
    return { body: new Response(bytes).body as unknown as ReadableStream, contentType: row.contentType };
  }
  if (!isStorageEnabled()) return null;

  const cached = photoCache.get(id);
  if (cached) {
    photoCache.delete(id); // most recently used goes last
    photoCache.set(id, cached);
    return { body: new Response(cached.bytes).body as unknown as ReadableStream, contentType: cached.contentType };
  }

  let pending = photoInFlight.get(id);
  const owner = !pending;
  if (!pending) {
    pending = loadPhotoFromEgnyte(id).finally(() => photoInFlight.delete(id));
    photoInFlight.set(id, pending);
  }
  let photo = await pending;
  // A streamed (large) file can be read only once, by whoever asked first; anyone else who was waiting fetches their own.
  if (!owner && photo.kind === 'stream') photo = await loadPhotoFromEgnyte(id);
  if (photo.kind === 'none') return null;
  if (photo.kind === 'stream') return { body: photo.body, contentType: photo.contentType };
  return { body: new Response(photo.bytes).body as unknown as ReadableStream, contentType: photo.contentType };
}
