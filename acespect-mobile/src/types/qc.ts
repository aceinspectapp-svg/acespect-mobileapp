/**
 * Domain types for the QC flow — mirrors acespect-backend's
 * src/modules/qc/qc.serializers.ts output exactly (real ids, server-owned
 * labels/colors for severity and status) now that QC is backed by the real
 * API instead of local state. See QcDataContext.tsx / services/qcApi.ts.
 */

export interface QcPropertyType {
  id: string;
  key: string;
  label: string;
  icon: string;
}

export interface QcSeverity {
  id: string;
  key: string;
  label: string;
  color: string;
}

export interface QcStatus {
  id: string;
  key: string;
  label: string;
  color: string;
  meaning: string;
}

export interface QcPerson {
  id: string;
  name: string | null;
  email: string;
  role?: string;
}

export interface QcDefect {
  id: string;
  // Admin creates a defect with just a property + assignee now -- these are
  // filled in later by whoever it's assigned to, from the Defect screen.
  location: string | null;
  locationDetails: string | null;
  summary: string | null;
  dueDate: string | null;
  createdAt: string;
  property: { id: string; name: string; propertyType: QcPropertyType };
  project: { id: string; name: string };
  client: { id: string; name: string };
  severity: QcSeverity | null;
  status: QcStatus;
  assignedTo: QcPerson | null;
  createdBy: QcPerson;
}

export type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface TaskUpdate {
  id: string;
  author: QcPerson;
  comment: string;
  photoUrls: string[];
  statusAfter: TaskStatus;
  statusChanged: boolean;
  createdAt: string;
}

export interface QcTask {
  id: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  createdAt: string;
  assignedTo: QcPerson;
  defect: QcDefect;
  updates?: TaskUpdate[];
}

/** A photo picked on-device, pending upload with a task update. */
export interface QcPhoto {
  id: string;
  uri: string;
}

const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
};
export function formatTaskStatus(status: TaskStatus): string {
  return TASK_STATUS_LABEL[status];
}

const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};
export function formatTaskPriority(priority: TaskPriority): string {
  return TASK_PRIORITY_LABEL[priority];
}
