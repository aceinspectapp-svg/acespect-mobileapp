/**
 * Mirrors acespect-mobile/src/constants/inspectionData.ts (inspection
 * types + property types + which combos are valid) and
 * acespect-backend/src/modules/templates/templates.sections.ts (the 12
 * templatable section keys). Kept in sync by hand -- same convention this
 * codebase already uses for other shapes duplicated per-repo.
 */

export interface InspectionTypeDef {
  id: string;
  title: string;
  applicableProperties: string[];
}

export const PROPERTY_TYPES: { id: string; title: string }[] = [
  { id: "residential_house", title: "Residential House" },
  { id: "apartment", title: "Apartment" },
  { id: "commercial_properties", title: "Commercial Properties" },
  { id: "public_assets", title: "Public Assets" },
];

export const INSPECTION_TYPES: InspectionTypeDef[] = [
  {
    id: "dilapidation",
    title: "Dilapidation",
    applicableProperties: ["residential_house", "apartment", "commercial_properties", "public_assets"],
  },
  {
    id: "pre_purchase",
    title: "Pre-Purchase",
    applicableProperties: ["residential_house", "apartment", "commercial_properties"],
  },
  {
    id: "construction_stage",
    title: "Construction Stage",
    applicableProperties: ["residential_house", "apartment"],
  },
  {
    id: "investigations",
    title: "Investigations",
    applicableProperties: ["residential_house", "apartment", "commercial_properties"],
  },
];

export function propertyTitle(id: string): string {
  return PROPERTY_TYPES.find((p) => p.id === id)?.title ?? id;
}
export function inspectionTitle(id: string): string {
  return INSPECTION_TYPES.find((t) => t.id === id)?.title ?? id;
}
/** Reverse of propertyTitle -- inspections are stored with the display title
 * ("Residential House"), but the templates API is keyed by slug id
 * ("residential_house"). Falls back to the input so an already-slug value
 * still passes through untouched. */
export function propertyIdFromTitle(title: string): string {
  return PROPERTY_TYPES.find((p) => p.title === title)?.id ?? title;
}
/** Reverse of inspectionTitle -- see propertyIdFromTitle. */
export function inspectionIdFromTitle(title: string): string {
  return INSPECTION_TYPES.find((t) => t.title === title)?.id ?? title;
}
export function isValidCombo(inspectionType: string, propertyType: string): boolean {
  return INSPECTION_TYPES.find((t) => t.id === inspectionType)?.applicableProperties.includes(propertyType) ?? false;
}

/** The 12 real data-entry section keys that get templates (matches backend's TEMPLATABLE_SECTIONS). */
export const TEMPLATABLE_SECTIONS: { key: string; name: string }[] = [
  { key: "job-info", name: "Job Information" },
  { key: "description", name: "Description & Overview" },
  { key: "driveway", name: "Driveway" },
  { key: "paving_paths", name: "Paving & Paths" },
  { key: "fences", name: "Fences" },
  { key: "retaining_walls", name: "Retaining Walls" },
  { key: "garage_carport_sheds", name: "Garage / Carport / Sheds" },
  { key: "pool_spa", name: "Pool / Spa" },
  { key: "elevations", name: "Elevations" },
  { key: "roof_chimneys", name: "Roof Covering & Chimneys" },
  { key: "internal_areas", name: "Internal Areas" },
  { key: "notes", name: "Notes / Post Project / Defects" },
];
