import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Token persistence backed by the device keychain / keystore (expo-secure-store)
 * — NOT AsyncStorage, so tokens are encrypted at rest and not readable by other
 * apps. Values are small (JWT + 96-char refresh), well under the secure-store limit.
 *
 * expo-secure-store has no real web implementation: getItemAsync there
 * resolves to null harmlessly, but setItemAsync/deleteItemAsync throw. Two
 * consequences, both only on web (native is fully unaffected, this app's
 * primary target):
 *   1. Left unguarded, that throw turned a genuinely successful login into
 *      an "Unable to sign in" error -- the API call succeeded, but the
 *      then-unguarded `setTokens()` throw was caught by the login handler's
 *      own try/catch and reported as a login failure.
 *   2. Even swallowing that throw, nothing was ever actually stored, so
 *      every subsequent request's `getAccessToken()` (apiClient's request
 *      interceptor reads it fresh, not from in-memory state) would resolve
 *      null and go out with no Authorization header -- login would appear
 *      to succeed and then every following API call would 401.
 * An in-memory fallback used only on web fixes both: real, but session-only
 * (lost on refresh, which is an acceptable limitation for what's fundamentally
 * a mobile app's web target, not a persistent web product).
 */
const ACCESS_KEY = 'acespect.accessToken';
const REFRESH_KEY = 'acespect.refreshToken';

const memoryStore = new Map<string, string>();
const isWeb = Platform.OS === 'web';

async function safe(op: () => Promise<unknown>): Promise<void> {
  try {
    await op();
  } catch {
    // no-op -- see file-level note above
  }
}

export const tokenStorage = {
  getAccessToken: () => (isWeb ? Promise.resolve(memoryStore.get(ACCESS_KEY) ?? null) : SecureStore.getItemAsync(ACCESS_KEY)),
  getRefreshToken: () => (isWeb ? Promise.resolve(memoryStore.get(REFRESH_KEY) ?? null) : SecureStore.getItemAsync(REFRESH_KEY)),

  async setTokens(accessToken: string, refreshToken: string): Promise<void> {
    if (isWeb) {
      memoryStore.set(ACCESS_KEY, accessToken);
      memoryStore.set(REFRESH_KEY, refreshToken);
      return;
    }
    await Promise.all([
      safe(() => SecureStore.setItemAsync(ACCESS_KEY, accessToken)),
      safe(() => SecureStore.setItemAsync(REFRESH_KEY, refreshToken)),
    ]);
  },

  async clear(): Promise<void> {
    if (isWeb) {
      memoryStore.delete(ACCESS_KEY);
      memoryStore.delete(REFRESH_KEY);
      return;
    }
    await Promise.all([
      safe(() => SecureStore.deleteItemAsync(ACCESS_KEY)),
      safe(() => SecureStore.deleteItemAsync(REFRESH_KEY)),
    ]);
  },
};
