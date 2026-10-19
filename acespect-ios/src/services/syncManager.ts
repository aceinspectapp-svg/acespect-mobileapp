import axios from 'axios';
import * as Network from 'expo-network';
import { File } from 'expo-file-system';
import type { SubmitPayload } from '../context/InspectionDraftContext';
import type { AnswerTree } from '../components/inspection/fieldRenderers/types';
import { getSyncQueue, setSyncQueue, getWifiOnlySync, QueuedSubmission } from './offlineStorage';
import { submitInspection, uploadPhoto, type SubmitResult } from './inspectionApi';
import { getPhotoNumber, mergePhotoNumbers } from './photoNumbers';

/**
 * Foreground-only sync: an inspection finished offline is queued here and
 * flushed the moment the app has a connection again -- on cold start, on the
 * instant `expo-network` reports connectivity regained, or via a manual
 * retry. There's no native background task (would need a dev-client build,
 * same reason WatermelonDB was shelved), so nothing syncs while the app is
 * fully closed -- opening it is what triggers the catch-up.
 *
 * Respects the inspector's "Wi-Fi only" preference (Settings): automatic
 * triggers (cold start, connectivity regained) skip uploading queued
 * inspections while on cellular data if that's turned on. A manual "Retry
 * now" tap always goes ahead regardless -- an explicit action overrides the
 * background preference rather than silently doing nothing.
 */

type Listener = (queue: QueuedSubmission[]) => void;
type ProcessingListener = (processing: boolean) => void;
const listeners = new Set<Listener>();
const processingListeners = new Set<ProcessingListener>();
let queueCache: QueuedSubmission[] = [];
let processing = false;
let initialized = false;

function notify() {
  listeners.forEach((l) => l(queueCache));
}

function setProcessing(next: boolean) {
  processing = next;
  processingListeners.forEach((l) => l(processing));
}

/**
 * Subscribe to "a sync pass is currently running" -- fires immediately with
 * the current state. A queue-processing pass can legitimately take a while
 * (each photo upload gets up to 120s, see inspectionApi.ts, and a queued
 * entry can hold several), and `processQueue` silently no-ops if one is
 * already running (see below) -- without this, tapping "retry now" again
 * while a pass is still in flight looks like the tap did nothing at all.
 */
export function subscribeProcessing(cb: ProcessingListener): () => void {
  processingListeners.add(cb);
  cb(processing);
  return () => processingListeners.delete(cb);
}

/** What the sync pass is doing right now, so the screen can say so instead of just spinning. */
export interface SyncProgress {
  /** The inspection being sent (its job number). */
  label: string;
  /** "Preparing", "Uploading photo 3 of 12", "Saving the inspection on the server". */
  step: string;
  done: number;
  total: number;
}
type ProgressListener = (p: SyncProgress | null) => void;
const progressListeners = new Set<ProgressListener>();
let progress: SyncProgress | null = null;
/** When the pass last made headway (a step began or a photo finished): the stall watch below measures from here. */
let lastTouch = 0;

function setProgress(next: SyncProgress | null) {
  progress = next;
  if (next) lastTouch = Date.now();
  progressListeners.forEach((l) => l(progress));
}

/** Subscribe to what the sync pass is doing; fires immediately. `null` when no pass is running. */
export function subscribeProgress(cb: ProgressListener): () => void {
  progressListeners.add(cb);
  cb(progress);
  return () => progressListeners.delete(cb);
}

export function getProgress(): SyncProgress | null {
  return progress;
}

/** How long a pass may go without any headway (no photo finished, no step began) before it is given up on and reported. A single photo may take up to 120 s (inspectionApi.ts), so this is longer. */
const STALL_MS = 150_000;

/**
 * Rejects when the running pass has made no headway for STALL_MS. Without it, one step that never finishes (an upload that never answers)
 * kept the "running" flag set for ever: the banner spun, nothing was sent, and every retry was ignored because a pass was "already running".
 */
function stallWatch(): { stalled: Promise<never>; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      if (Date.now() - lastTouch > STALL_MS) reject(new Error(`Stopped: no progress for ${Math.round(STALL_MS / 1000)} seconds`));
    }, 5000);
  });
  stalled.catch(() => undefined);
  return { stalled, stop: () => timer && clearInterval(timer) };
}

