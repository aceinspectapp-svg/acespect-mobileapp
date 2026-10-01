import { api } from './apiClient';
import { QcDefect, QcSeverity, QcStatus, QcTask, TaskStatus, TaskUpdate } from '../types/qc';

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

/** Defect lookup — the "Defect" link on Task Detail. */
export async function getDefect(id: string): Promise<QcDefect> {
  const { data } = await api.get<{ defect: QcDefect }>(`/qc/defects/${id}`);
  return data.defect;
}

/**
 * Fills in what the admin didn't set at creation (location/summary/severity/
 * due date) -- allowed because the server checks this defect is actually
 * assigned to the caller (see acespect-backend's qc.service updateDefect).
 * `assignedToId` isn't accepted here on purpose: reassigning stays an
 * admin-only action done from acespect-web.
 */
export async function updateDefect(
  id: string,
  patch: Partial<{
    location: string;
    locationDetails: string;
    summary: string;
    severityId: string;
    statusId: string;
    dueDate: string | null;
  }>,
): Promise<QcDefect> {
  const { data } = await api.patch<{ defect: QcDefect }>(`/qc/defects/${id}`, patch);
  return data.defect;
}

/** The severity list for the Defect screen's picker -- same config bundle acespect-web's admin pages read, just the one piece mobile needs. */
export async function getSeverities(): Promise<QcSeverity[]> {
  const { data } = await api.get<{ severities: QcSeverity[] }>('/qc/config');
  return data.severities;
}

/** The full 11-stage status lifecycle, for the Defect screen's free status picker -- same /qc/config bundle, just the statuses piece. */
export async function getStatuses(): Promise<QcStatus[]> {
  const { data } = await api.get<{ statuses: QcStatus[] }>('/qc/config');
  return data.statuses;
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
  photoUris.forEach((uri, i) => {
    const name = uri.split('/').pop() || `photo-${i}.jpg`;
    const ext = (name.split('.').pop() || 'jpg').toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
    form.append('photos', { uri, name, type: mime } as unknown as Blob);
  });

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
