import type { HTTPRequest, Page } from 'puppeteer';

/**
 * How a report (PDF or Word) loads its photographs.
 *
 * The report page asks for every photograph at the same moment, and each one costs the server a few database look-ups (is it a tenant
 * file, where is it stored). On a small server (1 CPU, a handful of database connections) a report of a few hundred photographs used to
 * run the pool dry, and the photographs whose look-up timed out simply came out of the report as "Photograph unavailable".
 *
 * So the report's headless browser does not fetch photographs itself: each /api/v1/media/ request is handed to this server process, which
 * fetches it at the very same URL (signed link and all -- the media route checks it exactly as before), at most REPORT_PHOTO_CONCURRENCY at a
 * time across every report being made, tries a failed one again, and gives the browser the answer. A photograph that still cannot be
 * loaded is remembered, and the report is stopped with a clear error instead of being printed without it.
 */

/** Photographs fetched at once, across all reports being made on this server. */
export const REPORT_PHOTO_CONCURRENCY = Math.max(1, Number(process.env.REPORT_PHOTO_CONCURRENCY ?? 6));
/** Tries per photograph (the first and the retries). */
const ATTEMPTS = 4;
/** Wait before each retry, in ms. */
const RETRY_DELAYS_MS = [500, 1500, 4000];
/** One try's limit. */
const ATTEMPT_TIMEOUT_MS = 30_000;

/** A photograph (or a file) served by the media route, as the report page links it. */
export function isMediaUrl(url: string): boolean {
  return /\/api\/v1\/media\/[0-9a-f-]{36}(?:[?#]|$)/i.test(url);
}

/** The photograph's id from its link, for error messages (the signature is never shown). */
export function mediaIdOf(url: string): string {
  return /\/api\/v1\/media\/([0-9a-f-]{36})/i.exec(url)?.[1] ?? url.split('?')[0]!;
}

// ---- one shared queue ---------------------------------------------------------------------------------------------------
let active = 0;
const queued: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= REPORT_PHOTO_CONCURRENCY) await new Promise<void>((resolve) => queued.push(resolve));
  else active++;
  try {
    return await work();
  } finally {
    const next = queued.shift();
    if (next) next(); // the slot passes straight on (active stays the same)
    else active--;
  }
}

/** How many photograph fetches are running and waiting right now (for tests and the log). */
export function photoQueueState(): { active: number; queued: number } {
  return { active, queued: queued.length };
}

export interface FetchedReportPhoto {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

/** A photograph that could not be loaded after every try. */
export class ReportPhotoError extends Error {
  constructor(readonly url: string, readonly reason: string) {
    super(`photograph ${mediaIdOf(url)} could not be loaded: ${reason}`);
  }
}

/**
 * A failure worth trying again: no answer, a timeout, "too many requests", a server error, or the database being briefly out of connections
 * (the API answers that 400 DB_REQUEST_ERROR). A refused link (403) or a photograph that is not there (404) is final.
 */
function transient(status: number, body: Buffer): boolean {
  if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
  if (status === 400) return /DB_REQUEST_ERROR/.test(body.toString('utf8', 0, Math.min(body.length, 2000)));
  return false;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The answer's headers the browser needs for an <img> (and a fetch) on the report page. */
const PASSED_HEADERS = ['content-type', 'cache-control', 'cross-origin-resource-policy', 'access-control-allow-origin', 'access-control-allow-credentials', 'vary'];

/**
 * Fetches one photograph through the shared queue, trying again on a passing failure. Resolves with the answer when it is a success;
 * otherwise throws ReportPhotoError with the last reason. `fetcher` is for tests.
 */
export async function fetchReportPhoto(
  url: string,
  headers: Record<string, string> = {},
  { fetcher = fetch, delays = RETRY_DELAYS_MS }: { fetcher?: typeof fetch; delays?: number[] } = {},
): Promise<FetchedReportPhoto> {
  let reason = 'unknown';
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await wait(delays[Math.min(attempt - 1, delays.length - 1)] ?? 0);
    const result = await slot(async () => {
      try {
        const res = await fetcher(url, { headers, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
        const body = Buffer.from(await res.arrayBuffer());
        const out: Record<string, string> = {};
        for (const h of PASSED_HEADERS) {
          const v = res.headers.get(h);
          if (v !== null) out[h] = v;
        }
        return { ok: res.ok, status: res.status, headers: out, body };
      } catch (e) {
        return { ok: false, status: 0, headers: {}, body: Buffer.alloc(0), error: e instanceof Error ? e.message : String(e) };
      }
    });
    if (result.ok) return { status: result.status, headers: result.headers, body: result.body };
    reason = result.status ? `the server answered ${result.status}` : `no answer (${(result as { error?: string }).error ?? 'network error'})`;
    if (result.status && !transient(result.status, result.body)) break;
  }
  throw new ReportPhotoError(url, reason);
}

/** What happened to the report page's photographs. */
export interface ReportPhotoLog {
  /** Photographs that could not be loaded, after every try. */
  failed: ReportPhotoError[];
  /** Photograph requests not answered yet. */
  pending(): number;
}

/**
 * Routes the report page's photograph requests through fetchReportPhoto (everything else goes on untouched). Call before the page is opened.
 * A photograph that fails for good is answered with its error (so the page settles) and listed in `failed`.
 */
export async function routeReportPhotos(page: Page): Promise<ReportPhotoLog> {
  const failed: ReportPhotoError[] = [];
  let open = 0;
  await page.setRequestInterception(true);
  page.on('request', (req: HTTPRequest) => {
    if (req.isInterceptResolutionHandled()) return;
    const url = req.url();
    if (!isMediaUrl(url) || (req.method() !== 'GET' && req.method() !== 'HEAD')) {
      void req.continue().catch(() => undefined);
      return;
    }
    open++;
    // The browser's own request headers (its Referer, Origin, User-Agent), less the ones that belong to its connection.
    const headers = Object.fromEntries(Object.entries(req.headers()).filter(([k]) => !/^(:|host$|connection$|keep-alive$|content-length$|accept-encoding$|transfer-encoding$|upgrade$|expect$)/i.test(k)));
    void fetchReportPhoto(url, headers)
      .then(
        (p) => req.respond({ status: p.status, headers: p.headers, body: req.method() === 'HEAD' ? Buffer.alloc(0) : p.body }),
        (e: unknown) => {
          failed.push(e instanceof ReportPhotoError ? e : new ReportPhotoError(url, e instanceof Error ? e.message : String(e)));
          return req.respond({ status: 502, headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' }, body: 'Photograph unavailable' });
        },
      )
      .catch(() => undefined) // the page was closed meanwhile
      .finally(() => { open--; });
  });
  return { failed, pending: () => open };
}

/** The plain message for a report whose photographs did not all load. */
export function photosFailedMessage(log: ReportPhotoLog): string | null {
  const ids = [...new Set(log.failed.map((f) => mediaIdOf(f.url)))];
  if (ids.length) {
    const shown = ids.slice(0, 5).join(', ') + (ids.length > 5 ? ` and ${ids.length - 5} more` : '');
    return `${ids.length} photograph${ids.length === 1 ? '' : 's'} could not be loaded (${log.failed[0]!.reason}), so the report was not made. Please try again in a minute. Photo id${ids.length === 1 ? '' : 's'}: ${shown}.`;
  }
  const left = log.pending();
  if (left) return `${left} photograph${left === 1 ? ' was' : 's were'} still loading when the report's time ran out, so the report was not made. Please try again in a minute.`;
  return null;
}
