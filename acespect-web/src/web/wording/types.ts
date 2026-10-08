import type { AnswerTree, ConditionSummaryRow, TemplateField } from "../templateFields";
import type { Composer } from "./shared";
import type { ReportProfile } from "./profile";

/**
 * Everything the report generator needs to know that depends on WHICH report is being written.
 * Each report type has exactly one of these (see registry.ts); nothing in the generator picks
 * wording from a section name alone.
 */
export interface ReportWording {
  /** The report type this wording belongs to (null only for NO_WORDING). */
  profile: ReportProfile | null;
  /**
   * "final": the wording supplied for this report type.
   * "provisional": no wording supplied yet -- stands in until it is (see provisional.ts).
   * "none": no wording at all; sections fall back to plain "Label: value." lines.
   */
  status: "final" | "provisional" | "none";
  /** Section key -> that section's sentences, for THIS report type. */
  composers: Record<string, Composer>;
  /** Section key -> what to say when a section that can legitimately not exist has nothing recorded. */
  absence: Record<string, string>;
  /** True for a section whose fields are flat (no repeating group) and which its composer writes in one go. */
  isFlatComposed(sectionKey: string, templateFields: TemplateField[]): boolean;
  /** Section-level answers composed into prose ahead of the section's items (Internal Areas). */
  leadIn?: { sectionKey: string; keys: ReadonlySet<string>; compose(scope: AnswerTree, templateFields: TemplateField[]): string };
  /** A section whose items are grouped under a heading each time the floor changes. */
  floorGrouped?: { sectionKey: string; heading(label: string): string };
  /** Classification-only answers per section, never printed as "Label: value." lines. */
  metadataFields: Record<string, string[]>;
  /** Sections that have no Condition Summary row. */
  noSummarySections: string[];
  /** Sections where a fixed slot marked "not present" gets its own sentence ("There is no front fence."). */
  absentSlotSections: string[];
  /** Condition Summary rows for one item of a section, when a report type grades several categories per item. Undefined: the standard single row. */
  summaryRows?(sectionKey: string, inst: AnswerTree, itemFields: TemplateField[], label: string): ConditionSummaryRow[] | undefined;
  /** Extra values worked out from a section's answers and stored with its fields (e.g. the list of labels a sentence needs). */
  derivedFields?(sectionKey: string, scope: AnswerTree, templateFields: TemplateField[]): Record<string, unknown>;
  /**
   * The two Description-page sentences this report type words itself -- where the project works are and what the scope is.
   * A report type that leaves this out keeps the standard sentences.
   */
  descriptionBlocks?(input: { fields: Record<string, unknown>; areaCount: number }): { works?: string; scope?: string };
}

/** No wording: every section falls back to the generic "Label: value." lines. */
export const NO_WORDING: ReportWording = {
  profile: null,
  status: "none",
  composers: {},
  absence: {},
  isFlatComposed: () => false,
  metadataFields: {},
  noSummarySections: [],
  absentSlotSections: [],
};

/** The sentence a report type has for one section, or undefined when it has none for it. */
export function composeSection(
  wording: ReportWording,
  sectionKey: string,
  inst: AnswerTree,
  itemFields: TemplateField[],
  label: string,
): string | undefined {
  const composer = wording.composers[sectionKey];
  return composer ? composer(inst, itemFields, label) : undefined;
}
