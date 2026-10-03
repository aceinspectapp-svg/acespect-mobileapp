import axios from 'axios';
import { API_URL } from '../config/api';
import { api } from './apiClient';
import { AuthResponse, AuthUser, LoginInput, LoginResult, RegisterInput } from '../types/auth';

/**
 * Auth API.
 *
 * register / login / logout use a bare client (no auth interceptor): a 401 on
 * login means "bad credentials", and must NOT trigger a token-refresh+retry.
 * `me` uses the authenticated `api` so it benefits from auto-refresh.
 */
const bare = axios.create({ baseURL: API_URL, timeout: 15000 });

export const authApi = {
  register: (input: RegisterInput): Promise<AuthResponse> =>
    bare.post<AuthResponse>('/auth/register', input).then((r) => r.data),

  login: (input: LoginInput): Promise<LoginResult> =>
    bare.post<LoginResult>('/auth/login', input).then((r) => r.data),

  verifyMfa: (mfaToken: string, code: string): Promise<AuthResponse> =>
    bare.post<AuthResponse>('/auth/mfa/verify', { mfaToken, code }).then((r) => r.data),

  google: (idToken: string): Promise<AuthResponse> =>
    bare.post<AuthResponse>('/auth/google', { idToken }).then((r) => r.data),

  logout: (refreshToken: string): Promise<void> =>
    bare.post('/auth/logout', { refreshToken }).then(() => undefined),

  me: (): Promise<AuthUser> =>
    api.get<{ user: AuthUser }>('/auth/me').then((r) => r.data.user),
};
