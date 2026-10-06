import { API_BASE, getToken } from "./api";
import {
  absenceSentence,
  atLocation,
  composeInternalAreasLeadIn,
  composeSectionSentence,
  floorHeading,
  INTERNAL_AREAS_LEAD_IN_KEYS,
  isNotPresent,
} from "./reportSentences";
import { gradeOf } from "./conditionGrades";

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
  | "tile-multiselect"
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

/**
 * Plain-language list of what is still missing from a section -- the same
 * required-field and mandatory-defect rules `meetsAllRequiredFields` /
 * `meetsAllRequireWhen` enforce at Submit, but naming each gap so an admin
 * can tell the inspector exactly what to finish. Items inside a repeating
 * group are prefixed with that instance's own label ("Front: Condition").
 * Fields sharing a `requiredGroup` (either/or) are listed once, joined with "or".
 */
export function listMissingItems(templateFields: TemplateField[], scope: AnswerTree, context = ""): string[] {
  const out: string[] = [];
  const named = (label: string) => (context ? `${context}: ${label}` : label);
  const seenGroups = new Set<string>();
  for (const field of templateFields) {
    if (!isGateSatisfied(field, scope)) continue;
    const value = scope[field.key];
    if (field.type === "repeating-group") {
      for (const { label, scope: inst } of resolveInstances(field, value)) {
        out.push(...listMissingItems(field.itemFields ?? [], inst, context ? `${context} / ${label}` : label));
      }
      if (field.required && !isAnswered(value)) out.push(named(field.label));
    }
    if (field.repeat?.requireWhen && !isRepeatRequirementMet(field, value, scope)) {
      out.push(named("record at least one defect"));
      continue;
    }
    if (field.type === "repeating-group" || !isFieldMissing(field, templateFields, scope)) continue;
    if (field.requiredGroup) {
      if (seenGroups.has(field.requiredGroup)) continue;
      seenGroups.add(field.requiredGroup);
      const labels = templateFields.filter((f) => f.requiredGroup === field.requiredGroup).map((f) => f.label);
      out.push(named(labels.join(" or ")));
    } else {
      out.push(named(field.label));
    }
  }
  return out;
}

/** How the forms store a typed "Other" answer inline: "__other__:<text>". */
export const OTHER_PREFIX = "__other__:";

/**
 * What the inspector typed for an "Other" answer. `undefined` when `raw` is not
 * an inline "Other" at all; `""` when it is but nothing was typed after the
 * prefix. Used by the report wording only -- the form editors have their own
 * handling (see `displayValue`).
 */
