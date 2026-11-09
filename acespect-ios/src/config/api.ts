/**
 * API endpoint configuration.
 *
 * The phone cannot reach the PC's `localhost`, so on a physical device the
 * base URL must be the machine's LAN IP (or a tunnel). Override per-machine
 * without editing code by setting EXPO_PUBLIC_API_URL (Expo inlines any
 * EXPO_PUBLIC_* var at build time), e.g. in acespect-mobile/.env:
 *
 *   EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
 *
 * Reach-ability cheatsheet:
 *   • Physical device, same Wi-Fi  → http://<PC-LAN-IP>:4000
 *   • Android emulator             → http://10.0.2.2:4000
 *   • iOS simulator                → http://localhost:4000
 *   • Wi-Fi blocks LAN (as with the Expo tunnel) → tunnel the backend too
 */
const DEFAULT_DEV_BASE_URL = 'http://172.19.69.51:4000'; // this PC's Wi-Fi IP

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_DEV_BASE_URL;

/**
 * Release builds only ever talk to the API over HTTPS. A build accidentally made with an http:// address stops with a clear message
 * instead of sending passwords and inspection data in the clear. Plain http stays allowed in development (a PC on the local Wi-Fi).
 */
function requireHttps(url: string): string {
  if (!__DEV__ && !url.startsWith('https://')) {
    throw new Error(`This build is set to use an insecure API address (${url}). Release builds must use https://. Rebuild with an https EXPO_PUBLIC_API_URL.`);
  }
  return url;
}

export const API_BASE_URL = requireHttps(configuredBaseUrl);

/** Versioned API prefix. */
export const API_PREFIX = '/api/v1';

export const API_URL = `${API_BASE_URL}${API_PREFIX}`;

/** Photo and file links come back as `/api/v1/media/<id>?e=...&s=...`; make them absolute for <Image>. */
export function mediaUri(url: string): string {
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}
