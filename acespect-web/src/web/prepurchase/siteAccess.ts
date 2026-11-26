/**
 * The template's "Site Access Conditions": only the sentences a form field decides, in the template's order.
 *   - Roof, "Roof covering — Applicability: Apartment complex – not applicable" (roofcov_applicability = na-apt): the roof was not accessed.
 *   - External, "Sub-floor — Applicability" (subfloor_applicability): "Apartment complex – not assessable" (na-apt): the subfloor was not
 *     inspected; "Not applicable – constructed on concrete slab" (na-slab): not inspected due to slab on ground conditions.
 * No field decides the others (a ladder, the 3.6m height limit, an obstructed or raked roof cavity), so they are never printed. The Notes'
 * "No Access Areas" are typed words, printed in the Notes themselves.
 */
import type { FormSection } from "../mockData";
import { SITE_ACCESS } from "./scopeText";

const answer = (sections: FormSection[], key: string, field: string): unknown =>
  ((sections.find((s) => (s.key ?? s.id) === key)?.answers as Record<string, unknown> | null | undefined) ?? {})[field];

export function siteAccessSentences(sections: FormSection[], opts: { commercial?: boolean } = {}): string[] {
  if (opts.commercial) return commercialSiteAccess(sections);
  const out: string[] = [];
  if (answer(sections, "roof_chimneys", "roofcov_applicability") === "na-apt") out.push(SITE_ACCESS.roofNotAccessed);
  const subfloor = answer(sections, "elevations", "subfloor_applicability");
  if (subfloor === "na-apt") out.push(SITE_ACCESS.subfloorNotInspected);
  if (subfloor === "na-slab") out.push(SITE_ACCESS.subfloorSlab);
  return out;
}

/**
 * Pre-Purchase / Commercial: the template's sentences its form decides.
 *   - Roof, "Gutters / Valleys — Applicability: Roof could not be safely accessed" (guttersvalleys_applicability = na): the roof was not
 *     accessed.
 *   - External, "Sub-floor — Applicability": "No access to subfloor" (na-access): the subfloor was not inspected; "Not applicable –
 *     constructed on concrete slab" (na-slab): not inspected due to slab on ground conditions.
 * The form has no answer for the others (a ladder, the 3.6m limit, an obstructed or raked roof cavity), so they are never printed.
 */
function commercialSiteAccess(sections: FormSection[]): string[] {
  const out: string[] = [];
  if (answer(sections, "roof_chimneys", "guttersvalleys_applicability") === "na") out.push(SITE_ACCESS.roofNotAccessed);
  const subfloor = answer(sections, "elevations", "subfloor_applicability");
  if (subfloor === "na-access") out.push(SITE_ACCESS.subfloorNotInspected);
  if (subfloor === "na-slab") out.push(SITE_ACCESS.subfloorSlab);
  return out;
}
