import * as Network from 'expo-network';
import { File } from 'expo-file-system';
import type { SubmitPayload } from '../context/InspectionDraftContext';
import type { AnswerTree } from '../components/inspection/fieldRenderers/types';
import { getSyncQueue, setSyncQueue, getWifiOnlySync, QueuedSubmission } from './offlineStorage';
import { submitInspection, uploadPhoto, type SubmitResult } from './inspectionApi';
import { getPhotoNumber, mergePhotoNumbers } from './photoNumbers';
import { reportProblem } from './problemReport';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
 * Every photo that has reached the server on this phone, by its local file. The photo backup below (and the section saver in liveSync.ts)
 * send photos as soon as they exist; the final submit then finds them here instead of sending them again. The local files are kept until
 * the whole inspection has been accepted (cleanupUploadedFiles), because the inspector may still reopen a section and look at them.
 */
const photoCache = new Map<string, string>();
/** Where each uploaded photo was filed (kept with the cache), so one the server turns out not to hold can be sent again to the same place. */
interface PhotoMeta { inspectionId?: string; sectionKey: string; jobNo?: string }
const photoMeta = new Map<string, PhotoMeta>();

// ...and across restarts of the app: if the phone is closed or the system stops the app half way through 100+ photos, the photos already on the
// server are not sent again.
const PHOTO_CACHE_KEY = 'uploaded-photos:v1';
let cacheTimer: ReturnType<typeof setTimeout> | null = null;
function saveCacheSoon(): void {
  if (cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    const rows = [...photoCache].slice(-3000).map(([uri, url]) => {
      const m = photoMeta.get(uri);
      return m ? [uri, url, m.sectionKey, m.jobNo ?? '', m.inspectionId ?? ''] : [uri, url];
    });
    void AsyncStorage.setItem(PHOTO_CACHE_KEY, JSON.stringify(rows)).catch(() => undefined);
  }, 1500);
}
async function loadPhotoCache(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PHOTO_CACHE_KEY);
    for (const row of raw ? (JSON.parse(raw) as string[][]) : []) {
      const [uri, url, sectionKey, jobNo, inspectionId] = row;
      if (!uri || !url) continue;
      if (!photoCache.has(uri)) photoCache.set(uri, url);
      if (sectionKey && !photoMeta.has(uri)) photoMeta.set(uri, { sectionKey, ...(jobNo ? { jobNo } : {}), ...(inspectionId ? { inspectionId } : {}) });
    }
  } catch {
    /* nothing remembered */
  }
}

/** Photos being sent right now: the background saver and the final submit can reach the same photo together, and it must only be sent once. */
const photoInFlight = new Map<string, Promise<string>>();

/** The photo's file is no longer on this phone (cleared storage, deleted from the gallery): it can never be sent. */
export class PhotoFileMissing extends Error {
  constructor(public readonly uri: string, reason = 'The photo file is no longer on this phone') {
    super(reason);
    this.name = 'PhotoFileMissing';
  }
}
function localFileMissing(uri: string): boolean {
  try {
    return !new File(uri).exists;
  } catch {
    return false; // cannot tell (web, or a platform without the file API): try the upload and let it speak
  }
}

async function uploadAndForget(uri: string, opts: { inspectionId?: string; sectionKey?: string; jobNo?: string }): Promise<string> {
  const hit = photoCache.get(uri);
  if (hit) return hit;
  const running = photoInFlight.get(uri);
  if (running) return running;
  if (isLocalUri(uri) && localFileMissing(uri)) throw new PhotoFileMissing(uri);
  const work = uploadPhoto(uri, { ...opts, photoNumber: getPhotoNumber(uri) })
    .then((url) => {
      photoCache.set(uri, url);
      if (opts.sectionKey) photoMeta.set(uri, { sectionKey: opts.sectionKey, ...(opts.jobNo ? { jobNo: opts.jobNo } : {}), ...(opts.inspectionId ? { inspectionId: opts.inspectionId } : {}) });
      saveCacheSoon();
      return url;
    })
    .catch((err) => {
      // The server looked at the file and said it can never be used (an unreadable or unsupported image): sending it again cannot help, and it
      // must not hold up the rest of the inspection. Treated like a file that has gone: left out, counted, and reported.
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
      if (code === 'PHOTO_UNREADABLE') throw new PhotoFileMissing(uri, 'The server could not read this photo');
      // Say which photo it was, so a failure that reaches the Troubleshoot page names it.
      if (err && typeof err === 'object') (err as { photoNumber?: number }).photoNumber = getPhotoNumber(uri);
      throw err;
    })
    .finally(() => photoInFlight.delete(uri));
  photoInFlight.set(uri, work);
  return work;
}

