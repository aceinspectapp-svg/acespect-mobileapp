/**
 * The Job Information fields a reviewer can correct, for one report type. They are the fields the report's cover reads (report.ts,
 * buildReportHeader), so each type lists only what its own cover prints: a Construction report has no Property Owner, Client Project
 * Reference or General Statement, and so does not offer them.
 */
export type JobInfoFieldType = "text" | "email" | "date" | "textarea";
export interface JobInfoField { key: string; label: string; type: JobInfoFieldType }

const DILAPIDATION: JobInfoField[] = [
  { key: "date", label: "Date", type: "date" },
  { key: "clientName", label: "Client Name", type: "text" },
  { key: "clientEmail", label: "Client Email", type: "email" },
  { key: "yourReference", label: "Client Project Reference", type: "text" },
  { key: "jobNo", label: "Job Number", type: "text" },
  { key: "propertyOwner", label: "Property Owner Name", type: "text" },
  { key: "propertyOwnerEmail", label: "Property Owner Email", type: "email" },
  { key: "address", label: "Property Address", type: "text" },
  { key: "weather", label: "Weather", type: "text" },
  { key: "inspector", label: "Inspector Name", type: "text" },
  { key: "inspectorRegistration", label: "Inspector DBU License", type: "text" },
  { key: "purpose", label: "General Statement (Inspection Summary)", type: "textarea" },
];

// The Construction cover: the date, the client (and the email printed under the name), Our Reference, the property, the inspection date, the
// weather and the inspector with their registration. Its purpose and general statement are the report's own fixed wording, and the stage
// comes from what the inspector chose, so none of those are editable here.
const CONSTRUCTION_KEYS = ["date", "clientName", "clientEmail", "jobNo", "address", "weather", "inspector", "inspectorRegistration"];
const CONSTRUCTION: JobInfoField[] = CONSTRUCTION_KEYS.map((key) => DILAPIDATION.find((f) => f.key === key)!);

export const isConstructionInspection = (inspection: { type: string }): boolean => /construction/i.test(inspection.type);

export const jobInfoFieldsFor = (inspection: { type: string }): JobInfoField[] => (isConstructionInspection(inspection) ? CONSTRUCTION : DILAPIDATION);
