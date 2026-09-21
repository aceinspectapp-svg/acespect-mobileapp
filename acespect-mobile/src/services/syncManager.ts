import * as Network from 'expo-network';
import { File } from 'expo-file-system';
import type { SubmitPayload } from '../context/InspectionDraftContext';
import type { AnswerTree } from '../components/inspection/fieldRenderers/types';
import { getSyncQueue, setSyncQueue, getWifiOnlySync, QueuedSubmission } from './offlineStorage';
import { submitInspection, uploadPhoto } from './inspectionApi';

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

async function uploadAndForget(uri: string, opts: { inspectionId?: string; sectionKey?: string }): Promise<string> {
  const url = await uploadPhoto(uri, opts);
  void deleteLocalFile(uri);
  return url;
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
          urlByUri.set(uri, await uploadAndForget(uri, { inspectionId, sectionKey: childPath.join(':') }));
        }
        arr[i] = urlByUri.get(uri)!;
      }
    } else if (Array.isArray(value)) {
      // Repeating-group / damage-list instances (strip/checklist presentation).
      for (const inst of value as AnswerTree[]) {
        await walkAndResolvePhotos(inst, childPath, inspectionId, urlByUri);
      }
    } else if (typeof value === 'object') {
      // A single nested compound value, or fixed-tabs' Record<instanceKey, AnswerTree> --
      // either way its own entries recurse the same way, gaining one more folder level.
      await walkAndResolvePhotos(value as AnswerTree, childPath, inspectionId, urlByUri);
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
export async function runSubmission(payload: SubmitPayload): Promise<{ inspectionId: string; reviewJobId: string; status: string }> {
  const inspectionId = payload.id;
  const urlByUri = new Map<string, string>();

  // Primary pass: walk each section's actual answer tree, so every
  // photos-type field (wherever it's nested) gets uploaded under a folder
  // that matches its own sub-area, and the field's own stored value is what
  // ends up holding the real URL -- not just a separate flat summary list.
  for (const section of payload.sections) {
    await walkAndResolvePhotos(section.answers as AnswerTree | undefined, [section.key], inspectionId, urlByUri);
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
        urlByUri.set(uri, await uploadAndForget(uri, { inspectionId, sectionKey: section.key }));
      }
    }
    for (const d of section.damages ?? []) {
      for (const uri of d.photos ?? []) {
        if (isLocalUri(uri) && !urlByUri.has(uri)) {
          urlByUri.set(uri, await uploadAndForget(uri, { inspectionId, sectionKey: section.key }));
        }
      }
    }
  }

  const resolve = (u: string) => urlByUri.get(u) ?? u;
  for (const section of payload.sections) {
    section.photos = (section.photos ?? []).map(resolve);
    section.damages = (section.damages ?? []).map((d) => ({ ...d, photos: (d.photos ?? []).map(resolve) }));
  }

  return submitInspection(payload);
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
 * Flush the queue in order. Stops (without dropping remaining entries) the
 * moment one submission fails, so a dead connection doesn't get hammered
 * once per entry. `force` (the manual "Retry now" button) bypasses the
 * Wi-Fi-only preference -- every other caller here is an automatic trigger
 * that should respect it.
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
        const message = err instanceof Error ? err.message : 'Unknown error';
        queueCache = queueCache.map((e) => (e.id === id ? { ...e, attempts: e.attempts + 1, lastError: message } : e));
        await persist();
        // A response actually came back (e.g. a 400/422 validation error) --
        // that specific payload was rejected, not merely unreachable, and
        // retrying the exact same payload again right now won't change the
        // outcome. It stays queued (so a server-side fix can still pick it
        // up later, same as the photo-URL-format bug this was written for),
        // but it shouldn't block whatever else is queued behind it.
        if ((err as { response?: unknown })?.response) continue;
        // No response reached us at all -- a real connectivity problem, so
        // stop here rather than hammering a dead connection once per
        // remaining entry.
        break;
      }
    }
  } finally {
    setProcessing(false);
  }
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
