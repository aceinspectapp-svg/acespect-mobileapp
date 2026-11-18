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

/** A request to the API, signed in (api.ts's fetchWithRefresh), given only the path after the API base. */
export type ApiRequest = (path: string, init?: RequestInit) => Promise<Response>;

async function reasonOf(res: Response, fallback: string): Promise<string> {
  const why = (await res.json().catch(() => null))?.error?.message;
  return why ? `${fallback}: ${why}` : `${fallback} (HTTP ${res.status})`;
}

/**
 * Asks for the report and waits until it is made, telling `onProgress` each time it hears how far it has got. Resolves with the finished
 * file. Throws with the server's own reason when the report could not be made. A server that does not offer background reports yet
 * (an older backend) is asked for the file directly, as before.
 */
export async function makeReportFile(
  id: string,
  format: ReportFormat,
  request: ApiRequest,
  {
    onProgress = () => undefined,
    pollMs = 2500,
    giveUpAfterMs = 30 * 60_000,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  }: { onProgress?: (job: ReportJobStatus | null) => void; pollMs?: number; giveUpAfterMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Blob> {
  const failed = `Failed to generate ${format === "pdf" ? "PDF" : "Word document"}`;
  onProgress(null);
  const started = await request(`/inspections/${id}/report-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format }),
  });
  if (started.status === 404 && /^Route not found/.test((await started.clone().json().catch(() => null))?.error?.message ?? "")) {
    // An older server without background reports: the file straight away, in one (long) request.
    const direct = await request(`/inspections/${id}/report.${format}`);
    if (!direct.ok) throw new Error(await reasonOf(direct, failed));
    return direct.blob();
  }
  if (!started.ok) throw new Error(await reasonOf(started, failed));
  let job = (await started.json()).job as ReportJobStatus;
  const until = Date.now() + giveUpAfterMs;
  onProgress(job);
  while (job.state !== "done" && job.state !== "failed") {
    if (Date.now() > until) throw new Error(`${failed}: it took longer than ${Math.round(giveUpAfterMs / 60_000)} minutes. Please try again.`);
    await sleep(pollMs);
    const res = await request(`/inspections/${id}/report-jobs/${job.id}`);
    if (!res.ok) throw new Error(await reasonOf(res, failed));
    job = (await res.json()).job as ReportJobStatus;
    onProgress(job);
  }
  if (job.state === "failed") throw new Error(`${failed}${job.error?.message ? `: ${job.error.message}` : ""}`);
  const file = await request(`/inspections/${id}/report-jobs/${job.id}/file`);
  if (!file.ok) throw new Error(await reasonOf(file, failed));
  return file.blob();
}
