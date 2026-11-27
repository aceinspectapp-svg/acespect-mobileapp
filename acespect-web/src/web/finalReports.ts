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

export async function listFinalVersions(inspectionId: string): Promise<{ latestVersion: number; versions: FinalVersion[] }> {
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
