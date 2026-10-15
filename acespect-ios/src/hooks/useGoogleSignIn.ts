import { useEffect, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { GOOGLE_AUTH_ENABLED, googleClientIds, isGoogleConfigured } from '../config/google';
import { getApiErrorMessage } from '../services/apiError';

// Required so the auth popup/redirect can dismiss and return to the app.
WebBrowser.maybeCompleteAuthSession();

interface UseGoogleSignIn {
  /** Launch the Google account chooser. */
  signIn: () => Promise<void>;
  /** True while exchanging the Google token with our backend. */
  busy: boolean;
  /** Latest error message (config missing, cancelled, backend rejected, …). */
  error: string | null;
  configured: boolean;
}

/**
 * Google sign-in via expo-auth-session. On success we receive a Google ID
 * token and hand it to `onIdToken` (which posts it to our backend for
 * verification + session issue). The app never trusts the token directly.
 */
function useGoogleSignInLive(
  onIdToken: (idToken: string) => Promise<void>,
): UseGoogleSignIn {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: googleClientIds.webClientId,
    iosClientId: googleClientIds.iosClientId,
    androidClientId: googleClientIds.androidClientId,
  });

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!response) return;
    if (response.type === 'success') {
      const idToken = response.params?.id_token;
      if (!idToken) {
        setError('Google did not return an ID token.');
        return;
      }
      setBusy(true);
      setError(null);
      onIdToken(idToken)
        .catch((e) => setError(getApiErrorMessage(e, 'Google sign-in failed.')))
        .finally(() => setBusy(false));
    } else if (response.type === 'error') {
      setError('Google sign-in failed. Please try again.');
    }
    // 'cancel' / 'dismiss' → silently ignore
  }, [response, onIdToken]);

  const signIn = async () => {
    setError(null);
    if (!isGoogleConfigured) {
      setError('Google sign-in isn’t configured yet.');
      return;
    }
    await promptAsync();
  };

  return { signIn, busy, error, configured: isGoogleConfigured && !!request };
}

/** No-op stand-in used while Google sign-in is disabled (see GOOGLE_AUTH_ENABLED). */
function useGoogleSignInDisabled(): UseGoogleSignIn {
  return {
    signIn: async () => {},
    busy: false,
    error: null,
    configured: false,
  };
}

/**
 * Selected at module load by the GOOGLE_AUTH_ENABLED flag so the expo-auth-session
 * hook is never mounted while Google sign-in is off (keeps hook order stable).
 */
export const useGoogleSignIn = GOOGLE_AUTH_ENABLED
  ? useGoogleSignInLive
  : useGoogleSignInDisabled;
