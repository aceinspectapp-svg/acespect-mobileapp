import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { audit, diffFields } from '../../lib/auditTrail';
import {
  restrictSerialized,
  serializeInspection,
  serializeInspectionSummary,
  serializeSection,
  serializeUser,
  WEB_TO_INS_STATUS,
  WEB_TO_REV_STATUS,
} from './web.serializers';
import { Actor, canEdit, canViewDetail, isAdmin } from './assignment.rules';
import { assignmentService } from './assignment.service';
import { DamageUpdateInput, InspectionUpdateInput, SectionUpdateInput, UserUpdateInput } from './web.schemas';

const SECTIONS_INCLUDE = {
  sections: {
    orderBy: { order: 'asc' as const },
    include: { damages: { orderBy: { order: 'asc' as const } } },
  },
};

/**
 * Which inspections a signed-in person may list. Admins: all. A reviewer: every one that has left draft -- their own, unassigned ones to
 * take, and other reviewers' (those come back withheld, see `shape`). Everyone else (inspectors, and the QC roles that share this login)
 * only their own.
 */
function scopeFor(user: { id: string; role: string }): Prisma.InspectionWhereInput {
  if (user.role === 'ADMIN') return {};
  if (user.role === 'REVIEWER') return { status: { not: 'DRAFT' } };
  return { inspectorId: user.id };
}

/** A reviewer gets the full record of inspections that are theirs or unassigned, and only the withheld version of the rest. */
function shape<T extends ReturnType<typeof serializeInspection>>(user: { id: string; role: string }, s: T) {
  return user.role === 'REVIEWER' && !canViewDetail(user, { reviewerId: s.reviewerId, status: s.status }) ? restrictSerialized(s) : s;
}

/** Throws unless `actor` may change this inspection (its assigned reviewer, or an admin). Used by every reviewer write. */
async function requireCanEdit(inspectionId: string, actor: Actor) {
  const row = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { reviewerId: true, status: true } });
  if (!row) throw ApiError.notFound('Inspection not found');
  if (!canEdit(actor, row)) {
    throw new ApiError(403, row.reviewerId ? 'This inspection is assigned to another reviewer, so only they (or an admin) can change it.' : 'Assign this inspection to yourself before editing it.', 'NOT_ASSIGNEE');
  }
}

const SECTION_SUMMARY_SELECT = { id: true, key: true, name: true, icon: true, status: true, reviewStatus: true, reviewComment: true, updatedAt: true, order: true } as const;

interface ListOptions {
  /** 'summary': the light list (no answers, photos or damage records), paged. Anything else: the full list in one go (older web builds). */
  view?: string;
  limit?: number;
  /** The id of the last inspection of the previous page. */
  cursor?: string;
  /** Only inspections (or sections) changed after this time. */
  since?: Date;
}

async function listInspections(user: { id: string; role: string }, opts: ListOptions = {}) {
  const scope = scopeFor(user);

  if (opts.view !== 'summary') {
    const rows = await prisma.inspection.findMany({ where: scope, orderBy: { date: 'desc' }, include: SECTIONS_INCLUDE });
    return { inspections: rows.map((r) => shape(user, serializeInspection(r))) };
  }

  // Taken before the query, so a change that lands while it runs is picked up by the next "since" request rather than missed.
  const serverTime = new Date().toISOString();
  const take = Math.min(Math.max(Math.floor(opts.limit ?? 500), 1), 1000);
  const where: Prisma.InspectionWhereInput = opts.since
    ? { AND: [scope, { OR: [{ updatedAt: { gt: opts.since } }, { sections: { some: { updatedAt: { gt: opts.since } } } }] }] }
    : scope;
  const rows = await prisma.inspection.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: { sections: { orderBy: { order: 'asc' }, select: SECTION_SUMMARY_SELECT } },
  });
  const page = rows.slice(0, take);
  return {
    inspections: page.map((r) => shape(user, serializeInspectionSummary(r))),
    ...(rows.length > take ? { nextCursor: page[page.length - 1]!.id } : {}),
    serverTime,
  };
}

