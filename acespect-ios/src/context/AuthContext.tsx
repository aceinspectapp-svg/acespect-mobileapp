import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { authApi } from '../services/authApi';
import { setOnUnauthorized } from '../services/apiClient';
import { tokenStorage } from '../services/tokenStorage';
import { AuthUser, RegisterInput } from '../types/auth';

/** Thrown by signIn when the account has two-step verification: the screen then asks for the code. */
export class MfaChallenge extends Error {
  constructor(public readonly mfaToken: string) {
    super('Enter the code from your authenticator app');
    this.name = 'MfaChallenge';
  }
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True only during the initial "is there a valid session?" check at launch. */
  isBootstrapping: boolean;
  /** True while a sign-in / sign-up request is in flight. */
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Second sign-in step: the authenticator (or backup) code. */
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  /** Exchange a verified Google ID token for an app session. */
  loginWithGoogleIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Real auth backed by the acespect-backend API.
 *
 * Access is denied by default: on launch we treat the user as unauthenticated
 * and only set them once a stored session is validated against `/auth/me`
 * (with automatic token refresh). Navigation is gated on `isAuthenticated`,
 * so the inspection screens are unreachable without a valid token.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Restore session on launch + react to a hard auth failure from the client.
  useEffect(() => {
    // If a refresh ultimately fails mid-session, drop the user back to login.
    setOnUnauthorized(() => setUser(null));

    // Dev-only escape hatch: when EXPO_PUBLIC_AUTH_BYPASS=1, seed a fake user so
    // the whole app is reachable with no backend / no sign-in. Inert (and absent
    // from real builds) unless the flag is explicitly set.
    if (process.env.EXPO_PUBLIC_AUTH_BYPASS === '1') {
      setUser({
        id: 'dev-bypass',
        email: 'dev@local',
        name: 'Dev Inspector',
        role: 'INSPECTOR',
      });
      setIsBootstrapping(false);
      return;
    }

    (async () => {
      try {
        const [access, refresh] = await Promise.all([
          tokenStorage.getAccessToken(),
          tokenStorage.getRefreshToken(),
        ]);
        if (!access && !refresh) return; // no stored session → stay logged out
        const me = await authApi.me(); // interceptor refreshes if access expired
        setUser(me);
      } catch {
        await tokenStorage.clear();
        setUser(null);
      } finally {
        setIsBootstrapping(false);
      }
    })();

    return () => setOnUnauthorized(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await authApi.login({ email, password });
      if ('mfaRequired' in res) throw new MfaChallenge(res.mfaToken);
      if ('mfaEnrollRequired' in res) {
        throw new Error('Your role needs two-step verification. Sign in on the ACE SPECT web portal to set it up, then sign in here.');
      }
      await tokenStorage.setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    setIsLoading(true);
    try {
      const res = await authApi.verifyMfa(mfaToken, code);
      await tokenStorage.setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    setIsLoading(true);
    try {
      const res = await authApi.register(input);
      await tokenStorage.setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loginWithGoogleIdToken = useCallback(async (idToken: string) => {
    setIsLoading(true);
    try {
      const res = await authApi.google(idToken);
      await tokenStorage.setTokens(res.accessToken, res.refreshToken);
      setUser(res.user);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    const refresh = await tokenStorage.getRefreshToken();
    if (refresh) {
      try {
        await authApi.logout(refresh); // best-effort server-side revoke
      } catch {
        // ignore — we clear locally regardless
      }
    }
    await tokenStorage.clear();
    setUser(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      isAuthenticated: !!user,
      isBootstrapping,
      isLoading,
      signIn,
      verifyMfa,
      register,
      loginWithGoogleIdToken,
      signOut,
    }),
    [user, isBootstrapping, isLoading, signIn, verifyMfa, register, loginWithGoogleIdToken, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
