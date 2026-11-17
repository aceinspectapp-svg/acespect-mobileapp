/**
 * The reviewer's photo tools: rotate / crop a photo, swap it for another file, put the original back, and delete a photo the reviewer added.
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
import sharp from 'sharp';
import { applyPhotoEdit, mediaIdOf, needsOptimizing, optimizePhoto, removeMediaId, swapMediaId, type PhotoEdit } from './photoEdit';

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

/** True for a photo the reviewer swapped in for another (its `editedFromId` is the photo it replaced, so Revert undoes the swap). */
const isReplacement = (edit: unknown): boolean => !!edit && typeof edit === 'object' && (edit as { replace?: unknown }).replace === true;

/**
 * The photo an edit of `photoId` starts from, with its row: the original a rotate / crop copy was made from, or the photo itself when it
 * is an original -- or a photo swapped in for another (an edit of it works on the new photo, not on the one it replaced).
 */
async function rootOf(photoId: string) {
  const row = await prisma.photo.findUnique({ where: { id: photoId }, select: { id: true, editedFromId: true, edit: true, addedById: true } });
  if (!row) throw ApiError.notFound('Photo not found');
  return { row, rootId: isReplacement(row.edit) ? row.id : row.editedFromId ?? row.id };
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
  const { row } = await rootOf(photoId);
  if (!row.editedFromId) throw new ApiError(409, 'That photo has not been edited', 'NOT_EDITED');
  // the photo this one was made from: the original of a rotate / crop copy, or the photo a swapped-in one replaced
  const rootId = row.editedFromId;
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

/**
 * Swaps a photo for another one the reviewer has just uploaded (`with`), everywhere the old one is used -- exactly like an edit, so the
 * report text and the photo's place stay as they are. The new photo remembers the one it replaced, so "Revert to original" undoes the swap.
 */
async function replacePhoto(sectionId: string, input: { url: string; with: string }, actor: Actor) {
  const section = await loadSection(sectionId, actor);
  const photoId = mediaIdOf(input.url);
  const newId = mediaIdOf(input.with);
  if (!photoId || !newId) throw ApiError.badRequest('That is not a photo link');
  if (photoId === newId) throw ApiError.badRequest('That is the same photo');
  const { row } = await rootOf(photoId);
  const fresh = await prisma.photo.findUnique({ where: { id: newId }, select: { id: true, editedFromId: true } });
  if (!fresh) throw ApiError.notFound('The new photo could not be found');
  if (fresh.editedFromId) throw ApiError.badRequest('That photo is already in use as an edit of another');
  await prisma.photo.update({ where: { id: newId }, data: { editedFromId: photoId, edit: json({ rotate: 0, replace: true }), addedById: row.addedById ?? null } });
  const meta = { ...metaOf(section) };
  if (photoId in meta) { meta[newId] = meta[photoId]; delete meta[photoId]; }
  const saved = await saveWith(section, (v) => swapMediaId(v, photoId, newId), meta);
  await audit({
    category: 'web', action: 'photo.replace', inspectionId: section.inspection.id, jobNo: section.inspection.jobNo,
    target: { type: 'Section', id: section.id, label: section.name },
    message: `${section.name}: a photo was replaced with another file`,
    metadata: { sectionKey: section.key, from: photoId, to: newId },
  });
  return { url: input.url.replace(photoId, newId), section: saved };
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

/** What the review panel needs to know about each photo: is it an edited copy (and of which original), did a reviewer add it. */
async function photoInfo(ids: string[]) {
  const rows = await prisma.photo.findMany({ where: { id: { in: ids } }, select: { id: true, editedFromId: true, edit: true, addedById: true } });
  // `originalUrl` is what the editor draws and edits: a swapped-in photo is edited as itself.
  return Object.fromEntries(rows.map((r) => {
    const replaced = isReplacement(r.edit);
    return [r.id, { editedFromId: r.editedFromId, originalUrl: r.editedFromId && !replaced ? `/api/v1/media/${r.editedFromId}` : null, edit: replaced ? null : r.edit, addedByReviewer: !!r.addedById, replaced }];
  }));
}

/** Every photo id a value links to, in order, once each. */
function photoIdsIn(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') for (const m of value.matchAll(/\/media\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi)) out.add(m[1]!.toLowerCase());
  else if (Array.isArray(value)) value.forEach((v) => photoIdsIn(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => photoIdsIn(v, out));
}

export interface OptimizeResult {
  checked: number;
  optimized: number;
  alreadyFine: number;
  failed: number;
  bytesBefore: number;
  bytesAfter: number;
  /** Sections skipped because they are approved. */
  lockedSections: string[];
}

/**
 * Brings the photos of an inspection (or one section) to 1024 x 768 and under 200 KB, as new copies linked to their originals -- the
 * originals stay, Revert still works, and the section is pointed at the copies exactly like a rotate / crop. A photo already within the
 * limits is left alone; an approved section is skipped.
 */
async function optimizePhotos(inspectionId: string, input: { sectionId?: string }, actor: Actor): Promise<OptimizeResult> {
  const sections = await prisma.section.findMany({ where: { inspectionId, ...(input.sectionId ? { id: input.sectionId } : {}) }, select: { id: true, name: true, reviewStatus: true } });
  if (input.sectionId && !sections.length) throw ApiError.notFound('Section not found');
  const result: OptimizeResult = { checked: 0, optimized: 0, alreadyFine: 0, failed: 0, bytesBefore: 0, bytesAfter: 0, lockedSections: [] };
  const done = new Map<string, { id: string; before: number; after: number } | null>(); // photo id -> its copy (null: nothing to do / failed)
  for (const head of sections) {
    if (head.reviewStatus === 'APPROVED') { result.lockedSections.push(head.name); continue; }
    let section = await loadSection(head.id, actor);
    const ids = new Set<string>();
    photoIdsIn([section.photos, section.answers, section.damages.map((d) => d.photos)], ids);
    let meta = metaOf(section);
    for (const id of ids) {
      result.checked++;
      let copy = done.get(id);
      if (copy === undefined) {
        try {
          const bytes = await readPhotoBytes(id);
          const m = await sharp(bytes).metadata();
          if (!needsOptimizing(bytes.length, m.width ?? 0, m.height ?? 0)) { done.set(id, null); copy = null; result.alreadyFine++; continue; }
          const out = await optimizePhoto(bytes);
          const stored = await inspectionsService.uploadPhoto(out.bytes, 'image/jpeg', 'optimized.jpg', section.inspection.id, section.key, section.inspection.jobNo ?? undefined);
          const newId = mediaIdOf(stored.url);
          if (!newId) throw new Error('not saved');
          const { rootId, row } = await rootOf(id);
          await prisma.photo.update({ where: { id: newId }, data: { editedFromId: rootId, edit: json({ rotate: 0, optimize: true }), addedById: row.addedById ?? null } });
          copy = { id: newId, before: bytes.length, after: out.bytes.length };
          done.set(id, copy);
        } catch {
          done.set(id, null);
          result.failed++;
          continue;
        }
      } else if (copy === null) { result.alreadyFine++; continue; }
      result.optimized++;
      result.bytesBefore += copy.before;
      result.bytesAfter += copy.after;
      if (id in meta) { meta = { ...meta, [copy.id]: meta[id] }; delete meta[id]; }
      const swap = copy;
      await saveWith(section, (v) => swapMediaId(v, id, swap.id), meta);
      section = await loadSection(head.id, actor);
      meta = metaOf(section);
    }
  }
  await audit({
    category: 'web', action: 'photo.optimize', inspectionId,
    message: `Photos brought to 1024 x 768 and under 200 KB: ${result.optimized} resized, ${result.alreadyFine} already fine${result.failed ? `, ${result.failed} failed` : ''}`,
    metadata: { ...result, sectionId: input.sectionId },
  });
  return result;
}

export const photoToolsService = { editPhoto, revertPhoto, replacePhoto, deletePhoto, photoInfo, optimizePhotos };