/** Local (not yet uploaded) photo files an entry still holds. */
export function countLocalPhotos(payload: SubmitPayload): number {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.startsWith('file:')) found.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  for (const section of payload.sections) {
    walk(section.answers);
    walk(section.photos);
    walk(section.damages);
  }
  return found.size;
}

/** Why a failed attempt failed, in words the inspector can read: what the server said (with its status), and where in the pass it stopped. */
function describeFailure(err: unknown): string {
  let text = err instanceof Error ? err.message : 'Unknown error';
  if (axios.isAxiosError(err) && err.response) {
    const server = (err.response.data as { error?: { message?: string } } | undefined)?.error?.message;
    text = `Server answered ${err.response.status}${server ? `: ${server}` : ''}`;
  }
  return progress?.step ? `${text} (at: ${progress.step})` : text;
}

async function persist() {
  await setSyncQueue(queueCache);
  notify();
}

/** Subscribe to queue changes; fires immediately with the current snapshot. Returns an unsubscribe fn. */
export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  cb(queueCache);
  return () => listeners.delete(cb);
}

export function getQueueSnapshot(): QueuedSubmission[] {
  return queueCache;
}

function isLocalUri(u: string): boolean {
  return u.startsWith('file:');
}

/**
 * Once a local photo is safely uploaded, its on-device copy is never read
 * again -- captured photos otherwise accumulate in the app's document
 * directory forever (nothing else in this app ever deleted them), which on
 * a phone used for inspection after inspection adds up fast at full camera
 * resolution. Best-effort: a failed delete just leaves the file behind
 * rather than failing the submission over a freed-up-space nicety.
 */
async function deleteLocalFile(uri: string): Promise<void> {
  try {
    new File(uri).delete();
  } catch {
    // Ignore -- already gone, or the platform declined to remove it.
  }
}

/**
 * Every photo that has reached the server on this phone, by its local file. The background saver (liveSync.ts) uploads photos as each
 * section is saved; the final submit then finds them here instead of sending them again. The local files are kept until the whole
 * inspection has been accepted (cleanupUploadedFiles), because the inspector may still reopen a section and look at them.
 */
const photoCache = new Map<string, string>();

async function uploadAndForget(uri: string, opts: { inspectionId?: string; sectionKey?: string; jobNo?: string }): Promise<string> {
  const hit = photoCache.get(uri);
  if (hit) return hit;
  // A queued photo whose file is gone from this phone can never be sent: say so, instead of attempting an upload that cannot work.
  try {
    if (!new File(uri).exists) throw new Error(`A photo file is missing from this phone (${opts.sectionKey ?? 'unknown section'})`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('A photo file is missing')) throw e;
  }
  if (progress) setProgress({ ...progress, step: `Uploading photo ${progress.done + 1} of ${progress.total}` });
  const url = await uploadPhoto(uri, { ...opts, photoNumber: getPhotoNumber(uri) });
  photoCache.set(uri, url);
  if (progress) setProgress({ ...progress, done: progress.done + 1 });
  return url;
}

/** Every local photo file a value refers to, at any depth. */
function collectLocalUris(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (isLocalUri(value)) out.add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectLocalUris(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectLocalUris(v, out);
  }
}

/**
 * Removes the local copies of the given photos once the inspection that holds them has been accepted. Only that inspection's own photos:
 * the cache holds photos of every inspection on this phone, including one still being filled in, and deleting those loses them.
 */
export function cleanupUploadedFiles(uris: Iterable<string>): void {
  for (const uri of uris) {
    void deleteLocalFile(uri);
    photoCache.delete(uri);
  }
}

/**
 * A copy of one section with every local photo replaced by its uploaded URL (uploading what has not been sent yet). The section itself is
 * left untouched, so the screens keep showing the local files. Used by the background saver.
 */
