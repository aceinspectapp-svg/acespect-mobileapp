import axios from 'axios';

/**
 * Turns any thrown value (axios error, network failure, timeout) into a
 * human-readable message, preferring the backend's `{ error: { message } }`.
 * A 400 from the `validate()` middleware always carries the same generic
 * top-level message ("Validation failed") -- the actual reason lives in
 * `error.details`, a field -> messages map (Zod's `flatten().fieldErrors`),
 * so that's checked first and its first message shown instead, e.g. "Enter
 * a valid phone number" rather than the useless generic text.
 */
export function getApiErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string; details?: Record<string, string[]> } }
      | undefined;
    const fieldMessage = Object.values(data?.error?.details ?? {})[0]?.[0];
    if (fieldMessage) return fieldMessage;
    if (data?.error?.message) return data.error.message;
    if (err.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
    if (!err.response) return 'Cannot reach the server. Check your connection.';
  }
  return fallback;
}
