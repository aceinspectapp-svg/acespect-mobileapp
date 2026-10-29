import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { drainAudit, flushPhotoBatches, startAuditFlusher } from './lib/auditTrail';
import { ensureBucket, isStorageEnabled } from './lib/storage';
import { startQueue, stopQueue } from './lib/queue';
import { startReviewWorker } from './worker';
import { startQcJobs } from './modules/qc/qc.jobs';
import { ensureTemplateReferenceData } from './modules/qc/qc.templates.service';

async function main() {
  // eslint-disable-next-line no-console
  console.log('▶️  server.js starting...');
  const app = createApp();

  // Verify DB connectivity up front so misconfig surfaces at boot, not mid-request.
  try {
    await prisma.$connect();
    // eslint-disable-next-line no-console
    console.log('✅ Database connected');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Could not connect to the database. Check DATABASE_URL.', err);
  }

  // Photo storage is Egnyte-backed (see lib/storage.ts) -- requires
  // EGNYTE_DOMAIN/EGNYTE_API_TOKEN to be set, or uploads fail loudly at
  // request time rather than silently.
  try {
    if (isStorageEnabled()) {
      await ensureBucket();
      // eslint-disable-next-line no-console
      console.log('✅ Photo storage ready (Egnyte)');
    } else {
      // eslint-disable-next-line no-console
      console.warn('⚠️  EGNYTE_DOMAIN/EGNYTE_API_TOKEN not set — photo uploads will fail.');
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Could not verify photo storage.', err);
  }

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`🚀 acespect-backend listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Standard stages and the seven result codes, created once.
  try {
    await ensureTemplateReferenceData();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Could not seed QC reference data.', err);
  }

  try {
    await (await import('./modules/qc/qc.privacy.service')).ensureSubProcessors();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Could not seed the sub-processor register.', err);
  }

  // Recurring work: SLA scan, DLP reminders, notification digests, retention. Set QC_JOBS=off to run an API-only instance.
  if (process.env.QC_JOBS !== 'off') startQcJobs();

  // Review job queue (pg-boss, in this same Postgres). The review worker runs in-process; set REVIEW_WORKER=off for an API-only instance.
  try {
    await startQueue();
    // eslint-disable-next-line no-console
    console.log('✅ Job queue ready (pg-boss)');
    if (process.env.REVIEW_WORKER !== 'off') await startReviewWorker();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Could not start the job queue (pg-boss) — the API keeps running, but review jobs will not be processed.', err);
  }

  startAuditFlusher();

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} received — shutting down...`);
    server.close(async () => {
      await flushPhotoBatches().catch(() => undefined); // photo summaries still waiting are written before the process ends
      await drainAudit(); // ...and so are audit entries still on their way
      await stopQueue().catch(() => undefined); // running review jobs finish before the queue's pool closes
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Never let a boot failure die silently — always print it and exit non-zero so
// the platform's restart policy (and whoever is watching logs) sees why.
main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('❌ Fatal error during startup:', err);
  process.exit(1);
});
