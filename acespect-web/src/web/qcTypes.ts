// Mirrors acespect-backend/src/modules/qc/qc.serializers.ts and the master-data
// services' output shapes. Spec-defined field values live in each row's `data`.

export interface QcPropertyType {
  id: string;
  key: string;
  label: string;
  icon: string;
  order: number;
}

export interface QcSeverity {
  id: string;
  key: string;
  label: string;
  color: string;
  order: number;
}

export interface QcStatus {
  id: string;
  key: string;
  label: string;
  color: string;
  meaning: string;
  order: number;
}

export interface QcTradeCategory {
  id: string;
  name: string;
  code: string;
  licenceRequired: boolean;
  licenceHint: string | null;
  active: boolean;
}

export interface QcProperty {
  id: string;
  name: string;
  projectId: string;
  propertyType: QcPropertyType;
}

export interface QcProject {
  id: string;
  name: string;
  clientId: string;
}

export interface QcConfigClient {
  id: string;
  name: string;
  projects: (QcProject & { properties: QcProperty[] })[];
}

export interface QcConfigBundle {
  propertyTypes: QcPropertyType[];
  severities: QcSeverity[];
  statuses: QcStatus[];
  tradeCategories: QcTradeCategory[];
  clients: QcConfigClient[];
}

export type FieldData = Record<string, unknown>;

export interface QcClientRow {
  id: string;
  name: string;
  clientCode: string | null;
  status: string;
  data: FieldData;
  _count: { projects: number; masterContractors: number; memberships: number };
}

export interface QcMasterContractorRow {
  id: string;
  clientId: string;
  name: string;
  abn: string | null;
  status: string;
  data: FieldData;
  insuranceStatus: string;
  client: { id: string; name: string };
}

export interface QcTradeCompanyRow {
  id: string;
  name: string;
  abn: string | null;
  status: string;
  data: FieldData;
  categories: { id: string; name: string; code: string }[];
  masterContractors: { id: string; name: string }[];
}

export interface QcSiteRow {
  id: string;
  projectId: string;
  name: string;
  status: string;
  data: FieldData;
  project?: { id: string; name: string };
  _count?: { lots: number };
}

export interface QcLotRow {
  id: string;
  name: string;
  projectId: string;
  siteId: string | null;
  lotStatus: string;
  data: FieldData;
  propertyType: QcPropertyType;
  site: { id: string; name: string } | null;
  project: { id: string; name: string; clientId: string };
}

export interface QcTeamMember {
  id: string;
  projectId: string;
  assigneeType: string;
  userId: string | null;
  projectRole: string;
  data: FieldData;
  user: { id: string; name: string | null; email: string } | null;
  tradeCompany: { id: string; name: string } | null;
  masterContractor: { id: string; name: string } | null;
}

export interface QcProjectRow {
  id: string;
  name: string;
  clientId: string;
  projectRef: string | null;
  jobNumber: string | null;
  builderId: string | null;
  state: string | null;
  status: string;
  closurePolicy: string;
  deskReviewAllowed: boolean;
  safetyAutoRelease: boolean;
  data: FieldData;
  client: { id: string; name: string };
  builder: { id: string; name: string } | null;
  _count: { sites: number; properties: number };
  sites?: QcSiteRow[];
  team?: QcTeamMember[];
}

export interface QcMembershipRow {
  id: string;
  role: string;
  status: string;
  optionalPermissions: string[];
  client: { id: string; name: string };
  masterContractor: { id: string; name: string } | null;
  tradeCompany: { id: string; name: string } | null;
  tradeCategories: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}

export interface QcPersonRow {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  position: string | null;
  whiteCardNumber: string | null;
  qcMemberships: QcMembershipRow[];
  qcInspectorCredential: { status: string; data: FieldData; approvedClients: { id: string; name: string }[] } | null;
  _count: { assignedQcDefects: number };
}

/** Used by the assignee pickers (any account that can be given QC work). */
export interface QcPerson {
  id: string;
  name: string | null;
  email: string;
  role?: string;
  qcMemberships?: { role: string; client: { id: string; name: string } }[];
}

export interface QcAllowedAction {
  key: string;
  label: string;
  form: string;
}

export interface QcDefect {
  id: string;
  defectRef: string | null;
  title: string | null;
  location: string | null;
  locationDetails: string | null;
  summary: string | null;
  roomArea: string | null;
  element: string | null;
  nature: string | null;
  codeRef: string | null;
  isDraft: boolean;
  flags: string[];
  escalationLevel: number;
  reworkCount: number;
  photoUrls: string[];
  dueDate: string | null;
  targetRectificationDate: string | null;
  scheduledAttendanceDate: string | null;
  holdReason: string | null;
  holdReviewDate: string | null;
  withdrawnReason: string | null;
  exceptionReason: string | null;
  disputeBy: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  property: { id: string; name: string; propertyType: QcPropertyType };
  site: { id: string; name: string } | null;
  project: { id: string; name: string; jobNumber: string | null; closurePolicy: string; deskReviewAllowed: boolean };
  client: { id: string; name: string };
  builder: { id: string; name: string } | null;
  tradeCategory: { id: string; name: string; code: string } | null;
  severity: QcSeverity | null;
  status: QcStatus;
  assignedTo: QcPerson | null;
  createdBy: QcPerson;
  builderContact: QcPerson | null;
  allocatedTradeCompany: { id: string; name: string } | null;
  allocatedTradeUser: QcPerson | null;
  closedBy: QcPerson | null;
  allowedActions?: QcAllowedAction[];
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
  changes: Record<string, unknown>;
  attachments: string[];
  reworkCount: number;
  hash: string;
  createdAt: string;
}

export interface QcDefectComment {
  id: string;
  text: string;
  visibleTo: string;
  authorRole: string;
  attachments: string[];
  createdAt: string;
  author: QcPerson;
}

export interface QcDefectDetail {
  defect: QcDefect;
  events: QcDefectEvent[];
  comments: QcDefectComment[];
  actorRole: string;
}
