// Mirrors acespect-backend/src/modules/qc/spec/qcSpec.ts. The server owns the
// definitions (GET /qc/spec); this file only types them and caches the fetch.

export type FieldKind =
  | "text" | "longtext" | "select" | "multiselect" | "bool" | "date" | "datetime" | "int" | "decimal" | "currency"
  | "email" | "phone" | "abn" | "acn" | "address" | "ref" | "refs" | "file" | "files" | "composite" | "system";

export interface FieldSpec {
  key: string;
  label: string;
  kind: FieldKind;
  req: "M" | "O" | "C" | "S";
  group: string;
  rules?: string;
  notes?: string;
  min?: number;
  max?: number;
  options?: string[];
  ref?: string | null;
  parts?: Array<{ label: string; kind: FieldKind }>;
  requiredWhen?: { field: string; in: string[] };
  hidden?: boolean;
  system: boolean;
}

export interface FormSpec {
  code: string;
  title: string;
  description: string;
  usedBy: string;
  actions: string;
  fields: FieldSpec[];
}

export interface QcSpecPayload {
  spec: {
    entities: Record<string, FormSpec>;
    forms: Record<string, FormSpec>;
    extraForms: Record<string, FormSpec>;
  };
  roles: Array<{ code: string; label: string }>;
  deactivationReasons: string[];
  actions: Array<{ key: string; label: string; form: string }>;
}

export function findForm(spec: QcSpecPayload, code: string): FormSpec {
  const f = spec.spec.entities[code] ?? spec.spec.forms[code] ?? spec.spec.extraForms[code];
  if (!f) throw new Error(`Unknown spec form ${code}`);
  return f;
}

export interface Address {
  unit?: string;
  streetNumber?: string;
  streetName?: string;
  streetType?: string;
  suffix?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

export const STREET_TYPES = ["Street", "Road", "Avenue", "Crescent", "Court", "Drive", "Parade", "Place", "Way", "Lane", "Boulevard", "Close", "Terrace", "Highway", "Other"];
export const AU_STATES = ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "ACT", "NT"];
