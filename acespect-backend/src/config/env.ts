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

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

  // Allowed Google OAuth client IDs (comma-separated) that may appear as the
  // `aud` of an incoming Google ID token. Empty = Google sign-in disabled.
  GOOGLE_CLIENT_IDS: z.string().default(''),

  // Redis backing the BullMQ review queue.
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Python LangGraph agent service the worker calls per job.
  // Empty = skeleton mode: the worker simulates a review instead of calling AI.
  AI_SERVICE_URL: z.string().default(''),
  // How many review jobs the worker processes concurrently.
  REVIEW_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(2),

  // Egnyte Storage for inspection photos. Empty = storage disabled (photo
  // upload returns 503; the rest of the app runs fine). EGNYTE_DOMAIN is the
  // subdomain part of the org's Egnyte URL (e.g. "houspect" for
  // houspect.egnyte.com). Egnyte's shareable links open a web viewer rather
  // than serving raw bytes, so the app never hands out Egnyte URLs directly —
  // uploadPhoto() returns a URL on this backend (PUBLIC_BASE_URL + /api/v1/media/:id)
  // which proxies the file through using EGNYTE_API_TOKEN server-side.
  EGNYTE_DOMAIN: z.string().default(''),
  EGNYTE_API_TOKEN: z.string().default(''),
  EGNYTE_ROOT_FOLDER: z.string().default('/Shared/Inspection Photos'),
  // This backend's own public URL, used to build photo URLs that proxy to Egnyte.
  PUBLIC_BASE_URL: z.string().default('http://localhost:4000'),
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
