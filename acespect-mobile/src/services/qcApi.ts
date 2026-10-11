import { api } from './apiClient';
import { QcConfigBundle, QcDefect, QcDefectComment, QcDefectDetail, QcLot, QcProject, QcProjectDocument, QcTask, SpecForm, TaskStatus, TaskUpdate } from '../types/qc';
import { readCache, withCache, writeCache } from './qcCache';

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
  return (await getDefectDetailCached(id)).data;
}

/** The defect, plus whether it came from the phone's memory because there is no signal. */
export function getDefectDetailCached(id: string) {
  return withCache(`defect.${id}`, () => api.get<QcDefectDetail>(`/qc/defects/${id}`).then((r) => r.data));
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
  return (await withCache('config', () => api.get<QcConfigBundle>('/qc/config').then((r) => r.data))).data;
}

let specForms: Record<string, SpecForm> | null = null;

/** Field definitions for a spec form (F16...F33), fetched once per app run. */
export async function getSpecForm(code: string): Promise<SpecForm> {
  if (!specForms) {
    const { data } = await withCache('spec', () =>
      api.get<{ spec: { entities: Record<string, SpecForm>; forms: Record<string, SpecForm>; extraForms: Record<string, SpecForm> } }>('/qc/spec').then((r) => r.data),
    );
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

// ─── The defects feed, new defects, comments, projects, documents ───────────────

export interface DefectQuery {
  status?: string;
  severity?: string;
  q?: string;
  projectId?: string;
  draft?: boolean;
}

/** Every defect this person may see (not just ones assigned as tasks): drafts for inspectors, released work for builders and trades. */
export function listDefects(query: DefectQuery = {}) {
  const params: Record<string, string> = { limit: '300' };
  if (query.status) params.status = query.status;
  if (query.severity) params.severity = query.severity;
  if (query.q) params.q = query.q;
  if (query.projectId) params.projectId = query.projectId;
  if (query.draft !== undefined) params.draft = String(query.draft);
  return withCache(`defects.${JSON.stringify(params)}`, () => api.get<{ defects: QcDefect[] }>('/qc/defects', { params }).then((r) => r.data.defects));
}

/** Creates a draft defect in a lot, assigned to the caller. F16 fields may be sent up front. */
export async function createDefect(body: Record<string, unknown>): Promise<QcDefect> {
  const { data } = await api.post<{ defect: QcDefect }>('/qc/defects', body);
  return data.defect;
}

export async function postDefectComment(id: string, text: string, visibleTo: string, photoUris: string[]): Promise<QcDefectComment> {
  const form = new FormData();
  form.append('payload', JSON.stringify({ text, visibleTo }));
  appendPhotos(form, photoUris);
  const { data } = await api.post<{ comment: QcDefectComment }>(`/qc/defects/${id}/comments`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
  return data.comment;
}

export async function bulkReleaseDefects(ids: string[]): Promise<Array<{ id: string; ok: boolean; message?: string }>> {
  const { data } = await api.post<{ results: Array<{ id: string; ok: boolean; message?: string }> }>('/qc/defects/bulk/release', { ids, cover_note: 'Released' });
  return data.results;
}

export const listProjects = () => withCache('projects', () => api.get<{ projects: QcProject[] }>('/qc/projects').then((r) => r.data.projects));
export const listLots = (projectId: string) => withCache(`lots.${projectId}`, () => api.get<{ lots: QcLot[] }>('/qc/lots', { params: { projectId } }).then((r) => r.data.lots));
export const listProjectDocuments = (projectId: string) =>
  withCache(`docs.${projectId}`, () => api.get<{ documents: QcProjectDocument[] }>(`/qc/projects/${projectId}/documents`).then((r) => r.data.documents));

export { readCache, writeCache };
