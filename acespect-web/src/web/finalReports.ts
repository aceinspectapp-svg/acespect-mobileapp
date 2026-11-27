import { API_BASE, ensureSession, fetchWithRefresh, getToken } from "./api";

/**
 * Final Report Versions: Word reports staff edited by hand and uploaded, kept per inspection as versions (ADMIN and REVIEWER only; the
 * server refuses every other role). Version 0 is the live report the system generates -- it is never stored, and its download is the
 * report page's existing Download Word button.
 */

export interface FinalVersion {
  id: string;
  versionNumber: number;
  fileName: string;
  sizeBytes: number;
  note: string | null;
  uploadedAt: string;
  uploadedBy: { id: string; name: string | null; email: string };
  /** The latest uploaded version: "Current final". */
  current: boolean;
}

export const MAX_FINAL_REPORT_BYTES = 50 * 1024 * 1024;

/** Only admins and reviewers see the section (the web app maps every other role to "inspector"). */
export const canSeeFinalVersions = (role: string | null | undefined): boolean => role === "admin" || role === "reviewer";

/** "Save as a new version?" is asked only once something has been uploaded: the first upload is always Version 1. */
export const asksNewVersion = (versions: readonly FinalVersion[]): boolean => versions.length > 0;

export const latestVersionNumber = (versions: readonly FinalVersion[]): number => versions.reduce((n, v) => Math.max(n, v.versionNumber), 0);

/** The browser's own check before sending (the server checks the content again). Null when the file may be uploaded. */
export function fileProblem(file: { name: string; size: number }): string | null {
  if (!/\.docx$/i.test(file.name.trim())) return "Only Word (.docx) files can be uploaded.";
  if (file.size > MAX_FINAL_REPORT_BYTES) return "That file is larger than 50 MB. Final reports can be at most 50 MB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Date and time in Melbourne, whatever the viewer's own time zone: "27 Nov 2026, 3:05 pm AEDT". */
export function formatMelbourne(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short",
  }).format(new Date(iso));
}

const base = (inspectionId: string) => `${API_BASE}/inspections/${encodeURIComponent(inspectionId)}/final-versions`;
const headers = (): Record<string, string> => {
  const token = getToken();
  return { "X-App-Client": "web", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
};

async function failure(res: Response): Promise<Error & { status?: number; code?: string }> {
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const body = await res.json();
    message = body?.error?.message ?? message;
    code = body?.error?.code;
  } catch { /* not JSON */ }
  return Object.assign(new Error(message), { status: res.status, code });
}

export interface FinalVersionList {
  latestVersion: number;
  /** At least one uploaded version: the generated report is locked (no role can make or download it). */
  locked: boolean;
  /** The inspection has no job number: files are saved under final-reports/_Unassigned/<inspectionId>/. */
  unassigned: boolean;
  versions: FinalVersion[];
}

export async function listFinalVersions(inspectionId: string): Promise<FinalVersionList> {
  const res = await fetchWithRefresh(base(inspectionId), { headers: headers() });
  if (!res.ok) throw await failure(res);
  return res.json();
}

export interface UploadRequest {
  file: File;
  note: string;
  /** Undefined for the first upload; otherwise the answer to "Save as a new version?" (Yes = new, No = replace). */
  mode?: "new" | "replace";
  /** The latest version number shown when the file was chosen. */
  basedOn: number;
}

/**
 * One multipart upload, as photos are sent, with its progress reported (XMLHttpRequest: fetch cannot report upload progress). The login
 * is renewed first so a long upload does not start with one about to expire.
 */
export async function uploadFinalVersion(inspectionId: string, r: UploadRequest, onProgress: (fraction: number) => void, xhrFactory: () => XMLHttpRequest = () => new XMLHttpRequest()): Promise<FinalVersion> {
  await ensureSession({ minValidMs: 10 * 60_000, redirect: false });
  const form = new FormData();
  if (r.note.trim()) form.append("note", r.note.trim());
  if (r.mode) form.append("mode", r.mode);
  form.append("basedOn", String(r.basedOn));
  form.append("file", r.file, r.file.name);
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open("POST", base(inspectionId));
    for (const [k, v] of Object.entries(headers())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new Error("The upload failed: the connection was lost. Try again."));
    xhr.ontimeout = () => reject(new Error("The upload took too long. Try again."));
    xhr.onload = () => {
      let body: { version?: FinalVersion; error?: { message?: string; code?: string } } | null = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && body?.version) return resolve(body.version);
      reject(Object.assign(new Error(body?.error?.message ?? `Upload failed (HTTP ${xhr.status})`), { status: xhr.status, code: body?.error?.code }));
    };
    xhr.send(form);
  });
}

/** Soft delete (ADMIN only; the server refuses everyone else). The file is kept; the version is hidden and its number never reused. */
export async function deleteFinalVersion(inspectionId: string, versionId: string): Promise<{ remaining: number }> {
  const res = await fetchWithRefresh(`${base(inspectionId)}/${encodeURIComponent(versionId)}`, { method: "DELETE", headers: headers() });
  if (!res.ok) throw await failure(res);
  return res.json();
}

/** Whether the generated report is locked (for anyone who may open the inspection). */
export async function getReportLock(inspectionId: string): Promise<boolean> {
  const res = await fetchWithRefresh(`${API_BASE}/inspections/${encodeURIComponent(inspectionId)}/report-lock`, { headers: headers() });
  if (!res.ok) throw await failure(res);
  return !!(await res.json()).locked;
}

/** The server's words when the report is locked (also on its 423 answers). */
export const REPORT_LOCKED_MESSAGE = "A final report has been uploaded for this inspection. Download it from Final Report Versions.";

/** Only an admin may delete a version (the server refuses everyone else). */
export const canDeleteFinalVersions = (role: string | null | undefined): boolean => role === "admin";

/** Collapsed: only the Current final row (Version 0 is always shown). Expanded: every uploaded version, newest first. */
export const visibleVersions = (versions: readonly FinalVersion[], expanded: boolean): FinalVersion[] =>
  expanded ? [...versions] : versions.filter((v) => v.current);

/** How many uploaded versions the toggle reveals, and its words. Null when there is nothing more to show. */
export function toggleLabel(versions: readonly FinalVersion[], expanded: boolean): string | null {
  const more = versions.filter((v) => !v.current).length;
  if (more === 0) return null;
  return expanded ? "Hide older versions" : `Show all versions (${versions.length})`;
}

/** Downloads one uploaded version through the API (signed in; the server checks the role) and saves it under its file name. */
export async function downloadFinalVersion(inspectionId: string, v: Pick<FinalVersion, "id" | "fileName">): Promise<void> {
  const res = await fetchWithRefresh(`${base(inspectionId)}/${encodeURIComponent(v.id)}/file`, { headers: headers() });
  if (!res.ok) throw await failure(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = v.fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