async function getInspection(id: string, user: { id: string; role: string }) {
  // Same visibility rule as the list: asking for someone else's inspection by id is "not found", not a peek at it.
  const row = await prisma.inspection.findFirst({ where: { AND: [{ id }, scopeFor(user)] }, include: SECTIONS_INCLUDE });
  if (!row) throw ApiError.notFound('Inspection not found');
  // Held by another reviewer: listed, but not opened.
  if (user.role === 'REVIEWER' && !canViewDetail(user, row)) throw new ApiError(403, 'This inspection is assigned to another reviewer.', 'ASSIGNED_TO_OTHER');
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
  const beforeUser = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, phone: true, region: true, licenseNumber: true } });
  if (!beforeUser) throw ApiError.notFound('User not found');

  const row = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.region !== undefined ? { region: input.region } : {}),
      ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
    },
  });
  const userDiff = diffFields(beforeUser, row as unknown as Record<string, unknown>, Object.keys(input).filter((k) => k in beforeUser));
  if (userDiff) await audit({ category: 'admin', action: 'user.update', target: { type: 'User', id, label: beforeUser.email }, before: userDiff.before, after: userDiff.after, message: `Profile of ${beforeUser.email} changed` });
  return serializeUser(row);
}

const REVIEW_ACTION: Record<string, string> = { APPROVED: 'section.approve', REVISION_REQUESTED: 'section.request_revision', PENDING: 'section.reset_review' };

/** Reviewer edits a section's verdict / report text / recorded field data -- and the change is on record, before and after. */
async function updateSection(id: string, input: SectionUpdateInput, actor: Actor) {
  const owner = await prisma.section.findUnique({ where: { id }, select: { inspectionId: true } });
  if (!owner) throw ApiError.notFound('Section not found');
  await requireCanEdit(owner.inspectionId, actor);
  const before = await prisma.section.findUnique({ where: { id }, include: { inspection: { select: { id: true, jobNo: true } } } });
  const result = await updateSectionCore(id, input);
  if (before) {
    const after = await prisma.section.findUnique({ where: { id } });
    const touched = [
      input.reviewStatus ? 'reviewStatus' : null, input.reviewComment !== undefined ? 'reviewComment' : null, input.reportText !== undefined ? 'reportText' : null,
      input.fields ? 'fields' : null, input.excludedPhotoUrls !== undefined ? 'excludedPhotoUrls' : null, input.photos !== undefined ? 'photos' : null, input.answers !== undefined ? 'answers' : null,
    ].filter((k): k is string => !!k);
    const diff = after ? diffFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>, touched) : null;
    const newStatus = diff?.after.reviewStatus as string | undefined;
    if (diff || input.damages) {
      await audit({
        category: 'web',
        action: newStatus ? REVIEW_ACTION[newStatus] ?? 'section.edit' : 'section.edit',
        inspectionId: before.inspection.id,
        jobNo: before.inspection.jobNo,
        target: { type: 'Section', id, label: before.name },
        before: diff?.before,
        after: diff?.after,
        message: newStatus ? `${before.name}: ${String(diff?.before.reviewStatus ?? '').toLowerCase()} → ${newStatus.toLowerCase()}` : `${before.name} edited (${Object.keys(diff?.after ?? {}).join(', ') || 'damage records'})`,
        metadata: { sectionKey: before.key, changed: Object.keys(diff?.after ?? {}), damagesReplaced: input.damages?.length },
      });
    }
  }
  return result;
}

