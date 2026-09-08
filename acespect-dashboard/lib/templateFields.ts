"use client";

import { api } from "./api";

/**
 * Web port of the mobile app's template/answer-tree types and pure logic
 * (acespect-mobile/src/services/templateApi.ts,
 * .../fieldRenderers/types.ts, .../utils/flattenSectionToDraft.ts). Kept
 * byte-for-byte equivalent on the parts that are pure TS (no React Native
 * dependency) so a section filled in on mobile and reopened here validates
 * and flattens identically.
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
  minInstances?: number;
  maxInstances?: number;
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

export interface TemplateLayout {
  mode?: "section-nav";
  groups?: { letter: string; icon?: string; hint?: string }[];
}

export interface ActiveTemplate {
  id: string;
  inspectionType: string;
  propertyType: string;
  sectionKey: string;
  version: number;
  fields: TemplateField[];
  layout?: TemplateLayout | null;
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
    const { template } = await api<{ template: ActiveTemplate }>(
      `/templates/active/${inspectionType}/${propertyType}/${sectionKey}`,
    );
    return template;
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
function isFilled(v: AnswerValue): boolean {
  return Array.isArray(v) ? v.length > 0 : !!v;
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

/**
 * Every `required` field satisfied (respecting gates + either/or
 * requiredGroups), including inside every instance of every repeating-group.
 * Mirrors acespect-mobile's flattenSectionToDraft.meetsAllRequiredFields.
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
  if (!ungrouped.every((f) => isFilled(scope[f.key]))) return false;
  for (const fields of grouped.values()) {
    if (!fields.some((f) => isFilled(scope[f.key]))) return false;
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

/** Names of currently-missing required fields, for an inline "still needed" note. */
export function listMissingRequiredFields(templateFields: TemplateField[], scope: AnswerTree): string[] {
  const missing: string[] = [];
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
  for (const f of ungrouped) if (!isFilled(scope[f.key])) missing.push(f.label);
  for (const fields of grouped.values()) {
    if (!fields.some((f) => isFilled(scope[f.key]))) missing.push(fields.map((f) => f.label).join(" or "));
  }
  for (const field of templateFields) {
    if (field.type !== "repeating-group") continue;
    if (!isGateSatisfied(field, scope)) continue;
    for (const { label, scope: inst } of resolveInstances(field, scope[field.key])) {
      const sub = listMissingRequiredFields(field.itemFields ?? [], inst);
      missing.push(...sub.map((m) => `${label}: ${m}`));
    }
  }
  return missing;
}

/** Every damage-list's `repeat.requireWhen` satisfied, at every nesting depth. */
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
 * Same walk as acespect-mobile's flattenSectionToDraft -- derives the
 * flattened report `fields`, the flat `damages[]` array and a summary
 * `reportText` from the raw answer tree. Kept as the single source of truth
 * on save so editing answers here doesn't leave the report view stale.
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
