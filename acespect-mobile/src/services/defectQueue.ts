import AsyncStorage from '@react-native-async-storage/async-storage';
import * as qc from './qcApi';
import { errorMessage, isNetworkError } from './qcCache';

/**
 * Offline outbox for defect work. Anything an inspector or site user does to a defect (raise one, save the
 * draft, add photos, comment, run a lifecycle action) is tried straight away; if there is no signal it is
 * kept here, in order, and sent by `flushDefectQueue` when the connection returns.
 *
 * A defect raised offline has a local id (`local-...`). Later entries that name it are rewritten to the real
 * id once its creation has gone through. An entry the server refuses (for a reason a retry will not fix) stays
 * in the queue with the reason so the person can see it and discard it; entries behind a failed creation fail too.
 */
const KEY = 'qc.defect.queue.v1';

export type QueueOp =
  | { kind: 'create'; body: Record<string, unknown>; photoUris: string[] }
  | { kind: 'update'; defectId: string; patch: Record<string, unknown> }
  | { kind: 'photos'; defectId: string; photoUris: string[] }
  | { kind: 'comment'; defectId: string; text: string; visibleTo: string; photoUris: string[] }
  | { kind: 'action'; defectId: string; action: string; payload: Record<string, unknown>; photoUris: string[] };

export interface QueueEntry {
  id: string;
  createdAt: string;
  label: string;
  op: QueueOp;
  /** Local id given to a defect created offline. */
  localId?: string;
  error?: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();
export const onQueueChange = (fn: Listener): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => listeners.forEach((l) => l());

async function read(): Promise<QueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueueEntry[]) : [];
  } catch {
    return [];
  }
}
async function write(q: QueueEntry[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
  notify();
}

export const isLocalId = (id: string) => id.startsWith('local-');
export const listQueue = read;
export const queueSize = async () => (await read()).length;
export const queuedForDefect = async (defectId: string) => (await read()).filter((e) => 'defectId' in e.op && e.op.defectId === defectId);

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Add an entry to the outbox. Returns the local id when it is a new defect. */
export async function enqueueDefectWork(op: QueueOp, label: string): Promise<{ entry: QueueEntry }> {
  const entry: QueueEntry = { id: newId(), createdAt: new Date().toISOString(), label, op, ...(op.kind === 'create' ? { localId: `local-${newId()}` } : {}) };
  await write([...(await read()), entry]);
  return { entry };
}

export async function discardEntry(id: string): Promise<void> {
  const q = await read();
  const gone = q.find((e) => e.id === id);
  // Discarding a creation also drops whatever was queued against the defect it would have made.
  await write(q.filter((e) => e.id !== id && !(gone?.localId && 'defectId' in e.op && e.op.defectId === gone.localId)));
}

/** Try a change now; with no connection keep it for later. Resolves to what happened. */
export async function runOrQueue<T>(attempt: () => Promise<T>, op: QueueOp, label: string): Promise<{ queued: false; result: T } | { queued: true; entry: QueueEntry }> {
  try {
    return { queued: false, result: await attempt() };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    const { entry } = await enqueueDefectWork(op, label);
    return { queued: true, entry };
  }
}

async function send(entry: QueueEntry, ids: Map<string, string>): Promise<void> {
  const op = entry.op;
  const real = (id: string) => ids.get(id) ?? id;
  switch (op.kind) {
    case 'create': {
      const defect = await qc.createDefect(op.body);
      if (entry.localId) ids.set(entry.localId, defect.id);
      if (op.photoUris.length) await qc.addDefectPhotos(defect.id, op.photoUris);
      return;
    }
    case 'update':
      await qc.updateDefect(real(op.defectId), op.patch);
      return;
    case 'photos':
      await qc.addDefectPhotos(real(op.defectId), op.photoUris);
      return;
    case 'comment':
      await qc.postDefectComment(real(op.defectId), op.text, op.visibleTo, op.photoUris);
      return;
    case 'action':
      // No expectedUpdatedAt: the server checks the action is still allowed in the defect's current state.
      await qc.postDefectAction(real(op.defectId), op.action, op.payload, op.photoUris);
      return;
  }
}

let flushing: Promise<FlushResult> | null = null;
export interface FlushResult { sent: number; failed: number; offline: boolean }

/** Send everything waiting, oldest first. Stops at the first network failure. */
export function flushDefectQueue(): Promise<FlushResult> {
  if (!flushing) flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush(): Promise<FlushResult> {
  const q = await read();
  if (q.length === 0) return { sent: 0, failed: 0, offline: false };
  const ids = new Map<string, string>();
  const failedLocal = new Set<string>();
  const remaining: QueueEntry[] = [];
  let sent = 0;
  let failed = 0;
  let offline = false;
  for (const entry of q) {
    if (offline) { remaining.push(entry); continue; }
    if (entry.error) { remaining.push(entry); failed++; if (entry.localId) failedLocal.add(entry.localId); continue; }
    const dependsOn = 'defectId' in entry.op ? entry.op.defectId : null;
    if (dependsOn && failedLocal.has(dependsOn)) {
      remaining.push({ ...entry, error: 'The defect this belongs to could not be created.' });
      failed++;
      continue;
    }
    try {
      await send(entry, ids);
      sent++;
    } catch (e) {
      if (isNetworkError(e)) {
        offline = true;
        remaining.push(entry);
      } else {
        remaining.push({ ...entry, error: errorMessage(e, 'The server did not accept this') });
        failed++;
        if (entry.localId) failedLocal.add(entry.localId);
      }
    }
  }
  await write(remaining);
  return { sent, failed, offline };
}
