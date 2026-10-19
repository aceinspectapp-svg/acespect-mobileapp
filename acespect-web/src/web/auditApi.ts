import { API_BASE, fetchWithRefresh, getToken, req } from "./api";

/** One audit entry as the server sends it (see acespect-backend/src/modules/audit/audit.service.ts, `present`). */
export interface AuditEvent {
  id: string;
  seq: string;
  occurredAt: string;
  clientTime: string | null;
  clientSkewMs: number | null;
  category: "mobile" | "web" | "admin" | "system" | "security" | "qc";
  action: string;
  outcome: "success" | "failure" | "denied";
  severity: "info" | "notice" | "warning" | "error";
  actor: { id: string | null; name: string | null; role: string | null; type: string };
  source: "mobile" | "web" | "api" | "system";
  client: { app: string | null; version: string | null; updateId: string | null; platform: string | null; os: string | null; device: string | null };
  ip: string | null;
  userAgent: string | null;
  target: { type: string | null; id: string | null; label: string | null };
  inspectionId: string | null;
  jobNo: string | null;
  correlationId: string | null;
  requestId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  integrity: { stream: string; prevHash: string | null; hash: string };
}

export type AuditFilters = Partial<Record<
  "from" | "to" | "category" | "action" | "outcome" | "severity" | "source" | "actorId" | "inspectionId" | "jobNo" | "appVersion" | "ip" | "correlationId" | "q",
  string
>>;

export interface VerifyResult {
  ok: boolean;
  eventsChecked: number;
  streams: number;
  anchorsChecked: number;
  unsealedEvents: number;
  problems: { kind: "hash" | "link" | "anchor"; id?: string; seq?: string; detail: string }[];
  verifiedAt: string;
  headHash: string | null;
}

export interface AuditHealth {
  totalEvents: number;
  eventsLast24h: number;
  problemsLast24h: number;
  lastEventAt: string | null;
  lastAnchor: { at: string; upToSeq: string; events: number } | null;
  writer: { written: number; failed: number; lastError: string | null; lastFailureAt: string | null };
  retentionDays: number;
}

export interface AuditTimeline {
  inspection: { id: string; jobNo: string | null; inspectorId: string; reviewerId: string | null; status: string; address: string | null; client: string | null; inspectionType: string; createdAt: string; submittedAt: string | null } | null;
  events: AuditEvent[];
  truncated: boolean;
}

