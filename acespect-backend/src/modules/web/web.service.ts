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
import { DamageUpdateInput, InspectionUpdateInput, SectionUpdateInput } from './web.schemas';

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
    // crack/defect on both -- so each row keeps its id, `photos` and
    // `excludedPhotoUrls` (the reviewer's own separate photo-selection/
    // attachment work on that exact damage, untouched by this path). Only
    // an actual add/remove of a damage-list entry changes the row count.
    const existingDamages = row.damages;
    const nextDamages = input.damages;
    const matched = Math.min(existingDamages.length, nextDamages.length);

    for (let i = 0; i < matched; i++) {
      const d = nextDamages[i]!;
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
        },
      });
    }
    // Reviewer removed an entry -- its row (and photos) go with it.
    for (let i = matched; i < existingDamages.length; i++) {
      await tx.damage.delete({ where: { id: existingDamages[i]!.id } });
    }
    // Reviewer added an entry -- a brand new row, no photos yet.
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

export const webService = {
  listInspections,
  getInspection,
  listUsers,
  updateSection,
  updateDamage,
  updateInspection,
};
