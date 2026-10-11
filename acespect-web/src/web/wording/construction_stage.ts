import type { ReportWording } from "./types";
import type { ReportProfile } from "./profile";
import { composeConstructionSection } from "../construction/compose";
import { CONSTRUCTION_KEYS } from "../construction/stages";

/**
 * The Construction Stage report wording (every stage and both combined inspections, House and Apartment). Every
 * Construction Stage section is written in one go from its own answers: the checklist rows as heading + sentence, the
 * defects it records, the General Description, the notes. The reviewer portal and the printed report both read this.
 */
export function constructionWording(profile: ReportProfile): ReportWording {
  const apartment = profile.propertyType === "apartment";
  const composers: ReportWording["composers"] = {};
  for (const key of CONSTRUCTION_KEYS) composers[key] = (inst, itemFields) => composeConstructionSection(key, itemFields, inst, apartment).text;
  return {
    profile,
    status: "final",
    composers,
    absence: {},
    isFlatComposed: (sectionKey) => CONSTRUCTION_KEYS.includes(sectionKey),
    metadataFields: {},
    noSummarySections: CONSTRUCTION_KEYS,
    absentSlotSections: [],
    derivedDamages: (sectionKey, scope, templateFields) => composeConstructionSection(sectionKey, templateFields, scope, apartment).damages,
    // Re-deriving a section from its answers replaces any text the reviewer typed over it.
    derivedFields: () => ({ reportTextOverride: false }),
  };
}
