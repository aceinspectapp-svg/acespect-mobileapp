/**
 * Certificate pinning: the app only talks to the API when the server's certificate chains up to one of the keys below, so a forged
 * certificate (hostile Wi-Fi, a compromised certificate authority, a device with a planted root) cannot read or change the traffic.
 *
 * Only certificate-authority keys are pinned, never the server's own certificate, which Azure renews by itself. The set covers every
 * authority the *.azurewebsites.net chain uses today plus their replacements, so a normal renewal or a Microsoft change of intermediate keeps
 * working. Checked against the live chain on 9 Nov 2026:
 *   *.azurewebsites.net <- Microsoft TLS G2 RSA CA OCSP 16 <- Microsoft TLS RSA Root G2 <- DigiCert Global Root G2
 *
 * Pinning needs the native module, so it only switches on in an app build that includes it (a new APK / iOS build). An older build that gets
 * this code as an update finds the module missing and carries on as before. Off in development (Expo Go, local HTTP) and for any API address
 * that is not on azurewebsites.net: a custom domain needs its own pins checked before it is added here.
 */
import { API_BASE_URL } from '../config/api';

const AZURE_PINS = [
  'SwPJlmyGOywAipWl7ZJUBwRIx7IZ0oMQL2psW26OKs0=', // Microsoft TLS RSA Root G2
  'i7WTqTvh0OioIruIfFR4kMPnBqrS2rdiVPl/s2uC/CY=', // DigiCert Global Root G2
  'uUwZgwDOxcBXrQcntwu+kYFpkiVkOaezL0WYEZ3anJc=', // DigiCert Global Root G3 (backup)
  'svcpi1K/LDysTd/nLeTWgqxYlXWVmC8rYjAa9ZfGmcU=', // Microsoft RSA Root Certificate Authority 2017 (backup)
  'NfU84SZGEeAzQP434ex9TMmGxWE9ynD9BKpEVF8tryg=', // Microsoft ECC Root Certificate Authority 2017 (backup)
];

export type PinningState = 'on' | 'off' | 'unavailable' | 'failed';
let state: PinningState = 'off';
export const sslPinningState = (): PinningState => state;

type PinningModule = {
  isSslPinningAvailable: () => boolean;
  initializeSslPinning: (options: Record<string, { includeSubdomains?: boolean; publicKeyHashes: string[] }>) => Promise<void>;
  addSslPinningErrorListener?: (cb: (e: { serverHostname: string; message?: string }) => void) => { remove: () => void };
};

/** Call once, as early as possible, before the first request. Never throws. */
export async function startSslPinning(onRefused?: (host: string) => void): Promise<PinningState> {
  if (__DEV__ || process.env.EXPO_PUBLIC_SSL_PINNING === 'off') return (state = 'off');
  let host: string;
  try {
    host = new URL(API_BASE_URL).hostname;
  } catch {
    return (state = 'off');
  }
  if (!host.endsWith('.azurewebsites.net')) return (state = 'off');
  let mod: PinningModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('react-native-ssl-public-key-pinning') as PinningModule;
  } catch {
    return (state = 'unavailable');
  }
  try {
    if (!mod.isSslPinningAvailable()) return (state = 'unavailable');
    await mod.initializeSslPinning({ [host]: { includeSubdomains: false, publicKeyHashes: AZURE_PINS } });
    mod.addSslPinningErrorListener?.((e) => onRefused?.(e.serverHostname));
    return (state = 'on');
  } catch {
    return (state = 'failed');
  }
}
