import { api } from './apiClient';
import type { SubmitPayload } from '../context/InspectionDraftContext';

/** Upload one local photo (file:// URI) to the backend → returns its public URL. */
export async function uploadPhoto(uri: string): Promise<string> {
  const name = uri.split('/').pop() || 'photo.jpg';
  const rawExt = (name.split('.').pop() || 'jpg').toLowerCase();
  const mime = rawExt === 'jpg' ? 'image/jpeg' : `image/${rawExt}`;

  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } for file parts.
  form.append('photo', { uri, name, type: mime } as unknown as Blob);

  const { data } = await api.post<{ url: string }>('/inspections/photos', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.url;
}

/** Submit the structured inspection. Returns the created inspection id. */
export async function submitInspection(
  payload: SubmitPayload,
): Promise<{ inspectionId: string; reviewJobId: string; status: string }> {
  const { data } = await api.post('/inspections/submit', payload);
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
