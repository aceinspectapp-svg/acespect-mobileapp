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

  const row = await prisma.section.update({
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
    },
    include: { damages: { orderBy: { order: 'asc' } } },
  });
  return serializeSection(row);
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
