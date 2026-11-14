import 'dotenv/config';
import { z } from 'zod';

/**
 * Validated environment. The process refuses to start with bad/missing config
 * (fail fast) rather than throwing deep inside a request later.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // Encryption of the database connection. "auto" (default): Azure Database for PostgreSQL is always reached over TLS with its certificate
  // checked; other hosts (local, Railway's private network) are left as configured. "require": the same for any host. "off": leave the URL alone.
  DATABASE_TLS: z.enum(['auto', 'require', 'off']).default('auto'),
  // Prisma's connection pool. Prisma's own default is 2 x CPUs + 1, which on a 1-CPU App Service is 3 -- far too few when a report's
  // photographs are fetched. DATABASE_CONNECTION_LIMIT: connections Prisma may open; DATABASE_POOL_TIMEOUT: seconds a query waits for a free one
  // before failing. pg-boss keeps its own, separate pool of 3 (lib/queue.ts), so the app opens at most DATABASE_CONNECTION_LIMIT + 3 in all
  // (the standalone worker, if run, as many again). A connection_limit / pool_timeout already in DATABASE_URL wins.
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_POOL_TIMEOUT: z.coerce.number().int().min(0).max(300).default(20),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // A refresh token is single-use (each refresh hands out a new one), so a renewal whose answer never arrived -- a restart mid-request,
  // a dropped connection, two tabs renewing together -- would otherwise end the session for good. For this many seconds after a token was
  // swapped, presenting it again is answered with another new pair instead of "invalid". 0 turns it off.
  REFRESH_REUSE_LEEWAY_SEC: z.coerce.number().int().min(0).default(60),

  // Which request header carries the visitor's real address, for rate limits and the security log. Behind Railway's edge, Express's own
  // `req.ip` is unreliable (Railway does not fix how many proxies sit in front, and the address it finds is often one of Railway's own
  // servers, shared by every visitor), and Railway sets X-Real-IP itself on every request. Empty = use Express's `req.ip` (local
  // development, tests). Defaults to x-real-ip when running on Railway.
  CLIENT_IP_HEADER: z.string().default(process.env.RAILWAY_ENVIRONMENT ? 'x-real-ip' : ''),
  // API requests allowed per 15 minutes: per signed-in user, and per address for requests with no valid login.
  API_RATE_LIMIT_USER: z.coerce.number().int().positive().default(1500),
  API_RATE_LIMIT_ANON: z.coerce.number().int().positive().default(300),

  // Allowed Google OAuth client IDs (comma-separated) that may appear as the
  // `aud` of an incoming Google ID token. Empty = Google sign-in disabled.
  GOOGLE_CLIENT_IDS: z.string().default(''),

  // Python LangGraph agent service the worker calls per job.
  // Empty = skeleton mode: the worker simulates a review instead of calling AI.
  AI_SERVICE_URL: z.string().default(''),
  // How many review jobs the worker processes concurrently.
  REVIEW_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // This backend's own public URL, used to build photo URLs
  // (PUBLIC_BASE_URL + /api/v1/media/:id) that proxy through to wherever the
  // bytes actually live -- see lib/storage.ts.
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),


  // Where photos and report files are kept (see lib/storage.ts): Azure Blob Storage, or Egnyte (kept for now). Defaults to Azure in
  // production and Egnyte elsewhere, so existing local setups behave as before.
  STORAGE_PROVIDER: z.enum(['azure', 'egnyte']).optional(),
  // Azure Blob Storage. In Azure the backend signs in as its managed identity (no key or SAS): set the account name and the container.
  // AZURE_STORAGE_CONNECTION_STRING is for local development against the Azurite emulator and takes priority when set.
  AZURE_STORAGE_ACCOUNT_NAME: z.string().default(''),
  AZURE_STORAGE_CONTAINER: z.string().regex(/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){1,61}[a-z0-9]$/, 'AZURE_STORAGE_CONTAINER must be 3-63 lowercase letters, digits or hyphens').default('inspection-photos'),
  AZURE_STORAGE_CONNECTION_STRING: z.string().default(''),

  // Egnyte-backed photo storage (see lib/storage.ts). Empty EGNYTE_DOMAIN/
  // EGNYTE_API_TOKEN means storage is unconfigured -- isStorageEnabled()
  // returns false and photo uploads fail loudly rather than silently.
  EGNYTE_DOMAIN: z.string().default(''),
  EGNYTE_API_TOKEN: z.string().default(''),
  // Test only: a stand-in Egnyte server (scripts/check-egnyte-upload.ts). Leave empty in production.
  EGNYTE_BASE_URL: z.string().default(''),
  EGNYTE_ROOT_FOLDER: z.string().default('/Shared/ACE SPECT/inspection-photos'),

  // The web app's own origin -- the PDF pipeline points a headless browser
  // at `${WEB_APP_URL}/report/:id` (the same page a reviewer already sees)
  // rather than re-rendering the report a second time; see lib/reportPdf.ts.
  WEB_APP_URL: z.string().default('http://localhost:5173'),

  // Outbound email for invitations, resets and notifications (REQ-NOT-001).
  // Empty SMTP_URL = email is skipped (in-app notifications still work).
  // Example: smtp://user:pass@smtp.example.com:587
  SMTP_URL: z.string().default(''),
  // Who is emailed about failed or incomplete submissions (comma separated). Empty = every active admin account's own email.
  ALERT_EMAILS: z.string().default(''),
  MAIL_FROM: z.string().default('ACE SPECT <no-reply@acespect.app>'),
  // Optional SMS gateway for Safety Hazard alerts: a webhook that accepts
  // POST { to, message }. Empty = SMS skipped. Needs a sub-processor
  // assessment before use (REQ-TEN-004).
  SMS_WEBHOOK_URL: z.string().default(''),
  // Optional Expo push access token (higher rate limits); push works without it.
  EXPO_ACCESS_TOKEN: z.string().default(''),
  // Roles that must use MFA (comma separated: SA, CLIENT_ADMIN, PRIVATE_INSPECTOR, ...).
  // The spec requires it for Super Admin, Client Admin and Private Inspector; the
  // default is Client Admin only so existing admin and mobile inspector accounts
  // are not locked out before they have enrolled. Clients can also require MFA
  // for all their roles (client setting).
  MFA_REQUIRED_ROLES: z.string().default('CLIENT_ADMIN'),
  // Houspect (platform) roles that must use two-step sign-in, comma separated, e.g. ADMIN,REVIEWER. Empty = not enforced (the default); turn it on
  // once every admin and reviewer has been told, because each must then set up an authenticator at their next sign-in.
  MFA_REQUIRED_PLATFORM_ROLES: z.string().default(''),
  // Can anyone create an account from the phone app (POST /auth/register, Google sign-up)? Off by default: accounts come from an administrator's
  // invitation (Admin -> Users). Set SELF_SIGNUP=on only for local tests.
  SELF_SIGNUP: z.enum(['on', 'off']).default('off'),
  // Allowed Microsoft Entra (Azure AD) application IDs for SSO; empty = disabled.
  MICROSOFT_CLIENT_IDS: z.string().default(''),
  // Versions of the privacy collection notice and terms of use users accept at activation.
  TERMS_VERSION: z.string().default('2026-10'),
  PRIVACY_VERSION: z.string().default('2026-10'),
  // Minutes a support-mode session lasts (REQ-TEN-008).
  SUPPORT_SESSION_MINUTES: z.coerce.number().int().positive().default(60),
  // Signed evidence links expire after this many minutes (REQ-TEN-002).
  MEDIA_LINK_MINUTES: z.coerce.number().int().positive().default(15),
  /** How long the "download all original photos" link printed in a report keeps working (days). */
  ORIGINAL_PHOTOS_LINK_DAYS: z.coerce.number().int().positive().max(3650).default(365),
  // Inspection photos are served through signed links only. To roll the signed links out without breaking installed apps and open web tabs,
  // the old unsigned links keep working until this moment (an ISO date such as 2026-12-01 or 2026-12-01T00:00:00Z; a date alone means 00:00 UTC),
  // and every unsigned access is logged. Empty (the default) = unsigned links are refused straight away.
  MEDIA_ALLOW_UNSIGNED_UNTIL: z.string().trim().optional().refine((v) => !v || !Number.isNaN(Date.parse(v)), 'must be a date such as 2026-12-01'),

});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';

