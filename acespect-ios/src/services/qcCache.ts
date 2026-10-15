import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Small read-through cache so a field worker with no signal still sees what they last loaded
 * (lists, a defect, pickers, form definitions). Only used for reads; writes go through defectQueue.
 */
const PREFIX = 'qc.cache.v1.';

export const isNetworkError = (e: unknown): boolean => !(e as { response?: unknown }).response;

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* cache only */
  }
}

/** Fetch fresh data and remember it; when the network is down fall back to what was remembered. */
export async function withCache<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T; stale: boolean }> {
  try {
    const data = await fetcher();
    void writeCache(key, data);
    return { data, stale: false };
  } catch (e) {
    if (isNetworkError(e)) {
      const hit = await readCache<T>(key);
      if (hit !== null) return { data: hit, stale: true };
    }
    throw e;
  }
}

export const errorMessage = (e: unknown, fallback = 'Something went wrong'): string => {
  const err = e as { response?: { data?: { error?: { message?: string } } }; message?: string };
  return err.response?.data?.error?.message ?? (isNetworkError(e) ? 'No connection' : err.message) ?? fallback;
};
