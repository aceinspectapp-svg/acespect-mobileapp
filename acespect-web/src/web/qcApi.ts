/** API calls for the platform layer: context, SLA, templates, inspections, reports, notifications, audit and privacy. */
import { req, reqForm, API_BASE, getToken, getActiveClientId } from "./api";

export type Json = Record<string, any>;
const j = (body: unknown) => JSON.stringify(body ?? {});
const qs = (o: Record<string, unknown> = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};
const form = (fields: Record<string, unknown>, files: File[] = [], name = "files") => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) f.append(k, typeof v === "string" ? v : JSON.stringify(v));
  for (const file of files) f.append(name, file);
  return f;
};

export interface QcMe {
  userId: string;
  role: string;
  isSA: boolean;
  legacy: boolean;
  clientId: string | null;
  clients: Array<{ id: string; name: string; role: string }>;
  projectIds: string[] | "all";
  permissions: string[];
  capabilities: string[];
}

export interface Duration { value: number; unit: "hours" | "business_days" | "calendar_days" }
export interface SlaRule { acknowledge: Duration | null; rectifyFrom: Duration | null; rectifyTo: Duration | null; orByNextStage: boolean; reinspect: Duration | null; reviewAtNextStage: boolean; effectiveFrom: string }
export interface SlaView { effective: Record<string, SlaRule>; source: Record<string, "default" | "client" | "project">; clientDefault: Record<string, SlaRule> }
export interface EscalationLevel { level: number; name: string; trigger: string; waitDays: number | null; failedCount: number | null; action: string; notifyRoles: string[]; extraEmails: string }
export interface ProjectPolicy {
  levels: EscalationLevel[]; closurePolicy: string; evidenceOnlyFor: string[]; autoReleaseSafety: boolean; safetyRecipients: string[]; safetyAckHours: number;
  calendarState: string; extraDates: string[]; shutdowns: Array<{ name: string; start: string; end: string }>; includeShutdowns: boolean; dlpReminderDays: number[];
  dlpEscalationWindowDays: number; repeatFailureCount: number; severityLabels: Record<string, string>;
}
export interface PolicyView { effective: ProjectPolicy; overridden: string[]; clientDefault: ProjectPolicy }

export interface TemplateRow {
  id: string; code: string; name: string; level: "BASE" | "CLIENT" | "PROJECT"; clientId: string | null; projectId: string | null; parentId: string | null; parentVersion: number | null;
  stageKey: string | null; version: number; versionLabel: string; versionStatus: "DRAFT" | "PUBLISHED" | "RETIRED"; publishedAt: string | null; changeSummary: string | null;
  details: Json; itemCount?: number; items?: TemplateItem[];
}
export interface TemplateItem extends Json {
  id: string; itemNumber: string; section: string | null; sortOrder: number; active: boolean; locked: boolean; mandatory: boolean; itemType: string;
}
export interface StageDef { id: string; stage_number: string; stage_name: string; sequence: number; statutory_mandatory_notification_stage: boolean; active: boolean; [k: string]: any }
export interface ResultCode { id: string; code: string; label: string; definition: string; when_to_use: string; creates_a_defect: boolean; severity_mapping: string | null; photo_required: boolean; reason_required: boolean; colour: string; icon: string; renamed: boolean }
export interface PlanStage { id: string; stageId: string; stageNumber: string; stageName: string; sequence: number; enabled: boolean; mandatoryNotification: boolean; combinedWithStage: string | null; templateId: string | null; templateVersion: string | null; noticeDays: number | null; holdPoint: boolean; defaultInspectorId: string | null }

export interface InspectionRow {
  id: string; ref: string; clientId: string; projectId: string; siteId: string | null; propertyId: string | null; stageKey: string | null; templateId: string | null; type: string; status: string;
  inspectorId: string | null; plannedFrom: string | null; plannedTo: string | null; startedAt: string | null; finishedAt: string | null; signedAt: string | null; locked: boolean; holdPoint: boolean;
  request: Json; header: Json; summary: Json; counts?: Record<string, number>; results?: InspectionResult[];
  lot: { id: string; name: string; site: { id: string; name: string } | null } | null; project: { id: string; name: string; jobNumber: string | null } | null;
  inspector: { id: string; name: string | null; email: string } | null; stage: { id: string; stage_name: string; stage_number: string } | null;
}
export interface InspectionResult {
  id: string; itemNumber: string; item: Json; resultCode: string | null; comments: string | null; locationDetail: string | null; measurement: { value: number; unit: string } | null;
  photoUrls: string[]; reason: string | null; defectIds: string[]; carriedFromId: string | null; answeredAt: string | null;
}
export interface InspectionDetail {
  inspection: InspectionRow;
  defects: Array<{ id: string; defectRef: string | null; title: string | null; isDraft: boolean; sourceItemNumber: string | null; severity: { label: string; key: string } | null; status: { label: string; key: string } }>;
  template: { id: string; name: string; code: string; version: number } | null;
  addenda: Array<{ text: string; reason: string; at: string }>;
  resultCodes: ResultCode[];
}

