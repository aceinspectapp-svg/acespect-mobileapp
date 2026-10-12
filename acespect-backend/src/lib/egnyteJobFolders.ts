/**
 * Where an inspection's photos live in Egnyte: {root}/{batch}/{job folder}/{section}/...
 *
 * The office keeps one "batch" folder per block of job numbers, and each inspection's folder inside it, named by its job
 * number with a plain "V" prefix (the app's "VIC-" prefix is not used in Egnyte):
 *
 *   1-Jobs_Zeus / V260101-V260200 / V260105 / pp_description / street / ....jpg
 *
 * The rules (kept free of Egnyte calls, so they can be checked on their own -- see scripts/check-egnyte-folders.ts):
 *  - The JOB NUMBER decides the batch. The folder count is only a check: a batch that looks full never pushes an inspection
 *    into another batch, it is flagged for the office instead.
 *  - Existing batches are read from Egnyte and their ranges taken from their names (older batches are not all 100 wide), so
 *    an inspection always goes into the batch that already covers its number. A new batch of 100 is made only when none does.
 *  - A job number that does not look like one is never guessed at: its photos wait in {root}/_Unassigned/{draft id} and the
 *    inspection is flagged.
 */

export type JobNumber =
  | { ok: true; /** "V260105" */ folder: string; digits: string; /** 260105 */ n: number; year: number; /** 105 for a 6-digit number, else null */ seq: number | null }
  | { ok: false; reason: string };

/** "VIC-260105", "vic260105", "V 260105" and "V260105" are all the job V260105. Anything else is not a job number. */
export function normalizeJobNumber(raw: string | null | undefined): JobNumber {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, reason: 'No job number was entered.' };
  const m = /^(?:VIC|V)[\s\-_.]*(\d{5,7})$/i.exec(text);
  if (!m) return { ok: false, reason: `"${text}" is not a job number (expected V or VIC followed by 5 to 7 digits, e.g. VIC-260105).` };
  const digits = m[1]!;
  return { ok: true, folder: `V${digits}`, digits, n: Number(digits), year: Number(digits.slice(0, 2)), seq: digits.length === 6 ? Number(digits.slice(2)) : null };
}

export interface Batch { name: string; start: number; end: number }