/**
 * The database URL with TLS switched on where it must be. `sslmode=require` makes both Prisma and node-postgres (pg-boss) encrypt;
 * `sslaccept=strict` makes Prisma also check the server certificate (node-postgres checks it by default). Parameters already in the URL win.
 */
export function withDatabaseTls(url: string, mode: 'auto' | 'require' | 'off'): string {
  if (mode === 'off') return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const azure = /\.postgres\.database\.azure\.com$/i.test(u.hostname);
  if (mode === 'auto' && !azure) return url;
  if (!u.searchParams.has('sslmode')) u.searchParams.set('sslmode', 'require');
  if (!u.searchParams.has('sslaccept')) u.searchParams.set('sslaccept', 'strict');
  return u.toString();
}

/**
 * The database URL with Prisma's pool size and pool wait set, the same way withDatabaseTls adds TLS: parameters already in the URL win, and a
 * URL that cannot be read is left as it is. These two parameters mean something only to Prisma, so only Prisma's copy of the URL gets them.
 */
export function withPrismaPool(url: string, connectionLimit: number, poolTimeoutSec: number): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', String(connectionLimit));
  if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', String(poolTimeoutSec));
  return u.toString();
}

env.DATABASE_URL = withDatabaseTls(env.DATABASE_URL, env.DATABASE_TLS);
/** Prisma's URL: TLS as above, plus its pool size. pg-boss (lib/queue.ts) is given env.DATABASE_URL, without the Prisma-only pool parameters. */
export const prismaDatabaseUrl = withPrismaPool(env.DATABASE_URL, env.DATABASE_CONNECTION_LIMIT, env.DATABASE_POOL_TIMEOUT);
// Prisma reads the URL from the environment when its client starts (lib/prisma.ts imports this module first).
process.env.DATABASE_URL = prismaDatabaseUrl;