export async function resolveSectionForServer<T extends { key: string; answers?: unknown; photos?: string[]; damages?: { photos?: string[] }[] }>(
  section: T,
  inspectionId: string | undefined,
  jobNo?: string,
): Promise<T> {
  const copy = JSON.parse(JSON.stringify(section)) as T;
  await walkAndResolvePhotos(copy.answers as AnswerTree | undefined, [copy.key], inspectionId, photoCache, jobNo);
  for (const key of ['photos'] as const) {
    const list = copy[key] as string[] | undefined;
    if (list) for (let i = 0; i < list.length; i++) if (isLocalUri(list[i]!)) list[i] = await uploadAndForget(list[i]!, { inspectionId, sectionKey: copy.key, jobNo });
  }
  for (const d of copy.damages ?? []) {
    const list = d.photos;
    if (list) for (let i = 0; i < list.length; i++) if (isLocalUri(list[i]!)) list[i] = await uploadAndForget(list[i]!, { inspectionId, sectionKey: copy.key, jobNo });
  }
  return copy;
}

/**
 * "ceilings_photos" -> "ceilings", "front_elevation" -> "front_elevation" (no
 * suffix to strip). A bare "photos" key -> null: since a folder never holds
 * anything but photos anyway, a leaf photos field shouldn't get its own
 * "photos" subfolder -- its files belong directly in the parent folder
 * (the room, the damage record, ...), not one level deeper.
 */
function folderSegment(key: string): string | null {
  const stripped = key.replace(/_?[Pp]hotos$/, '');
  return stripped || null;
}

/**
 * Recursively walks a section's raw answer tree, uploading any local
 * (`file:`) photo URI it finds and replacing it in place with the resolved
 * remote URL -- so the exact per-field value the dashboard reads (via
 * `section.answers`) ends up pointing at a real, fetchable URL instead of a
 * device-local path nothing else can ever open. Each level of nesting
 * (section -> field -> repeating instance -> ...) becomes its own Egnyte
 * subfolder, so e.g. an Internal Areas "Ceilings" photo lands under
 * `internal_areas/ceilings/`, not lumped into one flat `internal_areas/`
 * folder with every other sub-area's photos.
 */
async function walkAndResolvePhotos(
  tree: AnswerTree | undefined,
  folderPath: string[],
  inspectionId: string | undefined,
  urlByUri: Map<string, string>,
  jobNo?: string,
): Promise<void> {
  if (!tree) return;
  for (const [key, value] of Object.entries(tree)) {
    if (value == null) continue;
    const segment = folderSegment(key);
    const childPath = segment ? [...folderPath, segment] : folderPath;

    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      const arr = value as string[];
      for (let i = 0; i < arr.length; i++) {
        const uri = arr[i]!;
        if (!isLocalUri(uri)) continue;
        if (!urlByUri.has(uri)) {
          urlByUri.set(uri, await uploadAndForget(uri, { inspectionId, sectionKey: childPath.join(':'), jobNo }));
        }
        arr[i] = urlByUri.get(uri)!;
      }
    } else if (Array.isArray(value)) {
      // Repeating-group / damage-list instances (strip/checklist presentation).
      for (const inst of value as AnswerTree[]) {
        await walkAndResolvePhotos(inst, childPath, inspectionId, urlByUri, jobNo);
      }
    } else if (typeof value === 'object') {
      // A single nested compound value, or fixed-tabs' Record<instanceKey, AnswerTree> --
      // either way its own entries recurse the same way, gaining one more folder level.
      await walkAndResolvePhotos(value as AnswerTree, childPath, inspectionId, urlByUri, jobNo);
    }
  }
}

/**
 * Upload every not-yet-uploaded (`file://`) photo in this payload, then
 * submit it. Shared by both the "submit right now" path and queued/deferred
 * sync, so a payload built with local URIs still in place (via
 * `draft.buildPayload((u) => u)`) can be handed to either one.
 *
 * Mutates `payload` in place as each photo uploads, replacing its local URI
 * with the resolved remote URL -- rather than building a separate resolved
 * copy and leaving the caller's object untouched. This matters for retries:
 * if every upload succeeds but the final `submitInspection` call then fails
 * (connection drops right after), the caller still holds a reference to
 * this same payload, now already fully resolved. A subsequent enqueue+retry
 * finds no local URIs left and goes straight to re-submitting, instead of
 * re-uploading -- and creating a second Egnyte copy of -- every photo that
 * already made it up.
 */
/** True when the server's receipt matches what this phone sent. */
export function receiptMatches(payload: SubmitPayload, result: { receipt?: { sections: number; photos: number } }): boolean {
  return !!result.receipt && !!payload.expected && result.receipt.sections === payload.expected.sections && result.receipt.photos === payload.expected.photos;
}

