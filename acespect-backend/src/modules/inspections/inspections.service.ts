import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { reviewQueue, reviewJobKey } from '../../lib/queue';
import { SubmitInspectionInput, UpdateInspectionInput } from './inspections.schemas';

const SEC_STATUS: Record<string, 'COMPLETE' | 'PARTIAL' | 'PENDING'> = {
  complete: 'COMPLETE',
  partial: 'PARTIAL',
  pending: 'PENDING',
};

/** Shared shape for writing a section (+ its damages) from the mobile payload. */
function sectionCreateData(s: SubmitInspectionInput['sections'][number]) {
  return {
    key: s.key,
    name: s.name,
    icon: s.icon,
    order: s.order,
    status: SEC_STATUS[s.status] ?? 'PENDING',
    reportText: s.reportText,
    fields: s.fields as Prisma.InputJsonValue,
    // Raw answers are what makes the section editable again later.
    ...(s.answers ? { answers: s.answers as Prisma.InputJsonValue } : {}),
    photos: s.photos as unknown as Prisma.InputJsonValue,
    damages: {
      create: s.damages.map((d) => ({
        type: d.type,
        location: d.location,
        direction: d.direction,
        widthMm: d.widthMm,
        lengthMm: d.lengthMm,
        notes: d.notes,
        photos: d.photos as unknown as Prisma.InputJsonValue,
        order: d.order,
      })),
    },
  };
}

/**
 * Persist an inspection from the mobile app as a DRAFT owned by the inspector.
 * It deliberately does NOT go to a reviewer yet: the inspector reviews it on
 * their dashboard, edits anything that needs correcting, then calls `finalize`,
 * which is what assigns a reviewer and enqueues the AI review. (Before, submit
 * went straight to SUBMITTED and into the review queue, leaving no chance to
 * correct a mistake.)
 */
async function submit(inspectorId: string, input: SubmitInspectionInput) {
  const inspection = await prisma.inspection.create({
    data: {
      inspectorId,
      inspectionType: input.inspectionType,
      propertyType: input.propertyType,
      jobNo: input.jobNo,
      address: input.address,
      suburb: input.suburb,
      client: input.client,
      date: input.date ? new Date(input.date) : new Date(),
      notes: input.notes ?? '',
      overallProgress: input.overallProgress ?? 0,
      status: 'DRAFT',
      ...(input.payload ? { payload: input.payload as Prisma.InputJsonValue } : {}),
      sections: { create: input.sections.map(sectionCreateData) },
    },
  });

  return { inspection };
}

/** Load a draft the given inspector owns, or explain why it can't be edited. */
async function requireOwnDraft(id: string, inspectorId: string) {
  const existing = await prisma.inspection.findUnique({
    where: { id },
    select: { id: true, inspectorId: true, status: true, version: true },
  });
  if (!existing) throw ApiError.notFound('Inspection not found');
  if (existing.inspectorId !== inspectorId) {
    throw ApiError.forbidden('You can only change your own inspections');
  }
  if (existing.status !== 'DRAFT') {
    throw new ApiError(409, 'Only a draft inspection can be edited', 'NOT_A_DRAFT');
  }
  return existing;
}

/**
 * Update a draft. When `sections` is supplied it replaces the stored set
 * outright -- the mobile form always holds the whole inspection, so merging
 * partial sections would risk leaving stale ones behind.
 */
async function update(id: string, inspectorId: string, input: UpdateInspectionInput) {
  await requireOwnDraft(id, inspectorId);

  return prisma.$transaction(async (tx) => {
    if (input.sections) {
      // Damages cascade from sections, so deleting sections clears them too.
      await tx.section.deleteMany({ where: { inspectionId: id } });
    }
    return tx.inspection.update({
      where: { id },
      data: {
        ...(input.jobNo !== undefined ? { jobNo: input.jobNo } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.suburb !== undefined ? { suburb: input.suburb } : {}),
        ...(input.client !== undefined ? { client: input.client } : {}),
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.overallProgress !== undefined ? { overallProgress: input.overallProgress } : {}),
        ...(input.sections ? { sections: { create: input.sections.map(sectionCreateData) } } : {}),
      },
    });
  });
}

/**
 * Finalize a draft: assign a reviewer, mark it SUBMITTED and enqueue the async
 * multi-agent review. This is the point of no return for the inspector -- after
 * this the inspection is in the reviewer's queue and no longer editable.
 */
async function finalize(id: string, inspectorId: string) {
  await requireOwnDraft(id, inspectorId);

  // Land it in a reviewer's queue (first active reviewer).
  const reviewer = await prisma.user.findFirst({
    where: { role: 'REVIEWER', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  const inspection = await prisma.inspection.update({
    where: { id },
    data: {
      status: 'SUBMITTED',
      submittedAt: new Date(),
      reviewerId: reviewer?.id ?? null,
    },
  });

  const reviewJob = await prisma.reviewJob.create({
    data: { inspectionId: inspection.id, version: inspection.version },
  });

  // Deterministic jobId makes a duplicate enqueue a no-op.
  await reviewQueue.add(
    'review',
    { reviewJobId: reviewJob.id, inspectionId: inspection.id, version: inspection.version },
    { jobId: reviewJobKey(inspection.id, inspection.version) },
  );

  return { inspection, reviewJob };
}

/** Fetch an inspection with its latest review job + summary. */
async function getById(id: string) {
  const inspection = await prisma.inspection.findUnique({
    where: { id },
    include: {
      reviewSummary: true,
      reviewJobs: { orderBy: { queuedAt: 'desc' }, take: 1, include: { results: true } },
    },
  });
  if (!inspection) throw ApiError.notFound('Inspection not found');
  return inspection;
}

/** Upload one inspection photo to Egnyte; returns a URL that proxies through this backend. */
async function uploadPhoto(buffer: Buffer, contentType: string, originalName: string) {
  const { isStorageEnabled, uploadPhoto: store } = await import('../../lib/storage');
  if (!isStorageEnabled()) {
    throw new ApiError(
      503,
      'Photo storage is not configured (set EGNYTE_DOMAIN + EGNYTE_API_TOKEN)',
      'STORAGE_DISABLED',
    );
  }
  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return store(buffer, contentType || 'image/jpeg', ext);
}

export const inspectionsService = { submit, update, finalize, getById, uploadPhoto };
