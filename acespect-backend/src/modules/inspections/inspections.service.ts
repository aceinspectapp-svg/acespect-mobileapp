import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { reviewQueue, reviewJobKey } from '../../lib/queue';
import { SubmitInspectionInput, SyncSectionInput, UpdateInspectionInput } from './inspections.schemas';

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
/**
 * Save ONE section of an inspection (creating the inspection on the first call). This is what keeps the server holding the inspection
 * while the inspector works: if the phone is lost or the final submit fails, everything up to the last saved section is already here.
 * Saving the same section again replaces it, so retries are safe.
 */
async function syncSection(inspectorId: string, id: string, input: SyncSectionInput) {
  const existing = await prisma.inspection.findUnique({ where: { id }, select: { id: true, inspectorId: true, status: true, jobNo: true, egnyteStatus: true } });
  if (existing && existing.inspectorId !== inspectorId) throw ApiError.forbidden('You can only change your own inspections');
  if (existing && existing.status !== 'DRAFT') throw new ApiError(409, 'This inspection has already been sent for review', 'NOT_A_DRAFT');

  const top = {
    inspectionType: input.inspectionType,
    propertyType: input.propertyType,
    ...(input.jobNo !== undefined ? { jobNo: input.jobNo } : {}),
    ...(input.address !== undefined ? { address: input.address } : {}),
    ...(input.suburb !== undefined ? { suburb: input.suburb } : {}),
    ...(input.client !== undefined ? { client: input.client } : {}),
    ...(input.date ? { date: new Date(input.date) } : {}),
  };
  let created = false;
  if (!existing) {
    try {
      await prisma.inspection.create({ data: { id, inspectorId, status: 'DRAFT', ...top } });
      created = true;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e; // another save created it a moment ago: carry on as an update
    }
  }
  await prisma.$transaction(async (tx) => {
    await tx.section.deleteMany({ where: { inspectionId: id, key: input.section.key } });
    await tx.inspection.update({ where: { id }, data: { ...top, sections: { create: sectionCreateData(input.section) } } });
  });
  // The photo folder is placed once, when the inspection is first created or its job number changes -- not on every section.
  if (input.jobNo && (created || existing?.jobNo !== input.jobNo || !existing?.egnyteStatus)) await settleEgnyteFolder(id, input.jobNo);
  return { inspectionId: id, ...(await receiptFor(id)) };
}

/** What was actually stored for an inspection: its sections (other than Job Information) and the distinct uploaded photos they reference. */
export async function receiptFor(inspectionId: string): Promise<{ sections: number; photos: number }> {
  const secs = await prisma.section.findMany({ where: { inspectionId }, select: { key: true, answers: true, photos: true, damages: { select: { photos: true } } } });
  const ids = new Set<string>();
  for (const s of secs) for (const m of JSON.stringify([s.answers, s.photos, s.damages]).matchAll(/\/api\/v1\/media\/([0-9a-f-]{36})/gi)) ids.add(m[1]!.toLowerCase());
  const found = ids.size ? await prisma.photo.count({ where: { id: { in: [...ids] } } }) : 0;
  return { sections: secs.filter((s) => s.key !== 'job-info').length, photos: found };
}

