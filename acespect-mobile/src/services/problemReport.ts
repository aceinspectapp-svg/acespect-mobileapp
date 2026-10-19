import { recordEvent } from './auditEvents';

/**
 * Notes about what went wrong (or how far a submit got) on this phone. They join the phone's audit-event queue (services/auditEvents.ts), so
 * they are kept when there is no connection and reach the server's audit log -- and the admin Troubleshoot page -- when there is one again.
 * Best effort: nothing here ever throws or blocks the inspector, and the same problem is noted at most once a minute.
 */
const recent = new Map<string, number>();

export function describeError(err: unknown): { message: string; status?: number; code?: string } {
  const e = err as { message?: string; code?: string; response?: { status?: number; data?: { error?: { message?: string } } } };
  return { message: e?.response?.data?.error?.message ?? e?.message ?? String(err), status: e?.response?.status, code: e?.code };
}

const PROBLEM_ACTION: Record<string, string> = {
  submit: 'submit.failed',
  'queued submission': 'queue.retry_failed',
  'background backup': 'sync.failed',
  'photo backup': 'photo.upload_failed',
  'photo file missing': 'photo.skipped',
};
const STEP_ACTION: Record<string, string> = {
  'submit pressed': 'submit.pressed',
  'submit stopped: no sections saved': 'submit.stopped',
  'submit queued: phone reports no connection': 'submit.queued',
  'submit finished': 'submit.delivered',
};
const slug = (s: string) => `app.${s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'note'}`;

/** Pulls the inspection and job out of a context object; everything else is kept as detail. */
function split(context: Record<string, unknown>): { inspectionId?: string; jobNo?: string; metadata: Record<string, unknown> } {
  const { inspectionId, jobNo, ...rest } = context;
  return { inspectionId: typeof inspectionId === 'string' ? inspectionId : undefined, jobNo: typeof jobNo === 'string' ? jobNo : undefined, metadata: rest };
}

/** A progress note (not an error) about a submit: it lets an admin see how far an attempt got, even when it never completed. */
export function reportStep(step: string, context: Record<string, unknown> = {}): void {
  recordEvent(STEP_ACTION[step] ?? slug(step), { message: step, ...split(context) });
}

export function reportProblem(where: string, err: unknown, context: Record<string, unknown> = {}): void {
  const d = describeError(err);
  const photoNumber = (err as { photoNumber?: number } | null)?.photoNumber;
  const key = `${where}|${d.status ?? ''}|${d.code ?? ''}|${d.message}`;
  const last = recent.get(key) ?? 0;
  if (Date.now() - last < 60_000) return;
  recent.set(key, Date.now());
  recordEvent(PROBLEM_ACTION[where] ?? slug(where), {
    outcome: 'failure',
    severity: 'warning',
    message: `${where}: ${d.message}`,
    ...split({ ...context, ...(d.status ? { status: d.status } : {}), ...(d.code ? { code: d.code } : {}), ...(photoNumber !== undefined ? { photoNumber } : {}) }),
  });
}
