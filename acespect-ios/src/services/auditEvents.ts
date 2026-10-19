import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';

/**
 * The phone's own record of what happened to an inspection on the device (taking photos, losing the connection, a submit being pressed, queued,
 * retried or delivered, photos skipped...). The server can never see these when the phone is offline, so they are kept here with the
 * time the phone saw them and uploaded in batches (POST /audit/client-events) whenever a connection allows. Each event has a fixed id, so
 * uploading a batch twice stores nothing twice. Nothing here can ever block or fail what the inspector is doing.
 */
export interface PhoneEvent {
  id: string;
  at: string;
  action: string;
  outcome?: 'success' | 'failure';
  severity?: 'info' | 'notice' | 'warning' | 'error';
  inspectionId?: string;
  jobNo?: string;
  correlationId?: string;
  message?: string;
  metadata?: Record<string, unknown>;
}

const KEY = 'audit-events:v1';
const MAX_QUEUED = 1000;
let queue: PhoneEvent[] = [];
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let failures = 0;

// ───────────────────────── what this phone is ─────────────────────────

export interface DeviceInfo { appVersion?: string; updateId?: string; platform?: string; osVersion?: string; deviceModel?: string }
let cachedDevice: DeviceInfo | null = null;
export function deviceInfo(): DeviceInfo {
  if (cachedDevice) return cachedDevice;
  let updateId: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    updateId = (require('expo-updates') as { updateId?: string | null }).updateId ?? undefined;
  } catch {
    /* not available in this build */
  }
  const k = (Platform as unknown as { constants?: Record<string, unknown> }).constants ?? {};
  cachedDevice = {
    appVersion: Constants.expoConfig?.version,
    updateId,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    deviceModel: Platform.OS === 'android' ? [k.Brand, k.Model].filter(Boolean).join(' ') || undefined : typeof k.interfaceIdiom === 'string' ? `iOS ${k.interfaceIdiom}` : 'iOS',
  };
  return cachedDevice;
}

/** The extra headers every request carries, so the server can say which app version and phone a request came from. */
export function appHeaders(): Record<string, string> {
  const d = deviceInfo();
  return {
    ...(d.appVersion ? { 'X-App-Version': d.appVersion } : {}),
    ...(d.updateId ? { 'X-App-Update': d.updateId } : {}),
    ...(d.platform ? { 'X-App-Platform': d.platform } : {}),
    ...(d.osVersion ? { 'X-App-Os': d.osVersion } : {}),
    ...(d.deviceModel ? { 'X-App-Device': d.deviceModel } : {}),
  };
}

// ───────────────────────── one id for everything one submit does ─────────────────────────

let correlation: { id: string; at: number } | null = null;
/** Starts a new "story" (one submit attempt): its events and its requests all carry this id. */
export function beginCorrelation(): string {
  correlation = { id: Crypto.randomUUID(), at: Date.now() };
  return correlation.id;
}
export function currentCorrelation(): string | undefined {
  return correlation && Date.now() - correlation.at < 30 * 60_000 ? correlation.id : undefined;
}

// ───────────────────────── the queue ─────────────────────────

function load(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(KEY)
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as PhoneEvent[]) : [];
        const have = new Set(queue.map((e) => e.id));
        queue = [...saved.filter((e) => !have.has(e.id)), ...queue];
      })
      .catch(() => undefined);
  }
  return loaded;
}

function saveSoon(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void AsyncStorage.setItem(KEY, JSON.stringify(queue)).catch(() => undefined);
  }, 1000);
}

/** Only short, plain values leave the phone: no file paths, tokens or long text. */
function cleanMeta(m?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!m) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m)) {
    if (/uri|token|password|secret|authorization/i.test(k) || v === undefined || v === null) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 200);
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => (typeof x === 'string' ? x.slice(0, 80) : x));
  }
  return Object.keys(out).length ? out : undefined;
}

export function recordEvent(action: string, data: Omit<PhoneEvent, 'id' | 'at' | 'action'> = {}): void {
  try {
    const event: PhoneEvent = {
      id: Crypto.randomUUID(),
      at: new Date().toISOString(),
      action,
      ...(data.outcome ? { outcome: data.outcome } : {}),
      ...(data.severity ? { severity: data.severity } : {}),
      ...(data.inspectionId ? { inspectionId: data.inspectionId } : {}),
      ...(data.jobNo ? { jobNo: data.jobNo.slice(0, 60) } : {}),
      correlationId: data.correlationId ?? currentCorrelation(),
      ...(data.message ? { message: data.message.slice(0, 300) } : {}),
      ...(data.metadata ? { metadata: cleanMeta(data.metadata) } : {}),
    };
    queue.push(event);
    if (queue.length > MAX_QUEUED) {
      // Keep the important ones: drop the oldest routine notes first.
      const drop = queue.findIndex((e) => !e.severity || e.severity === 'info');
      queue.splice(drop >= 0 ? drop : 0, 1);
    }
    saveSoon();
    scheduleFlush(3000);
  } catch {
    /* never let an audit note get in the way */
  }
}

function scheduleFlush(ms: number): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushEvents();
  }, ms);
}

export async function flushEvents(): Promise<void> {
  await load();
  if (flushing || queue.length === 0) return;
  flushing = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { api } = require('./apiClient') as { api: import('axios').AxiosInstance }; // loaded here, not at the top: apiClient itself uses this file
    while (queue.length > 0) {
      const batch = queue.slice(0, 100);
      try {
        await api.post('/audit/client-events', { sentAt: new Date().toISOString(), device: deviceInfo(), events: batch }, { timeout: 20000 });
      } catch (err) {
        const status = (err as { response?: { status?: number } }).response?.status;
        // The server judged these events unusable (not a connection problem): drop them rather than send them for ever.
        if (status === 400 || status === 413 || status === 422) {
          queue = queue.filter((e) => !batch.some((b) => b.id === e.id));
          saveSoon();
          continue;
        }
        throw err;
      }
      const sent = new Set(batch.map((b) => b.id));
      queue = queue.filter((e) => !sent.has(e.id));
      saveSoon();
    }
    failures = 0;
  } catch {
    failures += 1;
    scheduleFlush([30_000, 60_000, 120_000][failures - 1] ?? 300_000);
  } finally {
    flushing = false;
  }
}

// ───────────────────────── lifecycle ─────────────────────────

let started = false;
/** Call once at start-up: loads what is waiting, notes the launch, and sends events when the app comes to the front. */
export function initAuditEvents(): void {
  if (started) return;
  started = true;
  void load().then(() => {
    recordEvent('app.start', { message: 'App opened' });
  });
  let last = AppState.currentState;
  AppState.addEventListener('change', (next) => {
    if (last === 'active' && next !== 'active') recordEvent('app.background', { message: 'App moved to the background' });
    if (last !== 'active' && next === 'active') {
      recordEvent('app.foreground', { message: 'App came back to the front' });
      scheduleFlush(500);
    }
    last = next;
  });
}
