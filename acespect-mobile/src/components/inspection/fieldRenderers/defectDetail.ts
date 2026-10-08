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

const RED = '#E63329';
const ORANGE = '#E8702A';
const AMBER = '#E8A33D';
const SLATE = '#5B6B82';

/** Severity and category wording is fixed by the Houspect defect scheme. */
export const SEVERITY_OPTIONS = [
  { value: 'safety_hazard', label: 'Safety Hazard', color: RED },
  { value: 'major_defect', label: 'Major Defect', color: ORANGE },
  { value: 'minor_defect', label: 'Minor Defect', color: AMBER },
  { value: 'monitor_serviceability', label: 'Monitor/Serviceability', color: SLATE },
];
export const CATEGORY_OPTIONS = [
  { value: 'variations_from_plans', label: 'Variations from plans' },
  { value: 'poor_workmanship', label: 'Poor workmanship' },
  { value: 'not_compliant', label: 'Not compliant' },
];

/** Every field is required except the construction code. */
export const DEFECT_DETAIL_FIELDS: TemplateField[] = [
  { key: 'location', label: 'Location', type: 'text', order: 0, required: true, placeholder: 'e.g. Front left corner, Bed 2' },
  { key: 'defectType', label: 'Defect type', type: 'text', order: 1, required: true, placeholder: 'e.g. Cracked tile, gap at window seal' },
  { key: 'constructionCode', label: 'Construction code (optional)', type: 'text', order: 2, placeholder: 'e.g. NCC / AS clause' },
  { key: 'photos', label: 'Photographs', type: 'photos', order: 3, required: true },
  { key: 'severity', label: 'Severity', type: 'pill-select', order: 4, required: true, options: SEVERITY_OPTIONS },
  { key: 'category', label: 'Defect category', type: 'pill-select', order: 5, required: true, options: CATEGORY_OPTIONS },
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
