import { api } from './apiClient';
import type { DraftSection, DraftTop, SubmitPayload } from '../context/InspectionDraftContext';
import type { AnswerTree } from '../components/inspection/fieldRenderers/types';
import { resolveSectionForServer } from './syncManager';

/**
 * Keeps the server holding the inspection while the inspector works. Each time a section is saved on the phone, it is sent to the
 * server in the background (its photos first), so the server already has everything up to the last saved section. If the phone is lost,
 * or the final submit fails, nothing is gone. The final submit then just completes the same server record.
 *
 * Nothing here ever blocks the inspector: a failed save is retried quietly (with growing gaps) and the final submit sends the whole
 * inspection regardless. The status below is what the sections screen shows.
 */
export type LiveSyncState = 'idle' | 'saving' | 'saved' | 'waiting';
export interface LiveSyncStatus { state: LiveSyncState; savedSections: number; lastError?: string }

interface DraftAccess {
  buildPayload: (resolve: (uri: string) => string) => SubmitPayload;
  getFolderId: () => string;
  getTop: () => DraftTop;
  getAnswers: (key: string) => AnswerTree | undefined;
}

let access: DraftAccess | null = null;
const dirty = new Set<string>();
const sent = new Map<string, string>(); // section key -> what the server last received
let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;
/** Sections the server refused as invalid: not retried until that section is saved again, so one bad section never holds up the rest. */
const refused = new Map<string, string>();
let status: LiveSyncStatus = { state: 'idle', savedSections: 0 };
const listeners = new Set<(s: LiveSyncStatus) => void>();

function setStatus(next: Partial<LiveSyncStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((l) => l(status));
}
export const getLiveSyncStatus = (): LiveSyncStatus => status;
export function subscribeLiveSync(l: (s: LiveSyncStatus) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** The draft the saver reads from. Called by the draft provider. */
export function attachDraft(a: DraftAccess | null): void {
  access = a;
}

/** A new inspection (or the end of this one): forget what was sent. */
export function resetLiveSync(): void {
  dirty.clear();
  sent.clear();
  refused.clear();
  failures = 0;
  if (timer) clearTimeout(timer);
  timer = null;
  setStatus({ state: 'idle', savedSections: 0, lastError: undefined });
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A section was saved on the phone: send it to the server soon. */
export function scheduleSectionSync(key: string): void {
  refused.delete(key);
  dirty.add(key);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void run(), 1500);
}

async function run(): Promise<void> {
  if (running || !access) return;
  running = true;
  timer = null;
  setStatus({ state: 'saving' });
  try {
    while (dirty.size > 0 && access) {
      const key = dirty.values().next().value as string;
      if (refused.has(key)) { dirty.delete(key); continue; }
      const payload = access.buildPayload((u) => u);
      const section = payload.sections.find((s) => s.key === key);
      if (!section) { dirty.delete(key); continue; }
      const snapshot = JSON.stringify(section);
      if (sent.get(key) === snapshot) { dirty.delete(key); continue; }

      const id = access.getFolderId();
      const job = access.getAnswers('job-info') ?? {};
      const top = access.getTop();
      const jobNo = str(job.jobNumber) || undefined;
      let resolved: DraftSection & { answers?: unknown };
      try {
        resolved = await resolveSectionForServer(section as DraftSection & { answers?: unknown }, id, jobNo);
        await api.put(`/inspections/${id}/sync`, {
        inspectionType: top.inspectionType,
        propertyType: top.propertyType,
        ...(jobNo ? { jobNo } : {}),
        ...(str(job.inspectionAddress) ? { address: str(job.inspectionAddress) } : {}),
        ...(str(job.clientName) ? { client: str(job.clientName) } : {}),
        ...(str(job.inspectionDate) ? { date: str(job.inspectionDate) } : {}),
        section: {
          key: resolved.key, name: resolved.name, icon: resolved.icon ?? '', order: resolved.order, status: resolved.status ?? 'pending',
          reportText: resolved.reportText ?? '', fields: resolved.fields ?? {}, ...(resolved.answers ? { answers: resolved.answers } : {}),
          photos: resolved.photos ?? [],
          damages: (resolved.damages ?? []).map((d, i) => ({ type: d.type || 'Defect', location: d.location ?? '', direction: d.direction ?? '', widthMm: d.widthMm ?? 0, lengthMm: d.lengthMm ?? 0, notes: d.notes ?? '', photos: d.photos ?? [], order: i })),
        },
      }, { timeout: 60000 });
      } catch (err) {
        // The server judged THIS section invalid (400/413/422): skip it, carry on with the others, and say so.
        const st = (err as { response?: { status?: number } }).response?.status;
        if (st === 400 || st === 413 || st === 422) {
          refused.set(key, (err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? 'refused');
          dirty.delete(key);
          continue;
        }
        throw err;
      }
      sent.set(key, snapshot);
      dirty.delete(key);
      failures = 0;
      setStatus({ savedSections: sent.size, lastError: undefined });
    }
    setStatus(refused.size > 0
      ? { state: 'waiting', lastError: `${refused.size} section(s) could not be backed up: ${[...refused.values()][0]}` }
      : { state: sent.size > 0 ? 'saved' : 'idle' });
  } catch (err) {
    failures += 1;
    const e = err as { response?: { status?: number; data?: { error?: { message?: string; code?: string } } }; message?: string };
    // The inspection was already sent for review (or belongs to someone else): saving more sections can never work.
    const code = e.response?.data?.error?.code;
    if (code === 'NOT_A_DRAFT' || e.response?.status === 403) {
      dirty.clear();
      setStatus({ state: 'idle', lastError: undefined });
    } else {
      setStatus({ state: 'waiting', lastError: e.response?.data?.error?.message ?? e.message ?? 'not reachable' });
      // Try again quietly: 10 s, 30 s, 1 min, then every 2 minutes.
      timer = setTimeout(() => void run(), [10_000, 30_000, 60_000][failures - 1] ?? 120_000);
    }
  } finally {
    running = false;
  }
}