async function submit(inspectorId: string, input: SubmitInspectionInput) {
  // A blank (Job-Information-only) submission for a job that already has a real inspection from this inspector is a leftover, not a new
  // inspection: refuse it, so it cannot sit beside -- or stand in for -- the real one.
  if (input.jobNo && !input.sections.some((s) => s.key !== 'job-info')) {
    const real = await prisma.inspection.findFirst({
      where: { inspectorId, jobNo: { equals: input.jobNo, mode: 'insensitive' }, createdAt: { gte: new Date(Date.now() - 14 * 24 * 3600 * 1000) }, sections: { some: { key: { not: 'job-info' } } } },
      select: { id: true },
    });
    if (real) throw new ApiError(409, `An inspection for ${input.jobNo} with real content already exists; this blank one was not saved.`, 'BLANK_DUPLICATE');
  }
  const data = {
    inspectionType: input.inspectionType,
    propertyType: input.propertyType,
    jobNo: input.jobNo,
    address: input.address,
    suburb: input.suburb,
    client: input.client,
    date: input.date ? new Date(input.date) : new Date(),
    notes: input.notes ?? '',
    overallProgress: input.overallProgress ?? 0,
    status: 'DRAFT' as const,
    ...(input.payload ? { payload: input.payload as Prisma.InputJsonValue } : {}),
    sections: { create: input.sections.map(sectionCreateData) },
  };

  // The inspection may already be on the server: the phone saves each section as it is finished (syncSection), and an assigned
  // Post-Dilapidation job is a row admin made. Either way this call completes that one row -- it replaces its sections with the
  // full set and never makes a second inspection. Sending it again (a retry after a lost reply) is harmless.
  const targetId = input.assignmentId ?? input.id;
  const existing = targetId ? await prisma.inspection.findUnique({ where: { id: targetId }, select: { id: true, inspectorId: true, status: true } }) : null;
  if (input.assignmentId && !existing) throw ApiError.notFound('Assigned job not found');
  if (existing && existing.inspectorId !== inspectorId) throw ApiError.forbidden(input.assignmentId ? 'This job is not assigned to you' : 'You can only change your own inspections');
  if (existing && existing.status !== 'DRAFT') {
    // Already finalised: this is a retry of something that has already arrived. Leave it exactly as it is.
    return { inspection: await prisma.inspection.findUniqueOrThrow({ where: { id: existing.id } }) };
  }
  if (existing) {
    const { sections: _sections, ...fields } = data;
    const inspection = await prisma.$transaction(async (tx) => {
      await tx.section.deleteMany({ where: { inspectionId: existing.id } });
      return tx.inspection.update({ where: { id: existing.id }, data: { ...fields, sections: data.sections } });
    });
    await settleEgnyteFolder(existing.id, input.jobNo);
    return { inspection };
  }

  const inspection = await prisma.inspection.create({
    // A client-supplied id (the phone's draft id, made at the start of the inspection) is what its photos were uploaded under.
    data: { ...data, inspectorId, ...(input.id ? { id: input.id } : {}) },
  });
  // The folder was created under that draft-local id the moment the first
  // photo was taken, well before the job number was known -- now that it
  // is, rename it so it's browsable in Egnyte by job number instead of a
  // UUID. Skipped when `input.id` is absent (nothing was ever uploaded
  // under a matching folder, e.g. a web-created draft).
  await settleEgnyteFolder(inspection.id, input.jobNo);
  return { inspection };
}

/**
 * Place the inspection's Egnyte folder ({root}/{batch}/{job}) now that its job number is final, and record where it is and
 * whether the office needs to look at it. Non-fatal: an Egnyte outage must never block submission -- it is recorded as
 * "failed" and can be re-run from the admin page (POST /web/inspections/:id/egnyte/resolve).
 */
