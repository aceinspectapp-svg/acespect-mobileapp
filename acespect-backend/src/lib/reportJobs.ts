import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApiError } from '../utils/ApiError';
import type { ReportPhotoLog } from './reportPhotos';
import type { ReportStage } from './reportPdf';

/**
 * Reports (PDF and Word) made in the background.
 *
 * A report with a few hundred photographs takes minutes to make on a small server, and a single request that long is cut off by the
 * hosting front end (Azure App Service ends a request after about 230 seconds) or given up on by the browser. So the web app asks for a
 * report to be made (a job), shows "Preparing report…" while asking every few seconds how it is going, and downloads the finished file,
 * which is then a quick request.
 *
 * Jobs live in this server process and the finished files in its temporary folder, kept for FILE_TTL_MS. That suits one running server
 * (the App Service plan has one instance): with several, a status request could reach a server that does not have the job, and the web
 * app then says the report was lost and to try again. A restart loses running jobs the same way.
 *
 * The same report asked for again while it is still being made (a double click, or two people) joins that job rather than starting a
 * second browser. A finished job is not reused for a new request: the reviewer may have changed the report since.
 */

export type ReportFormat = 'pdf' | 'docx';
export type ReportJobState = 'waiting' | 'opening' | 'photos' | 'printing' | 'done' | 'failed';

export interface ReportJob {
  id: string;
  inspectionId: string;
  format: ReportFormat;
  /** Who asked first (the job is shown to anyone who may open the inspection). */
  userId: string;
  state: ReportJobState;
  createdAt: number;
  finishedAt?: number;
  fileName: string;
  /** The finished file on disk, its size and checksum. */
  path?: string;
  bytes?: number;
  sha256?: string;
  error?: { message: string; code: string; status: number };
  /** Photographs loaded so far, while the report page opens. */
  photos?: ReportPhotoLog;
  /** Anything the caller wants back with the finished file (the audit details). */
  meta: Record<string, unknown>;
}

/** How long a finished file (or a failed job) is kept for the download, in ms. */
export const FILE_TTL_MS = Math.max(60_000, Number(process.env.REPORT_FILE_TTL_MS ?? 30 * 60_000));
/** Jobs kept at most (finished ones are dropped oldest first beyond this). */
const MAX_JOBS = 200;
const DIR = join(tmpdir(), 'acespect-reports');

const jobs = new Map<string, ReportJob>();

function ensureDir(): void {
  mkdirSync(DIR, { recursive: true });
}

/** Removes finished jobs and files past their time (and files left by an earlier run of the server). */
export function sweepReportJobs(now = Date.now()): void {
  for (const [id, job] of jobs) {
    const done = job.state === 'done' || job.state === 'failed';
    if (done && now - (job.finishedAt ?? job.createdAt) > FILE_TTL_MS) dropJob(id);
  }
  try {
    for (const name of readdirSync(DIR)) {
      const p = join(DIR, name);
      const owned = [...jobs.values()].some((j) => j.path === p);
      if (!owned && now - statSync(p).mtimeMs > FILE_TTL_MS) rmSync(p, { force: true });
    }
  } catch {
    /* the folder does not exist yet */
  }
}

function dropJob(id: string): void {
  const job = jobs.get(id);
  if (job?.path) rmSync(job.path, { force: true });
  jobs.delete(id);
}

const sweeper = setInterval(() => sweepReportJobs(), 5 * 60_000);
sweeper.unref();

/** What the web app is shown about a job. */
export function jobStatus(job: ReportJob) {
  const st = job.photos?.stats();
  return {
    id: job.id,
    inspectionId: job.inspectionId,
    format: job.format,
    state: job.state,
    fileName: job.fileName,
    createdAt: new Date(job.createdAt).toISOString(),
    elapsedSeconds: Math.round(((job.finishedAt ?? Date.now()) - job.createdAt) / 1000),
    photos: st ? { requested: st.requested, loaded: st.loaded } : undefined,
    bytes: job.bytes,
    error: job.error ? { message: job.error.message, code: job.error.code } : undefined,
  };
}

export type MakeReport = (onStage: (stage: ReportStage, photos?: ReportPhotoLog) => void) => Promise<Buffer>;

/**
 * Starts making a report in the background, or joins the one already being made for the same inspection and format. Returns at once.
 * `make` does the work (generateInspectionReportPdf / Docx); it is told each stage as the report gets there.
 */
export function startReportJob(input: {
  inspectionId: string;
  format: ReportFormat;
  userId: string;
  fileName: string;
  meta?: Record<string, unknown>;
  make: MakeReport;
}): { job: ReportJob; joined: boolean } {
  for (const job of jobs.values()) {
    if (job.inspectionId === input.inspectionId && job.format === input.format && job.state !== 'done' && job.state !== 'failed') {
      return { job, joined: true };
    }
  }
  sweepReportJobs();
  if (jobs.size >= MAX_JOBS) {
    const oldestFinished = [...jobs.values()].filter((j) => j.state === 'done' || j.state === 'failed').sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldestFinished) dropJob(oldestFinished.id);
    else throw new ApiError(503, 'Too many reports are being prepared right now. Please try again in a minute.', 'REPORT_BUSY');
  }
  const job: ReportJob = {
    id: randomUUID(),
    inspectionId: input.inspectionId,
    format: input.format,
    userId: input.userId,
    state: 'opening', // 'waiting' only once it is known to be queued behind other reports (reportPdf.ts)
    createdAt: Date.now(),
    fileName: input.fileName,
    meta: input.meta ?? {},
  };
  jobs.set(job.id, job);
  void input
    .make((stage, photos) => {
      job.state = stage;
      if (photos) job.photos = photos;
    })
    .then((file) => {
      ensureDir();
      const path = join(DIR, `${job.id}.${job.format}`);
      writeFileSync(path, file);
      job.path = path;
      job.bytes = file.length;
      job.sha256 = createHash('sha256').update(file).digest('hex');
      job.state = 'done';
      job.finishedAt = Date.now();
    })
    .catch((e: unknown) => {
      const api = e instanceof ApiError ? e : null;
      if (!api) console.error(`[report] ${job.format} job ${job.id} for inspection ${job.inspectionId} failed:`, e);
      job.error = {
        message: api?.message ?? (e instanceof Error ? `The report could not be made. Reason: ${e.message.split('\n')[0]}` : 'The report could not be made.'),
        code: api?.code ?? 'REPORT_FAILED',
        status: api?.statusCode ?? 502,
      };
      job.state = 'failed';
      job.finishedAt = Date.now();
    });
  return { job, joined: false };
}

/** The job, if this server has it and it belongs to that inspection. */
export function getReportJob(inspectionId: string, jobId: string): ReportJob | undefined {
  const job = jobs.get(jobId);
  return job && job.inspectionId === inspectionId ? job : undefined;
}

/** For tests: forget every job and file. */
export function clearReportJobs(): void {
  for (const id of [...jobs.keys()]) dropJob(id);
}

/** For tests: the folder finished files are written to. */
export const REPORT_JOB_DIR = DIR;

/** For tests: a leftover file with the given age. */
export function writeTestFile(name: string, mtime: number): string {
  ensureDir();
  const p = join(DIR, name);
  writeFileSync(p, 'x');
  utimesSync(p, mtime / 1000, mtime / 1000);
  return p;
}
