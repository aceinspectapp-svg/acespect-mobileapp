/**
 * Google OAuth client IDs (from Google Cloud Console → Credentials).
 * Set per-platform via EXPO_PUBLIC_* vars in acespect-mobile/.env, e.g.:
 *
 *   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxxx.apps.googleusercontent.com
 *   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=xxxx.apps.googleusercontent.com
 *   EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=xxxx.apps.googleusercontent.com
 *
 * The SAME client IDs must be listed in the backend's GOOGLE_CLIENT_IDS so it
 * accepts the ID token's audience. Until set, the Google button reports that
 * sign-in isn't configured (it never silently no-ops).
 */
export const googleClientIds = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
};

/**
 * TEMP: Google sign-in is disabled until real OAuth client IDs are wired up.
 * Flip back to `true` (and set the EXPO_PUBLIC_GOOGLE_*_CLIENT_ID vars) to
 * re-enable. While false, the Google button is hidden and the auth-session
 * hook is never called (avoids the "webClientId must be defined" crash).
 */
export const GOOGLE_AUTH_ENABLED = false;

export const isGoogleConfigured = Boolean(
  googleClientIds.webClientId ||
    googleClientIds.iosClientId ||
    googleClientIds.androidClientId,
);