const qs = (o: Record<string, string | number | undefined | null>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

export const auditApi = {
  events: (f: AuditFilters, cursor?: string | null, limit = 100) =>
    req<{ events: AuditEvent[]; nextCursor: string | null }>(`/audit/events?${qs({ ...f, cursor, limit })}`),
  timeline: (inspectionId: string) => req<AuditTimeline>(`/audit/inspections/${inspectionId}/timeline`),
  facets: () =>
    req<{
      categories: { value: string; count: number }[];
      actions: { value: string; count: number }[];
      appVersions: { value: string | null; count: number }[];
      actors: { id: string | null; name: string | null; count: number }[];
    }>(`/audit/facets`),
  verify: (inspectionId?: string) => req<VerifyResult>(`/audit/verify${inspectionId ? `?inspectionId=${encodeURIComponent(inspectionId)}` : ""}`),
  health: () => req<AuditHealth>(`/audit/health`),
};

/** Downloads a file from the audit endpoints (report or export) and saves it; returns the file's SHA-256 as the server reported it. */
export async function downloadAuditFile(path: string, fallbackName: string): Promise<{ name: string; sha256: string | null }> {
  const token = getToken();
  const res = await fetchWithRefresh(`${API_BASE}${path}`, { headers: { "X-App-Client": "web", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message; } catch { /* keep the status */ }
    throw new Error(message);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? fallbackName;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { name, sha256: res.headers.get("x-content-sha256") };
}

// ───────────────────────── how an entry reads ─────────────────────────

const LABELS: Record<string, string> = {
  "inspection.create": "Inspection started on the phone",
  "inspection.submit": "Inspection submitted from the phone",
  "inspection.submit.repeat": "Submit repeated (already received)",
  "inspection.submit.refused": "Submit refused by the server",
  "inspection.finalize": "Sent for review",
  "inspection.edit": "Inspection details edited",
  "inspection.view": "Inspection opened",
  "inspection.job_number_set": "Job number set",
  "inspection.status_change": "Status changed",
  "inspection.assign_reviewer": "Reviewer assigned",
  "inspection.assign_post_dilapidation": "Post-dilapidation job assigned",
  "inspections.list": "Inspection list opened",
  "section.sync": "Section saved from the phone",
  "section.approve": "Section approved",
  "section.request_revision": "Revision requested",
  "section.reset_review": "Review reset",
  "section.approve_all": "All sections approved",
  "section.edit": "Section edited",
  "damage.edit": "Defect record edited",
  "photos.upload": "Photos uploaded",
  "photos.download": "Photos downloaded",
  "report.download": "Report downloaded",
  "egnyte.recheck": "Egnyte folder re-checked",
  "review.decision": "Review decision recorded",
  "user.update": "User profile changed",
  "template.create": "Template created",
  "template.update": "Template edited",
  "template.publish": "Template published",
  "template.accept_updates": "Template updates accepted on the phone",
  "admin.mail_test": "Test email sent",
  "admin.troubleshoot.view": "Troubleshoot page opened",
  "audit.view": "Audit log opened",
  "audit.timeline.view": "Inspection history opened",
  "audit.verify": "Integrity check run",
  "audit.export": "Audit export downloaded",
  "audit.report": "Audit report generated",
  "audit.purge": "Old entries removed (retention)",
  "api.change": "Change made",
  "request.rejected": "Request refused",
  "request.failed": "Request failed on the server",
  "app.start": "App opened",
  "app.background": "App moved to the background",
  "app.foreground": "App came back to the front",
  "app.step": "Phone note",
  "app.problem": "Phone problem",
  "network.offline": "Phone lost its connection",
  "network.online": "Phone reconnected",
  "photo.captured": "Photos taken on the phone",
  "photo.backup.complete": "All photos backed up",
  "photo.backup.waiting": "Photo backup waiting",
  "photo.upload_failed": "A photo could not be sent",
  "photo.skipped": "A photo was left out",
  "sync.failed": "Saving to the server failed",
  "sync.recovered": "Saving to the server recovered",
  "submit.pressed": "Submit pressed on the phone",
  "submit.queued": "Submit kept on the phone to retry",
  "submit.failed": "Submit failed on the phone",
  "submit.stopped": "Submit stopped (nothing to send)",
  "submit.delivered": "Phone confirmed delivery",
  "submit.photos_skipped": "Photos left out of the submit",
  "submit.photos_resent": "Missing photos sent again",
  "queue.retry_failed": "Queued inspection retry failed",
  "queue.delivered": "Queued inspection delivered",
  "queue.dropped": "Queued leftover dropped",
  "draft.resumed": "Unfinished inspection reopened",
  "security.login_ok": "Signed in",
  "security.login_failed": "Sign-in failed",
  "security.lockout": "Account locked after failed sign-ins",
  "security.password_changed": "Password changed",
  "security.password_reset": "Password reset",
  "security.session_revoked": "Session ended",
  "security.forbidden": "Access refused",
  "security.report_download": "Report downloaded",
  "security.file_access": "File opened",
};

export function labelOf(e: Pick<AuditEvent, "action">): string {
  if (LABELS[e.action]) return LABELS[e.action]!;
  if (e.action.startsWith("legacy.")) return `Earlier record: ${e.action.slice(7).replace(/_/g, " ")}`;
  if (e.action.startsWith("qc.")) return `QC: ${e.action.slice(3).replace(/[._]/g, " ")}`;
  const t = e.action.replace(/[._]/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export const CATEGORY_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  mobile: { label: "Phone", color: "#0369a1", bg: "#e0f2fe" },
  web: { label: "Portal", color: "#4338ca", bg: "#e0e7ff" },
  admin: { label: "Admin", color: "#7c3aed", bg: "#f3e8ff" },
  security: { label: "Security", color: "#b45309", bg: "#fef3c7" },
  system: { label: "System", color: "#475569", bg: "#f1f5f9" },
  qc: { label: "QC", color: "#047857", bg: "#d1fae5" },
};

export const OUTCOME_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  success: { label: "OK", color: "#15803d", bg: "#dcfce7" },
  failure: { label: "Failed", color: "#b91c1c", bg: "#fee2e2" },
  denied: { label: "Refused", color: "#b45309", bg: "#fef3c7" },
};

export function dotColor(e: Pick<AuditEvent, "outcome" | "severity">): string {
  if (e.outcome === "failure" || e.severity === "error") return "#dc2626";
  if (e.outcome === "denied" || e.severity === "warning") return "#d97706";
  if (e.severity === "notice") return "#2563eb";
  return "#16a34a";
}

export function when(iso: string, withSeconds = true): string {
  return new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) });
}
