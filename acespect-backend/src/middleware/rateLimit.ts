import rateLimit from 'express-rate-limit';

/**
 * Tight limiter for credential endpoints (login/register/refresh) to blunt
 * brute-force and credential-stuffing. Keyed by IP.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  // Only the local test harness sets this; it is never set in a deployed environment.
  skip: () => process.env.RATE_LIMIT_OFF === '1',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts, please try again later', code: 'RATE_LIMITED' } },
});

/** Looser default limiter for the rest of the API. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  skip: () => process.env.RATE_LIMIT_OFF === '1',
  standardHeaders: true,
  legacyHeaders: false,
});