/** "V260001-V260100" (or "V260001-260100") -> its range. Null for any other folder name. */
export function parseBatchName(name: string): Batch | null {
  const m = /^V(\d{5,7})-V?(\d{5,7})$/i.exec(name.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return start <= end ? { name, start, end } : null;
}

const pad4 = (n: number) => String(n).padStart(4, '0');

/** The standard 100-wide batch a 6-digit job number belongs in, e.g. V260105 -> V260101-V260200. Null for any other format. */
export function standardBatchFor(job: Extract<JobNumber, { ok: true }>): Batch | null {
  if (job.seq === null || job.seq < 1) return null;
  const first = Math.floor((job.seq - 1) / 100) * 100 + 1;
  const last = Math.min(first + 99, 9999);
  const yy = String(job.year).padStart(2, '0');
  return { name: `V${yy}${pad4(first)}-V${yy}${pad4(last)}`, start: Number(`${yy}${pad4(first)}`), end: Number(`${yy}${pad4(last)}`) };
}

/** The existing batches that cover a job number (normally one; the narrowest wins if names overlap). */
export function batchesCovering(batches: Batch[], n: number): Batch[] {
  return batches.filter((b) => n >= b.start && n <= b.end).sort((a, b) => a.end - a.start - (b.end - b.start));
}

export const overlaps = (a: Batch, b: Batch) => a.start <= b.end && b.start <= a.end;

// ───────────────────────── Allocation ─────────────────────────

export interface EgnyteFolderListing { folders: string[]; files: string[] }

/** What the rules need from Egnyte. `list` returns null when the folder does not exist; `createFolder` must treat "already exists" as success. */
export interface EgnyteFs {
  list(path: string): Promise<EgnyteFolderListing | null>;
  createFolder(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  deleteFolder(path: string): Promise<void>;
}

export type FolderStatus = 'ok' | 'needs_review' | 'unassigned';

export interface Resolution {
  status: FolderStatus;
  /** Full Egnyte path of the inspection folder (or the _Unassigned staging folder). */
  path: string;
  /** What the office should look at, when status is not "ok". */
  message?: string;
  jobFolder?: string;
  batch?: string;
}

const safeSegment = (raw: string) => raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const UNASSIGNED_FOLDER = '_Unassigned';

export interface ResolveOptions {
  /** The app's draft id, so photos that cannot be placed yet wait in their own folder. */
  draftId?: string;
  /** Runs `fn` with only one caller at a time per key (in this process and, in production, across instances). */
  lock?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;
  /** Make the inspection folder itself (default). Off when an existing staging folder is about to be moved into its place. */
  createJobFolder?: boolean;
}

const noLock = <T>(_key: string, fn: () => Promise<T>) => fn();

/**
 * Find (and create, where missing) the Egnyte folder for one job number. Idempotent: the same job number always resolves to
 * the same place. Throws only when Egnyte itself fails, so the caller can retry; every "this looks wrong" case is a
 * Resolution with status "needs_review" or "unassigned" instead.
 */
export async function resolveInspectionFolder(fs: EgnyteFs, root: string, rawJobNo: string | null | undefined, opts: ResolveOptions = {}): Promise<Resolution> {
  const lock = opts.lock ?? noLock;
  const unassigned = (message: string): Resolution => ({ status: 'unassigned', path: `${root}/${UNASSIGNED_FOLDER}/${safeSegment(opts.draftId || 'no-draft')}`, message });

  const job = normalizeJobNumber(rawJobNo);
  if (!job.ok) return unassigned(job.reason);

  const rootListing = await fs.list(root);
  if (!rootListing) throw new Error(`Egnyte root folder ${root} does not exist`);
  const batches = rootListing.folders.map(parseBatchName).filter((b): b is Batch => !!b);
  const warnings: string[] = [];

  let batch: Batch | undefined;
  const covering = batchesCovering(batches, job.n);
  if (covering.length > 1) warnings.push(`Batch folders ${covering.map((b) => b.name).join(' and ')} overlap and both cover ${job.folder}; used ${covering[0]!.name}.`);
  batch = covering[0];

  if (!batch) {
    const standard = standardBatchFor(job);
    if (!standard) return unassigned(`No batch folder covers ${job.folder}, and only 6-digit job numbers (year + 4-digit number) can start a new batch.`);
    const clash = batches.find((b) => overlaps(b, standard));
    if (clash) return unassigned(`A new batch ${standard.name} for ${job.folder} would overlap the existing batch ${clash.name}. Fix the batch names first.`);
    await lock(`egnyte-batch:${standard.name}`, async () => {
      // Another request may have created it while this one waited.
      const again = await fs.list(root);
      if (!again?.folders.some((f) => sameName(f, standard.name))) await fs.createFolder(`${root}/${standard.name}`);
    });
    batch = standard;
  }

  const batchPath = `${root}/${batch.name}`;
  const jobPath = `${batchPath}/${job.folder}`;
  const inBatch = (await fs.list(batchPath)) ?? { folders: [], files: [] };
  const exists = inBatch.folders.some((f) => sameName(f, job.folder));

  // Capacity counts inspection folders only -- never images or stray files.
  const capacity = batch.end - batch.start + 1;
  if (!exists && inBatch.folders.length >= capacity) {
    warnings.push(`Batch ${batch.name} already holds ${inBatch.folders.length} folders (room for ${capacity}); ${job.folder} was still stored in it because its number belongs there.`);
  }
  if (rootListing.folders.some((f) => sameName(f, job.folder))) {
    warnings.push(`A folder named ${job.folder} also exists directly under the root; the photos go in ${batch.name}.`);
  }

  if (!exists && opts.createJobFolder !== false) {
    await lock(`egnyte-job:${job.folder}`, async () => {
      const again = await fs.list(batchPath);
      if (!again?.folders.some((f) => sameName(f, job.folder))) await fs.createFolder(jobPath);
    });
  }

  return { status: warnings.length ? 'needs_review' : 'ok', path: jobPath, message: warnings.join(' ') || undefined, jobFolder: job.folder, batch: batch.name };
}

/**
 * Move everything under `from` into `to`, merging folders that already exist on both sides, then remove `from`. Used when
 * photos were first stored somewhere temporary (the draft's own folder, or _Unassigned) and the job's real folder is known.
 */
export async function mergeFolder(fs: EgnyteFs, from: string, to: string): Promise<void> {
  const src = await fs.list(from);
  if (!src) return; // nothing was stored there
  const dst = await fs.list(to);
  if (!dst) {
    await fs.move(from, to); // the job's folder does not exist yet: one move does it all
    return;
  }
  for (const f of src.files) await fs.move(`${from}/${f}`, `${to}/${f}`);
  for (const d of src.folders) {
    if (dst.folders.some((x) => sameName(x, d))) await mergeFolder(fs, `${from}/${d}`, `${to}/${d}`);
    else await fs.move(`${from}/${d}`, `${to}/${d}`);
  }
  await fs.deleteFolder(from);
}
