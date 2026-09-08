import { API_BASE, getToken } from "./api";

/**
 * Template/answer-tree types + pure logic, ported from the mobile app
 * (acespect-mobile/src/services/templateApi.ts,
 * .../fieldRenderers/types.ts) so a section's raw `answers` tree can be
 * walked and rendered here exactly the way it was captured on mobile,
 * instead of the old flat one-line-per-key summary.
 */

export type TemplateFieldType =
  | "text" | "textarea" | "numeric" | "date"
  | "yesno"
  | "pill-select"
  | "select-tiles"
  | "color-select"
  | "chip-multiselect"
  | "photos"
  | "repeating-group"
  | "damage-list";

export interface TemplateFieldOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

export interface FieldGate {
  fieldKey: string;
  equals?: string;
  equalsAny?: string[];
}

export interface RepeatConfig {
  presentation: "strip" | "fixed-tabs" | "nested" | "checklist";
  fixedInstances?: { key: string; label: string }[];
  addable?: boolean;
  addButtonLabel?: string;
  titleFieldKey?: string;
  collapsible?: boolean;
  categoryNav?: { selectorFieldKey: string };
  itemNoun?: string;
  requireWhen?: { fieldKey: string; equals: string[] };
}

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  order: number;
  required?: boolean;
  requiredGroup?: string;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
  unit?: string;
  prefix?: string;
  options?: TemplateFieldOption[];
  allowOther?: boolean;
  gate?: FieldGate;
  repeat?: RepeatConfig;
  itemFields?: TemplateField[];
  sectionLetter?: string;
}

export interface ActiveTemplate {
  id: string;
  inspectionType: string;
  propertyType: string;
  sectionKey: string;
  version: number;
  fields: TemplateField[];
}

export type AnswerValue = string | string[] | AnswerTree | AnswerTree[] | Record<string, AnswerTree> | undefined;
export interface AnswerTree {
  [fieldKey: string]: AnswerValue;
}

/** The current published template for a profile + section; null if none exists (not every section key is templatable). */
export async function fetchActiveTemplate(
  inspectionType: string,
  propertyType: string,
  sectionKey: string,
): Promise<ActiveTemplate | null> {
  try {
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/templates/active/${encodeURIComponent(inspectionType)}/${encodeURIComponent(propertyType)}/${encodeURIComponent(sectionKey)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { template: ActiveTemplate };
    return data.template;
  } catch {
    return null;
  }
}

export function isGateSatisfied(field: TemplateField, scope: AnswerTree): boolean {
  if (!field.gate) return true;
  const { equals, equalsAny } = field.gate;
  const val = scope[field.gate.fieldKey];
  const matches = (target: string) => (Array.isArray(val) ? (val as unknown[]).includes(target) : val === target);
  if (equalsAny) return equalsAny.some(matches);
  return equals !== undefined && matches(equals);
}

export function asAnswerTree(v: AnswerValue): AnswerTree {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AnswerTree) : {};
}
export function asStringArray(v: AnswerValue): string[] {
  return Array.isArray(v) && (v.length === 0 || typeof v[0] === "string") ? (v as string[]) : [];
}
export function asString(v: AnswerValue): string {
  return typeof v === "string" ? v : "";
}

export function resolveInstances(field: TemplateField, value: AnswerValue): { label: string; scope: AnswerTree }[] {
  const repeat = field.repeat ?? { presentation: "strip" as const };
  const titleKey = repeat.titleFieldKey;
  const named = (scope: AnswerTree, fallback: string): string => {
    const v = titleKey ? scope[titleKey] : undefined;
    return typeof v === "string" && v.trim() ? v.trim() : fallback;
  };

  if (repeat.presentation === "strip" || field.type === "damage-list") {
    const list = Array.isArray(value) ? (value as AnswerTree[]) : [];
    return list.map((scope, i) => ({ label: named(scope, `${field.label} ${i + 1}`), scope }));
  }
  const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
  const fixed = repeat.fixedInstances ?? [];
  const seen = new Set(fixed.map((f) => f.key));
  const out = fixed.map((f) => ({ label: named(record[f.key] ?? {}, f.label), scope: record[f.key] ?? {} }));
  let extra = 0;
  for (const [key, scope] of Object.entries(record)) {
    if (seen.has(key)) continue;
    extra += 1;
    out.push({ label: named(scope, `${field.label} ${fixed.length + extra}`), scope });
  }
  return out;
}

/** True when this scope has an answer for `field` (or, for a select/multiselect, resolves the stored value(s) to their option label(s) for display). */
export function displayValue(field: TemplateField, value: AnswerValue): string {
  if (value === undefined || value === "") return "—";
  const optionLabel = (raw: string) => {
    if (raw.startsWith("__other__:")) return raw.slice("__other__:".length);
    return field.options?.find((o) => o.value === raw)?.label ?? raw;
  };
  if (Array.isArray(value)) {
    const strs = value.filter((v): v is string => typeof v === "string");
    if (strs.length === 0) return "—";
    return strs.map(optionLabel).join(", ");
  }
  if (typeof value === "string") return optionLabel(value) || "—";
  return String(value);
}
