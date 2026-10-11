import { api } from './apiClient';

/** Calls for inspections, notifications and the signed-in person's QC context. */

export interface QcMe {
  userId: string;
  role: string;
  isSA: boolean;
  legacy: boolean;
  clientId: string | null;
  clients: Array<{ id: string; name: string; role: string }>;
  capabilities: string[];
}

export interface ResultCode {
  code: string;
  label: string;
  definition: string;
  creates_a_defect: boolean;
  photo_required: boolean;
  reason_required: boolean;
  colour: string;
}

export interface InspectionResult {
  id: string;
  itemNumber: string;
  item: Record<string, any>;
  resultCode: string | null;
  comments: string | null;
  locationDetail: string | null;
  measurement: { value: number; unit: string } | null;
  photoUrls: string[];
  reason: string | null;
  defectIds: string[];
  carriedFromId: string | null;
}

export interface Inspection {
  id: string;
  ref: string;
  status: string;
  type: string;
  locked: boolean;
  plannedFrom: string | null;
  plannedTo: string | null;
  stage: { stage_name: string; stage_number: string } | null;
  lot: { name: string } | null;
  project: { name: string } | null;
  counts?: Record<string, number>;
  results?: InspectionResult[];
  header?: Record<string, any>;
}

export interface InspectionDetail {
  inspection: Inspection;
  defects: Array<{ id: string; defectRef: string | null; title: string | null; isDraft: boolean; sourceItemNumber: string | null }>;
  resultCodes: ResultCode[];
}

export interface QcNotification {
  id: string;
  type: string;
  title: string;
  mandatory: boolean;
  readAt: string | null;
  ackedAt: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export const qcMe = (): Promise<QcMe> => api.get<QcMe>('/qc/me').then((r) => r.data);

export const listInspections = (): Promise<Inspection[]> =>
  api.get<{ inspections: Inspection[] }>('/qc/inspections?mine=true').then((r) => r.data.inspections);

export const getInspection = (id: string): Promise<InspectionDetail> => api.get<InspectionDetail>(`/qc/inspections/${id}`).then((r) => r.data);

export const startInspection = (id: string, body: Record<string, unknown>): Promise<InspectionDetail> =>
  api.post<InspectionDetail>(`/qc/inspections/${id}/start`, body).then((r) => r.data);

export const saveResult = (id: string, itemNumber: string, body: Record<string, unknown>) =>
  api.put<{ result: InspectionResult; raisedDefectIds?: string[]; stale?: boolean }>(`/qc/inspections/${id}/results/${encodeURIComponent(itemNumber)}`, body).then((r) => r.data);

export const createAdHocInspection = (body: { projectId: string; propertyId?: string; type?: string; purpose?: string }): Promise<Inspection> =>
  api.post<{ inspection: Inspection }>('/qc/inspections/adhoc', body).then((r) => r.data.inspection);

export const completionCheck = (id: string) =>
  api.get<{ unanswered: string[]; draftDefects: Array<{ id: string; defectRef: string | null; title: string | null }>; notInspected: number; hasSignature: boolean; canComplete: boolean }>(`/qc/inspections/${id}/completion`).then((r) => r.data);

export const completeInspection = (id: string, body: Record<string, unknown>) =>
  api.post(`/qc/inspections/${id}/complete`, body).then((r) => r.data);

/** Upload photos as evidence on an inspection; returns the stored (unsigned) URLs to reference from results. */
export async function uploadInspectionPhotos(inspectionId: string, uris: string[]): Promise<string[]> {
  const form = new FormData();
  form.append('linkedType', 'Inspection');
  form.append('linkedId', inspectionId);
  form.append('phase', 'Identification');
  form.append('capturedVia', 'In-app camera');
  uris.forEach((uri, i) => {
    const name = uri.split('/').pop() || `photo-${i}.jpg`;
    const ext = (name.split('.').pop() || 'jpg').toLowerCase();
    form.append('files', { uri, name, type: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}` } as unknown as Blob);
  });
  const { data } = await api.post<{ evidence: Array<{ rawUrl: string }> }>('/qc/evidence', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
  return data.evidence.map((e) => e.rawUrl);
}

export const listNotifications = (): Promise<{ notifications: QcNotification[]; unread: number }> => api.get('/qc/notifications').then((r) => r.data);
export const markNotificationRead = (id: string) => api.post(`/qc/notifications/${id}/read`).then(() => undefined);
export const ackNotification = (id: string) => api.post(`/qc/notifications/${id}/ack`).then(() => undefined);
export const registerPushToken = (token: string, platform: string) => api.post('/qc/push-token', { token, platform }).then(() => undefined);
