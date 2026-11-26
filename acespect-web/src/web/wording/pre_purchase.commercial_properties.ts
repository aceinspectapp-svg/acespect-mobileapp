// pre_purchase / commercial_properties -- this report type's wording.
// The office template is "ACESPECT Building (Pre-Purchase)_House and Commercial Nov 2026" (shared with House, whose report keeps its own
// wording). Until each element's sentences are written from it, the sections keep the provisional sentences (provisional.ts) with the
// fixes the Pre-Purchase / Apartment report already has, and what this form needs on top:
//   - a list of sentences ("General Comments") prints one bullet per sentence, never joined with ".,";
//   - a room's moisture observations: "None observed" says so in the template's words, and findings are listed ("Staining noted.");
//   - no full stop is added after text that already ends with ".", "!" or "?";
//   - an element's "Applicability" (Assessed / Not applicable / There is no garage ...) is never printed as a "Applicability: ..." line: an
//     element answered "Assessed" prints its own answers, one answered "Not applicable" prints nothing. (The sub-floor's answer is printed in
//     the Site Access Conditions, where the template has a sentence for it.)
//   - Driveway and Pool / Spa use the standard lines, not the house sentences: those read the house form's questions ("Is there a
//     driveway?"), which this form does not ask, and said "There is no driveway." of a driveway that was assessed.
import type { Composer } from "./shared";
import { provisionalWording } from "./provisional";
import { listLine, tidyFullStops, withMoistureWording } from "./pre_purchase.apartment";
import type { ReportWording } from "./types";

const base = provisionalWording({ inspectionType: "pre_purchase", propertyType: "commercial_properties" });

/** Each section's "Applicability" questions (the form's own keys). */
export const APPLICABILITY_FIELDS: Record<string, string[]> = {
  driveway: ["pp_driveway_applicability"],
  paving_paths: ["pp_paving_applicability"],
  fences: ["pp_fences_applicability"],
  retaining_walls: ["pp_retaining_applicability"],
  garage_carport_sheds: ["sheds_applicability", "garage_applicability", "carport_applicability", "studio_applicability", "grannyflat_applicability"],
  elevations: ["cladding_applicability", "subfloor_applicability", "extstairs_applicability", "balconies_applicability", "verandah_applicability", "alfresco_applicability"],
  roof_chimneys: [
    "eaves_applicability", "fascia_applicability", "gables_applicability", "flashings_applicability", "guttersvalleys_applicability", "chimneys_applicability",
    "roofcavity_applicability", "sarking_applicability", "roofframe_applicability", "insulation_applicability",
  ],
  internal_areas: ["partywalls_applicability", "intstairs_applicability", "gas_applicability", "fireplace_applicability"],
  pool_spa: ["pool_applicability"],
};

const { driveway: _driveway, pool_spa: _poolSpa, ...composers } = base.composers;

export const prePurchaseCommercialProperties: ReportWording = {
  ...base,
  composers: { ...composers, internal_areas: withMoistureWording(base.composers.internal_areas as Composer) },
  // Only the Description is written in one go; Driveway and Pool / Spa print their answers (see above).
  isFlatComposed: (sectionKey) => sectionKey === "description" || sectionKey.startsWith("custom_"),
  metadataFields: { ...base.metadataFields, ...APPLICABILITY_FIELDS, notes: [...(base.metadataFields.notes ?? [])] },
  // The Notes' typed comments are said as typed, not as "If Other — specify: ...".
  plainFields: { ...base.plainFields, notes: [...(base.plainFields?.notes ?? []), "generalCommentsOther"] },
  listLine,
  finish: (_sectionKey, text) => tidyFullStops(text),
  // The template's Pool/Spa paragraph is printed by the report itself, and only when a pool or spa was assessed (PrePurchaseReport.tsx).
  poolSpaDisclaimer: false,
};