export function otherAnswerText(raw: string): string | undefined {
  return raw.startsWith(OTHER_PREFIX) ? raw.slice(OTHER_PREFIX.length).trim() : undefined;
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

/** Appends "." unless `s` already ends with sentence-ending punctuation --
 *  a free-text answer (e.g. a Notes textarea) is just as often typed with
 *  its own trailing period as without one, and blindly appending "." to
 *  build a report line produced visible ".." for the former. */
export function withPeriod(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

export function resolveInstances(
  field: TemplateField,
  value: AnswerValue,
): { key?: string; label: string; scope: AnswerTree }[] {
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
  // `key` here is the fixed instance's own stable identity -- callers that
  // write back an edit must key off *this*, not try to rediscover it by
  // scanning `record` for a value `===` this scope object: a fixed instance
  // with no data yet gets a freshly-allocated `{}` below, which is never
  // reference-equal to anything already in `record`, so that reverse lookup
  // silently fails (and the edit is dropped) for any instance not yet started.
  const out = fixed.map((f) => ({ key: f.key, label: named(record[f.key] ?? {}, f.label), scope: record[f.key] ?? {} }));
  let extra = 0;
  for (const [key, scope] of Object.entries(record)) {
    if (seen.has(key)) continue;
    extra += 1;
    out.push({ key, label: named(scope, `${field.label} ${fixed.length + extra}`), scope });
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
 * One row of the report's Condition Summary page (see ReportConditionSummary.tsx)
 * -- stored per section as `fields.conditionSummary` (a plain JSON array,
 * same "no schema change" pattern as every other derived field) so the
 * report view can read it straight off each section without re-fetching
 * that section's template. `subLabel` is only set when the section has more
 * than one instance (e.g. each Elevations side, each Internal Areas room);
 * for a single-instance section (e.g. a single Driveway) the section's own
 * name is the whole label, so there's nothing to add here.
 */
export interface ConditionSummaryRow {
  subLabel?: string;
  conditionLabel: string;
  conditionColor: string;
  defectNote?: string;
}

/**
 * A human-friendly per-instance label for the Condition Summary's `subLabel`
 * -- `resolveInstances`' own fallback label (used for e.g. the ROOMHEAD
 * markers and the "{label}: ..." generic text fallback elsewhere in this
 * function) is a fine, stable per-instance *identity* ("Items 1", "Items
 * 2"), but reads poorly as a summary-table row name when the section has no
 * `titleFieldKey` configured (true of every "strip" section at the time of
 * writing: Driveway, Paving & Paths, Fences, Retaining Walls, Garage /
 * Carport / Sheds, Pool / Spa). Those sections identify an instance to the
 * *reader* via one of two fields instead -- a `location` pill-select
 * (Front/Left/Right/Rear, used by Fences/Retaining Walls/Driveway) or a
 * free-text `name` the inspector typed (used by Paving & Paths/Garage &
 * Carport/Pool & Spa) -- so this prefers whichever of those actually has an
 * answer, falling back to the generic label only when neither does.
 */
function niceInstanceLabel(itemFields: TemplateField[], inst: AnswerTree, fallbackLabel: string): string {
  const locationField = itemFields.find((f) => f.key === "location");
  if (locationField) {
    const resolved = locationField.options?.find((o) => o.value === asString(inst.location))?.label;
    if (resolved) return resolved;
  }
  const name = asString(inst.name).trim();
  if (name) return name;
  return fallbackLabel;
}

/**
 * One line per damage/defect recorded against this instance (e.g. "Crack at
 * ceiling cornice, northeast corner"), joined for the Condition Summary's
 * one-line notes column. Mirrors reportSentences.ts's damageSentences()
 * "no damageType field -> default to Crack" fallback for the sections
 * (Paving & Paths, Fences, Retaining Walls) that only ever track cracks.
 */
function buildDefectNote(damageField: TemplateField, inst: AnswerTree): string | undefined {
  const list = resolveInstances(damageField, inst[damageField.key]);
  if (list.length === 0) return undefined;
  const damageTypeField = (damageField.itemFields ?? []).find((f) => f.key === "damageType");
  const parts = list.map(({ scope: d }) => {
    const rawType = asString(d.damageType);
    const typedType = otherAnswerText(rawType);
    const typeLabel =
      typedType !== undefined
        ? typedType.charAt(0).toUpperCase() + typedType.slice(1) || "Defect"
        : damageTypeField && rawType
          ? damageTypeField.options?.find((o) => o.value === rawType)?.label ?? rawType
          : "Crack";
    const location = asString(d.location);
    return location ? `${typeLabel} ${atLocation(location)}` : typeLabel;
  });
  return parts.join("; ");
}

/** One Executive Summary row for an instance, or undefined when it has nothing to summarise (no grade answered yet, or marked as not present). */
function conditionSummaryRow(
  itemFields: TemplateField[],
  inst: AnswerTree,
  subLabel: string | undefined,
): ConditionSummaryRow | undefined {
  if (isNotPresent(inst)) return undefined;
  // Every composer in reportSentences.ts reads its grade from a field keyed
  // "condition" (most sections), "generalCondition" (Roof, Internal Areas) or
  // "wallsCondition" (Garage) -- checking those exact names first, rather than
  // just "the first color-select field", matters because Pool/Spa also has an
  // unrelated "fenceSafety" colour pill that sorts earlier. The generic
  // color-select fallback stays as a safety net for any future section.
  const conditionField =
    itemFields.find((f) => f.key === "condition" && f.type === "color-select") ??
    itemFields.find((f) => f.key === "generalCondition" && f.type === "color-select") ??
    itemFields.find((f) => f.key === "wallsCondition" && f.type === "color-select") ??
    itemFields.find((f) => f.type === "color-select");
  if (!conditionField) return undefined;
  const rawCond = asString(inst[conditionField.key]);
  const grade = gradeOf(conditionField.options?.find((o) => o.value === rawCond));
  // Skip instances with no condition answered yet -- a fixed slot (e.g. an
  // Internal Areas room never visited) shouldn't claim a row on an executive
  // summary with nothing to summarise.
  if (!grade) return undefined;
  const damageField = itemFields.find((f) => f.type === "damage-list");
  return {
    subLabel,
    conditionLabel: grade.label,
    conditionColor: grade.color,
    defectNote: damageField ? buildDefectNote(damageField, inst) : undefined,
  };
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
  // Description & Overview's fields are flat (no repeating-group), so they
  // never reach the composer call below (that one only fires per-instance
  // inside a repeating-group) -- the generic per-field fallback used to give
  // every field its own "Label: value." line, rendering as a bullet-style
  // list instead of the reference report's flowing prose paragraph. Route
  // this section's flat fields through its own composer instead, same as
  // every other section already does via SECTION_SENTENCE_COMPOSERS.
  // Driveway and Pool / Spa are flat too in the published templates (a single
  // "is there one?" yes/no with its fields beneath it, no repeating-group),
  // while the original seed wrapped them in a one-item list -- so they only
  // take this path when the template has no top-level repeating-group.
  const isFlatComposedSection =
    ancestorLabels.length === 0 &&
    (sectionKey === "description" ||
      ((sectionKey === "driveway" || sectionKey === "pool_spa") && !templateFields.some((f) => f.type === "repeating-group")));
  const isInternalAreas = ancestorLabels.length === 0 && sectionKey === "internal_areas";
  if (isInternalAreas) {
    const leadIn = composeInternalAreasLeadIn(scope, templateFields);
    if (leadIn) textParts.push(leadIn);
  }

  for (const field of templateFields) {
    if (!isGateSatisfied(field, scope)) continue;
    const value = scope[field.key];

    if (field.type === "damage-list") {
      const itemFields = field.itemFields ?? [];
      const damageTypeField = itemFields.find((f) => f.key === "damageType");
      for (const { scope: inst } of resolveInstances(field, value)) {
        const typeRaw = asString(inst.damageType);
        const typeLabel = otherAnswerText(typeRaw) ?? (damageTypeField?.options?.find((o) => o.value === typeRaw)?.label || typeRaw);
        const subField = itemFields.find((f) => f.gate?.fieldKey === "damageType" && f.gate.equals === typeRaw);
        const subRaw = subField ? asString(inst[subField.key]) : "";
        const subLabel = otherAnswerText(subRaw) ?? (subField?.options?.find((o) => o.value === subRaw)?.label || subRaw);

        const locationParts = [asString(inst.location), asString(inst.element), asString(inst.crackStartLocation)];
        damages.push({
          type: [typeLabel, subLabel].filter(Boolean).join(" — ") || "Damage",
          location: [...ancestorLabels, ...locationParts.filter(Boolean)].join(" — "),
          direction: otherAnswerText(asString(inst.direction)) ?? asString(inst.direction),
          widthMm: Number(inst.widthMm) || 0,
          lengthMm: Number(inst.lengthMm) || 0,
          notes: asString(inst.notes),
          photos: asStringArray(inst.photos),
        });
      }
      continue;
    }

    if (field.type === "repeating-group") {
      let instances = resolveInstances(field, value);
      const labels: string[] = [];
      // Only the section's own top-level repeating field (not one nested
      // inside another repeating-group) stands for "this whole section is
      // one instance-per-paragraph list" -- that's what every composer in
      // reportSentences.ts assumes.
      const composed = ancestorLabels.length === 0 ? sectionKey : undefined;
      // Houspect Victoria's template groups Internal Areas rooms under a
      // floor heading (Ground Floor / First Floor / ...) rather than
      // mentioning the floor in each room's own sentence -- inject a
      // heading line whenever the floor changes as instances are walked.
      const floorLevelField = (field.itemFields ?? []).find((f) => f.key === "floorLevel");
      if (composed === "internal_areas" && floorLevelField) {
        // Room order is fixed by the template (Front Entry, Living Room,
        // Dining, Kitchen, Bedroom, Bathroom, Laundry, Toilet, Stairwell,
        // Other) -- it has nothing to do with which physical floor each
        // room is actually on, that's a separate answer per room. Relying
        // on rooms happening to be answered in floor-consecutive order
        // (the previous behaviour) meant a real property whose rooms don't
        // line up with that fixed order -- e.g. a ground-floor Stairwell
        // coming after a first-floor Toilet in the list -- would print
        // repeated/interleaved "GROUND FLOOR" / "FIRST FLOOR" bands instead
        // of one clean group per floor. Sorting by the floor field's own
        // defined option order first (stable, so rooms on the same floor
        // keep their original relative order) guarantees each floor's rooms
        // are grouped together exactly once, regardless of answer order.
        const floorOrder = new Map((floorLevelField.options ?? []).map((o, i) => [o.value, i]));
        instances = instances
          .map((item, i) => ({
            item,
            i,
            floorIdx: floorOrder.get(asString(item.scope.floorLevel)) ?? Number.MAX_SAFE_INTEGER,
          }))
          .sort((a, b) => a.floorIdx - b.floorIdx || a.i - b.i)
          .map(({ item }) => item);
      }
      // Condition Summary rows (see ConditionSummaryRow / conditionSummaryRow above).
      const conditionSummaryRows: ConditionSummaryRow[] = [];
      let composedCount = 0;
      let lastFloorLevel: string | undefined;
      for (const { label, scope: inst } of instances) {
        const damageBase = damages.length; // where this instance's defects start in the section-wide list
        const sub = walk(field.itemFields ?? [], inst, [...ancestorLabels, label]);
        const notPresent = !!composed && isNotPresent(inst);
        // Stale damage records on an instance the inspector later marked as not present shouldn't reach the report.
        if (!notPresent) damages.push(...sub.damages);
        labels.push(label);
        // An instance marked not present (Is there a garage? No), or a fixed
        // slot the inspector never touched, contributes nothing -- no
        // sentence, no floor banner, no summary row.
        if (composed && (notPresent || !Object.values(inst).some(isAnswered))) continue;
        if (composed) {
          const row = conditionSummaryRow(
            field.itemFields ?? [],
            inst,
            instances.length > 1 ? niceInstanceLabel(field.itemFields ?? [], inst, label) : undefined,
          );
          if (row) conditionSummaryRows.push(row);
        }
        const composedSentence = composed ? composeSectionSentence(composed, inst, field.itemFields ?? [], label) : undefined;
        // `undefined` means "no composer registered for this section" (fall
        // back to the generic label/value text); an empty string means "a
        // composer ran and deliberately has nothing to say" (e.g. the
        // `notes` composer suppressing a checklist item answered "No") --
        // these must NOT be treated the same, or a composer's silence gets
        // overwritten by the exact boilerplate line it was trying to avoid.
        if (composedSentence !== undefined) {
          if (composedSentence) {
            // The floor banner goes in only once this room is known to print something.
            if (composed === "internal_areas" && floorLevelField) {
              const floorRaw = asString(inst.floorLevel);
              if (floorRaw && floorRaw !== lastFloorLevel) {
                textParts.push(floorHeading(floorLevelField.options?.find((o) => o.value === floorRaw)?.label ?? floorRaw));
                lastFloorLevel = floorRaw;
              }
            }
            // Defect paragraphs are tagged with their position in this instance's list; make that the section-wide position.
            textParts.push(composedSentence.replace(/DEFECT::(\d+)::/g, (_m, n) => `DEFECT::${damageBase + Number(n)}::`));
            composedCount += 1;
          }
        } else if (sub.reportText) {
          textParts.push(`${label}: ${sub.reportText}`.trim());
        }
      }
      // Nothing to say for a composed section that can legitimately not exist
      // (no driveway, no pool, every garage slot marked "no", ...) used to
      // leave this section's reportText empty -- ReportSection.tsx would then
      // fall back to its generic "No content recorded for this category"
      // placeholder, which reads like the inspection was left incomplete
      // rather than reporting the fact that the feature doesn't exist. State
      // it properly instead, matching the reference report's own "There is no
      // driveway." convention.
      if (composed && composedCount === 0) {
        const absence = absenceSentence(composed);
        if (absence) textParts.push(absence);
      }
      fields[field.key] = labels.join(", ");
      // Written even when empty for a graded section: the backend merges `fields`
      // on save, so omitting it would leave an earlier save's rows behind after
      // every instance was later marked not present.
      if (conditionSummaryRows.length > 0 || (composed && (field.itemFields ?? []).some((f) => f.type === "color-select"))) {
        fields.conditionSummary = conditionSummaryRows;
      }
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
    // An inline "Other" prints what was typed; a bare "Other" with nothing typed says nothing (the word "other" alone is not an answer).
    const hasOtherOption = field.options?.some((o) => o.value === "other") ?? false;
    const toLabel = (raw: string) => {
      const typed = otherAnswerText(raw);
      if (typed !== undefined) return typed;
      if (raw === "other" && !hasOtherOption) return "";
      return field.options?.find((o) => o.value === raw)?.label ?? raw;
    };
    const strValue = Array.isArray(value)
      ? value.filter((v) => typeof v === "string").map(toLabel).filter(Boolean).join(", ")
      : toLabel(String(value));
    if (!strValue) continue;
    fields[field.key] = strValue;
    // Notes & Post Project's own classification fields (not a finding, just
    // metadata) -- printing "Additional Damage Present?: No." etc. as a
    // bullet line would defeat the point of hiding the whole section when
    // there's nothing notable (see the `notes` composer and ReportView.tsx).
    // Still recorded in `fields` above for the reviewer's editing view.
    const isNotesMetadata = sectionKey === "notes" && (field.key === "postProject" || field.key === "hasDamage");
    // Still recorded in `fields` above (so the reviewer's Field Data view
    // keeps every answer editable) -- just not echoed as its own bullet line
    // when a whole-section composer is about to produce real prose instead.
    // The "Is there a ...?" yes/no of a section that has an absence sentence is
    // folded into the prose (or the absence sentence) instead of a bullet line,
    // and Internal Areas' section-level answers are composed by its lead-in.
    const isPresenceFlag = field.key === "present" && !!sectionKey && absenceSentence(sectionKey) !== undefined;
    const isLeadInField = isInternalAreas && INTERNAL_AREAS_LEAD_IN_KEYS.has(field.key);
    if (!isFlatComposedSection && !isNotesMetadata && !isPresenceFlag && !isLeadInField) {
      textParts.push(`${field.label}: ${withPeriod(strValue)}`);
    }
  }

  // A whole section answered "No" at its top level (Are there any retaining
  // walls? No) -- everything beneath it is gated away, so state the fact.
  if (!isFlatComposedSection && ancestorLabels.length === 0 && sectionKey && asString(scope.present) === "no") {
    const absence = absenceSentence(sectionKey);
    if (absence) textParts.push(absence);
  }

  if (isFlatComposedSection) {
    const composed = composeSectionSentence(sectionKey!, scope, templateFields, "");
    // Driveway / Pool are a single instance, so the whole section is one summary row (no sub-label).
    const row = sectionKey === "description" ? undefined : conditionSummaryRow(templateFields, scope, undefined);
    if (row) fields.conditionSummary = [row];
    else if (sectionKey !== "description" && templateFields.some((f) => f.type === "color-select")) fields.conditionSummary = [];
    return { fields, damages, reportText: composed ?? textParts.join("\n\n") };
  }

  // "\n\n" so multiple instances (several driveways, each elevation, each
  // room) render as their own paragraphs in ReportSection.tsx rather than
  // one run-on block -- safe for the generic per-field fallback too, since
  // nothing downstream depends on reportText staying single-line.
  return { fields, damages, reportText: textParts.join("\n\n") };
}
