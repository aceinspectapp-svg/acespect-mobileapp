import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import {
  serializeInspection,
  serializeSection,
  serializeUser,
  WEB_TO_INS_STATUS,
  WEB_TO_REV_STATUS,
} from './web.serializers';
import { DamageUpdateInput, InspectionUpdateInput, SectionUpdateInput, UserUpdateInput } from './web.schemas';

const SECTIONS_INCLUDE = {
  sections: {
    orderBy: { order: 'asc' as const },
    include: { damages: { orderBy: { order: 'asc' as const } } },
  },
};

/** Role-scoped list: inspector → own; reviewer → assigned (non-draft); admin → all. */
async function listInspections(user: { id: string; role: string }) {
  let where: Prisma.InspectionWhereInput = {};
  if (user.role === 'REVIEWER') where = { reviewerId: user.id, status: { not: 'DRAFT' } };
  else if (user.role === 'INSPECTOR') where = { inspectorId: user.id };
  // ADMIN → all

  const rows = await prisma.inspection.findMany({
    where,
    orderBy: { date: 'desc' },
    include: SECTIONS_INCLUDE,
  });
  return rows.map((r) => serializeInspection(r));
}

async function getInspection(id: string) {
  const row = await prisma.inspection.findUnique({ where: { id }, include: SECTIONS_INCLUDE });
  if (!row) throw ApiError.notFound('Inspection not found');
  return serializeInspection(row);
}

async function listUsers() {
  const rows = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'REVIEWER', 'INSPECTOR'] } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(serializeUser);
}

/** Admin edits another user's profile (name/phone/region/license). */
async function updateUser(id: string, input: UserUpdateInput) {
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw ApiError.notFound('User not found');

  const row = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
    },
  });
  return serializeUser(row);
}

/** Reviewer edits a section's verdict / report text / recorded field data. */
async function updateSection(id: string, input: SectionUpdateInput) {
  const exists = await prisma.section.findUnique({ where: { id }, select: { id: true, fields: true } });
  if (!exists) throw ApiError.notFound('Section not found');

  return prisma.$transaction(async (tx) => {
    const row = await tx.section.update({
      where: { id },
      data: {
        ...(input.reviewStatus ? { reviewStatus: WEB_TO_REV_STATUS[input.reviewStatus] } : {}),
        ...(input.reviewComment !== undefined ? { reviewComment: input.reviewComment } : {}),
        ...(input.reportText !== undefined ? { reportText: input.reportText } : {}),
        // Merge rather than replace so edits don't drop fields the form doesn't show (e.g. photo counters).
        ...(input.fields
          ? {
              fields: {
                ...(exists.fields as Prisma.InputJsonObject),
                ...(input.fields as Prisma.InputJsonObject),
              },
            }
          : {}),
        // Replaced wholesale, not merged -- the reviewer's UI always sends the
        // full current exclusion set, same as reportText above.
        ...(input.excludedPhotoUrls !== undefined
          ? { excludedPhotoUrls: input.excludedPhotoUrls as Prisma.InputJsonValue }
          : {}),
        // Same replace-wholesale idea -- the reviewer's UI sends the full
        // current photo list (existing + any it just uploaded and appended).
        ...(input.photos !== undefined ? { photos: input.photos as Prisma.InputJsonValue } : {}),
        // Replaced wholesale -- the reviewer's Field Data editor always sends
        // the section's complete, current answer tree.
        ...(input.answers !== undefined ? { answers: input.answers as Prisma.InputJsonValue } : {}),
      },
      include: { damages: { orderBy: { order: 'asc' } } },
    });

    if (input.damages === undefined) return serializeSection(row);

    // The reviewer's Field Data edit re-derives this section's damage-list
    // entries from the just-saved answers (same derivation the inspector's
    // own editor uses) and sends the full new list here. Matched back onto
    // the EXISTING damage rows by position -- both sides are built by
    // walking the same template in the same order, so index i is the same
    // crack/defect on both -- so each row keeps its id and `excludedPhotoUrls`
    // (the reviewer's own separate photo-exclusion work on that exact
    // damage, untouched by this path). Only an actual add/remove of a
    // damage-list entry changes the row count.
    const existingDamages = row.damages;
    const nextDamages = input.damages;
    const matched = Math.min(existingDamages.length, nextDamages.length);

    for (let i = 0; i < matched; i++) {
      const d = nextDamages[i]!;
      // `photos` here comes from the Field Data editor's own photo control
      // on this damage -- a second write path onto the same `Damage.photos`
      // column the reviewer's separate "+ Add" button also writes to.
      // Merged (union), never replaced, so neither path can silently drop
      // a photo the other one added; `undefined` (field editor never
      // touched photos this save) leaves the column alone entirely.
      const existingPhotos = (existingDamages[i]!.photos as string[] | null) ?? [];
      const mergedPhotos = d.photos !== undefined ? Array.from(new Set([...existingPhotos, ...d.photos])) : undefined;
      await tx.damage.update({
        where: { id: existingDamages[i]!.id },
        data: {
          type: d.type,
          location: d.location,
          direction: d.direction,
          widthMm: d.widthMm,
          lengthMm: d.lengthMm,
          notes: d.notes,
          order: i,
          ...(mergedPhotos !== undefined ? { photos: mergedPhotos as Prisma.InputJsonValue } : {}),
        },
      });
    }
    // Reviewer removed an entry -- its row (and photos) go with it.
    for (let i = matched; i < existingDamages.length; i++) {
      await tx.damage.delete({ where: { id: existingDamages[i]!.id } });
    }
    // Reviewer added a brand new entry -- no existing row to merge with, so
    // whatever photos the field editor already has on it (if any) are all
    // there is.
    for (let i = matched; i < nextDamages.length; i++) {
      const d = nextDamages[i]!;
      await tx.damage.create({
        data: {
          sectionId: id,
          type: d.type,
          location: d.location,
          direction: d.direction,
          widthMm: d.widthMm,
          lengthMm: d.lengthMm,
          notes: d.notes,
          order: i,
          photos: (d.photos ?? []) as Prisma.InputJsonValue,
        },
      });
    }

    const finalRow = await tx.section.findUniqueOrThrow({ where: { id }, include: { damages: { orderBy: { order: 'asc' } } } });
    return serializeSection(finalRow);
  });
}

