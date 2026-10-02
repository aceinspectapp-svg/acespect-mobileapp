import type {
  Inspection,
  Role,
  User,
  InspectionStatus,
  SectionReviewStatus,
  Template,
  TemplateField,
  TemplateSummaryRow,
} from "./mockData";
import type {
  QcClientRow, QcConfigBundle, QcDefect, QcDefectDetail, QcLotRow, QcMasterContractorRow, QcPerson, QcPersonRow,
  QcProjectRow, QcSiteRow, QcTeamMember, QcTradeCategory, QcTradeCompanyRow, FieldData,
} from "./qcTypes";
import type { QcSpecPayload } from "./qcSpec";

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000/api/v1";

/**
 * Resolve a stored photo value against the CURRENT backend host, not
 * whichever one was live when it was uploaded. New uploads store a relative
 * `/api/v1/media/:id` path; older ones may still have an absolute URL baked
 * in from a since-restarted Cloudflare tunnel, which would otherwise 404
 * forever. Either way, take everything from `/api/v1/media/` onward and
 * re-attach it to today's API_BASE origin.
 */
export function resolveMediaUrl(value: string): string {
  const marker = "/api/v1/media/";
  const idx = value.indexOf(marker);
  if (idx === -1) return value;
  const origin = API_BASE.replace(/\/api\/v1\/?$/, "");
  return origin + value.slice(idx);
}

const TOKEN_KEY = "acespect_token";
const USER_KEY = "acespect_user";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

export function getToken(): string | null {
  return typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
}
export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}
function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function mapRole(r: string): Role {
  const x = (r || "").toLowerCase();
  return x === "admin" ? "admin" : x === "reviewer" ? "reviewer" : "inspector";
}

export interface ApiError extends Error {
  status?: number;
  /** Stable machine code from the server (e.g. CATEGORY_MISMATCH). */
  code?: string;
  /** Field-level validation messages, keyed by spec field key. */
  details?: Record<string, string[]>;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    let details: Record<string, string[]> | undefined;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
      code = body?.error?.code;
      details = body?.error?.details;
    } catch {
      /* non-JSON */
    }
    const err: ApiError = new Error(message);
    err.status = res.status;
    err.code = code;
    err.details = details;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Multipart variant of req(): the browser sets the boundary, so no Content-Type header. */
async function reqForm<T>(path: string, form: FormData, method = "POST"): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    body: form,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let code: string | undefined;
    let details: Record<string, string[]> | undefined;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
      code = body?.error?.code;
      details = body?.error?.details;
    } catch {
      /* non-JSON */
    }
    const err: ApiError = new Error(message);
    err.status = res.status;
    err.code = code;
    err.details = details;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Build the multipart body the QC action/comment endpoints take: JSON in `payload`, photos as repeated `photos` parts. */
export function qcForm(payload: Record<string, unknown>, files: File[] = []): FormData {
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  for (const f of files) form.append("photos", f);
  return form;
}

