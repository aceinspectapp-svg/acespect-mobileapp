// Mirrors acespect-backend/src/modules/qc/qc.serializers.ts's output shapes.

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
  clients: QcConfigClient[];
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
  // filled in later by whoever it's assigned to, from the mobile Defect screen.
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
