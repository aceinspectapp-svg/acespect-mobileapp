/**
 * The report's New / Satisfactory / Fair / Average / Poor grading, shared by
 * the inline "Condition: ..." tags (reportSentences.ts) and the Executive
 * Summary rows (templateFields.ts).
 *
 * Some templates define a `color` on each condition option and some don't --
 * the current published Dilapidation templates, for one, list the options
 * ("Satisfactory with typical wear and tear", "Fair", ...) with no colour at
 * all -- so the colour falls back to one fixed palette keyed on the option's
 * value. An option's own colour, when it has one, still wins.
 */

export interface GradeOption {
  value: string;
  label: string;
  color?: string;
}

export interface Grade {
  /** Short display label, e.g. "Satisfactory" (not "Satisfactory with typical wear and tear"). */
  label: string;
  color: string;
  /** Lower-case form for mid-sentence use: "It is in satisfactory condition". */
  word: string;
}

const FALLBACK_PALETTE: [RegExp, string][] = [
  [/^new/, "#16a34a"],
  [/^satisfactory/, "#65a30d"],
  [/^fair/, "#d97706"],
  [/^average/, "#ea580c"],
  [/^poor/, "#dc2626"],
];

/** "Satisfactory with typical wear and tear" -> "Satisfactory" -- the sentence templates already add "with typical wear and tear" themselves, and a pill/table cell needs the short form. */
export function shortConditionLabel(label: string): string {
  return label.replace(/\s+with typical wear and tear$/i, "").trim();
}

export function gradeOf(option: GradeOption | undefined): Grade | undefined {
  if (!option) return undefined;
  const color = option.color ?? FALLBACK_PALETTE.find(([re]) => re.test(option.value.toLowerCase()))?.[1];
  if (!color) return undefined;
  const label = shortConditionLabel(option.label);
  return { label, color, word: label.toLowerCase() };
}
