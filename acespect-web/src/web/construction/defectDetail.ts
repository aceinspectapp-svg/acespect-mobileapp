/**
 * "Tell us about this defect": the small form that opens under a checklist row answered with one of its `defectOn` choices (the red
 * "Defect" answers). Its answers sit beside the row's own, under `<rowKey>__defect` -- location, category, severity, photographs,
 * comments and construction code -- and the report prints them as that row's defect, with its photos under it.
 *
 * The same form as the iOS app's (acespect-ios/src/components/inspection/fieldRenderers/defectDetail.ts), so a defect recorded on the
 * phone can be read and finished on the web. Templates only mark a row with `defectOn`; the form itself is fixed.
 */
import type { AnswerTree, AnswerValue, TemplateField } from "../templateFields";
import { asAnswerTree } from "../templateFields";
import { CATEGORY_LABELS, SEVERITY_LABELS, chosen } from "./words";

export const DEFECT_SUFFIX = "__defect";
export const defectKey = (fieldKey: string) => `${fieldKey}${DEFECT_SUFFIX}`;

const options = (table: Record<string, string>) => Object.entries(table).map(([value, label]) => ({ value, label }));

/** Location, category, severity and photographs are required; comments and the construction code are optional. */
export const DEFECT_DETAIL_FIELDS: TemplateField[] = [
  { key: "location", label: "Location — level, room/zone, grid reference, element (footing, bearer, truss, flashing, etc.)", type: "text", order: 0, required: true, placeholder: "e.g. Level 1, Bed 2, grid B3, bearer" },
  { key: "category", label: "Defect category (tick all that apply)", type: "chip-multiselect", order: 1, required: true, options: options(CATEGORY_LABELS) },
  { key: "severity", label: "Defect severity (tick all that apply)", type: "chip-multiselect", order: 2, required: true, options: options(SEVERITY_LABELS) },
  { key: "photos", label: "Photographs", type: "photos", order: 3, required: true },
  { key: "comments", label: "Comments (optional)", type: "textarea", order: 4 },
  { key: "constructionCode", label: "Construction code (optional)", type: "text", order: 5, placeholder: "e.g. 2.04 (Guide to Standards and Tolerances)" },
] as TemplateField[];

/**
 * True when this row is answered as a defect -- the same test the report uses (construction/compose.ts): one of its `defectOn` choices,
 * or, for a row without `defectOn`, a red choice.
 */
export function isDefectAnswer(field: TemplateField, v: AnswerValue): boolean {
  if (field.type !== "pill-select" || typeof v !== "string" || !v) return false;
  return field.defectOn?.length ? field.defectOn.includes(v) : chosen(field, v).tone === "bad";
}

/** The row's defect details (empty when none were given yet). */
export const defectScope = (field: TemplateField, scope: AnswerTree): AnswerTree => asAnswerTree(scope[defectKey(field.key)]);
