/**
 * When a request to the server is worth sending again, and how long to wait first. One rule for the whole app (photo uploads, the final
 * submit, background section saves, the QC result and defect queues), so a server that is briefly busy -- answering 408, 429, 502, 503 or
 * 504 while it makes a large report, or not answering at all -- never costs an inspector a photo, a section or a result: the request waits
 * and is sent again, and only a real refusal (400, 403, 404, 413, 422 …) is shown as one.
 *
 * Plain TypeScript with no imports, so it is tested directly with Node (src/services/retryPolicy.test.ts).
 */

/** Statuses that mean "the server is busy or briefly unreachable, try again" -- never "this request is wrong". */
export const BUSY_STATUSES: readonly number[] = [408, 425, 429, 500, 502, 503, 504];

type HttpFailure = { response?: { status?: number; headers?: Record<string, unknown> }; code?: string; message?: string };

/** The HTTP status of a failed request, or undefined when no answer came at all. */
export function statusOf(err: unknown): number | undefined {
  return (err as HttpFailure | null)?.response?.status;
}

/** No answer at all: no connection, the request timed out, or the connection dropped. */
export function isNoAnswer(err: unknown): boolean {
  return !!err && typeof err === 'object' && !(err as HttpFailure).response;
}

/** The server answered that it is busy (or a proxy in front of it did: Azure's front end answers 502 / 504 for a server that is held up). */
export function isServerBusy(err: unknown): boolean {
  const st = statusOf(err);
  return st !== undefined && BUSY_STATUSES.includes(st);
}

/** Worth sending again later: no answer, or a busy answer. */
export function isTransientFailure(err: unknown): boolean {
  return isNoAnswer(err) || isServerBusy(err);
}

/**
 * Waits between tries. A busy server is waited out for about four minutes in all (3 min 52 s; never under 3 min 6 s with the spread below
 * -- a large report keeps the server busy 2-3 minutes); no answer
 * at all gets a shorter run (about half a minute), since that is usually the phone being offline, which the app's own queue then handles.
 */
export const BUSY_WAITS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000, 30_000, 45_000, 60_000, 60_000];
export const NO_ANSWER_WAITS_MS: readonly number[] = [2_000, 6_000, 15_000];

/** The Retry-After the server sent (seconds or a date), in ms, capped at a minute; undefined when there is none. */
export function retryAfterMs(err: unknown, now = Date.now()): number | undefined {
  const h = (err as HttpFailure | null)?.response?.headers;
  const raw = h ? (h['retry-after'] ?? h['Retry-After']) : undefined;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const secs = Number(raw);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(String(raw)) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 60_000) : undefined;
}

/**
 * How long to wait before try number `attempt + 1` (attempt 0 = after the first failure), or null when it is time to give up. A little
 * random spread (±20 %) so a hundred phones do not all come back at the same second.
 */
export function nextWaitMs(err: unknown, attempt: number, random: () => number = Math.random): number | null {
  const waits = isServerBusy(err) ? BUSY_WAITS_MS : isNoAnswer(err) ? NO_ANSWER_WAITS_MS : null;
  if (!waits || attempt >= waits.length) return null;
  const base = retryAfterMs(err) ?? waits[attempt]!;
  return Math.round(base * (0.8 + 0.4 * random()));
}

/**
 * Runs `send`, and while it fails with a failure worth trying again (`retryable`, default isTransientFailure), waits (nextWaitMs) and
 * sends again. The last failure is thrown when the waits run out or the failure is a real refusal. Only for requests that are safe to
 * send twice (the server keeps one copy: photos by their photo id, the submit by the inspection id).
 */
export async function withRetry<T>(
  send: (attempt: number) => Promise<T>,
  opts: { retryable?: (err: unknown) => boolean; onRetry?: (err: unknown, waitMs: number, attempt: number) => void; sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): Promise<T> {
  const retryable = opts.retryable ?? isTransientFailure;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await send(attempt);
    } catch (err) {
      // A busy server or no answer: the waits above. Something else the caller counts as worth repeating (a photo upload's 409 "already being
      // saved"): the short run.
      const wait = !retryable(err) ? null : isTransientFailure(err) ? nextWaitMs(err, attempt, opts.random) : (NO_ANSWER_WAITS_MS[attempt] ?? null);
      if (wait === null) throw err;
      opts.onRetry?.(err, wait, attempt);
      await sleep(wait);
    }
  }
}
