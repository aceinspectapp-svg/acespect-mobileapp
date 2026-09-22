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
      damages?: { type: string; location: string; direction: string; widthMm: number; lengthMm: number; notes: string }[];
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
};

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
