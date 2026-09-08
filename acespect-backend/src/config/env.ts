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

  // This backend's own public URL, used to build photo URLs
  // (PUBLIC_BASE_URL + /api/v1/media/:id) that proxy to Postgres-stored
  // photo bytes -- see lib/storage.ts.
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