/** Removes the local copies of photos that are safely on the server, once the inspection that holds them has been accepted. */
export function cleanupUploadedFiles(): void {
  for (const uri of photoCache.keys()) void deleteLocalFile(uri);
  photoCache.clear();
  photoMeta.clear();
  void AsyncStorage.removeItem(PHOTO_CACHE_KEY).catch(() => undefined);
}

// ───────────────────────── Photo backup: every photo is sent as soon as it is in the inspection ─────────────────────────

/**
 * The inspector's photos used to be sent only when a section was saved or at Submit, which for an inspection with hundreds of photos meant
 * one very long upload at the very end. Now each photo starts going to the server as soon as it appears in the form (two at a time, in the
 * background), so by the time Submit is pressed nearly everything is already there. What is left to send is simply "the photos in the draft
 * that are not in the uploaded list", so nothing extra needs saving: after a restart, reopening the draft carries on where it stopped.
 */
export interface PhotoBackupStatus {
  total: number;
  uploaded: number;
  state: 'idle' | 'uploading' | 'waiting';
  /** Why it is waiting. */
  reason?: 'connection' | 'wifi' | 'job';
  /** Photos that can never be sent (their file is gone from this phone). */
  lost: number;
  lastError?: string;
}

const PUMP_WORKERS = 2;
const bySection = new Map<string, Map<string, PhotoMeta>>(); // top-level section key -> its local photos
const lostInBackup = new Set<string>();
let backupJobNo: string | undefined;
let pumpWorkers = 0;
let pausedUntil = 0;
let pumpFailures = 0;
let pumpTimer: ReturnType<typeof setTimeout> | null = null;
let waitReason: PhotoBackupStatus['reason'] | undefined;
let lastBackupError: string | undefined;
let backupStatus: PhotoBackupStatus = { total: 0, uploaded: 0, state: 'idle', lost: 0 };
const backupListeners = new Set<(s: PhotoBackupStatus) => void>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;

export const getPhotoBackupStatus = (): PhotoBackupStatus => backupStatus;
export function subscribePhotoBackup(l: (s: PhotoBackupStatus) => void): () => void {
  backupListeners.add(l);
  return () => { backupListeners.delete(l); };
}

function computeBackupStatus(): PhotoBackupStatus {
  let total = 0;
  let uploaded = 0;
  for (const m of bySection.values()) for (const uri of m.keys()) { if (lostInBackup.has(uri)) continue; total++; if (photoCache.has(uri)) uploaded++; }
  const busy = pumpWorkers > 0 || photoInFlight.size > 0;
  const state: PhotoBackupStatus['state'] = uploaded >= total ? 'idle' : waitReason ? 'waiting' : busy ? 'uploading' : 'waiting';
  return { total, uploaded, state, ...(state === 'waiting' && waitReason ? { reason: waitReason } : {}), lost: lostInBackup.size, ...(lastBackupError && state !== 'idle' ? { lastError: lastBackupError } : {}) };
}
function emitBackup(): void {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    backupStatus = computeBackupStatus();
    setKeepAwake(backupStatus.state !== 'idle');
    backupListeners.forEach((l) => l(backupStatus));
  }, 250);
}

// Keeps the screen on while photos are still going up: a phone that falls asleep stops the upload. Optional: if this build has no such
// module the backup simply carries on without it.
let awake = false;
function setKeepAwake(on: boolean): void {
  if (on === awake) return;
  awake = on;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const k = require('expo-keep-awake') as { activateKeepAwakeAsync: (tag?: string) => Promise<void>; deactivateKeepAwake: (tag?: string) => Promise<void> };
    void (on ? k.activateKeepAwakeAsync('photo-backup') : k.deactivateKeepAwake('photo-backup')).catch(() => undefined);
  } catch {
    /* not available in this build */
  }
}

