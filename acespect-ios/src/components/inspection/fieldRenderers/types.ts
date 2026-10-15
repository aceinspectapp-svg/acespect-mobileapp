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
  /**
   * The answer tree this field is a sibling within -- i.e. `scope[field.key]
   * === value`. Most renderers don't need it (they only read/write their own
   * value), but a repeating-group/damage-list needs to see a *sibling's*
   * value to check `repeat.requireWhen` (e.g. "Condition" next to
   * "Damages"). Optional so existing renderers that ignore it are unaffected.
   */
  scope?: AnswerTree;
  /**
   * True when THIS field is currently a required-but-unfilled gap -- set by
   * `FieldListRenderer` (which has every sibling, needed to resolve
   * either/or `requiredGroup`s) right before rendering each field. Leaf
   * renderers use it to draw a red outline; only meaningful once
   * `showMissing` (below) has turned highlighting on in the first place.
   */
  missing?: boolean;
  /**
   * Turns the red-outline-on-incomplete-fields behavior on for this render
   * pass -- off by default (a fresh section shouldn't look like it's
   * already full of errors), turned on by `DynamicSectionScreen` once the
   * inspector has actually tried to leave an incomplete section. Threaded
   * through every container renderer (repeating-group, damage-list, the
   * section-nav modal, ...) purely so their own nested `FieldListRenderer`
   * calls can keep computing `missing` for fields at every depth.
   */
  showMissing?: boolean;
}

/**
 * A field with a `gate` only renders when the named sibling field's answer
 * satisfies it. For a scalar sibling (yesno/pill-select) that means an exact
 * match; for a multi-select sibling (chip-multiselect) it means the gate
 * value is one of the selected options -- this is what lets a checklist like
 * "which items are present here?" reveal one fillable form per ticked item.
 * `equalsAny` is the OR-of-many form (fires on any one of several sibling
 * values, e.g. "Internal only" OR "External only" -- but not the other
 * options on that same field).
 */
export function isGateSatisfied(field: TemplateField, scope: AnswerTree): boolean {
  if (!field.gate) return true;
  const { equals, equalsAny } = field.gate;
  const val = scope[field.gate.fieldKey];
  const matches = (target: string) => (Array.isArray(val) ? (val as unknown[]).includes(target) : val === target);
  if (equalsAny) return equalsAny.some(matches);
  return equals !== undefined && matches(equals);
}

/**
 * True when a repeating-group/damage-list's `repeat.requireWhen` condition is
 * satisfied -- i.e. either it doesn't apply (the trigger sibling isn't one of
 * the named values), or it applies and at least one instance has been added.
 * `scope` here is the level ABOVE the field (its siblings), matching how
 * `isGateSatisfied` reads a sibling's value.
 *
 * The trigger sibling can be a scalar (color-select/pill-select Condition,
 * the common case) or a multi-select (e.g. Rooms' `generalCondition` chip
 * list, which can hold "Fair" alongside other picks at once) -- either way,
 * it's triggered once ANY one of its values is in `req.equals`.
 */
export function isRepeatRequirementMet(field: TemplateField, value: AnswerValue, scope: AnswerTree | undefined): boolean {
  const req = field.repeat?.requireWhen;
  if (!req || !scope) return true;
  const triggerVal = scope[req.fieldKey];
  const triggered = Array.isArray(triggerVal)
    ? triggerVal.some((v) => typeof v === 'string' && req.equals.includes(v))
    : typeof triggerVal === 'string' && req.equals.includes(triggerVal);
  if (!triggered) return true;
  return Array.isArray(value) && value.length > 0;
}
