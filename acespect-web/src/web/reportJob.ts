/**
 * A report file (PDF or Word) made in the background on the server (backend lib/reportJobs.ts).
 *
 * A large report takes minutes to make -- too long for one request, which the hosting front end cuts off -- so the file is asked for
 * (POST /inspections/:id/report-jobs), the job is asked how it is going every few seconds, and the finished file is then downloaded
 * (GET .../report-jobs/:jobId/file), which is quick. While it is being made the page shows "Preparing report…" and how far it has got.
 */

export type ReportFormat = "pdf" | "docx";
export type ReportJobState = "waiting" | "opening" | "photos" | "printing" | "done" | "failed";

export interface ReportJobStatus {
  id: string;
  state: ReportJobState;
  fileName: string;
  elapsedSeconds: number;
  photos?: { requested: number; loaded: number };
  bytes?: number;
  error?: { message: string; code: string };
}

/** What the person is shown while the report is being made, e.g. "Preparing report… loading photographs (120 of 250)". */
export function progressText(job: Pick<ReportJobStatus, "state" | "photos"> | null, format: ReportFormat): string {
  const file = format === "pdf" ? "PDF" : "Word document";
  if (!job) return "Preparing report…";
  switch (job.state) {
    case "waiting":
      return "Preparing report… waiting for another report to finish first";
    case "opening":
    case "photos": {
      const p = job.photos;
      return p && p.requested ? `Preparing report… loading photographs (${Math.min(p.loaded, p.requested)} of ${p.requested})` : "Preparing report… opening the report";
    }
    case "printing":
      return `Preparing report… putting the ${file} together`;
    case "done":
      return `The ${file} is ready.`;
    default:
      return "Preparing report…";
  }
}

/** A request to the API, signed in with the current login, given only the path after the API base. */
export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

/** Makes sure the login is good before a request (api.ts ensureSession); `force` renews it even if it looks good. */
export type SessionCheck = (force?: boolean) => Promise<"ok" | "signed-out" | "unavailable">;

/** The login has ended and could not be renewed: the person has to sign in again (the page says so, with a link). */
export class SignInAgainError extends Error {
  readonly signInAgain = true;
  constructor() {
    super("Please sign in again. Your session has ended, so the report could not be fetched.");
    this.name = "SignInAgainError";
  }
}

async function reasonOf(res: Response, fallback: string): Promise<string> {
  const why = (await res.json().catch(() => null))?.error?.message;
  return why ? `${fallback}: ${why}` : `${fallback} (HTTP ${res.status})`;
}

/** Codes of a 401 that renewing the login cannot fix. */
const ENDED = new Set(["SESSION_IDLE", "SESSION_REVOKED", "ACCOUNT_INACTIVE"]);
/** Waits between tries while the server cannot be reached: 2, 4, 8, then every 15 seconds. */
export const RETRY_WAITS_MS = [2000, 4000, 8000, 15000];

