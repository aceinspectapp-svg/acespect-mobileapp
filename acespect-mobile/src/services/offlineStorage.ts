import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DraftSection, DraftTop, SubmitPayload } from '../context/InspectionDraftContext';
import type { AnswerTree } from '../components/inspection/fieldRenderers/types';
import type { ActiveTemplate } from './templateApi';

const DRAFT_KEY = 'offline:draft:current';
const TEMPLATE_CACHE_KEY = 'offline:templates:cache';
const SYNC_QUEUE_KEY = 'offline:sync:queue';
const WIFI_ONLY_SYNC_KEY = 'offline:settings:wifiOnlySync';

/** Everything InspectionDraftContext holds in refs, snapshotted for persistence. */
export interface DraftSnapshot {
  top: DraftTop;
  sections: Record<string, DraftSection>;
  photos: Record<string, string[]>;
  answers: Record<string, AnswerTree>;
  /** Templates pinned for this specific draft (session pin) — kept alongside
   *  the draft, distinct from the long-lived opportunistic cache below, so a
   *  resumed draft keeps rendering the exact version it started with. */
  templates: Record<string, ActiveTemplate>;
}

export interface QueuedSubmission {
  id: string;
  payload: SubmitPayload;
  attempts: number;
  lastError?: string;
  queuedAt: string;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort persistence — a write failure shouldn't crash the inspection flow.
  }
}

export async function loadDraftSnapshot(): Promise<DraftSnapshot | null> {
  return readJson<DraftSnapshot>(DRAFT_KEY);
}

export async function saveDraftSnapshot(snapshot: DraftSnapshot): Promise<void> {
  await writeJson(DRAFT_KEY, snapshot);
}

export async function clearDraftSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore — worst case a stale snapshot lingers until the next successful write.
  }
}

/** Opportunistic template cache: written on every successful live fetch, read as a fallback when offline. */
export async function getCachedTemplate(pinKey: string): Promise<ActiveTemplate | null> {
  const all = await readJson<Record<string, ActiveTemplate>>(TEMPLATE_CACHE_KEY);
  return all?.[pinKey] ?? null;
}

export async function setCachedTemplate(pinKey: string, template: ActiveTemplate): Promise<void> {
  const all = (await readJson<Record<string, ActiveTemplate>>(TEMPLATE_CACHE_KEY)) ?? {};
  all[pinKey] = template;
  await writeJson(TEMPLATE_CACHE_KEY, all);
}

export async function getSyncQueue(): Promise<QueuedSubmission[]> {
  return (await readJson<QueuedSubmission[]>(SYNC_QUEUE_KEY)) ?? [];
}

export async function setSyncQueue(queue: QueuedSubmission[]): Promise<void> {
  await writeJson(SYNC_QUEUE_KEY, queue);
}

/** Inspector preference: only auto-sync (upload queued inspections) on Wi-Fi, not mobile data. Defaults off (sync on any connection) until set. */
export async function getWifiOnlySync(): Promise<boolean> {
  return (await readJson<boolean>(WIFI_ONLY_SYNC_KEY)) ?? false;
}

export async function setWifiOnlySync(enabled: boolean): Promise<void> {
  await writeJson(WIFI_ONLY_SYNC_KEY, enabled);
}
