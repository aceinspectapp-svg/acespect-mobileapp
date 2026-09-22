import { api } from './apiClient';
import type { SubmitPayload } from '../context/InspectionDraftContext';

/**
 * Upload one local photo (file:// URI) to the backend → returns its public
 * URL. `inspectionId`/`sectionKey`, when given, group the file under that
 * inspection's own section folder in Egnyte instead of an ungrouped flat
 * upload — always pass them for a real inspection photo (see
 * `InspectionDraftContext.getFolderId()`).
 */
export async function uploadPhoto(
  uri: string,
  opts?: { inspectionId?: string; sectionKey?: string },
): Promise<string> {
  const name = uri.split('/').pop() || 'photo.jpg';
  const rawExt = (name.split('.').pop() || 'jpg').toLowerCase();
  const mime = rawExt === 'jpg' ? 'image/jpeg' : `image/${rawExt}`;

  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } for file parts.
  form.append('photo', { uri, name, type: mime } as unknown as Blob);
  if (opts?.inspectionId) form.append('inspectionId', opts.inspectionId);
  if (opts?.sectionKey) form.append('sectionKey', opts.sectionKey);

  const { data } = await api.post<{ url: string }>('/inspections/photos', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // The shared client's default (15s, apiClient.ts) is fine for small JSON
    // calls but nowhere near enough for a full-resolution phone photo: the
    // backend uploads it to Egnyte twice (compressed + full-quality
    // original, storage.ts) before responding, and over a slow/tunnelled
    // dev connection a single ~9MB photo has been measured taking 45s+.
    // Without this override every upload of a real (not test-sized) photo
    // would spuriously fail as a "Network Error" well before it was actually
    // done -- not a flaky connection, just too short a clock for the payload.
    timeout: 120000,
  });
  return data.url;
}

/** Submit the structured inspection. Returns the created inspection id. */
export async function submitInspection(
  payload: SubmitPayload,
): Promise<{ inspectionId: string; reviewJobId: string; status: string }> {
  const { data } = await api.post('/inspections/submit', payload, {
    // Same reasoning as uploadPhoto's override above: the payload itself is
    // small (photos are already-uploaded URLs by this point), but creating
    // the inspection + every section + damage row + the review job is real
    // work, and over a slow/tunnelled dev connection the shared client's
    // default 15s (apiClient.ts) has been tight enough to throw a spurious
    // "Network Error" on an otherwise-successful submit.
    timeout: 60000,
  });
  return data;
}

/** A Post-Dilapidation job admin has pushed to the signed-in inspector, not yet picked up. */
export interface AssignedJob {
  id: string;
  inspectionType: string;
  propertyType: string;
  jobNo: string | null;
  address: string | null;
  suburb: string | null;
  client: string | null;
  baseline: { id: string; jobNo: string | null; address: string | null; client: string | null; propertyType: string } | null;
}

export async function getAssignedJobs(): Promise<AssignedJob[]> {
  const { data } = await api.get<{ jobs: AssignedJob[] }>('/inspections/assigned');
  return data.jobs;
}

/** One section of a Post-Dilapidation job's baseline, as last recorded -- read-only reference. */
export interface BaselineSection {
  key: string;
  name: string;
  reportText: string;
  fields: Record<string, unknown>;
  photos: string[];
}

export async function getBaselineSections(assignedInspectionId: string): Promise<BaselineSection[]> {
  const { data } = await api.get<{ sections: BaselineSection[] }>(`/inspections/${assignedInspectionId}/baseline-sections`);
  return data.sections;
}