export interface MakeReportOptions {
  onProgress?: (job: ReportJobStatus | null) => void;
  /** Told when a request failed for a reason that usually passes (no answer, server busy) and is about to be tried again. */
  onRetry?: (info: { waitMs: number; failingForMs: number; reason: string }) => void;
  session?: SessionCheck;
  pollMs?: number;
  giveUpAfterMs?: number;
  /** How long requests keep being tried again while the server does not answer, before giving up. */
  retryForMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Asks for the report and waits until it is made, telling `onProgress` each time it hears how far it has got. Resolves with the finished
 * file. Throws with the server's own reason when the report could not be made, or SignInAgainError when the login has ended.
 *
 * Before every request the login is checked and renewed if it is about to expire (`session`): a large report takes minutes, longer than a
 * login lasts. A request that gets no answer -- offline, or the hosting front end giving up on a busy server, which the browser reports as
 * a CORS error because that reply has none of our headers -- or a busy answer (408, 429, 5xx) is tried again after a short wait (2, 4, 8,
 * then every 15 s) for up to `retryForMs`; asking for the report again is safe, as the server joins the job already being made. A server
 * that does not offer background reports yet (an older backend) is asked for the file directly, as before.
 */
export async function makeReportFile(
  id: string,
  format: ReportFormat,
  request: ApiRequest,
  {
    onProgress = () => undefined,
    onRetry = () => undefined,
    session = async () => "ok",
    pollMs = 2500,
    giveUpAfterMs = 30 * 60_000,
    retryForMs = 4 * 60_000,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
  }: MakeReportOptions = {},
): Promise<Blob> {
  const failed = `Failed to generate ${format === "pdf" ? "PDF" : "Word document"}`;

  /** One request, with the login checked first and passing failures tried again. Returns the answer (ok, or a real refusal). */
  async function send(path: string, init?: RequestInit): Promise<Response> {
    let failingSince = 0;
    let tries = 0;
    let renewedAfter401 = false;
    for (;;) {
      let reason = "";
      let waitMs = 0;
      const login = await session();
      if (login === "signed-out") throw new SignInAgainError();
      if (login === "unavailable") reason = "the sign-in could not be renewed (no answer)";
      else {
        let res: Response | undefined;
        try {
          res = await request(path, init);
        } catch {
          reason = "no answer from the server";
        }
        if (res) {
          if (res.status === 401) {
            const code = (await res.clone().json().catch(() => null))?.error?.code as string | undefined;
            if (code && ENDED.has(code)) throw new SignInAgainError();
            // The login ran out between the check and the request: renew it once and ask again straight away.
            if (!renewedAfter401) {
              renewedAfter401 = true;
              const renewed = await session(true);
              if (renewed === "signed-out") throw new SignInAgainError();
              if (renewed === "ok") continue;
              reason = "the sign-in could not be renewed (no answer)";
            } else {
              throw new SignInAgainError();
            }
          } else if (res.status === 408 || res.status === 429 || res.status >= 500) {
            reason = `the server is busy (HTTP ${res.status})`;
            const after = Number(res.headers.get("Retry-After"));
            if (res.status === 429 && after > 0 && after <= 60) waitMs = after * 1000;
          } else {
            return res;
          }
        }
      }
      const t = now();
      failingSince ||= t;
      if (t - failingSince >= retryForMs) {
        throw new Error(`${failed}: ${reason}, and it still had not answered after ${Math.round(retryForMs / 60_000)} minutes of trying. The server may be busy with another report; please try again in a few minutes.`);
      }
      waitMs ||= RETRY_WAITS_MS[Math.min(tries, RETRY_WAITS_MS.length - 1)]!;
      tries++;
      onRetry({ waitMs, failingForMs: t - failingSince, reason });
      await sleep(waitMs);
    }
  }

  onProgress(null);
  const started = await send(`/inspections/${id}/report-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format }),
  });
  if (started.status === 404 && /^Route not found/.test((await started.clone().json().catch(() => null))?.error?.message ?? "")) {
    // An older server without background reports: the file straight away, in one (long) request.
    const direct = await send(`/inspections/${id}/report.${format}`);
    if (!direct.ok) throw new Error(await reasonOf(direct, failed));
    return direct.blob();
  }
  if (!started.ok) throw new Error(await reasonOf(started, failed));
  let job = (await started.json()).job as ReportJobStatus;
  const until = now() + giveUpAfterMs;
  onProgress(job);
  while (job.state !== "done" && job.state !== "failed") {
    if (now() > until) throw new Error(`${failed}: it took longer than ${Math.round(giveUpAfterMs / 60_000)} minutes. Please try again.`);
    await sleep(pollMs);
    const res = await send(`/inspections/${id}/report-jobs/${job.id}`);
    // A 404 here is the server's own "no longer being prepared" (a restart): its message says to ask again.
    if (!res.ok) throw new Error(await reasonOf(res, failed));
    job = (await res.json()).job as ReportJobStatus;
    onProgress(job);
  }
  if (job.state === "failed") throw new Error(`${failed}${job.error?.message ? `: ${job.error.message}` : ""}`);
  const file = await send(`/inspections/${id}/report-jobs/${job.id}/file`);
  if (!file.ok) throw new Error(await reasonOf(file, failed));
  return file.blob();
}
