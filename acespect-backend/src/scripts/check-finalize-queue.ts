/**
 * Checks that a review queue that is down cannot fail (or lose) a submission. The phone retries any failed submit, and the inspection is
 * already in the reviewers' list by the time the queue is asked, so the server must answer "submitted" and queue the review later.
 * It breaks the queue by dropping pg-boss's schema, so it refuses to run anywhere but a local scratch database:
 *
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public npm run check:finalize-queue
 */
import { prisma } from '../lib/prisma';
import { requeueStrandedReviews, startQueue, stopQueue } from '../lib/queue';
import { inspectionsService } from '../modules/inspections/inspections.service';

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  console.error('Refusing to run: DATABASE_URL must point at a local scratch database.');
  process.exit(1);
}

let failed = false;
const ok = (cond: unknown, label: string) => {
  if (!cond) failed = true;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
};

async function main() {
  const user = await prisma.user.findFirstOrThrow();
  const created = await inspectionsService.submit(user.id, { inspectionType: 'Dilapidation', propertyType: 'Commercial Properties', jobNo: 'CHECK-FINALIZE-QUEUE', address: 'x', suburb: 'x', client: 'x', sections: [] } as never);
  const id = created.inspection.id;
  try {
    await startQueue();
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS pgboss CASCADE'); // the queue is now broken under the running process
    const done = await inspectionsService.finalize(id, user.id);
    ok(done.inspection.status === 'SUBMITTED', 'finalize answers "submitted" even though the queue is down');
    const job = await prisma.reviewJob.findFirstOrThrow({ where: { inspectionId: id } });
    ok(job.status === 'QUEUED' && /Not queued/.test(job.error ?? ''), 'the review job is kept and says why it was not queued');
    const again = await inspectionsService.finalize(id, user.id).then((r) => r.inspection.status, (e: Error) => `refused: ${e.message}`);
    ok(again === 'SUBMITTED', `a phone asking again is told it is submitted, not refused (${String(again).slice(0, 60)})`);
    ok((await prisma.reviewJob.count({ where: { inspectionId: id } })) === 1, 'and no second review job is created');

    await prisma.reviewJob.update({ where: { id: job.id }, data: { queuedAt: new Date(Date.now() - 10 * 60_000) } });
    await stopQueue().catch(() => undefined);
    await startQueue(); // pg-boss rebuilds its schema on start: the queue is back
    const n = await requeueStrandedReviews();
    ok(n >= 1, 'the sweep queues the stranded review once the queue is back');
    const queued = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM pgboss.job WHERE singleton_key LIKE '${id}%'`);
    ok(Number(queued[0]?.n ?? 0) === 1, 'and it is really in the queue (once)');
    const after = await prisma.reviewJob.findUniqueOrThrow({ where: { id: job.id } });
    ok(after.error === null, 'and the note is cleared');
  } finally {
    await prisma.inspection.delete({ where: { id } });
    await stopQueue().catch(() => undefined);
  }
  console.log(failed ? '\nFAILED' : '\nall checks passed');
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
