import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { API_URL } from '../config/api';
import { tokenStorage } from './tokenStorage';

/**
 * Authenticated axios client.
 *  - Request: attaches the stored access token as a Bearer header.
 *  - Response: on a 401, transparently refreshes the token once (single-flight)
 *    and retries the original request. If refresh fails, tokens are cleared and
 *    the registered `onUnauthorized` handler fires so the app returns to login.
 *
 * A separate, interceptor-free client (`refreshClient`) performs the refresh so
 * it can never recurse through this interceptor.
 */

let onUnauthorized: (() => void) | null = null;

/** The client a person with roles in several clients is working in; sent as X-Client-Id. */
let activeClientId: string | null = null;
export function setActiveClientId(id: string | null): void {
  activeClientId = id;
}
export const getActiveClientId = (): string | null => activeClientId;
export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorized = cb;
}

const refreshClient = axios.create({ baseURL: API_URL, timeout: 15000 });

export const api: AxiosInstance = axios.create({ baseURL: API_URL, timeout: 15000 });

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await tokenStorage.getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['X-App-Client'] = 'mobile';
  if (activeClientId) config.headers['X-Client-Id'] = activeClientId;
  return config;
});

// Single-flight refresh: concurrent 401s share one refresh round-trip.
let refreshing: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = await tokenStorage.getRefreshToken();
  if (!refreshToken) return null;
  try {
    const { data } = await refreshClient.post('/auth/refresh', { refreshToken });
    await tokenStorage.setTokens(data.accessToken, data.refreshToken);
    return data.accessToken as string;
  } catch {
    await tokenStorage.clear();
    return null;
  }
}

/** Renews the sign-in (one renewal shared by everything that asks at the same moment). Null when it cannot be renewed. */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = performRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/** Seconds until an access token expires (read from the token itself); 0 when it cannot be read. */
function secondsLeft(token: string): number {
  try {
    const part = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(globalThis.atob(part)).exp as number;
    return exp - Date.now() / 1000;
  } catch {
    return 0;
  }
}

/** Renews the sign-in BEFORE a long job (a photo upload) if it is about to run out, instead of finding out half way through. */
export async function ensureFreshAccessToken(minSeconds = 180): Promise<void> {
  const token = await tokenStorage.getAccessToken();
  if (token && secondsLeft(token) < minSeconds) await refreshAccessToken();
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean; _noAutoRetry?: boolean })
      | undefined;

    // `_noAutoRetry`: the caller renews the sign-in and re-sends by itself (a photo upload must rebuild its form data, which cannot be re-sent as is).
    if (error.response?.status === 401 && original && !original._retry && !original._noAutoRetry) {
      original._retry = true;
      if (!refreshing) {
        refreshing = performRefresh().finally(() => {
          refreshing = null;
        });
      }
      const newToken = await refreshing;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      onUnauthorized?.();
    }

    return Promise.reject(error);
  },
);
