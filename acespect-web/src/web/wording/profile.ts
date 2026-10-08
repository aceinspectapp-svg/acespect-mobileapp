/**
 * A report type: the inspection type plus the property type, as the slugs the templates
 * API is keyed by ("dilapidation" + "residential_house"). Every report's wording is chosen
 * by this first, and only then by section.
 */
export interface ReportProfile {
  inspectionType: string;
  propertyType: string;
}

/**
 * An inspection is stored with the display title ("Residential House"), but templates and
 * wording are keyed by slug ("residential_house"). Covers every current inspection / property
 * type; the fallback (lower-case, spaces and hyphens to underscores) is a no-op for a slug
 * that was already passed in.
 */
const TYPE_LABEL_TO_SLUG: Record<string, string> = {
  "Dilapidation": "dilapidation",
  "Pre-Purchase": "pre_purchase",
  "Construction Stage": "construction_stage",
  "Investigations": "investigations",
  "Residential House": "residential_house",
  "Apartment": "apartment",
  "Commercial Properties": "commercial_properties",
  "Public Assets": "public_assets",
};

export function toSlug(value: string): string {
  return TYPE_LABEL_TO_SLUG[value] ?? value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** The report type of an inspection, from its stored type / property type (titles or slugs). */
export function reportProfileOf(inspectionType: string, propertyType: string): ReportProfile {
  return { inspectionType: toSlug(inspectionType ?? ""), propertyType: toSlug(propertyType ?? "") };
}

export function profileKey(profile: ReportProfile): string {
  return `${profile.inspectionType}/${profile.propertyType}`;
}
