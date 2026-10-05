import { api } from './apiClient';
import { QcConfigBundle, QcDefect, QcDefectDetail, QcTask, SpecForm, TaskStatus, TaskUpdate } from '../types/qc';

/** Tasks assigned to the signed-in user — the mobile app's entire QC surface. */
export async function getMyTasks(): Promise<QcTask[]> {
  const { data } = await api.get<{ tasks: QcTask[] }>('/qc/tasks/assigned');
  return data.tasks;
}

/** Task detail including its full activity log. */
export async function getTask(id: string): Promise<QcTask> {
  const { data } = await api.get<{ task: QcTask }>(`/qc/tasks/${id}`);
  return data.task;
}

/** A defect with its lifecycle history and the actions the server says this user may take on it now. */
export async function getDefectDetail(id: string): Promise<QcDefectDetail> {
  const { data } = await api.get<QcDefectDetail>(`/qc/defects/${id}`);
  return data;
}

/**
 * Saves a draft's descriptive fields (the F16 keys: defect_title, description,
 * room_or_area, ...). Status never changes here: that only happens through
 * lifecycle actions (postDefectAction), which the server checks against this
 * user's role.
 */
export async function updateDefect(id: string, patch: Record<string, unknown>): Promise<QcDefect> {
  const { data } = await api.patch<{ defect: QcDefect }>(`/qc/defects/${id}`, patch);
  return data.defect;
}

function appendPhotos(form: FormData, photoUris: string[]) {
  photoUris.forEach((uri, i) => {
    const name = uri.split('/').pop() || `photo-${i}.jpg`;
    const ext = (name.split('.').pop() || 'jpg').toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    form.append('photos', { uri, name, type: mime } as unknown as Blob);
  });
}

/** Runs a lifecycle action (confirm, release, verify_or_reject, ...). Photos travel with the form. */
export async function postDefectAction(
  id: string,
  action: string,
  payload: Record<string, unknown>,
  photoUris: string[],
  expectedUpdatedAt?: string,
): Promise<QcDefectDetail> {
  const form = new FormData();
  form.append('payload', JSON.stringify({ ...payload, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }));
  appendPhotos(form, photoUris);
  const { data } = await api.post<QcDefectDetail>(`/qc/defects/${id}/actions/${action}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return data;
}

/** Adds photos to a draft defect (at least one is needed before it can be confirmed as Open). */
export async function addDefectPhotos(id: string, photoUris: string[]): Promise<QcDefect> {
  const form = new FormData();
  appendPhotos(form, photoUris);
  const { data } = await api.post<{ defect: QcDefect }>(`/qc/defects/${id}/photos`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  return data.defect;
}

/** Severities, statuses, trade categories and trade companies, for pickers. */
export async function getConfig(): Promise<QcConfigBundle> {
  const { data } = await api.get<QcConfigBundle>('/qc/config');
  return data;
}

let specForms: Record<string, SpecForm> | null = null;

/** Field definitions for a spec form (F16...F33), fetched once per app run. */
export async function getSpecForm(code: string): Promise<SpecForm> {
  if (!specForms) {
    const { data } = await api.get<{ spec: { entities: Record<string, SpecForm>; forms: Record<string, SpecForm>; extraForms: Record<string, SpecForm> } }>('/qc/spec');
    specForms = { ...data.spec.entities, ...data.spec.forms, ...data.spec.extraForms };
  }
  const form = specForms[code];
  if (!form) throw new Error(`Unknown form ${code}`);
  return form;
}

/**
 * Posts a site-visit update: a comment and/or photos, optionally marking the
 * task complete. Multipart — same shape as inspectionApi.uploadPhoto's form,
 * just with a repeated "photos" field for multiple files at once.
 */
export async function postTaskUpdate(
  taskId: string,
  comment: string,
  markCompleted: boolean,
  photoUris: string[],
): Promise<TaskUpdate> {
  const form = new FormData();
  form.append('comment', comment);
  form.append('markCompleted', String(markCompleted));
  appendPhotos(form, photoUris);

  const { data } = await api.post<{ update: TaskUpdate }>(`/qc/tasks/${taskId}/updates`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // Same rationale as inspectionApi.uploadPhoto: several full-res photos
    // can take a while over a slow connection.
    timeout: 120000,
  });
  return data.update;
}

/** Direct, free status change -- the Tasks list's inline status pill, as opposed to postTaskUpdate's automatic bump. */
export async function updateTaskStatus(taskId: string, status: TaskStatus): Promise<QcTask> {
  const { data } = await api.patch<{ task: QcTask }>(`/qc/tasks/${taskId}/status`, { status });
  return data.task;
}
