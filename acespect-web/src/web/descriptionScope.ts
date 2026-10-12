import type { ReportWording } from "./wording/types";

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The scope the template words it: "external and internal to all structures", "external and internal to part of the property at {where}",
 * "internal only to {where}" / "external only to {where}" (the template's own default is "all areas"). Anything else is the inspector's choice, as picked.
 */
export function scopePhrase(choice: string, detail: string): string {
  const c = choice.toLowerCase().replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
  if (/^(internal|external) only to\b/.test(c)) return `${c} ${detail || "all areas"}`;
  if (/part of (the )?property/.test(c)) return `external and internal to part of the property${detail ? ` at ${detail}` : ""}`;
  return `${c}${detail ? ` ${detail}` : ""}`;
}

/**
 * The two sentences under "Scope of Inspection and Comments" on the Description page -- what the project works are, and the scope
 * of the inspection -- from the Description section's saved fields. A report type can word them itself (its `descriptionBlocks`);
 * otherwise the standard sentences below. `undefined` means the page shows its fill-in placeholder instead.
 */
export function scopeOfInspectionSentences(wording: ReportWording, fields: Record<string, unknown>, areaCount: number): { works?: string; scope?: string } {
  const own = wording.descriptionBlocks?.({ fields, areaCount });
  const address = str(fields.projectSiteAddress);
  const side = str(fields.siteSide);
  const direction = str(fields.siteDirection);
  const scopeForInspection = str(fields.scopeForInspection);
  const scopeDetail = str(fields.scopeDetail) || str(fields.scopePartDetail);
  const works =
    own?.works ||
    (address && side && direction
      ? `The project works are to the property at ${address}, which is at the ${side.toLowerCase()} - approximately ${direction.toLowerCase()} - of the site of this inspection.`
      : undefined);
  const scope = own?.scope || (scopeForInspection ? `The scope for inspection is ${scopePhrase(scopeForInspection, scopeDetail)}.` : undefined);
  return { works, scope };
}
