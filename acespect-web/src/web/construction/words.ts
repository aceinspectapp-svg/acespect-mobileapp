/**
 * Small wording helpers shared by the Construction Stage wording and its report: reading an answer as its label, the
 * tone of a choice (OK / defect / not yet / N/A, from its colour), the short heading each checklist row prints under.
 */
import type { AnswerTree, AnswerValue, TemplateField } from "../templateFields";
import { asStringArray, otherAnswerText } from "../templateFields";

export type Tone = "ok" | "bad" | "warn" | "na" | "plain";
const TONE_BY_COLOR: Record<string, Tone> = { "#1FA463": "ok", "#E63329": "bad", "#E8A33D": "warn", "#94A1B2": "na" };

export interface Chosen { label: string; tone: Tone; other: boolean }

/** The option a stored value points at (its label and colour tone), or the typed "Other" text. */
export function chosen(field: TemplateField, raw: string): Chosen {
  const other = otherAnswerText(raw);
  if (other !== undefined) return { label: other, tone: "plain", other: true };
  const opt = field.options?.find((o) => o.value === raw);
  if (!opt) return { label: raw, tone: "plain", other: false };
  return { label: opt.label, tone: (opt.color && TONE_BY_COLOR[opt.color]) || "plain", other: false };
}

export const toneOfOption = (color?: string): Tone => (color && TONE_BY_COLOR[color]) || "plain";

export const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
export const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Gutters; debris, lack of fall…" -> "Gutters": the report headings are the short names; the rest is the form's own guidance. */
export function headingOf(label: string): string {
  let depth = 0;
  let cut = label.length;
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) { cut = i; break; }
  }
  return label.slice(0, cut).replace(/\s+—\s+material$/i, "").trim().replace(/\s*\?$/, "");
}

/**
 * The heading each row prints under. Normally the short name ("Gutters"); where two rows share a short name ("Gutters;
 * clipped…" and "Gutters; debris…") the rest of the label is kept so they can be told apart.
 */
export function headingMap(fields: TemplateField[]): Map<string, string> {
  const base = new Map<string, number>();
  for (const f of fields) if (f.type === "pill-select") base.set(headingOf(f.label), (base.get(headingOf(f.label)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const f of fields) {
    const b = headingOf(f.label);
    const full = f.label.replace(/\s*;\s*/, " — ").replace(/\s*\?$/, "");
    const clipped = full.length <= 110 ? full : `${full.slice(0, 107).replace(/[\s,;(]+\S*$/, "")}…`;
    out.set(f.key, (base.get(b) ?? 0) > 1 ? clipped : b);
  }
  return out;
}

export const SATISFACTORY = /^((yes|no)\s*[—-]\s*)?ok$|^satisfactory$|^yes\s*[—-]\s*required$/i;
export const NOT_APPLICABLE = /^(n\/a|not applicable)$/i;

export function labelsOf(field: TemplateField | undefined, v: AnswerValue): string[] {
  if (!field) return [];
  const list = Array.isArray(v) ? asStringArray(v) : typeof v === "string" && v ? [v] : [];
  return list.map((raw) => chosen(field, raw).label);
}

export function photosIn(v: AnswerValue, excluded: string[] = []): string[] {
  return asStringArray(v).filter((u) => !excluded.includes(u));
}

export function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export const asList = (v: AnswerValue): string[] => (Array.isArray(v) ? asStringArray(v) : typeof v === "string" && v ? [v] : []);

export const CATEGORY_LABELS: Record<string, string> = {
  non_compliant_plans_specs: "Non-compliant with approved plans/specs", non_compliant_ncc_as: "Non-compliant with NCC/AS", workmanship_outside_tolerance: "Workmanship outside tolerance",
  material_product_defect: "Material/product defect", damage: "Damage", incomplete_work: "Incomplete work", design_documentation_conflict: "Design/documentation conflict", unable_to_inspect_concealed: "Unable to inspect/concealed",
};
export const SEVERITY_LABELS: Record<string, string> = {
  major: "Major", minor: "Minor", cosmetic: "Cosmetic", structural: "Structural", safety: "Safety", weatherproofing: "Weatherproofing", durability: "Durability", serviceability: "Serviceability", amenity: "Amenity",
};
export const mapLabels = (v: AnswerValue, table: Record<string, string>) => asList(v).map((x) => table[x] ?? x);

export type { AnswerTree };
