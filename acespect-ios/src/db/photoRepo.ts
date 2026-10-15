import type { Database } from '@nozbe/watermelondb';
import { CapturedPhoto } from '../types/photo';
import type { Inspection } from './models/Inspection';
import type { Photo } from './models/Photo';

/**
 * Returns the id of the current draft inspection, creating one if none exists.
 *
 * The job-setup flow isn't wired to the DB yet, so photos attach to a single
 * "draft" inspection row for now. When the wizard starts persisting, replace
 * this with the real inspection id.
 */
export async function getOrCreateDraftInspection(database: Database): Promise<string> {
  const inspections = database.get<Inspection>('inspections');
  const existing = await inspections.query().fetch();
  const draft = existing.find((i) => i.status === 'draft');
  if (draft) return draft.id;

  let id = '';
  await database.write(async () => {
    const rec = await inspections.create((r) => {
      r.serverId = null;
      r.inspectionType = 'unknown';
      r.propertyType = 'unknown';
      r.status = 'draft';
      r.startedAt = new Date();
    });
    id = rec.id;
  });
  return id;
}

/**
 * Persist a captured photo. Best-effort: a no-op when `database` is null (Expo
 * Go, before a dev client is built) so the capture UX never breaks.
 */
export async function persistPhoto(
  database: Database | null,
  params: { sectionKey: string; photo: CapturedPhoto; sortOrder: number },
): Promise<void> {
  if (!database) return;
  const { sectionKey, photo, sortOrder } = params;
  const inspectionId = await getOrCreateDraftInspection(database);

  await database.write(async () => {
    await database.get<Photo>('photos').create((rec) => {
      rec.inspectionId = inspectionId;
      rec.sectionKey = sectionKey;
      rec.category = photo.category ?? null;
      rec.filePath = photo.uri;
      rec.caption = photo.caption;
      rec.sortOrder = sortOrder;
      rec.capturedAt = new Date(photo.capturedAt);
      rec.remoteUrl = null;
      rec.synced = false;
    });
  });
}
