/** Auth/user shapes — mirror the backend `/api/v1/auth` responses. */

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: string; // 'INSPECTOR' for v1
  createdAt?: string;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

/** What the server answers to a password: a session, or a second step first. */
export type LoginResult =
  | AuthResponse
  | { mfaRequired: true; mfaToken: string }
  | { mfaEnrollRequired: true; mfaToken: string };

/** What an invitation link is for (shown before the person chooses a password). */
export interface InvitationInfo {
  email: string;
  name: string | null;
  termsVersion: string;
  privacyVersion: string;
  organisations?: { clientName: string; role: string }[];
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}
