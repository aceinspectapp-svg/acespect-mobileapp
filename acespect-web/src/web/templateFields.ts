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

/**
 * Mobile only ever submits (and the backend only ever stores) the
 * human-readable display labels for inspectionType/propertyType --
 * "Dilapidation", "Residential House" -- never the lowercase slugs
 * ("dilapidation", "residential_house") templates are keyed by; those slugs
 * are mobile-local state used for its own live template fetching and are
 * never sent to the backend. So a section's stored inspection carries only
 * the display label, and any template lookup from it needs to map back to
 * the slug first. Table covers every current INSPECTION_TYPES/
 * PROPERTY_TYPES entry (acespect-mobile/src/constants/inspectionData.ts);
 * the fallback (lowercase, spaces/hyphens -> underscore) handles anything
 * added later without needing this file touched, and is a no-op if a slug
 * was already passed in.
 */
const TYPE_LABEL_TO_SLUG: Record<string, string> = {
  "Dilapidation": "dilapidation",
  "Pre-Purchase": "pre_purchase",
  "Construction Stage": "construction_stage",
  "Investigations": "investigations",
  "Residential House": "residential_house",
  "Apartment": "apartment",
  "Commercial Properties": "commercial_properties",
  "Public Assets": "public_assets",
};

function toSlug(value: string): string {
  return TYPE_LABEL_TO_SLUG[value] ?? value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** The current published template for a profile + section; null if none exists (not every section key is templatable). */
export async function fetchActiveTemplate(
  inspectionType: string,
  propertyType: string,
  sectionKey: string,
): Promise<ActiveTemplate | null> {
  // Some older/malformed records have no type or property type stored at
  // all (predates this field being required) -- nothing to look up.
  if (!inspectionType || !propertyType) return null;
  try {
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/templates/active/${encodeURIComponent(toSlug(inspectionType))}/${encodeURIComponent(toSlug(propertyType))}/${encodeURIComponent(sectionKey)}`,
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

export function isRepeatRequirementMet(field: TemplateField, value: AnswerValue, scope: AnswerTree | undefined): boolean {
  const req = field.repeat?.requireWhen;
  if (!req || !scope) return true;
  const triggerVal = scope[req.fieldKey];
  const triggered = Array.isArray(triggerVal)
    ? triggerVal.some((v) => typeof v === "string" && req.equals.includes(v))
    : typeof triggerVal === "string" && req.equals.includes(triggerVal);
  if (!triggered) return true;
  return Array.isArray(value) && value.length > 0;
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

export interface FlattenedSection {
  fields: Record<string, unknown>;
  damages: {
    type: string;
    location: string;
    direction: string;
    widthMm: number;
    lengthMm: number;
    notes: string;
    photos: string[];
  }[];
  reportText: string;
}

/**
 * Derives the flattened report `fields`, the flat `damages[]` array, and a
 * summary `reportText` from a raw answer tree -- the same walk
 * acespect-mobile's flattenSectionToDraft does. Run on save so editing
 * answers here never leaves the report/damages view stale.
 */
export function flattenSectionToDraft(templateFields: TemplateField[], answers: AnswerTree): FlattenedSection {
  return walk(templateFields, answers, []);
}

function walk(templateFields: TemplateField[], scope: AnswerTree, ancestorLabels: string[]): FlattenedSection {
  const fields: Record<string, unknown> = {};
  const damages: FlattenedSection["damages"] = [];
  const textParts: string[] = [];

  for (const field of templateFields) {
    if (!isGateSatisfied(field, scope)) continue;
    const value = scope[field.key];

    if (field.type === "damage-list") {
      const itemFields = field.itemFields ?? [];
      const damageTypeField = itemFields.find((f) => f.key === "damageType");
      for (const { scope: inst } of resolveInstances(field, value)) {
        const typeRaw = asString(inst.damageType);
        const typeLabel = damageTypeField?.options?.find((o) => o.value === typeRaw)?.label || typeRaw;
        const subField = itemFields.find((f) => f.gate?.fieldKey === "damageType" && f.gate.equals === typeRaw);
        const subRaw = subField ? asString(inst[subField.key]) : "";
        const subLabel = subField?.options?.find((o) => o.value === subRaw)?.label || subRaw;

        const locationParts = [asString(inst.location), asString(inst.element), asString(inst.crackStartLocation)];
        damages.push({
          type: [typeLabel, subLabel].filter(Boolean).join(" — ") || "Damage",
          location: [...ancestorLabels, ...locationParts.filter(Boolean)].join(" — "),
          direction: asString(inst.direction),
          widthMm: Number(inst.widthMm) || 0,
          lengthMm: Number(inst.lengthMm) || 0,
          notes: asString(inst.notes),
          photos: asStringArray(inst.photos),
        });
      }
      continue;
    }

    if (field.type === "repeating-group") {
      const instances = resolveInstances(field, value);
      const labels: string[] = [];
      for (const { label, scope: inst } of instances) {
        const sub = walk(field.itemFields ?? [], inst, [...ancestorLabels, label]);
        damages.push(...sub.damages);
        labels.push(label);
        if (sub.reportText) textParts.push(`${label}: ${sub.reportText}`.trim());
      }
      fields[field.key] = labels.join(", ");
      continue;
    }

    if (field.type === "photos") continue;

    if (value === undefined || value === "") continue;
    const strValue = Array.isArray(value) ? value.filter((v) => typeof v === "string").join(", ") : String(value);
    fields[field.key] = strValue;
    textParts.push(`${field.label}: ${strValue}.`);
  }

  return { fields, damages, reportText: textParts.join(" ") };
}
