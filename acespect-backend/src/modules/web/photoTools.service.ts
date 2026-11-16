/**
 * The reviewer's photo tools: rotate / crop a photo, put the original back, and delete a photo the reviewer added.
 *
 * An edit never touches the photo it starts from. It saves a NEW copy (linked to its original in the photos table) and points the section
 * at the copy everywhere the original was used -- the section's photo list, its answers, its defect records, the composed report text --
 * so the report, the Word file and the review panel all follow. The original stays where it is: the "download all original photos" zip,
 * the audit trail and "Revert" still have it. All of it is refused once the section is approved.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { audit } from '../../lib/auditTrail';
import { fetchPhotoStream } from '../../lib/storage';
import { inspectionsService } from '../inspections/inspections.service';
import { canEdit, type Actor } from './assignment.rules';
import { serializeSection } from './web.serializers';
import { applyPhotoEdit, mediaIdOf, removeMediaId, swapMediaId, type PhotoEdit } from './photoEdit';

const json = (v: unknown) => v as Prisma.InputJsonValue;

async function loadSection(sectionId: string, actor: Actor) {
  const section = await prisma.section.findUnique({ where: { id: sectionId }, include: { damages: { orderBy: { order: 'asc' } }, inspection: { select: { id: true, jobNo: true, reviewerId: true, status: true } } } });
  if (!section) throw ApiError.notFound('Section not found');
  if (!canEdit(actor, section.inspection)) {
    throw new ApiError(403, section.inspection.reviewerId ? 'This inspection is assigned to another reviewer, so only they (or an admin) can change it.' : 'Assign this inspection to yourself before editing it.', 'NOT_ASSIGNEE');
  }
  if (section.reviewStatus === 'APPROVED') throw new ApiError(409, 'This section is approved. Reopen it before changing its photos.', 'SECTION_APPROVED');
  return section;
}

type LoadedSection = Awaited<ReturnType<typeof loadSection>>;

/** Saves `section` with `change` applied to everything that can hold a photo link. */
async function saveWith(section: LoadedSection, change: (v: unknown) => unknown, meta: Record<string, unknown>) {
  const next = await prisma.$transaction(async (tx) => {
    for (const d of section.damages) {
      await tx.damage.update({ where: { id: d.id }, data: { photos: json(change(d.photos ?? [])), excludedPhotoUrls: json(change(d.excludedPhotoUrls ?? [])) } });
    }
    return tx.section.update({
      where: { id: section.id },
      data: {
        answers: section.answers === null ? Prisma.JsonNull : json(change(section.answers)),
        fields: json(change(section.fields ?? {})),
        reportText: change(section.reportText) as string,
        photos: json(change(section.photos ?? [])),
        excludedPhotoUrls: json(change(section.excludedPhotoUrls ?? [])),
        photoMeta: json(meta),
      },
      include: { damages: { orderBy: { order: 'asc' } } },
    });
  });
  return serializeSection(next);
}

async function readPhotoBytes(id: string): Promise<Buffer> {
  const got = await fetchPhotoStream(id);
  if (!got) throw ApiError.notFound('That photo could not be found in storage');
  return Buffer.from(await new Response(got.body).arrayBuffer());
}

/** The id of the photo a copy was made from (or the photo itself when it is an original), with its row. */
async function rootOf(photoId: string) {
  const row = await prisma.photo.findUnique({ where: { id: photoId }, select: { id: true, editedFromId: true, edit: true, addedById: true } });
  if (!row) throw ApiError.notFound('Photo not found');
  return { row, rootId: row.editedFromId ?? row.id };
}

const metaOf = (section: LoadedSection): Record<string, unknown> => ((section.photoMeta as Record<string, unknown> | null) ?? {});