/** Reviewer picks which of one damage record's own photos make the report. */
async function updateDamage(id: string, input: DamageUpdateInput) {
  const exists = await prisma.damage.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw ApiError.notFound('Damage not found');

  return prisma.damage.update({
    where: { id },
    data: {
      ...(input.excludedPhotoUrls !== undefined
        ? { excludedPhotoUrls: input.excludedPhotoUrls as Prisma.InputJsonValue }
        : {}),
      ...(input.photos !== undefined ? { photos: input.photos as Prisma.InputJsonValue } : {}),
    },
  });
}

/** Status / notes / reviewer-assignment changes on an inspection. */
/** Approve every section of an inspection in one go (the reviewer's "Approve All"). Sections already approved are left alone. */
async function approveAllSections(id: string) {
  const exists = await prisma.inspection.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw ApiError.notFound('Inspection not found');
  await prisma.section.updateMany({ where: { inspectionId: id, reviewStatus: { not: 'APPROVED' } }, data: { reviewStatus: 'APPROVED' } });
  const fresh = await prisma.inspection.findUnique({ where: { id }, include: SECTIONS_INCLUDE });
  return serializeInspection(fresh!);
}

/** Re-run the Egnyte folder placement for one inspection (after a failure, or once its job number was corrected). */
async function resolveEgnyte(id: string) {
  const row = await prisma.inspection.findUnique({ where: { id }, select: { id: true, jobNo: true } });
  if (!row) throw ApiError.notFound('Inspection not found');
  const { settleEgnyteFolder } = await import('../inspections/inspections.service');
  await settleEgnyteFolder(row.id, row.jobNo);
  const fresh = await prisma.inspection.findUnique({ where: { id }, include: SECTIONS_INCLUDE });
  return serializeInspection(fresh!);
}