/** What the payload claims to contain: sections other than Job Information, and the distinct uploaded photos they reference. */
function expectedContent(payload: SubmitPayload): { sections: number; photos: number } {
  const ids = new Set<string>();
  for (const m of JSON.stringify(payload.sections.map((s) => [s.answers, s.photos, s.damages])).matchAll(/\/api\/v1\/media\/([0-9a-f-]{36})/gi)) ids.add(m[1]!.toLowerCase());
  return { sections: payload.sections.filter((s) => s.key !== 'job-info').length, photos: ids.size };
}

export async function runSubmission(payload: SubmitPayload): Promise<SubmitResult> {
  const inspectionId = payload.id;
  const jobNo = payload.jobNo;
  const urlByUri = photoCache;
  mergePhotoNumbers(payload.photoNumbers); // a queued submission keeps the numbers its photos were given
  const ownPhotos = new Set<string>();
  collectLocalUris(payload.sections, ownPhotos); // before they are replaced by their uploaded URLs: these are the files to clean up afterwards

  // Primary pass: walk each section's actual answer tree, so every
  // photos-type field (wherever it's nested) gets uploaded under a folder
  // that matches its own sub-area, and the field's own stored value is what
  // ends up holding the real URL -- not just a separate flat summary list.
  for (const section of payload.sections) {
    await walkAndResolvePhotos(section.answers as AnswerTree | undefined, [section.key], inspectionId, urlByUri, jobNo);
  }

  // Fallback safety net: `section.photos` / `damages[].photos` are a flat
  // aggregate of the same URIs (used by the dashboard's summary thumbnail
  // grid) that should already be covered by the walk above. Anything still
  // local here (e.g. captured through a path the answers walk didn't reach)
  // still gets uploaded rather than silently left broken, just without a
  // sub-area-specific folder.
  for (const section of payload.sections) {
    for (const uri of section.photos ?? []) {
      if (isLocalUri(uri) && !urlByUri.has(uri)) {
        urlByUri.set(uri, await uploadAndForget(uri, { inspectionId, sectionKey: section.key, jobNo }));
      }
    }
    for (const d of section.damages ?? []) {
      for (const uri of d.photos ?? []) {
        if (isLocalUri(uri) && !urlByUri.has(uri)) {
          urlByUri.set(uri, await uploadAndForget(uri, { inspectionId, sectionKey: section.key, jobNo }));
        }
      }
    }
  }

  const resolve = (u: string) => urlByUri.get(u) ?? u;
  for (const section of payload.sections) {
    section.photos = (section.photos ?? []).map(resolve);
    section.damages = (section.damages ?? []).map((d) => ({ ...d, photos: (d.photos ?? []).map(resolve) }));
  }

  payload.expected = expectedContent(payload);
  if (progress) setProgress({ ...progress, step: 'Saving the inspection on the server' });
  const result = await submitInspection(payload);
  // The server has it: the local copies of the photos are no longer needed.
  cleanupUploadedFiles(ownPhotos);
  return result;
}

/** True when the Wi-Fi-only preference is on and the device isn't currently on Wi-Fi -- automatic sync should hold off. */
export async function isWaitingForWifi(): Promise<boolean> {
  const wifiOnly = await getWifiOnlySync();
  if (!wifiOnly) return false;
  const state = await Network.getNetworkStateAsync();
  return state.type !== Network.NetworkStateType.WIFI;
}

/** Save a finished inspection for later sync (offline, or a live attempt just failed). Tries immediately in case connectivity (and the Wi-Fi-only preference, if set) allows it. */
export async function enqueueSubmission(payload: SubmitPayload): Promise<void> {
  const entry: QueuedSubmission = {
    id: payload.id ?? payload.draftId,
    payload,
    attempts: 0,
    queuedAt: new Date().toISOString(),
  };
  queueCache = [...queueCache, entry];
  await persist();
  void processQueue();
}

