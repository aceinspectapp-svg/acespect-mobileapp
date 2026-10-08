// Dilapidation / Apartment -- the wording for this report type, and only this one.
//
// Written from the Houspect "Dilapidation Multi Level Offices" inspector template (1 May 2024): an office / hotel building of
// several levels, inspected outside (driveway, paving and car parks, fences, retaining walls, garage and other free-standing
// structures, the four elevations, the roof) and inside (offices and staff facilities on levels Grnd / 1 / 2 / 3, plus renovations,
// safety advisories, rooms not accessed and signs of movement). It is the Commercial report without the warehouse and production
// areas, so it is worded by the Commercial composers -- the same sentence rules apply:
//   * a part in satisfactory condition gets "satisfactory ... with typical wear and tear / weathering", any other grade is stated;
//   * the cracking / damage overview is said only when it records an issue;
//   * every recorded defect is said, with its photos.
// Only what the building IS is worded here ("The property is a commercial office building ...").
import type { Composer } from "./shared";
import { dilapidationCommercialProperties as commercial, makeDescription } from "./dilapidation.commercial_properties";
import type { ReportWording } from "./types";

/** The building types the form offers, as a sentence says them. */
const BUILDING: Record<string, string> = {
  "commercial offices": "commercial office building",
  "hotel/motel": "hotel or motel",
};
const description: Composer = makeDescription((label) => BUILDING[label] ?? label);

export const dilapidationApartment: ReportWording = {
  ...commercial,
  profile: { inspectionType: "dilapidation", propertyType: "apartment" },
  status: "final",
  composers: { ...commercial.composers, description },
};
