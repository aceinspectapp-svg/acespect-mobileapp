import PgBoss from 'pg-boss';
import { env } from '../config/env';

/** Name of the review queue — shared by the producer (API) and the worker. */
export const REVIEW_QUEUE = 'review';

/** Payload carried by each review job. Kept tiny — the worker re-reads the DB. */
export interface ReviewJobData {
  reviewJobId: string;
  inspectionId: string;
  version: number;
}

/**
 * Deterministic job key so a re-submit of the same inspection version is
 * de-duplicated by the queue instead of enqueued twice.
 */
export function reviewJobKey(inspectionId: string, version: number): string {
  return `${inspectionId}_v${version}`;
}

/**
 * Job queue backed by the app's own PostgreSQL (pg-boss), no extra service. pg-boss
 * keeps its tables in a dedicated `pgboss` schema, so it never touches
 * Prisma's `public` schema or migrations. The pool is deliberately small:
 * small Azure Postgres tiers allow few connections and Prisma shares them.
 */
const PGBOSS_SCHEMA = 'pgboss';
const PGBOSS_POOL_MAX = 3;

let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function startBoss(): Promise<PgBoss> {
  const instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: PGBOSS_SCHEMA,
    max: PGBOSS_POOL_MAX,
    application_name: 'acespect-pgboss',
  });
  // Without a listener an 'error' event would crash the process.
  instance.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('⚠️  pg-boss error:', err);
  });
  await instance.start();
  // 3 attempts in total (1 + 2 retries), exponential backoff from 5s.
  // 'exclusive' keeps at most one pending/running job per key, so a duplicate
  // enqueue of the same inspection version is dropped.
  await instance.createQueue(REVIEW_QUEUE, {
    policy: 'exclusive',
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 30 * 60,
    retentionSeconds: 14 * 24 * 3600,
    deleteAfterSeconds: 7 * 24 * 3600,
  });
  return instance;
}

/**
 * Starts pg-boss (creates its schema on first run) and the review queue.
 * Idempotent: concurrent and repeated calls share one instance. A failed
 * start is not cached, so a later call can try again.
 */
export function startQueue(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss);
  if (!starting) {
    starting = startBoss()
      .then((b) => {
        boss = b;
        return b;
      })
      .finally(() => {
        starting = null;
      });
  }
  return starting;
}

/** Graceful stop: lets running jobs finish, then closes the pool. */
export async function stopQueue(): Promise<void> {
  const current = boss ?? (starting ? await starting.catch(() => null) : null);
  boss = null;
  if (current) await current.stop({ graceful: true, timeout: 20_000 });
}

/**
 * Enqueue a review. Re-submitting a version that is still queued, running or
 * waiting to retry is a no-op (returns null).
 */
export async function enqueueReview(data: ReviewJobData): Promise<string | null> {
  const b = await startQueue();
  return b.send(REVIEW_QUEUE, data, {
    singletonKey: reviewJobKey(data.inspectionId, data.version),
  });
}