export interface Notification { id: string; type: string; title: string; body: string; entityType: string | null; entityId: string | null; mandatory: boolean; readAt: string | null; ackedAt: string | null; createdAt: string }
export interface ReportRow { id: string; createdAt: string; report_type: string; format: string; fileName: string; fileHash: string; fileSize: number; generatedAt: string; downloadCount: number }
export interface Escalation { id: string; level: number; trigger: string; manual: boolean; reason: string | null; triggeredAt: string; ackAt: string | null; resolvedAt: string | null; resolveNote: string | null; referralType: string | null; referralRef: string | null }

export const qcx = {
  me: () => req<QcMe>("/qc/me"),
  permissions: () => req<{ matrix: Array<{ capability: string; roles: Record<string, boolean | string> }>; optionalPermissions: string[] }>("/qc/permissions"),
  context: { switch: (clientId: string) => req<{ clientId: string }>("/qc/context/switch", { method: "POST", body: j({ clientId }) }) },
  support: {
    sessions: () => req<{ sessions: Array<{ id: string; reason: string; ticketRef: string | null; startedAt: string; expiresAt: string; endedAt: string | null; actionsPerformed: number; user: { name: string | null; email: string } }> }>("/qc/support-sessions").then((d) => d.sessions),
  },

  dashboard: (f: Json = {}) => req<Json>(`/qc/dashboard${qs(f)}`),
  portfolio: () => req<{ projects: Json[] }>("/qc/portfolio").then((d) => d.projects),

  sla: {
    get: (projectId?: string) => req<{ sla: SlaView; severities: Array<{ key: string; label: string }> }>(`/qc/sla${qs({ projectId })}`),
    save: (severity: string, rule: Json, projectId?: string) => req<{ sla: SlaView }>(`/qc/sla/${severity}${qs({ projectId })}`, { method: "PUT", body: j(rule) }),
    revert: (projectId: string, severity?: string) => req<{ sla: SlaView }>(`/qc/sla${qs({ projectId, severity })}`, { method: "DELETE" }),
  },
  policy: {
    get: (projectId?: string) => req<{ policy: PolicyView }>(`/qc/policy${qs({ projectId })}`).then((d) => d.policy),
    save: (patch: Json, projectId?: string) => req<{ policy: PolicyView }>(`/qc/policy${qs({ projectId })}`, { method: "PUT", body: j(patch) }).then((d) => d.policy),
    revert: (projectId: string, keys?: string[]) => req<{ policy: PolicyView }>(`/qc/policy${qs({ projectId, keys: keys?.join(",") })}`, { method: "DELETE" }).then((d) => d.policy),
  },
  escalations: {
    forDefect: (id: string) => req<{ escalations: Escalation[] }>(`/qc/defects/${id}/escalations`).then((d) => d.escalations),
    escalate: (id: string, body: Json) => req<Json>(`/qc/defects/${id}/escalate`, { method: "POST", body: j(body) }),
    referral: (escalationId: string, body: Json) => req<Json>(`/qc/escalations/${escalationId}/referral`, { method: "POST", body: j(body) }),
    ack: (escalationId: string) => req<Json>(`/qc/escalations/${escalationId}/ack`, { method: "POST" }),
    log: (projectId?: string) => req<{ escalations: Array<Escalation & { defect: Json }> }>(`/qc/escalations${qs({ projectId })}`).then((d) => d.escalations),
  },

  stages: { list: () => req<{ stages: StageDef[] }>("/qc/stages").then((d) => d.stages), save: (id: string | null, body: Json) => req(id ? `/qc/stages/${id}` : "/qc/stages", { method: id ? "PUT" : "POST", body: j(body) }) },
  resultCodes: { list: () => req<{ resultCodes: ResultCode[] }>("/qc/result-codes").then((d) => d.resultCodes), save: (code: string, body: Json) => req(`/qc/result-codes/${encodeURIComponent(code)}`, { method: "PUT", body: j(body) }) },
  templates: {
    list: (f: Json = {}) => req<{ templates: TemplateRow[] }>(`/qc/templates${qs(f)}`).then((d) => d.templates),
    get: (id: string) => req<{ template: TemplateRow }>(`/qc/templates/${id}`).then((d) => d.template),
    create: (body: Json) => req<{ template: TemplateRow }>("/qc/templates", { method: "POST", body: j(body) }).then((d) => d.template),
    update: (id: string, body: Json) => req<{ template: TemplateRow }>(`/qc/templates/${id}`, { method: "PATCH", body: j(body) }).then((d) => d.template),
    addItem: (id: string, body: Json) => req<{ item: TemplateItem }>(`/qc/templates/${id}/items`, { method: "POST", body: j(body) }).then((d) => d.item),
    updateItem: (itemId: string, body: Json) => req<{ item: TemplateItem }>(`/qc/template-items/${itemId}`, { method: "PATCH", body: j(body) }).then((d) => d.item),
    removeItem: (itemId: string) => req<void>(`/qc/template-items/${itemId}`, { method: "DELETE" }),
    draft: (id: string) => req<{ template: TemplateRow }>(`/qc/templates/${id}/draft`, { method: "POST" }).then((d) => d.template),
    publish: (id: string, body: Json) => req<{ template: TemplateRow }>(`/qc/templates/${id}/publish`, { method: "POST", body: j(body) }).then((d) => d.template),
    adopt: (id: string, projectIds: string[]) => req<{ adopted: number }>(`/qc/templates/${id}/adopt`, { method: "POST", body: j({ projectIds }) }),
    clone: (id: string, body: Json) => req<{ template: TemplateRow }>(`/qc/templates/${id}/clone`, { method: "POST", body: j(body) }).then((d) => d.template),
    diff: (id: string) => req<Json>(`/qc/templates/${id}/diff`),
    merge: (id: string, itemNumbers: string[], overwriteLocal = false) => req<Json>(`/qc/templates/${id}/merge`, { method: "POST", body: j({ itemNumbers, overwriteLocal }) }),
    exportUrl: (id: string) => `${API_BASE}/qc/templates/${id}/export`,
    import: (id: string, file: File, partial: boolean) => reqForm<{ report: { rows: number; imported: number; errors: Array<{ row: number; message: string }> } }>(`/qc/templates/${id}/import`, form({ partial: String(partial) }, [file])),
  },

  projects: {
    plan: (id: string) => req<{ plan: PlanStage[] }>(`/qc/projects/${id}/plan`).then((d) => d.plan),
    seedPlan: (id: string) => req<{ plan: PlanStage[] }>(`/qc/projects/${id}/plan/seed`, { method: "POST" }).then((d) => d.plan),
    updateStage: (id: string, rowId: string, body: Json) => req<{ plan: PlanStage[] }>(`/qc/projects/${id}/plan/${rowId}`, { method: "PATCH", body: j(body) }).then((d) => d.plan),
    matrix: (id: string, siteId?: string) => req<{ stages: PlanStage[]; lots: Array<{ id: string; name: string; siteId: string | null; lotStatus: string; cells: Array<{ stageId: string; applies: boolean; status: string; inspectionId: string | null; plannedFrom: string | null; inspectorId: string | null }> }> }>(`/qc/projects/${id}/matrix${qs({ siteId })}`),
    transition: (id: string, status: string, reason?: string) => req<Json>(`/qc/projects/${id}/status`, { method: "POST", body: j({ status, reason }) }),
    documents: (id: string) => req<{ documents: Json[] }>(`/qc/projects/${id}/documents`).then((d) => d.documents),
    addDocument: (id: string, fields: Json, file: File) => reqForm<Json>(`/qc/projects/${id}/documents`, form(fields, [file])),
    importLots: (siteId: string, file: File, mode: "add" | "update", partial: boolean) =>
      reqForm<{ report: { rows: number; added: number; updated: number; errors: Array<{ row: number; message: string }> } }>(`/qc/sites/${siteId}/lots/import`, form({ mode, partial: String(partial) }, [file])),
    lotCsvTemplateUrl: () => `${API_BASE}/qc/lots/csv-template`,
    dlp: (id: string) => req<{ dlp: Json }>(`/qc/projects/${id}/dlp`).then((d) => d.dlp),
    startDlp: (id: string, body: Json) => req<Json>(`/qc/projects/${id}/dlp/start`, { method: "POST", body: j(body) }),
    closeOutDlp: (id: string, body: Json) => req<Json>(`/qc/projects/${id}/dlp/closeout`, { method: "POST", body: j(body) }),
  },

  inspections: {
    list: (f: Json = {}) => req<{ inspections: InspectionRow[] }>(`/qc/inspections${qs(f)}`).then((d) => d.inspections),
    get: (id: string) => req<InspectionDetail>(`/qc/inspections/${id}`),
    request: (body: Json) => req<{ inspections: InspectionRow[] }>("/qc/inspections/request", { method: "POST", body: j(body) }),
    plan: (body: Json) => req<{ inspections: InspectionRow[]; warnings: string[] }>("/qc/inspections/plan", { method: "POST", body: j(body) }),
    change: (id: string, body: Json) => req<Json>(`/qc/inspections/${id}/change`, { method: "POST", body: j(body) }),
    adhoc: (body: Json) => req<Json>("/qc/inspections/adhoc", { method: "POST", body: j(body) }),
    start: (id: string, body: Json) => req<InspectionDetail>(`/qc/inspections/${id}/start`, { method: "POST", body: j(body) }),
    saveResult: (id: string, item: string, body: Json) => req<{ result: InspectionResult; raisedDefectIds?: string[]; stale?: boolean }>(`/qc/inspections/${id}/results/${encodeURIComponent(item)}`, { method: "PUT", body: j(body) }),
    raiseAnother: (id: string, item: string) => req<{ defectId: string }>(`/qc/inspections/${id}/results/${encodeURIComponent(item)}/defects`, { method: "POST" }),
    completion: (id: string) => req<{ unanswered: string[]; draftDefects: Array<{ id: string; defectRef: string | null; title: string | null }>; notInspected: number; hasSignature: boolean; canComplete: boolean }>(`/qc/inspections/${id}/completion`),
    complete: (id: string, body: Json) => req<Json>(`/qc/inspections/${id}/complete`, { method: "POST", body: j(body) }),
    addendum: (id: string, fields: Json, files: File[]) => reqForm<Json>(`/qc/inspections/${id}/addendum`, form(fields, files)),
    report: (id: string, photos = true) => req<{ report: Json }>(`/qc/inspections/${id}/report${qs({ photos: photos ? "true" : "false" })}`, { method: "POST" }).then((d) => d.report),
  },
  evidence: {
    upload: (fields: Json, files: File[]) => reqForm<{ evidence: Array<{ id: string; url: string; rawUrl: string; fileHash: string }> }>("/qc/evidence", form(fields, files)),
    list: (linkedType: string, linkedId: string) => req<{ evidence: Json[] }>(`/qc/evidence${qs({ linkedType, linkedId })}`).then((d) => d.evidence),
    verify: (id: string) => req<{ ok: boolean; stored: string; current: string | null }>(`/qc/evidence/${id}/verify`),
  },

  reports: {
    list: (projectId?: string) => req<{ reports: ReportRow[] }>(`/qc/reports${qs({ projectId })}`).then((d) => d.reports),
    link: (id: string) => req<{ url: string; fileName: string; hash: string }>(`/qc/reports/${id}/download`),
    openItems: (body: Json, format: "pdf" | "xlsx") => req<{ report: Json }>(`/qc/reports/open-items${qs({ format })}`, { method: "POST", body: j(body) }).then((d) => d.report),
    escalations: (body: Json, format: "pdf" | "xlsx") => req<{ report: Json }>(`/qc/reports/escalations${qs({ ...body, format })}`, { method: "POST" }).then((d) => d.report),
    dlp: (projectId: string) => req<{ report: Json }>(`/qc/projects/${projectId}/dlp/report`, { method: "POST" }).then((d) => d.report),
    evidencePack: (defectId: string) => req<{ report: Json }>(`/qc/defects/${defectId}/evidence-pack`, { method: "POST" }).then((d) => d.report),
    portfolio: () => req<{ report: Json }>("/qc/portfolio/export", { method: "POST" }).then((d) => d.report),
  },

  notifications: {
    list: (unread = false) => req<{ notifications: Notification[]; unread: number }>(`/qc/notifications${qs({ unread: unread ? "true" : "" })}`),
    read: (id: string) => req(`/qc/notifications/${id}/read`, { method: "POST" }),
    readAll: () => req("/qc/notifications/all/read", { method: "POST" }),
    ack: (id: string) => req(`/qc/notifications/${id}/ack`, { method: "POST" }),
    prefs: () => req<{ events: Array<{ type: string; label: string; mandatory: boolean; inApp: boolean; email: "IMMEDIATE" | "DIGEST" | "OFF" }> }>("/qc/notification-prefs").then((d) => d.events),
    savePrefs: (events: Array<{ type: string; inApp: boolean; email: string }>) => req("/qc/notification-prefs", { method: "PUT", body: j({ events }) }),
  },

  audit: {
    list: (f: Json = {}) => req<{ entries: Array<Json> }>(`/qc/audit${qs(f)}`).then((d) => d.entries),
    verify: () => req<{ ok: boolean; checked: number; brokenAt?: string }>("/qc/audit/verify"),
    security: (f: Json = {}) => req<{ events: Array<Json> }>(`/qc/security-log${qs(f)}`).then((d) => d.events),
  },

  settings: {
    defaults: (clientId: string) => req<{ defaults: Json; plan: unknown }>(`/qc/clients/${clientId}/defaults`),
    saveDefaults: (clientId: string, body: Json) => req(`/qc/clients/${clientId}/defaults`, { method: "PUT", body: j(body) }),
    usage: () => req<{ users: number; projects: number; storageBytes?: number; plan: unknown }>("/qc/usage"),
    holds: () => req<{ holds: Json[] }>("/qc/legal-holds").then((d) => d.holds),
    placeHold: (body: Json) => req<Json>("/qc/legal-holds", { method: "POST", body: j(body) }),
    releaseHold: (id: string, reason: string) => req<Json>(`/qc/legal-holds/${id}/release`, { method: "POST", body: j({ reason }) }),
    exportTenant: async (clientId: string, contents: string[]) => {
      const res = await fetch(`${API_BASE}/qc/clients/${clientId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}`, ...(getActiveClientId() ? { "X-Client-Id": getActiveClientId()! } : {}) },
        body: j({ export_contents: contents }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `HTTP ${res.status}`);
      return res.blob();
    },
    offboard: (clientId: string, body: Json) => req<Json>(`/qc/clients/${clientId}/offboard`, { method: "POST", body: j(body) }),
    destroy: (clientId: string) => req<Json>(`/qc/clients/${clientId}/destroy`, { method: "POST" }),
  },

  privacy: {
    requests: () => req<{ requests: Json[] }>("/qc/privacy/requests").then((d) => d.requests),
    createRequest: (body: Json) => req<Json>("/qc/privacy/requests", { method: "POST", body: j(body) }),
    updateRequest: (id: string, body: Json) => req<Json>(`/qc/privacy/requests/${id}`, { method: "PATCH", body: j(body) }),
    exportPersonal: async (id: string, userId: string) => {
      const res = await fetch(`${API_BASE}/qc/privacy/requests/${id}/export`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` }, body: j({ userId }) });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `HTTP ${res.status}`);
      return res.blob();
    },
    breaches: () => req<{ incidents: Json[] }>("/qc/privacy/breaches").then((d) => d.incidents),
    createBreach: (body: Json) => req<Json>("/qc/privacy/breaches", { method: "POST", body: j(body) }),
    updateBreach: (id: string, body: Json) => req<Json>(`/qc/privacy/breaches/${id}`, { method: "PATCH", body: j(body) }),
    subProcessors: () => req<{ subProcessors: Json[] }>("/qc/privacy/subprocessors").then((d) => d.subProcessors),
    saveSubProcessor: (id: string | null, body: Json) => req<Json>(id ? `/qc/privacy/subprocessors/${id}` : "/qc/privacy/subprocessors", { method: id ? "PUT" : "POST", body: j(body) }),
    retention: () => req<{ due: Json[]; destroyed: Json[] }>("/qc/privacy/retention"),
  },

  people: {
    resendInvitation: (id: string) => req<{ invitation: { url: string; expiresAt: string; email: string; mail: string } }>(`/qc/people/${id}/invitation`, { method: "POST" }).then((d) => d.invitation),
    inspectors: () => req<{ users: Array<{ id: string; name: string | null; email: string }> }>("/qc/inspectors").then((d) => d.users),
  },
};