export const api = {
  async login(email: string, password: string): Promise<AuthUser> {
    const r = await req<{ accessToken: string; user: { id: string; email: string; name: string | null; role: string } }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    const user: AuthUser = { id: r.user.id, email: r.user.email, name: r.user.name, role: mapRole(r.user.role) };
    setSession(r.accessToken, user);
    return user;
  },

  async me(): Promise<AuthUser> {
    const r = await req<{ user: { id: string; email: string; name: string | null; role: string } }>("/auth/me");
    return { id: r.user.id, email: r.user.email, name: r.user.name, role: mapRole(r.user.role) };
  },

  getInspections: () => req<{ inspections: Inspection[] }>("/web/inspections").then((d) => d.inspections),
  getInspection: (id: string) => req<{ inspection: Inspection }>(`/web/inspections/${id}`).then((d) => d.inspection),
  getUsers: () => req<{ users: User[] }>("/web/users").then((d) => d.users),

  /** Admin-only: edit another user's profile (name/phone/region/license). */
  updateUser: (
    id: string,
    patch: { name?: string; phone?: string | null; region?: string | null; licenseNumber?: string | null },
  ) => req<{ user: User }>(`/web/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((d) => d.user),

  updateSection: (
    id: string,
    patch: {
      reviewStatus?: SectionReviewStatus;
      reviewComment?: string;
      reportText?: string;
      fields?: Record<string, unknown>;
      excludedPhotoUrls?: string[];
      photos?: string[];
      // The reviewer's Field Data edit -- see web.schemas.ts's sectionUpdateSchema.
      answers?: Record<string, unknown>;
      damages?: { type: string; location: string; direction: string; widthMm: number; lengthMm: number; notes: string; photos?: string[] }[];
    },
  ) => req<{ section: unknown }>(`/web/sections/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /** A damage record's own photo-exclusion list -- see updateSection above for the same idea, one level down. */
  updateDamage: (id: string, patch: { excludedPhotoUrls?: string[]; photos?: string[] }) =>
    req<{ damage: unknown }>(`/web/damages/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  updateInspection: (id: string, patch: { status?: InspectionStatus; notes?: string; reviewerId?: string | null }) =>
    req<{ inspection: Inspection }>(`/web/inspections/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  /**
   * The inspector's own draft-editing endpoint (same one the mobile app and
   * acespect-dashboard use) -- `sections`, when given, replaces the stored
   * set wholesale. Only works while the inspection is still a draft owned
   * by the calling inspector.
   */
  updateInspectionDraft: (
    id: string,
    patch: {
      jobNo?: string;
      address?: string;
      suburb?: string;
      client?: string;
      date?: string;
      notes?: string;
      sections?: Array<{
        key: string;
        name: string;
        icon: string;
        order: number;
        status: "complete" | "partial" | "pending";
        reportText: string;
        fields: Record<string, unknown>;
        answers?: Record<string, unknown>;
        photos: string[];
        damages: Array<{
          type: string;
          location: string;
          direction: string;
          widthMm: number;
          lengthMm: number;
          notes: string;
          photos: string[];
          order: number;
        }>;
      }>;
    },
  ) => req<{ inspection: unknown }>(`/inspections/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  finalizeInspection: (id: string) => req<{ inspection: unknown }>(`/inspections/${id}/finalize`, { method: "POST" }),

  /**
   * Starts a brand-new draft from the web (mobile's own "new inspection"
   * flow never touches the backend until it already has answers to submit,
   * since it works from a local offline DB first -- web has no equivalent,
   * so this creates the draft row immediately, pre-seeded with one empty
   * section per templatable key so InspectorFormEditor has something to
   * show right away). Returns the new inspection's id to navigate to.
   */
  createInspection: (input: {
    inspectionType: string;
    propertyType: string;
    jobNo?: string;
    address?: string;
    suburb?: string;
    client?: string;
    date?: string;
    sections: Array<{
      key: string;
      name: string;
      icon: string;
      order: number;
      status: "complete" | "partial" | "pending";
      reportText: string;
      fields: Record<string, unknown>;
      answers?: Record<string, unknown>;
      photos: string[];
      damages: Array<{
        type: string;
        location: string;
        direction: string;
        widthMm: number;
        lengthMm: number;
        notes: string;
        photos: string[];
        order: number;
      }>;
    }>;
  }) =>
    req<{ inspectionId: string; status: string }>("/inspections/submit", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /**
   * Uploads one photo taken on a different device than the one the
   * inspection was started on (e.g. a proper camera) so it lands in the
   * same photo store as everything shot in-app. `sectionKey` groups it
   * under that section for organizational purposes; omit it for an
   * ungrouped upload. Bypasses `req()` -- a multipart body must not carry a
   * JSON Content-Type, and the browser needs to set its own boundary.
   */
  async uploadInspectionPhoto(file: File, inspectionId?: string, sectionKey?: string): Promise<{ id: string; url: string }> {
    const form = new FormData();
    form.append("photo", file);
    if (inspectionId) form.append("inspectionId", inspectionId);
    if (sectionKey) form.append("sectionKey", sectionKey);
    const token = getToken();
    const res = await fetch(`${API_BASE}/inspections/photos`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        message = (await res.json())?.error?.message ?? message;
      } catch {
        /* non-JSON */
      }
      throw new Error(message);
    }
    return res.json();
  },

  /** Bundles a section's non-field-bound photos into one zip download -- see inspections.controller.ts. */
  sectionPhotosZipUrl: (sectionId: string) => `${API_BASE}/inspections/sections/${sectionId}/photos.zip`,

  getTemplateSummary: (inspectionType: string, propertyType: string) =>
    req<{ summary: TemplateSummaryRow[] }>(
      `/templates/summary?inspectionType=${encodeURIComponent(inspectionType)}&propertyType=${encodeURIComponent(propertyType)}`,
    ).then((d) => d.summary),
  getTemplates: (inspectionType: string, propertyType: string, sectionKey: string) =>
    req<{ templates: Template[] }>(
      `/templates?inspectionType=${encodeURIComponent(inspectionType)}&propertyType=${encodeURIComponent(propertyType)}&sectionKey=${encodeURIComponent(sectionKey)}`,
    ).then((d) => d.templates),
  getTemplate: (id: string) => req<{ template: Template }>(`/templates/${id}`).then((d) => d.template),
  createTemplate: (data: { inspectionType: string; propertyType: string; sectionKey: string; name: string; fields: TemplateField[] }) =>
    req<{ template: Template }>("/templates", { method: "POST", body: JSON.stringify(data) }).then((d) => d.template),
  updateTemplate: (id: string, patch: { name?: string; fields?: TemplateField[] }) =>
    req<{ template: Template }>(`/templates/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then(
      (d) => d.template,
    ),
  publishTemplate: (id: string) =>
    req<{ template: Template }>(`/templates/${id}/publish`, { method: "POST" }).then((d) => d.template),
  getTemplateAdoption: (inspectionType: string, propertyType: string) =>
    req<{ adoption: TemplateAdoptionRow[] }>(
      `/templates/adoption/${encodeURIComponent(inspectionType)}/${encodeURIComponent(propertyType)}`,
    ).then((d) => d.adoption),

  // ─── QC — requirements-spec admin (see acespect-backend/src/modules/qc) ──
  qc: {
    /** Field definitions for every entity and form; the admin's forms are rendered from this. */
    spec: () => req<QcSpecPayload>("/qc/spec"),
    getConfig: () => req<QcConfigBundle>("/qc/config"),

    clients: {
      list: () => req<{ clients: QcClientRow[] }>("/qc/clients").then((d) => d.clients),
      create: (input: FieldData) =>
        req<{ client: QcClientRow; firstAdmin: QcPersonRow; temporaryPassword?: string }>("/qc/clients", { method: "POST", body: JSON.stringify(input) }),
      update: (id: string, input: FieldData) =>
        req<{ client: QcClientRow }>(`/qc/clients/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((d) => d.client),
      setStatus: (id: string, status: string, reason?: string) =>
        req<{ client: QcClientRow }>(`/qc/clients/${id}/status`, { method: "POST", body: JSON.stringify({ status, reason }) }).then((d) => d.client),
      remove: (id: string) => req<void>(`/qc/clients/${id}`, { method: "DELETE" }),
    },
    masterContractors: {
      list: (clientId?: string) =>
        req<{ masterContractors: QcMasterContractorRow[] }>(`/qc/master-contractors${clientId ? `?clientId=${clientId}` : ""}`).then((d) => d.masterContractors),
      create: (input: FieldData) => req("/qc/master-contractors", { method: "POST", body: JSON.stringify(input) }),
      update: (id: string, input: FieldData) => req(`/qc/master-contractors/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      remove: (id: string) => req<void>(`/qc/master-contractors/${id}`, { method: "DELETE" }),
    },
    tradeCompanies: {
      list: () => req<{ tradeCompanies: QcTradeCompanyRow[] }>("/qc/trade-companies").then((d) => d.tradeCompanies),
      create: (input: FieldData) => req("/qc/trade-companies", { method: "POST", body: JSON.stringify(input) }),
      update: (id: string, input: FieldData) => req(`/qc/trade-companies/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      remove: (id: string) => req<void>(`/qc/trade-companies/${id}`, { method: "DELETE" }),
    },
    tradeCategories: {
      list: () => req<{ tradeCategories: QcTradeCategory[] }>("/qc/trade-categories").then((d) => d.tradeCategories),
      create: (input: FieldData) => req("/qc/trade-categories", { method: "POST", body: JSON.stringify(input) }),
      update: (id: string, input: FieldData) => req(`/qc/trade-categories/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      remove: (id: string) => req<{ retired: boolean }>(`/qc/trade-categories/${id}`, { method: "DELETE" }),
    },

    projects: {
      list: (clientId?: string) => req<{ projects: QcProjectRow[] }>(`/qc/projects${clientId ? `?clientId=${clientId}` : ""}`).then((d) => d.projects),
      get: (id: string) => req<{ project: QcProjectRow }>(`/qc/projects/${id}`).then((d) => d.project),
      create: (input: FieldData) => req<{ project: QcProjectRow }>("/qc/projects", { method: "POST", body: JSON.stringify(input) }).then((d) => d.project),
      update: (id: string, input: FieldData) =>
        req<{ project: QcProjectRow }>(`/qc/projects/${id}`, { method: "PATCH", body: JSON.stringify(input) }).then((d) => d.project),
      remove: (id: string) => req<void>(`/qc/projects/${id}`, { method: "DELETE" }),
      team: (id: string) => req<{ team: QcTeamMember[] }>(`/qc/projects/${id}/team`).then((d) => d.team),
      addTeamMember: (id: string, input: FieldData) => req(`/qc/projects/${id}/team`, { method: "POST", body: JSON.stringify(input) }),
      removeTeamMember: (memberId: string, removalReason?: string) =>
        req<void>(`/qc/team/${memberId}`, { method: "DELETE", body: JSON.stringify({ removalReason }) }),
    },
    sites: {
      list: (projectId?: string) => req<{ sites: QcSiteRow[] }>(`/qc/sites${projectId ? `?projectId=${projectId}` : ""}`).then((d) => d.sites),
      create: (input: FieldData) => req("/qc/sites", { method: "POST", body: JSON.stringify(input) }),
      update: (id: string, input: FieldData) => req(`/qc/sites/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      remove: (id: string) => req<void>(`/qc/sites/${id}`, { method: "DELETE" }),
    },
    lots: {
      list: (filters: { projectId?: string; siteId?: string } = {}) => {
        const params = new URLSearchParams();
        if (filters.projectId) params.set("projectId", filters.projectId);
        if (filters.siteId) params.set("siteId", filters.siteId);
        return req<{ lots: QcLotRow[] }>(`/qc/lots?${params.toString()}`).then((d) => d.lots);
      },
      create: (input: FieldData) => req("/qc/lots", { method: "POST", body: JSON.stringify(input) }),
      update: (id: string, input: FieldData) => req(`/qc/lots/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      remove: (id: string) => req<void>(`/qc/lots/${id}`, { method: "DELETE" }),
    },

    people: {
      list: (filters: { clientId?: string; role?: string; q?: string } = {}) => {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
        return req<{ people: QcPersonRow[] }>(`/qc/people?${params.toString()}`).then((d) => d.people);
      },
      create: (input: FieldData) => req<{ person: QcPersonRow; temporaryPassword?: string }>("/qc/people", { method: "POST", body: JSON.stringify(input) }),
      update: (id: string, input: FieldData) => req<{ person: QcPersonRow }>(`/qc/people/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
      deactivate: (id: string, input: { reason: string; reassignToId?: string }) =>
        req<{ reassigned: number }>(`/qc/people/${id}/deactivate`, { method: "POST", body: JSON.stringify(input) }),
      reactivate: (id: string) => req<void>(`/qc/people/${id}/reactivate`, { method: "POST" }),
      saveCredentials: (id: string, input: FieldData) => req(`/qc/people/${id}/credentials`, { method: "PUT", body: JSON.stringify(input) }),
      setCredentialStatus: (id: string, status: string) =>
        req(`/qc/people/${id}/credentials/status`, { method: "POST", body: JSON.stringify({ status }) }),
    },
    /** Accounts that can be given QC work (assignee pickers). */
    getAssignableUsers: () => req<{ users: QcPerson[] }>("/qc/users").then((d) => d.users),

    defects: {
      list: (filters: Record<string, string | undefined> = {}) => {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
        return req<{ defects: QcDefect[] }>(`/qc/defects?${params.toString()}`).then((d) => d.defects);
      },
      // The admin only picks the lot and the person; the rest is filled in on site and confirmed as Open.
      create: (input: { propertyId: string; assignedToId: string } & FieldData) =>
        req<{ defect: QcDefect }>("/qc/defects", { method: "POST", body: JSON.stringify(input) }).then((d) => d.defect),
      get: (id: string) => req<QcDefectDetail>(`/qc/defects/${id}`),
      update: (id: string, patch: FieldData) =>
        req<{ defect: QcDefect }>(`/qc/defects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }).then((d) => d.defect),
      /** Lifecycle action (confirm, release, allocate, verify...). Photos travel with the form. */
      act: (id: string, action: string, payload: Record<string, unknown>, files: File[] = []) =>
        reqForm<QcDefectDetail>(`/qc/defects/${id}/actions/${action}`, qcForm(payload, files)),
      comment: (id: string, payload: { text: string; visibleTo?: string }, files: File[] = []) =>
        reqForm<{ comment: unknown }>(`/qc/defects/${id}/comments`, qcForm(payload, files)),
      addPhotos: (id: string, files: File[]) => reqForm<{ defect: QcDefect }>(`/qc/defects/${id}/photos`, qcForm({}, files)),
    },
  },

  /** Admin-only troubleshooting feed: the mobile submit/update/finalize/photo pipeline's own trail. See acespect-backend's SubmissionLogEntry. */
  getSubmissionLogs: (filters: { event?: string; jobNo?: string; inspectorId?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (filters.event) params.set("event", filters.event);
    if (filters.jobNo) params.set("jobNo", filters.jobNo);
    if (filters.inspectorId) params.set("inspectorId", filters.inspectorId);
    params.set("limit", String(filters.limit ?? 200));
    return req<{ logs: SubmissionLogEntry[] }>(`/web/submission-logs?${params.toString()}`).then((d) => d.logs);
  },
};

export interface SubmissionLogEntry {
  id: string;
  event: "received" | "saved" | "updated" | "finalized" | "photo_uploaded" | "rejected";
  inspector: { id: string; name: string | null; email: string } | null;
  inspectorId: string | null;
  inspectionId: string | null;
  jobNo: string | null;
  statusCode: number | null;
  message: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

/** One inspector's adoption status for a profile's set of section templates — see templates.service.ts `getAdoption`. */
export interface TemplateAdoptionRow {
  inspectorId: string;
  name: string | null;
  email: string;
  status: "NOT_STARTED" | "UP_TO_DATE" | "UPDATE_AVAILABLE";
  notifiedAt: string | null;
  acceptedAt: string | null;
  sections: {
    sectionKey: string;
    currentVersion: number | null;
    latestVersion: number | null;
    upToDate: boolean;
    notifiedAt: string | null;
    acceptedAt: string | null;
  }[];
}