/** Collects the local photos in a section's answers with the folder each belongs in (same rule as walkAndResolvePhotos). */
function collectLocalPhotos(tree: AnswerTree | undefined, folderPath: string[], out: Map<string, string>): void {
  if (!tree) return;
  for (const [key, value] of Object.entries(tree)) {
    if (value == null) continue;
    const segment = folderSegment(key);
    const childPath = segment ? [...folderPath, segment] : folderPath;
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      for (const uri of value as string[]) if (isLocalUri(uri) && !out.has(uri)) out.set(uri, childPath.join(':'));
    } else if (Array.isArray(value)) {
      for (const inst of value as AnswerTree[]) collectLocalPhotos(inst, childPath, out);
    } else if (typeof value === 'object') {
      collectLocalPhotos(value as AnswerTree, childPath, out);
    }
  }
}

/** A section's answers changed: remember which local photos it holds and start sending the ones not sent yet. */
export function noteSectionAnswers(sectionKey: string, answers: AnswerTree | undefined, inspectionId: string | undefined, jobNo: string | undefined): void {
  if (jobNo) backupJobNo = jobNo;
  const found = new Map<string, string>();
  collectLocalPhotos(answers, [sectionKey], found);
  const mine = new Map<string, PhotoMeta>();
  for (const [uri, path] of found) mine.set(uri, { sectionKey: path, ...(inspectionId ? { inspectionId } : {}) });
  if (mine.size === 0) bySection.delete(sectionKey);
  else bySection.set(sectionKey, mine); // a photo the inspector removed from the form is simply no longer wanted
  startBackup();
  emitBackup();
}

/** A new inspection (or the end of this one): forget the list. Photos already on their way carry on, and stay remembered as uploaded. */
export function resetPhotoBackup(): void {
  bySection.clear();
  lostInBackup.clear();
  backupJobNo = undefined;
  pausedUntil = 0;
  pumpFailures = 0;
  waitReason = undefined;
  lastBackupError = undefined;
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = null;
  emitBackup();
}

function nextToSend(): [string, PhotoMeta] | undefined {
  for (const m of bySection.values()) {
    for (const [uri, meta] of m) if (!photoCache.has(uri) && !photoInFlight.has(uri) && !lostInBackup.has(uri)) return [uri, meta];
  }
  return undefined;
}

function pauseBackup(ms: number): void {
  pausedUntil = Date.now() + ms;
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = setTimeout(() => { pumpTimer = null; pausedUntil = 0; waitReason = undefined; startBackup(); }, ms);
}

function startBackup(): void {
  if (Date.now() < pausedUntil) return;
  // Photos wait for a job number, so each goes straight into its job's own folder in Egnyte.
  if (!backupJobNo) { waitReason = 'job'; return; }
  if (waitReason === 'job') waitReason = undefined;
  // A bounded loop: a worker that finds nothing to do ends at once, and must not be started again and again.
  for (let i = pumpWorkers; i < PUMP_WORKERS && nextToSend(); i++) void backupWorker();
}

