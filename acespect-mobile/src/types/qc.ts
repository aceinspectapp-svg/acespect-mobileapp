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

export interface QcTradeCategory {
  id: string;
  name: string;
  code: string;
}

/** A lifecycle step the server says the signed-in user may take on this defect right now. */
export interface QcAllowedAction {
  key: string;
  label: string;
  /** Spec form code (F16...F33) that collects its details; see GET /qc/spec. */
  form: string;
}

export interface QcDefect {
  id: string;
  defectRef: string | null;
  title: string | null;
  /** Service-level clocks and DLP flag, set by the server when the defect is released. */
  ackDueAt?: string | null;
  rectifyDueAt?: string | null;
  reinspectDueAt?: string | null;
  acknowledgedAt?: string | null;
  rectifiedAt?: string | null;
  dlpDefect?: boolean;
  foundAtStage?: string | null;
  // An admin creates a defect with just a lot + assignee: it starts as a
  // draft and these are filled in later by whoever it's assigned to.
  location: string | null;
  locationDetails: string | null;
  summary: string | null;
  roomArea: string | null;
  element: string | null;
  nature: string | null;
  codeRef: string | null;
  isDraft: boolean;
  flags: string[];
  reworkCount: number;
  photoUrls: string[];
  tradeCategory: QcTradeCategory | null;
  targetRectificationDate: string | null;
  holdReason: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on a single-defect fetch (GET /qc/defects/:id and task detail). */
  allowedActions?: QcAllowedAction[];
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

// ─── Requirements spec (GET /qc/spec): the server owns each form's fields ──────

export type SpecFieldKind =
  | 'text' | 'longtext' | 'select' | 'multiselect' | 'bool' | 'date' | 'datetime' | 'int' | 'decimal' | 'currency'
  | 'email' | 'phone' | 'abn' | 'acn' | 'address' | 'ref' | 'refs' | 'file' | 'files' | 'composite' | 'system';

export interface SpecField {
  key: string;
  label: string;
  kind: SpecFieldKind;
  req: 'M' | 'O' | 'C' | 'S';
  rules?: string;
  min?: number;
  max?: number;
  options?: string[];
  ref?: string | null;
  requiredWhen?: { field: string; in: string[] };
  hidden?: boolean;
  system: boolean;
}

export interface SpecForm {
  code: string;
  title: string;
  description: string;
  fields: SpecField[];
}

export interface QcDefectEvent {
  id: string;
  type: string;
  from: { key: string; label: string } | null;
  to: { key: string; label: string } | null;
  actor: QcPerson;
  actorRole: string;
  onBehalf: boolean;
  note: string | null;
  createdAt: string;
}

export interface QcDefectDetail {
  defect: QcDefect;
  events: QcDefectEvent[];
  actorRole: string;
}

export interface QcConfigBundle {
  severities: QcSeverity[];
  statuses: QcStatus[];
  tradeCategories: QcTradeCategory[];
  tradeCompanies: Array<{ id: string; name: string }>;
}
