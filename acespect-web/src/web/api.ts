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

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000/api/v1";

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
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      /* non-JSON */
    }
    const err: ApiError = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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

  updateSection: (
    id: string,
    patch: {
      reviewStatus?: SectionReviewStatus;
      reviewComment?: string;
      reportText?: string;
      fields?: Record<string, unknown>;
    },
  ) => req<{ section: unknown }>(`/web/sections/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

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
};
