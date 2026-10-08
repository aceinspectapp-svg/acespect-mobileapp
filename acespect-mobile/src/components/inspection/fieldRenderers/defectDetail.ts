import type { TemplateField } from '../../../services/templateApi';
import type { AnswerTree, AnswerValue } from './types';

/**
 * "Tell us about this defect": when a checklist row's answer is one of the field's `defectOn` options (the red "Defect"
 * choices), this small form opens right under the row. Its answers are stored beside the row's own, under
 * `<rowKey>__defect`, and travel with the section's answers like any other nested answer.
 *
 * The form is the same for every row, so it lives here rather than in each template: a template only marks the row
 * with `defectOn`.
 */
export const DEFECT_SUFFIX = '__defect';
export const defectKey = (fieldKey: string) => `${fieldKey}${DEFECT_SUFFIX}`;

/** Category and severity wording is fixed by the Houspect defect form; both can have several ticks. */
export const CATEGORY_OPTIONS = [
  { value: 'non_compliant_plans_specs', label: 'Non-compliant with approved plans/specs' },
  { value: 'non_compliant_ncc_as', label: 'Non-compliant with NCC/AS' },
  { value: 'workmanship_outside_tolerance', label: 'Workmanship outside tolerance' },
  { value: 'material_product_defect', label: 'Material/product defect' },
  { value: 'damage', label: 'Damage' },
  { value: 'incomplete_work', label: 'Incomplete work' },
  { value: 'design_documentation_conflict', label: 'Design/documentation conflict' },
  { value: 'unable_to_inspect_concealed', label: 'Unable to inspect/concealed' },
];
export const SEVERITY_OPTIONS = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Minor' },
  { value: 'cosmetic', label: 'Cosmetic' },
  { value: 'structural', label: 'Structural' },
  { value: 'safety', label: 'Safety' },
  { value: 'weatherproofing', label: 'Weatherproofing' },
  { value: 'durability', label: 'Durability' },
  { value: 'serviceability', label: 'Serviceability' },
  { value: 'amenity', label: 'Amenity' },
];

/** Location, category, severity and photographs are required; comments and the construction code are optional. */
export const DEFECT_DETAIL_FIELDS: TemplateField[] = [
  { key: 'location', label: 'Location — level, room/zone, grid reference, element (footing, bearer, truss, flashing, etc.)', type: 'text', order: 0, required: true, placeholder: 'e.g. Level 1, Bed 2, grid B3, bearer' },
  { key: 'category', label: 'Defect category (tick all that apply)', type: 'chip-multiselect', order: 1, required: true, options: CATEGORY_OPTIONS },
  { key: 'severity', label: 'Defect severity (tick all that apply)', type: 'chip-multiselect', order: 2, required: true, options: SEVERITY_OPTIONS },
  { key: 'photos', label: 'Photographs', type: 'photos', order: 3, required: true },
  { key: 'comments', label: 'Comments (optional)', type: 'textarea', order: 4 },
  { key: 'constructionCode', label: 'Construction code (optional)', type: 'text', order: 5, placeholder: 'e.g. NCC / AS clause' },
];

/** True when this row is currently answered with one of its defect choices. */
export function isDefectOpen(field: TemplateField, scope: AnswerTree): boolean {
  const v = scope[field.key];
  return !!field.defectOn?.length && typeof v === 'string' && field.defectOn.includes(v);
}

export function defectScope(field: TemplateField, scope: AnswerTree): AnswerTree {
  const v: AnswerValue = scope[defectKey(field.key)];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnswerTree) : {};
}
