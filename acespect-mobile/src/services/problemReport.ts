import { api } from './apiClient';

/**
 * Tells the server why an upload or submission attempt failed on THIS phone, so an admin can read the reason on the Troubleshoot page
 * (the server cannot see a request that never reached it). Best effort: it never throws and never blocks the inspector, and the same
 * problem is reported at most once a minute.
 */
const recent = new Map<string, number>();

export function describeError(err: unknown): { message: string; status?: number; code?: string } {
  const e = err as { message?: string; code?: string; response?: { status?: number; data?: { error?: { message?: string } } } };
  return { message: e?.response?.data?.error?.message ?? e?.message ?? String(err), status: e?.response?.status, code: e?.code };
}

export function reportProblem(where: string, err: unknown, context: Record<string, unknown> = {}): void {
  const d = describeError(err);
  const photoNumber = (err as { photoNumber?: number } | null)?.photoNumber;
  if (photoNumber !== undefined) context = { ...context, photoNumber };
  const key = `${where}|${d.status ?? ''}|${d.code ?? ''}|${d.message}`;
  const last = recent.get(key) ?? 0;
  if (Date.now() - last < 60_000) return;
  recent.set(key, Date.now());
  void api
    .post('/inspections/client-error', { where, message: d.message.slice(0, 300), status: d.status, code: d.code, context }, { timeout: 15000 })
    .catch(() => undefined);
}
