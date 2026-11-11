import type { ReportProfile } from "./profile";
import type { ReportWording } from "./types";
import { descriptionBlocks, dilapidationResidentialHouse, houseDamageSentences, residentialHouseComposers } from "./dilapidation.residential_house";

/**
 * Wording for a report type whose own wording has not been supplied yet. It reuses the
 * Dilapidation / Residential House sentences so those reports keep generating exactly as they
 * did before this folder existed -- but it is named, listed and flagged "provisional" in the
 * registry, so it is visible, and each report type replaces it with its own file as its wording
 * document arrives. It is not a design: do not add to it.
 */
export function provisionalWording(profile: ReportProfile): ReportWording {
  // The house sentences as they were before the Nov 2026 Residential template (that wording is for Dilapidation / Residential House only).
  return { ...dilapidationResidentialHouse, composers: residentialHouseComposers, damageSentences: houseDamageSentences, descriptionBlocks, profile, status: "provisional" };
}