async function updateSectionCore(id: string, input: SectionUpdateInput) {
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
async function updateDamage(id: string, input: DamageUpdateInput, actor: Actor) {
  const owner = await prisma.damage.findUnique({ where: { id }, select: { section: { select: { inspectionId: true } } } });
  if (!owner) throw ApiError.notFound('Damage not found');
  await requireCanEdit(owner.section.inspectionId, actor);
  const exists = await prisma.damage.findUnique({ where: { id }, include: { section: { select: { key: true, name: true, inspection: { select: { id: true, jobNo: true } } } } } });
  if (!exists) throw ApiError.notFound('Damage not found');

  const saved = await prisma.damage.update({
    where: { id },
    data: {
      ...(input.excludedPhotoUrls !== undefined
        ? { excludedPhotoUrls: input.excludedPhotoUrls as Prisma.InputJsonValue }
        : {}),
      ...(input.photos !== undefined ? { photos: input.photos as Prisma.InputJsonValue } : {}),
    },
  });
  const damageDiff = diffFields(exists as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>, [input.excludedPhotoUrls !== undefined ? 'excludedPhotoUrls' : '', input.photos !== undefined ? 'photos' : ''].filter(Boolean));
  if (damageDiff) {
    await audit({
      category: 'web', action: 'damage.edit', inspectionId: exists.section.inspection.id, jobNo: exists.section.inspection.jobNo,
      target: { type: 'Damage', id, label: `${exists.section.name}: ${exists.type}` }, before: damageDiff.before, after: damageDiff.after,
      message: `Photos of a ${exists.type} record in ${exists.section.name} changed`, metadata: { sectionKey: exists.section.key, changed: Object.keys(damageDiff.after) },
    });
  }
  return saved;
}

/** Status / notes / reviewer-assignment changes on an inspection. */
/** Approve every section of an inspection in one go (the reviewer's "Approve All"). Sections already approved are left alone. */
async function approveAllSections(id: string, actor: Actor) {
  await requireCanEdit(id, actor);
  const exists = await prisma.inspection.findUnique({ where: { id }, select: { id: true, jobNo: true } });
  if (!exists) throw ApiError.notFound('Inspection not found');
  const approved = await prisma.section.updateMany({ where: { inspectionId: id, reviewStatus: { not: 'APPROVED' } }, data: { reviewStatus: 'APPROVED' } });
  await audit({ category: 'web', action: 'section.approve_all', inspectionId: id, jobNo: exists.jobNo, target: { type: 'Inspection', id, label: exists.jobNo }, message: `${approved.count} section(s) approved in one step`, metadata: { approved: approved.count } });
  const fresh = await prisma.inspection.findUnique({ where: { id }, include: SECTIONS_INCLUDE });
  return serializeInspection(fresh!);
}

/** Re-run the Egnyte folder placement for one inspection (after a failure, or once its job number was corrected). */
async function resolveEgnyte(id: string, actor: Actor) {
  await requireCanEdit(id, actor);
  const row = await prisma.inspection.findUnique({ where: { id }, select: { id: true, jobNo: true, egnyteStatus: true, egnytePath: true } });
  if (!row) throw ApiError.notFound('Inspection not found');
  const { settleEgnyteFolder } = await import('../inspections/inspections.service');
  await settleEgnyteFolder(row.id, row.jobNo);
  const fresh = await prisma.inspection.findUnique({ where: { id }, include: SECTIONS_INCLUDE });
  await audit({
    category: 'web', action: 'egnyte.recheck', inspectionId: id, jobNo: row.jobNo, target: { type: 'Inspection', id, label: row.jobNo },
    before: { egnyteStatus: row.egnyteStatus, egnytePath: row.egnytePath }, after: { egnyteStatus: fresh?.egnyteStatus, egnytePath: fresh?.egnytePath }, message: 'Egnyte folder placement re-run',
  });
  return serializeInspection(fresh!);
}

async function updateInspection(id: string, input: InspectionUpdateInput, actor: Actor) {
  const exists = await prisma.inspection.findUnique({ where: { id }, select: { id: true, jobNo: true, status: true, notes: true, reviewerId: true } });
  if (!exists) throw ApiError.notFound('Inspection not found');
  await requireCanEdit(id, actor);
  // Changing who holds an inspection goes through the assignment rules (consent, email, audit), never a plain field write.
  if (input.reviewerId !== undefined) {
    if (!isAdmin(actor)) throw ApiError.forbidden('Use the assign / transfer request actions to change the reviewer');
    if (input.reviewerId === null) throw ApiError.badRequest('An inspection cannot be un-assigned; assign it to a reviewer instead');
    if (input.reviewerId !== exists.reviewerId) await assignmentService.assign(id, input.reviewerId, actor);
    if (input.status === undefined && input.notes === undefined) {
      const fresh = await prisma.inspection.findUniqueOrThrow({ where: { id }, include: SECTIONS_INCLUDE });
      return serializeInspection(fresh);
    }
  }

  const row = await prisma.inspection.update({
    where: { id },
    data: {
      ...(input.status ? { status: WEB_TO_INS_STATUS[input.status] } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: SECTIONS_INCLUDE,
  });
  const inspDiff = diffFields(exists, row as unknown as Record<string, unknown>, [input.status ? 'status' : '', input.notes !== undefined ? 'notes' : ''].filter(Boolean));
  if (inspDiff) {
    await audit({
      category: 'web', action: inspDiff.after.status ? 'inspection.status_change' : 'inspection.edit',
      inspectionId: id, jobNo: exists.jobNo, target: { type: 'Inspection', id, label: exists.jobNo }, before: inspDiff.before, after: inspDiff.after,
      message: inspDiff.after.status ? `Status ${String(inspDiff.before.status)} → ${String(inspDiff.after.status)}` : 'Inspection details changed',
    });
  }
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