async function backupWorker(): Promise<void> {
  pumpWorkers++;
  try {
    while (Date.now() >= pausedUntil) {
      if (!backupJobNo) { waitReason = 'job'; break; }
      if (await isWaitingForWifi()) { waitReason = 'wifi'; pauseBackup(30_000); break; }
      const next = nextToSend();
      if (!next) break;
      const [uri, meta] = next;
      waitReason = undefined;
      try {
        await uploadAndForget(uri, { ...meta, jobNo: backupJobNo });
        pumpFailures = 0;
        lastBackupError = undefined;
      } catch (err) {
        if (err instanceof PhotoFileMissing) {
          lostInBackup.add(uri);
          reportProblem('photo file missing', err, { jobNo: backupJobNo });
        } else {
          const e = err as { response?: { status?: number; data?: { error?: { message?: string } } }; message?: string };
          const st = e.response?.status;
          pumpFailures += 1;
          lastBackupError = e.response?.data?.error?.message ?? e.message ?? 'not reachable';
          waitReason = 'connection';
          reportProblem('photo backup', err, { jobNo: backupJobNo, failures: pumpFailures, ...(st ? { status: st } : {}) });
          // Wait a little (10 s, 30 s, 1 min, then every 2 minutes) and carry on; the photo stays in the list.
          pauseBackup([10_000, 30_000, 60_000][pumpFailures - 1] ?? 120_000);
          break;
        }
      }
      emitBackup();
    }
  } finally {
    pumpWorkers--;
    emitBackup();
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
  const lost = new Set<string>();
  await walkAndResolvePhotos(copy.answers as AnswerTree | undefined, [copy.key], inspectionId, photoCache, jobNo, lost);
  const resolveList = async (list: string[] | undefined): Promise<void> => {
    if (!list) return;
    const keep: string[] = [];
    for (const u of list) {
      if (!isLocalUri(u)) { keep.push(u); continue; }
      try { keep.push(await uploadAndForget(u, { inspectionId, sectionKey: copy.key, jobNo })); } catch (err) { if (err instanceof PhotoFileMissing) lost.add(u); else throw err; }
    }
    list.splice(0, list.length, ...keep);
  };
  await resolveList(copy.photos);
  for (const d of copy.damages ?? []) await resolveList(d.photos);
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
  lost?: Set<string>,
): Promise<void> {
  if (!tree) return;
  for (const [key, value] of Object.entries(tree)) {
    if (value == null) continue;
    const segment = folderSegment(key);
    const childPath = segment ? [...folderPath, segment] : folderPath;

    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      const arr = value as string[];
      const keep: string[] = [];
      for (const uri of arr) {
        if (!isLocalUri(uri)) { keep.push(uri); continue; }
        try {
          if (!urlByUri.has(uri)) {
            urlByUri.set(uri, await uploadAndForget(uri, { inspectionId, sectionKey: childPath.join(':'), jobNo }));
          }
          keep.push(urlByUri.get(uri)!);
        } catch (err) {
          // A photo whose file is gone from the phone can never be sent: leave it out (and count it) rather than block everything else.
          if (err instanceof PhotoFileMissing && lost) lost.add(uri);
          else throw err;
        }
      }
      arr.splice(0, arr.length, ...keep);
    } else if (Array.isArray(value)) {
      // Repeating-group / damage-list instances (strip/checklist presentation).
      for (const inst of value as AnswerTree[]) {
        await walkAndResolvePhotos(inst, childPath, inspectionId, urlByUri, jobNo, lost);
      }
    } else if (typeof value === 'object') {
      // A single nested compound value, or fixed-tabs' Record<instanceKey, AnswerTree> --
      // either way its own entries recurse the same way, gaining one more folder level.
      await walkAndResolvePhotos(value as AnswerTree, childPath, inspectionId, urlByUri, jobNo, lost);
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

/** Maps every string in a value, dropping the ones `f` turns into null from arrays (and blanking them elsewhere). */
function deepMapStrings(v: unknown, f: (s: string) => string | null): unknown {
  if (typeof v === 'string') return f(v) ?? '';
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === 'string' ? (f(x) === null ? [] : [f(x)!]) : [deepMapStrings(x, f)]));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, deepMapStrings(x, f)]));
  return v;
}

/**
 * The server named photos it does not hold (PHOTOS_MISSING): send each of them again to where it was filed, and swap the new address in. A
 * photo whose file is gone from the phone is dropped (and counted). Returns false when nothing could be put right.
 */
async function resendMissing(payload: SubmitPayload, ids: string[], lost: Set<string>): Promise<boolean> {
  const swaps = new Map<string, string | null>(); // old url -> new url (null: dropped)
  for (const id of ids) {
    const entry = [...photoCache].find(([, url]) => url.toLowerCase().includes(id.toLowerCase()));
    if (!entry) return false; // not a photo this phone sent: nothing to resend
    const [uri, oldUrl] = entry;
    const meta = photoMeta.get(uri);
    if (!meta) return false;
    photoCache.delete(uri);
    try {
      swaps.set(oldUrl, await uploadAndForget(uri, { ...meta, jobNo: meta.jobNo ?? payload.jobNo }));
    } catch (err) {
      if (err instanceof PhotoFileMissing) { lost.add(uri); swaps.set(oldUrl, null); } else throw err;
    }
  }
  const mapped = deepMapStrings(payload.sections, (u) => (swaps.has(u) ? swaps.get(u)! : u)) as SubmitPayload['sections'];
  payload.sections = mapped;
  return true;
}

