import { api } from './apiClient';
import { QcDefect, QcTask, TaskUpdate } from '../types/qc';

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

/** Read-only defect lookup — the "Defect" link on Task Detail. */
export async function getDefect(id: string): Promise<QcDefect> {
  const { data } = await api.get<{ defect: QcDefect }>(`/qc/defects/${id}`);
  return data.defect;
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
