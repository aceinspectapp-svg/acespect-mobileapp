import AsyncStorage from '@react-native-async-storage/async-storage';
import * as qc from './qcPlatformApi';

/**
 * Offline capture for inspection results (REQ-INP-OFFLINE): every result is
 * written to this queue first, then sent. With no signal the queue holds it
 * (photos stay on the phone) and `flushQueue` sends it when the connection
 * returns. The server keeps the later of two writes by `clientUpdatedAt`, so
 * replaying after a retry or from two devices never overwrites newer work.
 */
const KEY = 'qc.inspection.queue.v1';
const CACHE = (id: string) => `qc.inspection.cache.v1.${id}`;

export interface QueuedResult {
  inspectionId: string;
  itemNumber: string;
  payload: Record<string, unknown>;
  /** Local photo files not yet uploaded. */
  photoUris: string[];
  /** Already-stored photo URLs (from earlier saves of this item). */
  photoUrls: string[];
  clientUpdatedAt: string;
  /** Set when the server refused the entry for a reason a retry will not fix. */
  error?: string;
}

async function read(): Promise<QueuedResult[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedResult[]) : [];
  } catch {
    return [];
  }
}
const write = (q: QueuedResult[]) => AsyncStorage.setItem(KEY, JSON.stringify(q));

export const queuedFor = async (inspectionId: string) => (await read()).filter((q) => q.inspectionId === inspectionId);

/** Add or replace the pending write for one item. */
export async function enqueue(entry: Omit<QueuedResult, 'clientUpdatedAt' | 'error'>): Promise<void> {
  const q = await read();
  const next = q.filter((x) => !(x.inspectionId === entry.inspectionId && x.itemNumber === entry.itemNumber));
  next.push({ ...entry, clientUpdatedAt: new Date().toISOString() });
  await write(next);
}

export async function dropEntry(inspectionId: string, itemNumber: string): Promise<void> {
  await write((await read()).filter((x) => !(x.inspectionId === inspectionId && x.itemNumber === itemNumber)));
}

const isNetworkError = (e: unknown) => !(e as { response?: unknown }).response;

/** Send everything queued. Stops at the first network failure; entries the server rejects are kept with the reason. */
export async function flushQueue(inspectionId?: string): Promise<{ sent: number; failed: number; offline: boolean }> {
  const q = await read();
  let sent = 0;
  let failed = 0;
  const remaining: QueuedResult[] = [];
  let offline = false;
  for (const entry of q) {
    if ((inspectionId && entry.inspectionId !== inspectionId) || offline || entry.error) {
      remaining.push(entry);
      if (entry.error) failed++;
      continue;
    }
    try {
      const uploaded = entry.photoUris.length ? await qc.uploadInspectionPhotos(entry.inspectionId, entry.photoUris) : [];
      await qc.saveResult(entry.inspectionId, entry.itemNumber, {
        ...entry.payload,
        photoUrls: [...entry.photoUrls, ...uploaded],
        clientUpdatedAt: entry.clientUpdatedAt,
      });
      sent++;
    } catch (e) {
      if (isNetworkError(e)) {
        offline = true;
        remaining.push(entry);
      } else {
        const message = (e as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? 'The server did not accept this result';
        remaining.push({ ...entry, error: message });
        failed++;
      }
    }
  }
  await write(remaining);
  return { sent, failed, offline };
}

export async function cacheInspection(detail: qc.InspectionDetail): Promise<void> {
  try { await AsyncStorage.setItem(CACHE(detail.inspection.id), JSON.stringify(detail)); } catch { /* cache only */ }
}
export async function cachedInspection(id: string): Promise<qc.InspectionDetail | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE(id));
    return raw ? (JSON.parse(raw) as qc.InspectionDetail) : null;
  } catch {
    return null;
  }
}