export async function runSubmission(payload: SubmitPayload): Promise<SubmitResult> {
  const inspectionId = payload.id;
  const jobNo = payload.jobNo;
  const urlByUri = photoCache;
  const lost = new Set<string>();
  mergePhotoNumbers(payload.photoNumbers); // a queued submission keeps the numbers its photos were given

  // Primary pass: walk each section's actual answer tree, so every
  // photos-type field (wherever it's nested) gets uploaded under a folder
  // that matches its own sub-area, and the field's own stored value is what
  // ends up holding the real URL -- not just a separate flat summary list.
  for (const section of payload.sections) {
    await walkAndResolvePhotos(section.answers as AnswerTree | undefined, [section.key], inspectionId, urlByUri, jobNo, lost);
  }

  // Fallback safety net: `section.photos` / `damages[].photos` are a flat
  // aggregate of the same URIs (used by the dashboard's summary thumbnail
  // grid) that should already be covered by the walk above. Anything still
  // local here (e.g. captured through a path the answers walk didn't reach)
  // still gets uploaded rather than silently left broken, just without a
  // sub-area-specific folder.
  const uploadLeftover = async (uri: string, sectionKey: string): Promise<void> => {
    if (!isLocalUri(uri) || urlByUri.has(uri) || lost.has(uri)) return;
    try {
      urlByUri.set(uri, await uploadAndForget(uri, { inspectionId, sectionKey, jobNo }));
    } catch (err) {
      if (err instanceof PhotoFileMissing) lost.add(uri); else throw err;
    }
  };
  for (const section of payload.sections) {
    for (const uri of section.photos ?? []) await uploadLeftover(uri, section.key);
    for (const d of section.damages ?? []) for (const uri of d.photos ?? []) await uploadLeftover(uri, section.key);
  }

  const resolve = (u: string) => urlByUri.get(u) ?? u;
  for (const section of payload.sections) {
    section.photos = (section.photos ?? []).filter((u) => !lost.has(u)).map(resolve);
    section.damages = (section.damages ?? []).map((d) => ({ ...d, photos: (d.photos ?? []).filter((u) => !lost.has(u)).map(resolve) }));
  }

  // Ask the server to check, before it stores anything, that it really holds every photo this inspection points at. If it does not (it
  // names them), send just those again and submit once more -- so an inspection is never stored with photos missing.
  payload.verifyPhotos = true;
  let result: SubmitResult | undefined;
  for (let round = 0; !result; round++) {
    payload.expected = expectedContent(payload);
    try {
      result = await submitInspection(payload);
    } catch (err) {
      const body = (err as { response?: { data?: { error?: { code?: string; details?: { missing?: string[] } } } } }).response?.data?.error;
      if (body?.code !== 'PHOTOS_MISSING' || round >= 2 || !(await resendMissing(payload, body.details?.missing ?? [], lost))) throw err;
    }
  }
  // The server has it: the local copies of the photos are no longer needed.
  cleanupUploadedFiles();
  return { ...result, ...(lost.size > 0 ? { skippedPhotos: lost.size } : {}) };
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
      try {
        await runSubmission(entry.payload);
        queueCache = queueCache.filter((e) => e.id !== id);
        await persist();
      } catch (err) {
        // The server already holds a real inspection for this job and refused this blank leftover: nothing to send, so stop retrying it.
        if ((err as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code === 'BLANK_DUPLICATE') {
          queueCache = queueCache.filter((e) => e.id !== id);
          await persist();
          continue;
        }
        const message = err instanceof Error ? err.message : 'Unknown error';
        reportProblem('queued submission', err, { jobNo: entry.payload.jobNo, attempts: entry.attempts + 1, sections: entry.payload.sections.length });
        queueCache = queueCache.map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1, lastError: message } : e));
        await persist();
      }
    }
  } finally {
    setProcessing(false);
    scheduleQueueRetry();
  }
}

/**
 * A queued inspection used to be retried only when the app was opened, the connection came back, or "Retry now" was tapped -- so one bad
 * moment (a weak signal at the end of a long upload) left it waiting until somebody noticed. While the app is open it now tries again by
 * itself: after 30 s, 1 min, 2 min, then every 5 minutes, up to 12 attempts per inspection (after that it waits for a manual retry).
 */
let queueRetryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleQueueRetry(): void {
  if (queueRetryTimer) return;
  const stuck = queueCache.filter((e) => e.attempts > 0 && e.attempts < 12);
  if (stuck.length === 0) return;
  const attempts = Math.max(...stuck.map((e) => e.attempts));
  const wait = [30_000, 60_000, 120_000][attempts - 1] ?? 300_000;
  queueRetryTimer = setTimeout(() => {
    queueRetryTimer = null;
    void processQueue();
  }, wait);
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

/** Call once, near app startup. Hydrates the queue from disk, tries a flush, and starts watching for connectivity regained. */
export async function initSyncManager(): Promise<void> {
  if (initialized) return;
  initialized = true;

  await loadPhotoCache();
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
