import type { ReportProfile } from "./profile";
import type { ReportWording } from "./types";
import { dilapidationResidentialHouse } from "./dilapidation.residential_house";

/**
 * Wording for a report type whose own wording has not been supplied yet. It reuses the
 * Dilapidation / Residential House sentences so those reports keep generating exactly as they
 * did before this folder existed -- but it is named, listed and flagged "provisional" in the
 * registry, so it is visible, and each report type replaces it with its own file as its wording
 * document arrives. It is not a design: do not add to it.
 */
export function provisionalWording(profile: ReportProfile): ReportWording {
  return { ...dilapidationResidentialHouse, profile, status: "provisional" };
}
