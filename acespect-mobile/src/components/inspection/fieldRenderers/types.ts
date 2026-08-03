import type { TemplateField } from '../../../services/templateApi';

/**
 * A single nested JSON tree of answers, not typed per-section state --
 * every field reads/writes its own slice by key. Leaf fields hold a
 * string/string[]; repeating-group/damage-list fields hold either an array
 * of instance trees (strip/checklist presentation, or damage-list) or a
 * record keyed by instance key (fixed-tabs/nested presentation).
 */
export type AnswerValue = string | string[] | AnswerTree | AnswerTree[] | Record<string, AnswerTree> | undefined;
export interface AnswerTree {
  [fieldKey: string]: AnswerValue;
}

export interface FieldRendererProps {
  field: TemplateField;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  /** Field path so far, including this field's own key -- used for React keys and photo sectionKeys. */
  path: string[];
}

/**
 * A field with a `gate` only renders when the named sibling field's answer
 * satisfies it. For a scalar sibling (yesno/pill-select) that means an exact
 * match; for a multi-select sibling (chip-multiselect) it means the gate
 * value is one of the selected options -- this is what lets a checklist like
 * "which items are present here?" reveal one fillable form per ticked item.
 */
export function isGateSatisfied(field: TemplateField, scope: AnswerTree): boolean {
  if (!field.gate) return true;
  const val = scope[field.gate.fieldKey];
  if (Array.isArray(val)) return (val as unknown[]).includes(field.gate.equals);
  return val === field.gate.equals;
}
