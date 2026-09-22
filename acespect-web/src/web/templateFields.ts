import { API_BASE, getToken } from "./api";
import { composeSectionSentence } from "./reportSentences";

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
  exclusive?: boolean;
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

function isAnswered(v: AnswerValue): boolean {
  return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "";
}

/**
 * Whether `field` is a currently-unmet required field within `siblings` (the
 * full sibling list at this level, needed to resolve either/or
 * `requiredGroup`s the same way `meetsAllRequiredFields` does) against
 * `scope` -- ported from acespect-mobile's fieldRenderers/index.tsx so the
 * web editor can red-outline missing fields the same way mobile does. A
 * gated-off field is never "missing" -- it isn't asking anything right now.
 */
export function isFieldMissing(field: TemplateField, siblings: TemplateField[], scope: AnswerTree): boolean {
  if (!field.required) return false;
  if (!isGateSatisfied(field, scope)) return false;
  if (field.requiredGroup) {
    const group = siblings.filter((f) => f.requiredGroup === field.requiredGroup);
    return !group.some((f) => isAnswered(scope[f.key]));
  }
  return !isAnswered(scope[field.key]);
}

/**
 * True when every `repeat.requireWhen` constraint in this template is
 * satisfied, at every nesting depth -- ported from
 * acespect-mobile's utils/flattenSectionToDraft.ts so the web editor blocks
 * Submit on the same mandatory-defect rule mobile does (Condition = Average/
 * Poor without a recorded defect).
 */
export function meetsAllRequireWhen(templateFields: TemplateField[], scope: AnswerTree): boolean {
  for (const field of templateFields) {
    if (!isGateSatisfied(field, scope)) continue;
    const value = scope[field.key];
    if (field.repeat?.requireWhen && !isRepeatRequirementMet(field, value, scope)) return false;
    if (field.type === "repeating-group") {
      for (const { scope: inst } of resolveInstances(field, value)) {
        if (!meetsAllRequireWhen(field.itemFields ?? [], inst)) return false;
      }
    }
  }
  return true;
}

/**
 * True when every `required` field is satisfied, at this level AND inside
 * every instance of every repeating-group -- ported from
 * acespect-mobile's utils/flattenSectionToDraft.ts. A required field hidden
 * by its own `gate` doesn't block completion while invisible, and fields
 * sharing a `requiredGroup` are "either/or".
 */
export function meetsAllRequiredFields(templateFields: TemplateField[], scope: AnswerTree): boolean {
  const required = templateFields.filter((f) => f.required && isGateSatisfied(f, scope));
  const grouped = new Map<string, TemplateField[]>();
  const ungrouped: TemplateField[] = [];
  for (const f of required) {
    if (f.requiredGroup) {
      const arr = grouped.get(f.requiredGroup) ?? [];
      arr.push(f);
      grouped.set(f.requiredGroup, arr);
    } else {
      ungrouped.push(f);
    }
  }
  if (!ungrouped.every((f) => isAnswered(scope[f.key]))) return false;
  for (const fields of grouped.values()) {
    if (!fields.some((f) => isAnswered(scope[f.key]))) return false;
  }

  for (const field of templateFields) {
    if (field.type !== "repeating-group") continue;
    if (!isGateSatisfied(field, scope)) continue;
    for (const { scope: inst } of resolveInstances(field, scope[field.key])) {
      if (!meetsAllRequiredFields(field.itemFields ?? [], inst)) return false;
    }
  }
  return true;
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
 * acespect-mobile's flattenSectionToDraft does, except that when `sectionKey`
 * matches one of `reportSentences.ts`'s composers, each top-level instance's
 * paragraph is built with that exact Houspect-Victoria wording instead of
 * the generic "Label: value." fallback below. Run on save (web inspector
 * editor only -- mobile has its own copy of this function, untouched) so
 * editing answers here never leaves the report/damages view stale.
 */
export function flattenSectionToDraft(
  templateFields: TemplateField[],
  answers: AnswerTree,
  sectionKey?: string,
): FlattenedSection {
  return walk(templateFields, answers, [], sectionKey);
}

function walk(
  templateFields: TemplateField[],
  scope: AnswerTree,
  ancestorLabels: string[],
  sectionKey?: string,
): FlattenedSection {
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
      // Only the section's own top-level repeating field (not one nested
      // inside another repeating-group) stands for "this whole section is
      // one instance-per-paragraph list" -- that's what every composer in
      // reportSentences.ts assumes.
      const composed = ancestorLabels.length === 0 ? sectionKey : undefined;
      // Houspect Victoria's template groups Internal Areas rooms under a
      // floor heading (Ground Floor / First Floor / ...) rather than
      // mentioning the floor in each room's own sentence -- track the
      // floor across instances (in the order they were added) and inject a
      // heading line whenever it changes.
      const floorLevelField = (field.itemFields ?? []).find((f) => f.key === "floorLevel");
      let lastFloorLevel: string | undefined;
      for (const { label, scope: inst } of instances) {
        const sub = walk(field.itemFields ?? [], inst, [...ancestorLabels, label]);
        damages.push(...sub.damages);
        labels.push(label);
        if (composed === "internal_areas" && floorLevelField) {
          const floorRaw = asString(inst.floorLevel);
          if (floorRaw && floorRaw !== lastFloorLevel) {
            textParts.push((floorLevelField.options?.find((o) => o.value === floorRaw)?.label ?? floorRaw).toUpperCase());
            lastFloorLevel = floorRaw;
          }
        }
        const composedSentence = composed ? composeSectionSentence(composed, inst, field.itemFields ?? [], label) : undefined;
        if (composedSentence) textParts.push(composedSentence);
        else if (sub.reportText) textParts.push(`${label}: ${sub.reportText}`.trim());
      }
      fields[field.key] = labels.join(", ");
      continue;
    }

    if (field.type === "photos") continue;

    if (value === undefined || value === "") continue;
    // Select-type fields (pill-select, select-tiles, color-select,
    // chip-multiselect) store the option's raw `value` (e.g.
    // "single_storey_house"), not its display text -- every other path in
    // this file resolves that through `field.options` before it reaches the
    // report; this generic fallback used to skip that step, so an unfilled-
    // in field with no sentence composer printed the raw snake_case key
    // straight into the report text instead of its label.
    const toLabel = (raw: string) => field.options?.find((o) => o.value === raw)?.label ?? raw;
    const strValue = Array.isArray(value)
      ? value.filter((v) => typeof v === "string").map(toLabel).join(", ")
      : toLabel(String(value));
    fields[field.key] = strValue;
    textParts.push(`${field.label}: ${strValue}.`);
  }

  // "\n\n" so multiple instances (several driveways, each elevation, each
  // room) render as their own paragraphs in ReportSection.tsx rather than
  // one run-on block -- safe for the generic per-field fallback too, since
  // nothing downstream depends on reportText staying single-line.
  return { fields, damages, reportText: textParts.join("\n\n") };
}
