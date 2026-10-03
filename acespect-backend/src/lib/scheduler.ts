import { prisma } from './prisma';

/**
 * Minimal in-process scheduler for the platform's recurring work (SLA clocks,
 * reminders, digests, retention). It runs inside the API process, so there is
 * no extra service to deploy. A lease row per job means that when several
 * instances run, only one executes each tick (REQ-TEN-001 scenario 3 also
 * applies: jobs below always scope their queries per tenant).
 */
interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
}

const jobs: Job[] = [];
const timers: NodeJS.Timeout[] = [];

export function registerJob(job: Job): void {
  if (!jobs.some((j) => j.name === job.name)) jobs.push(job);
}

/** Take the lease for a job if nobody else holds it. Returns true when this instance should run it. */
async function acquire(name: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  await prisma.qcJobLease.upsert({ where: { name }, create: { name, leasedUntil: new Date(0) }, update: {} });
  const res = await prisma.qcJobLease.updateMany({ where: { name, leasedUntil: { lt: now } }, data: { leasedUntil: until } });
  return res.count === 1;
}

export async function runJobOnce(job: Job): Promise<void> {
  if (!(await acquire(job.name, Math.max(job.everyMs - 1000, 30_000)))) return;
  try {
    await job.run();
    await prisma.qcJobLease.update({ where: { name: job.name }, data: { lastRunAt: new Date(), lastStatus: 'ok' } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[scheduler] job ${job.name} failed`, err);
    await prisma.qcJobLease.update({ where: { name: job.name }, data: { lastRunAt: new Date(), lastStatus: `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) } }).catch(() => undefined);
  }
}

export function startScheduler(): void {
  if (timers.length) return;
  for (const job of jobs) {
    // Stagger the first run so a restart does not stampede.
    const first = setTimeout(() => void runJobOnce(job), 20_000 + Math.floor(Math.random() * 10_000));
    first.unref();
    const t = setInterval(() => void runJobOnce(job), job.everyMs);
    t.unref();
    timers.push(first, t);
  }
  // eslint-disable-next-line no-console
  console.log(`⏱️  scheduler started (${jobs.map((j) => j.name).join(', ') || 'no jobs'})`);
}

export function stopScheduler(): void {
  timers.splice(0).forEach((t) => clearTimeout(t));
}

export const registeredJobs = () => jobs.map((j) => ({ name: j.name, everyMs: j.everyMs }));
