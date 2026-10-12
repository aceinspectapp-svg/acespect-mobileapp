/**
 * The report's New / Satisfactory / Fair / Average / Poor grading, shared by
 * the inline "Condition: ..." tags (the report type's wording (src/web/wording/)) and the Executive
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

/**
 * The five grades, their standard colours and what each means -- the one place
 * all of it is defined. The meanings are the report's own wording (they are
 * printed in the Scope appendix and in the Condition Summary's legend).
 */
export const GRADE_LEGEND: { label: string; color: string; meaning: string }[] = [
  { label: "New", color: "#16a34a", meaning: "Self-explanatory." },
  { label: "Satisfactory", color: "#65a30d", meaning: "Generally good condition." },
  { label: "Fair", color: "#d97706", meaning: "Starting to look like it needs maintenance." },
  { label: "Average", color: "#ea580c", meaning: "Working but needs maintenance within 6 months." },
  { label: "Poor", color: "#dc2626", meaning: "Needs replacement." },
];

const FALLBACK_PALETTE: [RegExp, string][] = GRADE_LEGEND.map((g) => [new RegExp(`^${g.label.toLowerCase()}`), g.color]);

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

// --- Condition tag colours -------------------------------------------------
// White text on the solid grade colour fails WCAG AA for small text on four of the five grades (3.1-3.6:1 against the 4.5:1 needed), so a tag is a pale tint of the grade colour carrying a darkened shade of it as text, with the full colour kept as a bar down the left edge. The label is always printed, so colour never carries the grade alone.

function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, "$&$&") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

function mixHex(hex: string, withHex: string, amount: number): string {
  const a = rgbOf(hex);
  const b = rgbOf(withHex);
  return `#${a.map((c, i) => Math.round(c + (b[i]! - c) * amount).toString(16).padStart(2, "0")).join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The pale fill, dark text and full-colour bar for a condition tag or pill of this grade colour. */
export function conditionTagColors(color: string): { fill: string; text: string; bar: string } {
  const fill = mixHex(color, "#ffffff", 0.88);
  let text = mixHex(color, "#000000", 0.6);
  // Any option colour a template brings must still read: darken until the text clears AA.
  for (let t = 0.6; contrastRatio(text, fill) < 4.5 && t < 1; t += 0.1) text = mixHex(color, "#000000", t);
  return { fill, text, bar: color };
}
