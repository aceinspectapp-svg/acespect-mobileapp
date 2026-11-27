import { readFile } from 'fs/promises';
import JSZip from 'jszip';
import { ApiError } from '../../utils/ApiError';

/**
 * Final Report Versions: the rules, kept free of the database and storage so they can be tested on their own.
 *
 * Version 0 is the report the system makes from the inspection data (the existing report-jobs download); it is never stored. Versions 1, 2,
 * 3 ... are Word files staff edited by hand and uploaded. The first upload is always Version 1. A later upload is either a new version (the
 * next number) or replaces the latest uploaded version (same number; the replaced file is kept in storage, marked replaced, and hidden).
 */

/** Only these roles see or use Final Report Versions. Every other role is refused by the routes (403). */
export const FINAL_REPORT_ROLES = ['ADMIN', 'REVIEWER'] as const;

export const MAX_FINAL_REPORT_BYTES = 50 * 1024 * 1024;
export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_NOTE_LENGTH = 1000;

/** "new" = save as the next version number; "replace" = replace the latest uploaded version. */
export type UploadMode = 'new' | 'replace';

export interface CurrentVersion {
  id: string;
  versionNumber: number;
}

export type UploadPlan =
  | { kind: 'first'; versionNumber: 1 }
  | { kind: 'new'; versionNumber: number }
  | { kind: 'replace'; versionNumber: number; replaces: CurrentVersion };

/** The latest uploaded version (not replaced), or null when nothing has been uploaded yet. */
export function latestOf(current: CurrentVersion[]): CurrentVersion | null {
  return current.reduce<CurrentVersion | null>((best, v) => (!best || v.versionNumber > best.versionNumber ? v : best), null);
}

export function parseMode(raw: unknown): UploadMode | undefined {
  return raw === 'new' || raw === 'replace' ? raw : undefined;
}

/** The latest version number the person saw when they chose the file (0 = none), so a replace can never hit a version they did not see. */
export function parseBasedOn(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

/**
 * What an upload does, given the versions listed now (replaced and deleted rows excluded) and the highest version number this inspection has
 * ever used (deleted and replaced rows included -- a number is never used twice).
 *  - nothing listed: no question; the next unused number (Version 1 for an inspection's very first upload).
 *  - otherwise the person must have answered "Save as a new version?": Yes -> the next unused number, No -> replace the latest listed one.
 *  - `basedOn` must match the latest listed version now, so an upload never lands on a version someone else added in the meantime.
 */
export function planUpload(current: CurrentVersion[], mode: UploadMode | undefined, basedOn: number | undefined, highestEver = 0): UploadPlan {
  if (Number.isNaN(basedOn)) throw ApiError.badRequest('basedOn must be a whole number');
  const latest = latestOf(current);
  const latestNumber = latest?.versionNumber ?? 0;
  const next = Math.max(highestEver, latestNumber) + 1;
  if (basedOn !== undefined && basedOn !== latestNumber) {
    throw new ApiError(409, 'The versions changed while you were uploading. Reload the list and upload again.', 'VERSIONS_CHANGED');
  }
  if (!latest) return next === 1 ? { kind: 'first', versionNumber: 1 } : { kind: 'new', versionNumber: next };
  if (!mode) throw new ApiError(409, 'Choose whether to save this as a new version or replace the latest one.', 'VERSION_CHOICE_REQUIRED');
  if (mode === 'new') return { kind: 'new', versionNumber: next };
  return { kind: 'replace', versionNumber: latest.versionNumber, replaces: latest };
}

/** The same decision, in a form that can be compared before and after the file is stored. */
export const samePlan = (a: UploadPlan, b: UploadPlan): boolean =>
  a.kind === b.kind && a.versionNumber === b.versionNumber && (a.kind !== 'replace' || (b.kind === 'replace' && a.replaces.id === b.replaces.id));

/** A job number as a folder name: trimmed, upper-case, only letters, digits and "-" (anything else becomes "-"). Empty when there is none. */
export function jobFolder(jobNo: string | null | undefined): string {
  return (jobNo ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '-');
}

/**
 * The inspection type for the file name, so a Pre- and a Post-Dilapidation with the same job number stay apart. A Post-Dilapidation job is a
 * Dilapidation inspection with a baseline (see the Inspection model). "pre_purchase" -> "Pre-Purchase", "Construction Stage" -> "Construction-Stage".
 */
export function inspectionTypeLabel(inspectionType: string | null | undefined, hasBaseline: boolean): string {
  const words = (inspectionType ?? '').trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.join('-') === 'dilapidation' || words.join('-') === 'pre-dilapidation') return hasBaseline ? 'Post-Dilapidation' : 'Pre-Dilapidation';
  if (words.join('-') === 'post-dilapidation') return 'Post-Dilapidation';
  const label = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
  return label || 'Inspection';
}

export interface PathInspection {
  id: string;
  jobNo: string | null;
  inspectionType: string | null;
  hasBaseline: boolean;
}

/**
 * Where a version's file goes, for people browsing the storage (the database links versions by inspection id, not by this path):
 *   final-reports/<JOB NUMBER>/<Inspection-Type>-v<n>-<uploadId>.docx
 *   final-reports/_Unassigned/<inspectionId>/<Inspection-Type>-v<n>-<uploadId>.docx   (no job number)
 */
export function finalReportPath(inspection: PathInspection, versionNumber: number, uploadId: string): string {
  const job = jobFolder(inspection.jobNo).replace(/^-+|-+$/g, '');
  const folder = job ? job : `_Unassigned/${inspection.id}`;
  return `final-reports/${folder}/${inspectionTypeLabel(inspection.inspectionType, inspection.hasBaseline)}-v${versionNumber}-${uploadId}.docx`;
}

/** The file name as shown and as saved on download: no path, no control characters, at most 200 characters, always ending .docx. */
export function cleanFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  const stem = base.replace(/\.docx$/i, '').slice(0, 195) || 'report';
  return `${stem}.docx`;
}

/** A note typed at upload ("Changes made"), trimmed; null when empty. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.length > MAX_NOTE_LENGTH) throw ApiError.badRequest(`The note can be at most ${MAX_NOTE_LENGTH} characters.`);
  return t;
}

const notDocx = () => new ApiError(415, 'Only Word (.docx) files can be uploaded. This file is not a .docx Word document.', 'NOT_DOCX');

/**
 * Checks the upload really is a Word .docx: the name ends .docx, and the content is a zip package whose [Content_Types].xml declares a Word
 * document (not a macro-enabled .docm or a template) with its word/document.xml part. A renamed PDF, image or .doc fails.
 */
export async function assertDocx(filePath: string, originalName: string, size: number): Promise<void> {
  if (!/\.docx$/i.test(originalName.trim())) throw notDocx();
  if (size > MAX_FINAL_REPORT_BYTES) throw tooLarge();
  if (size < 4) throw notDocx();
  const bytes = await readFile(filePath);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) throw notDocx();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw notDocx();
  }
  const types = await zip.file('[Content_Types].xml')?.async('string');
  if (!types || !types.includes(`${DOCX_CONTENT_TYPE}.main+xml`) || !zip.file('word/document.xml')) throw notDocx();
}

export const tooLarge = () => new ApiError(413, 'That file is larger than 50 MB. Final reports can be at most 50 MB.', 'FILE_TOO_LARGE');
