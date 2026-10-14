import * as Crypto from 'expo-crypto';
import type { AxiosRequestConfig } from 'axios';
import { api, ensureFreshAccessToken, refreshAccessToken } from './apiClient';
import type { SubmitPayload } from '../context/InspectionDraftContext';

/**
 * Upload one local photo (file:// URI) to the backend → returns its public
 * URL. `inspectionId`/`sectionKey`, when given, group the file under that
 * inspection's own section folder in Egnyte instead of an ungrouped flat
 * upload — always pass them for a real inspection photo (see
 * `InspectionDraftContext.getFolderId()`).
 */
/**
 * A fixed id for one photo, made from the inspection, the section and the photo's own file path. The server keeps the photo
 * under this id, so sending the same photo again after a dropped connection returns the copy it already has.
 */
async function stablePhotoId(inspectionId: string, sectionKey: string | undefined, uri: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${inspectionId}|${sectionKey ?? ''}|${uri}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function uploadPhoto(
  uri: string,
  opts?: { inspectionId?: string; sectionKey?: string; jobNo?: string; photoNumber?: number },
): Promise<string> {
  const name = uri.split('/').pop() || 'photo.jpg';
  const rawExt = (name.split('.').pop() || 'jpg').toLowerCase();
  const mime = rawExt === 'jpg' ? 'image/jpeg' : `image/${rawExt}`;

  const photoId = opts?.inspectionId ? await stablePhotoId(opts.inspectionId, opts.sectionKey, uri) : undefined;
  // A fresh FormData for every attempt: one that has already been sent cannot be sent again (that is what showed up as "Network Error").
  const buildForm = (): FormData => {
    const form = new FormData();
    // React Native's FormData accepts { uri, name, type } for file parts.
    form.append('photo', { uri, name, type: mime } as unknown as Blob);
    if (opts?.inspectionId) form.append('inspectionId', opts.inspectionId);
    if (opts?.sectionKey) form.append('sectionKey', opts.sectionKey);
    // The job number lets the server file the photo straight into its batch / job folder in Egnyte.
    if (opts?.jobNo) form.append('jobNo', opts.jobNo);
    // The photo's number in this inspection (1, 2, 3 ...): it becomes the file's name in Egnyte.
    if (opts?.photoNumber) form.append('photoNumber', String(opts.photoNumber));
    if (photoId) form.append('photoId', photoId);
    return form;
  };

  // Renew the sign-in first if it is about to run out (a long run of photos outlives a 15-minute sign-in), send, and if the sign-in still
  // expired or the connection dropped, renew / wait and send again with a new form. Safe to repeat: the server keeps one copy per photoId.
  for (let attempt = 0; ; attempt++) {
    try {
      await ensureFreshAccessToken();
      const config: AxiosRequestConfig & { _noAutoRetry?: boolean } = {
        headers: { 'Content-Type': 'multipart/form-data' },
        _noAutoRetry: true,
        timeout: 180000,
      };
      const { data } = await api.post<{ url: string }>('/inspections/photos', buildForm(), config);
      return data.url;
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (attempt >= 3) throw err;
      if (status === 401) {
        if (!(await refreshAccessToken())) throw err; // signed out for real: the app sends the person to sign in
        continue;
      }
      const transient = status === undefined || status >= 500 || status === 429 || status === 409; // no reply at all (network / timeout), a server hiccup, "slow down", or "this photo is already being saved" (send again: the server then returns the saved copy)
      if (!transient) throw err;
      await new Promise((r) => setTimeout(r, [2000, 6000, 15000][attempt]!));
    }
  }
}

export interface SubmitResult {
  inspectionId: string;
  reviewJobId: string;
  status: string;
  /** What the server actually stored. */
  receipt?: { sections: number; photos: number };
}

/** Submit the structured inspection. Returns the created inspection id and the server's receipt for it. */
export async function submitInspection(
  payload: SubmitPayload,
): Promise<SubmitResult> {
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
