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

export interface QcMembership {
  clientId: string;
  clientName: string;
  role: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  /** Roles this person holds in QC clients (empty for the Super Admin and plain Houspect inspectors). */
  memberships?: QcMembership[];
}

const CLIENT_KEY = "acespect_client";
/** The client a multi-client person is working in; sent as X-Client-Id on every request. */
export function getActiveClientId(): string | null {
  try { return localStorage.getItem(CLIENT_KEY); } catch { return null; }
}
export function setActiveClientId(id: string | null) {
  try { if (id) localStorage.setItem(CLIENT_KEY, id); else localStorage.removeItem(CLIENT_KEY); } catch { /* storage unavailable */ }
}

/** Where a signed-in person lands: the QC portal for anyone with a QC role, the admin area for the Super Admin. */
export function homeFor(user: AuthUser): string {
  if (user.role === "admin") return "/admin/dashboard";
  if (user.memberships && user.memberships.length > 0) return "/qc";
  return `/${user.role}/dashboard`;
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
export function setSession(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  setActiveClientId(null);
}
export function setRefreshToken(t: string | null) {
  try { if (t) localStorage.setItem("acespect_refresh", t); else localStorage.removeItem("acespect_refresh"); } catch { /* storage unavailable */ }
}

export function mapRole(r: string): Role {
  const x = (r || "").toLowerCase();
  return x === "admin" ? "admin" : x === "reviewer" ? "reviewer" : "inspector";
}

export interface ApiError extends Error {
  status?: number;
  /** Stable machine code from the server (e.g. CATEGORY_MISMATCH). */
  code?: string;
  /** Field-level validation messages, keyed by spec field key. */
  details?: Record<string, any>;
}

let refreshing: Promise<boolean> | null = null;
/** Swap the refresh token for a new pair once; every request that hit an expired token waits for the same attempt. */
async function refreshSession(): Promise<boolean> {
  const rt = (() => { try { return localStorage.getItem("acespect_refresh"); } catch { return null; } })();
  if (!rt) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json", "X-App-Client": "web" }, body: JSON.stringify({ refreshToken: rt }) });
      if (!res.ok) return false;
      const r = (await res.json()) as AuthResponse;
      const u = getStoredUser();
      if (u) setSession(r.accessToken, u);
      setRefreshToken(r.refreshToken ?? null);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

async function fetchWithRefresh(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 401) return res;
  const body = await res.clone().json().catch(() => null);
  const code = body?.error?.code as string | undefined;
  if (code === "SESSION_IDLE" || code === "SESSION_REVOKED" || code === "ACCOUNT_INACTIVE") {
    clearSession();
    if (typeof window !== "undefined" && window.location.pathname !== "/") window.location.assign("/?reason=" + code);
    return res;
  }
  if (code !== "TOKEN_EXPIRED" || !(await refreshSession())) return res;
  const headers = { ...(init.headers as Record<string, string>), Authorization: `Bearer ${getToken()}` };
  return fetch(url, { ...init, headers });
}

export async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const client = getActiveClientId();
  const res = await fetchWithRefresh(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-App-Client": "web",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(client ? { "X-Client-Id": client } : {}),
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
export async function reqForm<T>(path: string, form: FormData, method = "POST"): Promise<T> {
  const token = getToken();
  const client = getActiveClientId();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    body: form,
    headers: { "X-App-Client": "web", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(client ? { "X-Client-Id": client } : {}) },
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

interface AuthResponse {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; email: string; name: string | null; role: string };
}
export type LoginOutcome =
  | { kind: "ok"; user: AuthUser }
  | { kind: "mfa"; mfaToken: string }
  | { kind: "enroll"; mfaToken: string };

/** Store a successful sign-in, or report which second step the server wants. Memberships decide where the person lands. */
async function finishLogin(r: unknown): Promise<LoginOutcome> {
  const x = r as Partial<AuthResponse> & { mfaRequired?: boolean; mfaEnrollRequired?: boolean; mfaToken?: string };
  if (x.mfaRequired && x.mfaToken) return { kind: "mfa", mfaToken: x.mfaToken };
  if (x.mfaEnrollRequired && x.mfaToken) return { kind: "enroll", mfaToken: x.mfaToken };
  const user: AuthUser = { id: x.user!.id, email: x.user!.email, name: x.user!.name, role: mapRole(x.user!.role) };
  setSession(x.accessToken!, user);
  setRefreshToken(x.refreshToken ?? null);
  const full = await api.me().catch(() => user);
  setSession(x.accessToken!, full);
  return { kind: "ok", user: full };
}

export const api = {
  /** First step of sign-in: either signed in, or a second step (MFA code / MFA enrolment) is needed. */
  async loginStep(email: string, password: string): Promise<LoginOutcome> {
    const r = await req<AuthResponse | { mfaRequired: true; mfaToken: string } | { mfaEnrollRequired: true; mfaToken: string }>(
      "/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) },
    );
    return finishLogin(r);
  },

  async login(email: string, password: string): Promise<AuthUser> {
    const o = await api.loginStep(email, password);
    if (o.kind !== "ok") throw new Error("This account needs a second sign-in step; use the sign-in page.");
    return o.user;
  },

  auth: {
    verifyMfa: (mfaToken: string, code: string) =>
      req<AuthResponse>("/auth/mfa/verify", { method: "POST", body: JSON.stringify({ mfaToken, code }) }).then(finishLogin),
    startEnrol: (mfaToken: string) =>
      req<{ secret: string; otpauthUri: string }>("/auth/mfa/enroll/start", { method: "POST", body: JSON.stringify({ mfaToken }) }),
    completeEnrol: (mfaToken: string, code: string) =>
      req<AuthResponse & { backupCodes: string[] }>("/auth/mfa/enroll/complete", { method: "POST", body: JSON.stringify({ mfaToken, code }) }).then(async (r) => ({
        outcome: await finishLogin(r), backupCodes: r.backupCodes,
      })),
    sso: (provider: "google" | "microsoft", idToken: string) =>
      req<AuthResponse>(`/auth/sso/${provider}`, { method: "POST", body: JSON.stringify({ idToken }) }).then(finishLogin),
    ssoConfig: () => req<{ microsoft: boolean }>("/auth/sso/config"),
    invitation: (token: string) =>
      req<{ email: string; name: string | null; termsVersion: string; privacyVersion: string }>(`/auth/invitations/${token}`),
    accept: (token: string, password: string, acceptTerms: boolean) =>
      req<AuthResponse | { mfaEnrollRequired: true; mfaToken: string } | { mfaRequired: true; mfaToken: string }>(`/auth/invitations/${token}/accept`, { method: "POST", body: JSON.stringify({ password, acceptTerms }) }).then(finishLogin),
    forgot: (email: string) => req<{ success: boolean }>("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) }),
    reset: (token: string, password: string) => req<{ success: boolean }>("/auth/password/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
    changePassword: (currentPassword: string, newPassword: string) =>
      req<{ success: boolean }>("/auth/password/change", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
    setupMfa: () => req<{ secret: string; otpauthUri: string }>("/auth/mfa/setup", { method: "POST" }),
    confirmMfa: (code: string) => req<{ backupCodes: string[] }>("/auth/mfa/confirm", { method: "POST", body: JSON.stringify({ code }) }),
    disableMfa: (password: string) => req<{ success: boolean }>("/auth/mfa/disable", { method: "POST", body: JSON.stringify({ password }) }),
  },

  async me(): Promise<AuthUser> {
    const r = await req<{ user: { id: string; email: string; name: string | null; role: string; mfaEnabled?: boolean }; memberships?: Array<{ clientId: string; clientName: string; role: string }> }>("/auth/me");
    return {
      id: r.user.id, email: r.user.email, name: r.user.name, role: mapRole(r.user.role),
      memberships: (r.memberships ?? []).map((m) => ({ clientId: m.clientId, clientName: m.clientName, role: m.role })),
    };
  },
  mfaEnabled: () => req<{ user: { mfaEnabled?: boolean } }>("/auth/me").then((d) => !!d.user.mfaEnabled),

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
      addTeamMember: (id: string, input: FieldData) => req<{ warnings?: string[] }>(`/qc/projects/${id}/team`, { method: "POST", body: JSON.stringify(input) }),
      removeTeamMember: (memberId: string, removalReason?: string, reassignToId?: string) =>
        req<void>(`/qc/team/${memberId}`, { method: "DELETE", body: JSON.stringify({ removalReason, reassignToId }) }),
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
      update: (id: string, input: FieldData) => req<{ warning?: string | null }>(`/qc/lots/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
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
      bulkRelease: (ids: string[], cover_note?: string) =>
        req<{ results: Array<{ id: string; ok: boolean; message?: string }> }>("/qc/defects/bulk/release", { method: "POST", body: JSON.stringify({ ids, cover_note }) }),
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
