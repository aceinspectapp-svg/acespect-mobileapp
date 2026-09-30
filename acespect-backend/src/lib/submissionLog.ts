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
export async function recordSubmissionEvent(entry: {
  event: 'received' | 'saved' | 'updated' | 'finalized' | 'photo_uploaded' | 'rejected';
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
