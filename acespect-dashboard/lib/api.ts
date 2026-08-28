"use client";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

const TOKEN_KEY = "acespect_token";
const REFRESH_KEY = "acespect_refresh";
const ROLE_KEY = "acespect_role";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(ROLE_KEY);
}

/** Role decides which home the user lands on: inspectors get their own drafts. */
export function getRole(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ROLE_KEY);
}
export function setRole(r: string) {
  localStorage.setItem(ROLE_KEY, r);
}
export function homeForRole(role: string | null): string {
  return role === "INSPECTOR" ? "/my-inspections" : "/inspections";
}

export interface ApiError extends Error {
  status?: number;
}

// Single-flight refresh: concurrent 401s share one refresh round-trip rather
// than each firing their own and racing to overwrite the stored tokens.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    setTokens(data.accessToken, data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

async function rawFetch(path: string, opts: RequestInit, token: string | null) {
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
}

/**
 * Fetch wrapper that attaches the bearer token and unwraps API errors. Access
 * tokens live only 15 minutes, so a 401 transparently refreshes once and
 * retries — without this an inspector part-way through editing a draft would
 * be bounced to the login screen and lose their unsaved changes.
 */
export async function api<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<T> {
  let res = await rawFetch(path, opts, getToken());

  if (res.status === 401 && !path.startsWith("/auth/")) {
    refreshing = refreshing ?? refreshAccessToken().finally(() => { refreshing = null; });
    const fresh = await refreshing;
    if (fresh) res = await rawFetch(path, opts, fresh);
    else clearToken();
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
    } catch {
      /* ignore non-JSON bodies */
    }
    const err: ApiError = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}