async function updateInspection(id: string, input: InspectionUpdateInput) {
  const exists = await prisma.inspection.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw ApiError.notFound('Inspection not found');

  const row = await prisma.inspection.update({
    where: { id },
    data: {
      ...(input.status ? { status: WEB_TO_INS_STATUS[input.status] } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.reviewerId !== undefined ? { reviewerId: input.reviewerId } : {}),
    },
    include: SECTIONS_INCLUDE,
  });
  return serializeInspection(row);
}

/**
 * Admin-only troubleshooting feed: the mobile submit/update/finalize/photo
 * pipeline's own trail (see lib/submissionLog.ts), newest first. Filters are
 * all optional and combine with AND -- `event: 'rejected'` narrowed to one
 * `jobNo` is exactly the "why didn't this inspector's job arrive" query this
 * page exists for.
 */
async function listSubmissionLogs(filters: {
  event?: string;
  inspectorId?: string;
  jobNo?: string;
  since?: Date;
  limit?: number;
}) {
  const where: Prisma.SubmissionLogEntryWhereInput = {
    ...(filters.event ? { event: filters.event } : {}),
    ...(filters.inspectorId ? { inspectorId: filters.inspectorId } : {}),
    ...(filters.jobNo ? { jobNo: { contains: filters.jobNo, mode: 'insensitive' } } : {}),
    ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
  };
  const rows = await prisma.submissionLogEntry.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(filters.limit ?? 100, 500),
    include: { inspector: { select: { id: true, name: true, email: true } } },
  });
  return rows;
}

/**
 * What an admin needs to see at a glance: submissions that look wrong, and photos that reached Egnyte for an inspection that
 * never arrived. Both are derived from the data, so they stay true without anyone writing log lines.
 */
async function getSubmissionHealth() {
  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
  const rows = await prisma.inspection.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: {
      id: true, jobNo: true, status: true, inspectionType: true, createdAt: true, egnyteStatus: true, egnyteMessage: true,
      inspector: { select: { name: true, email: true } },
      sections: { select: { key: true } },
    },
  });
  const flagged = rows
    .map((i) => {
      const reasons: string[] = [];
      // A draft with only Job Information is normal at the start of an inspection (the phone saves sections as they are finished);
      // it is only a problem once submitted, or when it has sat that way for a day.
      const stale = i.status !== 'DRAFT' || i.createdAt.getTime() < Date.now() - 24 * 3600 * 1000;
      if (stale && !i.sections.some((s) => s.key !== 'job-info')) reasons.push('Only Job Information arrived: no sections or photos were saved with it.');
      if (i.egnyteStatus === 'failed') reasons.push(`Egnyte folder not placed: ${i.egnyteMessage ?? 'unknown error'}`);
      else if (i.egnyteStatus === 'needs_review') reasons.push(`Egnyte folder needs a look: ${i.egnyteMessage ?? ''}`);
      else if (i.egnyteStatus === 'unassigned') reasons.push(`Photos are waiting for a valid job number: ${i.egnyteMessage ?? ''}`);
      return { id: i.id, jobNo: i.jobNo ?? '', type: i.inspectionType, status: i.status, createdAt: i.createdAt.toISOString(), inspector: i.inspector.name ?? i.inspector.email, egnyteStatus: i.egnyteStatus, reasons };
    })
    .filter((x) => x.reasons.length > 0);

  // Photos stored in a draft-id folder whose inspection never reached the server: the phone uploaded them, then the submission did not land.
  const { findOrphanUploads } = await import('../../lib/submissionAlerts');
  const orphans = await findOrphanUploads(0, 50);
  return {
    flagged,
    orphanUploads: orphans.map((o) => ({ draftId: o.folder, photos: o.photos, firstAt: o.firstAt.toISOString(), lastAt: o.lastAt.toISOString(), sections: o.sections.filter(Boolean) })),
  };
}

export const webService = {
  getSubmissionHealth,
  listInspections,
  getInspection,
  listUsers,
  updateUser,
  updateSection,
  updateDamage,
  updateInspection,
  resolveEgnyte,
  approveAllSections,
  listSubmissionLogs,
};
