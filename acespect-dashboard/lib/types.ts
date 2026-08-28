export type JobStatus = "QUEUED" | "PROCESSING" | "DONE" | "FAILED";
export type SummaryStatus = "PENDING" | "APPROVED" | "REJECTED" | "EDITED";
export type AgentKind = "FORM" | "PHOTO" | "RISK" | "SUMMARY";
export type Decision = "APPROVED" | "REJECTED" | "EDITED";

export interface Person {
  name: string | null;
  email: string;
}

export interface InspectionListItem {
  id: string;
  inspectionType: string;
  propertyType: string;
  submittedAt: string;
  inspector: Person | null;
  jobStatus: JobStatus | null;
  summary: { id: string; riskScore: number | null; status: SummaryStatus } | null;
}

export interface AgentResult {
  id: string;
  agent: AgentKind;
  output: Record<string, unknown>;
  model: string | null;
  tokensUsed: number | null;
  latencyMs: number | null;
}

export interface ReviewDecision {
  id: string;
  decision: Decision;
  notes: string | null;
  decidedAt: string;
  reviewer: Person | null;
}

export interface InspectionDetail {
  id: string;
  inspectionType: string;
  propertyType: string;
  status: string;
  submittedAt: string;
  payload: Record<string, unknown>;
  inspector: Person | null;
  reviewSummary: {
    id: string;
    riskScore: number | null;
    flags: unknown[];
    summaryText: string | null;
    status: SummaryStatus;
    decisions: ReviewDecision[];
  } | null;
  reviewJobs: {
    id: string;
    status: JobStatus;
    error: string | null;
    results: AgentResult[];
  }[];
}

/* ── Inspector-facing shapes (from /web/inspections) ─────────────────────── */

export type InspectionStatus =
  | "draft"
  | "submitted"
  | "in-review"
  | "approved"
  | "rejected";

export interface WebDamage {
  id: string;
  type: string;
  location: string;
  direction: string;
  widthMm: number;
  lengthMm: number;
  notes: string;
  photos: string[];
}

export interface WebSection {
  id: string;
  key: string;
  name: string;
  icon: string;
  status: string;
  reviewStatus: string;
  reviewComment: string;
  reportText: string;
  fields: Record<string, unknown>;
  /** Raw un-flattened answers; null for inspections submitted before this existed. */
  answers: Record<string, unknown> | null;
  damages: WebDamage[];
  photos: string[];
}

export interface WebInspection {
  id: string;
  jobNo: string;
  address: string;
  suburb: string;
  client: string;
  inspectorId: string;
  reviewerId: string | null;
  date: string;
  submittedAt: string | null;
  type: string;
  propertyType: string;
  status: InspectionStatus;
  overallProgress: number;
  notes: string;
  sections: WebSection[];
}