/** Rotate and / or crop one photo of a section. `edit` is relative to the ORIGINAL photo, so editing twice never compounds. */
async function editPhoto(sectionId: string, input: { url: string; edit: PhotoEdit }, actor: Actor) {
  const section = await loadSection(sectionId, actor);
  const photoId = mediaIdOf(input.url);
  if (!photoId) throw ApiError.badRequest('That is not a photo link');
  const { rootId } = await rootOf(photoId);
  const source = await readPhotoBytes(rootId);
  const edited = await applyPhotoEdit(source, input.edit);
  const stored = await inspectionsService.uploadPhoto(edited.bytes, 'image/jpeg', 'edited.jpg', section.inspection.id, section.key, section.inspection.jobNo ?? undefined);
  const newId = mediaIdOf(stored.url);
  if (!newId) throw new ApiError(500, 'The edited photo could not be saved', 'PHOTO_EDIT_FAILED');
  await prisma.photo.update({ where: { id: newId }, data: { editedFromId: rootId, edit: json(input.edit), addedById: (await prisma.photo.findUnique({ where: { id: photoId }, select: { addedById: true } }))?.addedById ?? null } });
  const meta = { ...metaOf(section) };
  if (photoId in meta) { meta[newId] = meta[photoId]; delete meta[photoId]; }
  const saved = await saveWith(section, (v) => swapMediaId(v, photoId, newId), meta);
  await audit({
    category: 'web', action: 'photo.edit', inspectionId: section.inspection.id, jobNo: section.inspection.jobNo,
    target: { type: 'Section', id: section.id, label: section.name },
    message: `${section.name}: a photo was ${[input.edit.rotate ? `rotated ${input.edit.rotate}°` : '', input.edit.crop ? 'cropped' : ''].filter(Boolean).join(' and ') || 'saved unchanged'}`,
    metadata: { sectionKey: section.key, from: photoId, to: newId, original: rootId, edit: input.edit },
  });
  return { url: stored.url, section: saved };
}

/** Puts a photo back to the original it was made from. */
async function revertPhoto(sectionId: string, input: { url: string }, actor: Actor) {
  const section = await loadSection(sectionId, actor);
  const photoId = mediaIdOf(input.url);
  if (!photoId) throw ApiError.badRequest('That is not a photo link');
  const { row, rootId } = await rootOf(photoId);
  if (!row.editedFromId) throw new ApiError(409, 'That photo has not been edited', 'NOT_EDITED');
  const meta = { ...metaOf(section) };
  if (photoId in meta) { meta[rootId] = meta[photoId]; delete meta[photoId]; }
  const saved = await saveWith(section, (v) => swapMediaId(v, photoId, rootId), meta);
  await audit({
    category: 'web', action: 'photo.revert', inspectionId: section.inspection.id, jobNo: section.inspection.jobNo,
    target: { type: 'Section', id: section.id, label: section.name },
    message: `${section.name}: a photo was put back to its original`,
    metadata: { sectionKey: section.key, from: photoId, to: rootId },
  });
  return { url: input.url.replace(photoId, rootId), section: saved };
}

/** Deletes a photo the reviewer added: out of the section everywhere. The inspector's own photos can only be left out of the report. */
async function deletePhoto(sectionId: string, input: { url: string }, actor: Actor) {
  const section = await loadSection(sectionId, actor);
  const photoId = mediaIdOf(input.url);
  if (!photoId) throw ApiError.badRequest('That is not a photo link');
  const { row } = await rootOf(photoId);
  if (!row.addedById) throw new ApiError(409, "Only a photo a reviewer added can be deleted. Remove the inspector's photo from the report instead.", 'NOT_REVIEWER_PHOTO');
  const meta = { ...metaOf(section) };
  delete meta[photoId];
  const saved = await saveWith(section, (v) => removeMediaId(v, photoId), meta);
  await audit({
    category: 'web', action: 'photo.delete', inspectionId: section.inspection.id, jobNo: section.inspection.jobNo,
    target: { type: 'Section', id: section.id, label: section.name },
    message: `${section.name}: a photo added by a reviewer was deleted`,
    metadata: { sectionKey: section.key, photo: photoId },
  });
  return { section: saved };
}

export const photoToolsService = { editPhoto, revertPhoto, deletePhoto };
