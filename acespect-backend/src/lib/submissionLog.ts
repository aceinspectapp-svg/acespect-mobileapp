import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Durable trail of the mobile app's submit/update/finalize/photo-upload
 * attempts reaching (or failing to reach) the database -- surfaced in the
 * admin dashboard (Troubleshooting page) so "did this inspector's job
 * actually arrive, and if not, why" is answerable without server-log or
 * database access. Console logging (see inspections.controller.ts,
 * errorHandler.ts) still happens alongside this for anyone watching
 * `railway logs` live; this is the same information made durable and
 * queryable instead of scrolling off.
 *
 * Fire-and-forget by design: a logging failure must never be the reason a
 * real submission fails, so every call site awaits this but the promise
 * itself never rejects -- it swallows its own errors after a console.error.
 */
/**
 * Keeps the trail from growing for ever (one row is written for every photo): routine events are dropped after 30 days, the ones an admin
 * investigates (warnings, failures, rejections) after 180. Deleted in slices so one run never holds the table for long.
 */
export async function pruneSubmissionLog(now = new Date()): Promise<{ routine: number; other: number }> {
  const day = 24 * 3600 * 1000;
  const slice = async (where: Prisma.SubmissionLogEntryWhereInput): Promise<number> => {
    let total = 0;
    for (let i = 0; i < 40; i++) {
      const ids = await prisma.submissionLogEntry.findMany({ where, select: { id: true }, take: 2000 });
      if (ids.length === 0) break;
      total += (await prisma.submissionLogEntry.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } })).count;
      if (ids.length < 2000) break;
    }
    return total;
  };
  const routine = await slice({ event: { in: ['received', 'saved', 'updated', 'finalized', 'photo_uploaded'] }, createdAt: { lt: new Date(now.getTime() - 30 * day) } });
  const other = await slice({ createdAt: { lt: new Date(now.getTime() - 180 * day) } });
  return { routine, other };
}

export async function recordSubmissionEvent(entry: {
  event: 'received' | 'saved' | 'updated' | 'finalized' | 'photo_uploaded' | 'rejected' | 'failed' | 'warning';
  inspectorId?: string | null;
  inspectionId?: string | null;
  jobNo?: string | null;
  statusCode?: number | null;
  message?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.submissionLogEntry.create({
      data: {
        event: entry.event,
        inspectorId: entry.inspectorId ?? null,
        inspectionId: entry.inspectionId ?? null,
        jobNo: entry.jobNo ?? null,
        statusCode: entry.statusCode ?? null,
        message: entry.message ?? null,
        detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Failed to record submission log entry.', err);
  }
}

/**
 * Only the inspections router (mobile's whole submit/update/finalize/photo
 * surface -- see inspections.routes.ts, which carries nothing unrelated) gets
 * a durable `[reject]` row. Every other 4xx in the app (auth, admin edits,
 * template management, ...) stays console-only, same as before.
 */
export function isSubmissionPath(originalUrl: string): boolean {
  return originalUrl.startsWith('/api/v1/inspections');
}