export async function settleEgnyteFolder(inspectionId: string, jobNo: string | null | undefined): Promise<void> {
  try {
    const { settleInspectionFolder, isStorageEnabled } = await import('../../lib/storage');
    if (!isStorageEnabled()) return;
    const previous = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { egnytePath: true } });
    const r = await settleInspectionFolder(inspectionId, jobNo, previous?.egnytePath);
    if (!r) return;
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: { egnytePath: r.status === 'unassigned' ? previous?.egnytePath ?? null : r.path, egnyteStatus: r.status, egnyteMessage: r.message ?? null, egnyteCheckedAt: new Date() },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('⚠️  Egnyte folder placement failed.', err);
    await prisma.inspection
      .update({ where: { id: inspectionId }, data: { egnyteStatus: 'failed', egnyteMessage: err instanceof Error ? err.message.slice(0, 500) : 'Egnyte folder placement failed', egnyteCheckedAt: new Date() } })
      .catch(() => undefined);
  }
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

  const updated = await prisma.$transaction(async (tx) => {
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
  // A corrected job number moves the photo folder to the right batch.
  if (input.jobNo) await settleEgnyteFolder(id, input.jobNo);
  return updated;
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

/**
 * Jobs admin has pushed to this inspector as a Post-Dilapidation baseline
 * comparison, not yet picked up (no sections filled in yet -- once the
 * inspector submits, `submit`'s `assignmentId` path fills the row in and it
 * naturally drops off this list). What the mobile app's "Assigned Jobs"
 * entry point polls.
 */
async function listAssigned(inspectorId: string) {
  const rows = await prisma.inspection.findMany({
    where: { inspectorId, baselineInspectionId: { not: null }, sections: { none: {} } },
    include: { baselineInspection: { select: { id: true, jobNo: true, address: true, client: true, propertyType: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    inspectionType: r.inspectionType,
    propertyType: r.propertyType,
    jobNo: r.jobNo,
    address: r.address,
    suburb: r.suburb,
    client: r.client,
    baseline: r.baselineInspection,
  }));
}

/**
 * Read-only reference data for a Post-Dilapidation job: every section of the
 * assigned job's baseline, as last recorded. Restricted to the inspector the
 * job is assigned to -- this is what lets DynamicSectionScreen show "what
 * was recorded last time" while the inspector fills in the comparison.
 */
async function getBaselineSections(assignedInspectionId: string, inspectorId: string) {
  const assigned = await prisma.inspection.findUnique({
    where: { id: assignedInspectionId },
    include: { baselineInspection: { include: { sections: true } } },
  });
  if (!assigned) throw ApiError.notFound('Inspection not found');
  if (assigned.inspectorId !== inspectorId) throw ApiError.forbidden('This job is not assigned to you');
  if (!assigned.baselineInspection) throw ApiError.notFound('This job has no baseline set');

  return assigned.baselineInspection.sections.map((s) => ({
    key: s.key,
    name: s.name,
    reportText: s.reportText,
    fields: s.fields,
    photos: s.photos,
  }));
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

/**
 * Upload one inspection photo; returns a URL that proxies through this
 * backend. `inspectionId`/`sectionKey`, when given, group the file under
 * that inspection's own section folder in Egnyte -- mobile passes them
 * alongside each photo (it has a draft-local inspection id from the moment
 * the inspection starts, well before submit, precisely so uploads can be
 * grouped correctly as they happen).
 */
async function uploadPhoto(
  buffer: Buffer,
  contentType: string,
  originalName: string,
  inspectionId?: string,
  sectionKey?: string,
  jobNo?: string,
  photoId?: string,
) {
  const { uploadPhoto: store } = await import('../../lib/storage');
  const ext = (originalName.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return store(buffer, contentType || 'image/jpeg', ext, inspectionId, sectionKey, undefined, undefined, { jobNo, photoId });
}

/**
 * A section's `photos` array holds any images the inspector attached that
 * aren't tied to a specific template field (e.g. extra shots from an
 * external camera) -- everything field-bound lives in `answers` instead.
 * Used to build the "download all" zip so a reviewer doesn't have to open
 * each image individually.
 */
async function getSectionPhotos(sectionId: string): Promise<{ name: string; photos: string[] }> {
  const section = await prisma.section.findUnique({ where: { id: sectionId }, select: { name: true, photos: true } });
  if (!section) throw ApiError.notFound('Section not found');
  return { name: section.name, photos: (section.photos as unknown as string[] | null) ?? [] };
}

export const inspectionsService = {
  syncSection,
  submit,
  update,
  finalize,
  getById,
  uploadPhoto,
  listAssigned,
  getBaselineSections,
  getSectionPhotos,
};
