import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt';

// Only the local test harness sets this; it is never set in a deployed environment.
const off = () => process.env.RATE_LIMIT_OFF === '1';

/**
 * Who a request counts against: the signed-in user when the token is valid (the signature is checked, so this cannot be forged to
 * dodge the limit), otherwise the network address. A whole office usually shares ONE address, so counting by address alone let
 * one busy reviewer -- or one person mistyping a password -- lock out everyone else at the same desk.
 */
function who(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      return `user:${verifyAccessToken(header.slice('Bearer '.length).trim()).sub}`;
    } catch {
      /* an invalid token is treated as anonymous */
    }
  }
  return `ip:${req.ip}`;
}

const wait = (seconds: number): string => (seconds < 90 ? `${seconds} second${seconds === 1 ? '' : 's'}` : `${Math.ceil(seconds / 60)} minutes`);

/** A 429 that says how long to wait (message, Retry-After header and retryAfterSeconds), so the apps can show it or retry by themselves. */
function refuse(what: string) {
  return (req: Request, res: Response): void => {
    const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
    const seconds = Math.max(1, Math.ceil(((reset?.getTime() ?? Date.now() + 60_000) - Date.now()) / 1000));
    res.set('Retry-After', String(seconds));
    res.status(429).json({ error: { message: `${what} Please wait ${wait(seconds)} and try again.`, code: 'RATE_LIMITED', retryAfterSeconds: seconds } });
  };
}

const base = { windowMs: 15 * 60 * 1000, skip: off, standardHeaders: true, legacyHeaders: false } as const;

/**
 * Sign-in: only FAILED attempts count (a correct password never uses up the allowance), per account and address together -- so
 * mistyping one person's password cannot lock the others out -- plus a much looser per-address ceiling against credential stuffing.
 */
export const loginByAccount = rateLimit({
  ...base,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String((req.body as { email?: unknown })?.email ?? '').trim().toLowerCase()}`,
  handler: refuse('Too many failed sign-in attempts for this account.'),
});
export const loginByAddress = rateLimit({
  ...base,
  limit: 80,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}`,
  handler: refuse('Too many failed sign-in attempts from this network.'),
});

/** The rest of the credential endpoints (sign-up, password reset, invitations): tight, by address. */
export const authLimiter = rateLimit({
  ...base,
  limit: 20,
  handler: refuse('Too many attempts.'),
});

/** Renewing a session happens on its own every few minutes in every open tab, so it gets its own, generous allowance. */
export const refreshLimiter = rateLimit({
  ...base,
  limit: 200,
  handler: refuse('Too many session renewals.'),
});

/** The rest of the API: counted per signed-in user (1500 requests / 15 min), or per address when not signed in (300). */
export const apiLimiter = rateLimit({
  ...base,
  limit: (req) => (who(req).startsWith('user:') ? 1500 : 300),
  keyGenerator: who,
  handler: refuse('Too many requests.'),
});
