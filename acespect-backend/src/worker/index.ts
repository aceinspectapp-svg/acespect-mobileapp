import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { REVIEW_QUEUE, ReviewJobData, startQueue, stopQueue } from '../lib/queue';
import { processReview } from './reviewProcessor';

/**
 * Registers the review worker on the pg-boss queue. Called in-process by the
 * API (server.ts) or by the standalone entry below (`npm run start:worker`),
 * so AI/queue load can still be split into its own process when needed.
 * pg-boss v11 has no concurrency option, so concurrency is N parallel workers
 * that each take one job at a time.
 */
export async function startReviewWorker(): Promise<void> {
  const boss = await startQueue();

  for (let i = 0; i < env.REVIEW_QUEUE_CONCURRENCY; i++) {
    await boss.work<ReviewJobData>(REVIEW_QUEUE, { batchSize: 1, pollingIntervalSeconds: 2 }, async (jobs) => {
      for (const job of jobs) {
        try {
          await processReview(job);
          // eslint-disable-next-line no-console
          console.log(`✅ review job ${job.id} done`);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(`❌ review job ${job.id} failed: ${err instanceof Error ? err.message : String(err)}`);
          throw err; // pg-boss marks the attempt failed and retries with backoff
        }
      }
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `🤖 review worker ready (concurrency ${env.REVIEW_QUEUE_CONCURRENCY}, ` +
      `AI ${env.AI_SERVICE_URL ? env.AI_SERVICE_URL : 'SIMULATED'})`,
  );
}

/** Standalone worker process. Run separately from the API (`npm run dev:worker`). */
async function main() {
  await startReviewWorker();

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received — closing worker...`);
    await stopQueue();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('❌ review worker failed to start:', err);
    process.exit(1);
  });
}