/**
 * Flush the queue in order. `force` (the manual "Retry now" button) bypasses
 * the Wi-Fi-only preference -- every other caller here is an automatic
 * trigger that should respect it.
 *
 * Every entry gets its own independent attempt every pass, success or
 * failure of one never blocking another -- this used to `break` the whole
 * loop on the first "no response reached us" failure (reasoning: assume a
 * dead connection, don't hammer the rest). In practice that meant one entry
 * with a permanent, non-connectivity problem (its local photo file no
 * longer on disk, say) silently blocked every entry queued behind it
 * forever -- discovered when a 254-attempt "Network Error" entry turned out
 * to be starving two genuinely-pending inspections that had never been
 * attempted even once. A real full outage still just means every entry
 * fails once this pass, which costs nothing worth guarding against.
 */
export async function processQueue(opts?: { force?: boolean }): Promise<void> {
  if (processing) return;
  if (!opts?.force && (await isWaitingForWifi())) return;
  setProcessing(true);
  try {
    // A snapshot of ids to attempt this pass -- entries added mid-run (a new
    // submission queued while this is already flushing) get picked up on
    // the next trigger rather than extending this loop indefinitely.
    const ids = queueCache.map((e) => e.id);
    for (const id of ids) {
      const entry = queueCache.find((e) => e.id === id);
      if (!entry) continue; // already synced and removed earlier in this same pass
      setProgress({ label: entry.payload.jobNo || entry.payload.address || 'inspection', step: 'Preparing', done: 0, total: countLocalPhotos(entry.payload) });
      const watch = stallWatch();
      try {
        const work = runSubmission(entry.payload);
        work.catch(() => undefined); // if the stall watch wins, a late failure of this must not surface as an unhandled rejection
        await Promise.race([work, watch.stalled]);
        queueCache = queueCache.filter((e) => e.id !== id);
        await persist();
      } catch (err) {
        // The server already holds a real inspection for this job and refused this blank leftover: nothing to send, so stop retrying it.
        if ((err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code === 'BLANK_DUPLICATE') {
          queueCache = queueCache.filter((e) => e.id !== id);
          await persist();
          continue;
        }
        const message = describeFailure(err);
        queueCache = queueCache.map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1, lastError: message } : e));
        await persist();
      } finally {
        watch.stop();
      }
    }
  } finally {
    setProgress(null);
    setProcessing(false);
  }
}

/** An inspector-triggered "give up on this one" -- see the long-press queue-details alert on SelectInspectionTypeScreen. Never called automatically; a payload with a genuinely bad local file needs a human to decide it's not coming back. */
export async function removeFromQueue(id: string): Promise<void> {
  queueCache = queueCache.filter((e) => e.id !== id);
  await persist();
}

/**
 * Manual "retry sync" action -- always attempts, regardless of the Wi-Fi-only
 * preference. Returns `false` (synchronously, before anything actually
 * runs) when a pass was already in flight, so the caller can tell the
 * inspector "still working on it" instead of leaving a repeated tap looking
 * like it did nothing.
 */
export function retryNow(): boolean {
  if (processing) return false;
  void processQueue({ force: true });
  return true;
}

/** What a manual retry achieved, so the inspector sees a result instead of a button that seems to do nothing. */
export interface RetryReport {
  started: boolean;
  sent: number;
  failed: { label: string; message: string }[];
}

/** Like retryNow, but resolves once the pass is over and says how many inspections went through and why the others did not. */
export async function retryNowAndReport(): Promise<RetryReport> {
  if (processing) return { started: false, sent: 0, failed: [] };
  const before = queueCache.map((e) => e.id);
  await processQueue({ force: true });
  const left = queueCache.filter((e) => before.includes(e.id));
  return {
    started: true,
    sent: before.length - left.length,
    failed: left.map((e) => ({ label: e.payload.jobNo || e.payload.address || 'Inspection', message: e.lastError ?? 'No answer from the server' })),
  };
}

/** Call once, near app startup. Hydrates the queue from disk, tries a flush, and starts watching for connectivity regained. */
export async function initSyncManager(): Promise<void> {
  if (initialized) return;
  initialized = true;

  queueCache = await getSyncQueue();
  notify();
  void processQueue();

  let wasOffline = false;
  Network.addNetworkStateListener((event) => {
    const online = event.isInternetReachable ?? event.isConnected ?? false;
    if (online && wasOffline) void processQueue();
    wasOffline = !online;
  });
}
