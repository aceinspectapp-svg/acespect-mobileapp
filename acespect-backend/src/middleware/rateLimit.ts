import crypto from 'node:crypto';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { verifyAccessToken } from '../utils/jwt';

/**
 * Rate limits. Two things decide whether they are fair:
 *
 *  - WHO a request is counted against. `req.ip` is the visitor's real address (middleware/clientIp.ts); a request carrying a valid login
 *    is counted against that USER, not their address, so a team sharing one office connection, or one person with several tabs open,
 *    does not share a single allowance.
 *  - What a limit is FOR. The strict one guards the sign-in endpoints against password guessing, so it counts per address AND per
 *    account: one person's failed attempts never lock out a colleague. Renewing a login (refresh) happens every few minutes for every
 *    signed-in tab and uses a long random token that cannot be guessed, so it gets a generous limit of its own.
 */

const WINDOW_MS = 15 * 60 * 1000;
// Only the local test harness sets this; it is never set in a deployed environment.
const skip = () => process.env.RATE_LIMIT_OFF === '1';

/** The signed-in user a request belongs to, by a valid access token; null for no token, an expired one or a forged one. */
function userOf(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    return verifyAccessToken(header.slice('Bearer '.length).trim()).sub;
  } catch {
    return null;
  }
}

const address = (req: Request): string => req.ip ?? 'unknown';
const shortHash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

/** Who a sign-in style request is about: the account's email, or the one-time token it carries. Empty when it names neither. */
function subjectOf(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.email === 'string' && body.email.trim()) return `e:${body.email.trim().toLowerCase()}`;
  for (const key of ['mfaToken', 'token']) {
    if (typeof body[key] === 'string' && body[key]) return `t:${shortHash(body[key] as string)}`;
  }
  const param = req.params?.token;
  return typeof param === 'string' && param ? `t:${shortHash(param)}` : '';
}

const tooMany = { error: { message: 'Too many requests -- please wait a few minutes and try again', code: 'RATE_LIMITED' } };

/**
 * Tight limiter for credential endpoints (login/register/password reset/invitations/MFA) to blunt brute-force and
 * credential-stuffing. Counted per address AND per account (or per one-time token), so a shared office connection does not share it.
 */
export const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 20,
  keyGenerator: (req) => `${address(req)}|${subjectOf(req)}`,
  skip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts, please try again later', code: 'RATE_LIMITED' } },
});

/** Renewing a login. Every signed-in tab does this every few minutes, so it must not share the strict credential limit. */
export const refreshLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 300,
  keyGenerator: (req) => address(req),
  skip,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany,
});

/** Default limiter for the rest of the API: per signed-in user, or per address for requests with no valid login. */
export const apiLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: (req) => (userOf(req) ? env.API_RATE_LIMIT_USER : env.API_RATE_LIMIT_ANON),
  keyGenerator: (req) => {
    const user = userOf(req);
    return user ? `user:${user}` : `ip:${address(req)}`;
  },
  skip,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooMany,
});
