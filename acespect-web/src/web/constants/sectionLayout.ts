/**
 * Which sections a NEW inspection starts with, for every report type -- the same list the mobile app shows on its
 * "Inspection Sections" hub (acespect-mobile/src/constants/inspectionSections.ts and constructionStages.ts), so a draft
 * started on the web has the sections its report is built from. Kept in step with mobile by hand, as the other shared
 * constants are; tests/new-inspection-sections.test.mjs compares the two for every report type and stage, so a change on
 * one side that is not made on the other fails the tests.
 *
 *  - Dilapidation / Pre-Purchase / Investigations: the property type's own list (Apartment, Commercial and Public Assets
 *    each have one; a House uses the full list), in that profile's order, with that profile's section names.
 *  - Construction Stage: Job Information plus the chosen stage's sections. The stage is recorded in Job Information
 *    (`constructionStage`), exactly as the mobile app does.
 */
import { TEMPLATABLE_SECTIONS } from "./inspectionData";

export interface SeedSection {
  key: string;
  name: string;
  icon: string;
}

// ---- Construction Stage ----------------------------------------------------------------------------------------------------
export interface ConstructionStageSection {
  id: string;
  title: string;
  icon: string;
  /** Only these property types get the section (the PCI forms differ for a house and an apartment). Omitted = both. */
  propertyTypes?: string[];
}

export interface ConstructionStage {
  id: string;
  title: string;
  subtitle: string;
  /** A combined inspection (two stages in one visit), shown after the six stages with this short badge. */
  combo?: boolean;
  badge?: string;
  sections: ConstructionStageSection[];
}

export const CONSTRUCTION_STAGES: ConstructionStage[] = [
  {
    id: "pre_pour",
    title: "Pre-Pour",
    subtitle: "Stage A1 · Slab set-out, formwork, reinforcing and services before the pour",
    sections: [
      { id: "pp_description", title: "Description & Overview", icon: "🏠" },
      { id: "pp_site_facilities", title: "Site & Facilities", icon: "🚧" },
      { id: "pp_measurements", title: "Site & Slab Measurements", icon: "📏" },
      { id: "pp_formwork", title: "Formwork & Measurements", icon: "🧱" },
      { id: "pp_general", title: "General Other", icon: "📋" },
      { id: "pp_defects", title: "Defects", icon: "⚠️" },
      { id: "pp_summary", title: "Statements & Notes", icon: "📝" },
      { id: "pp_client_issues", title: "Client List of Issues", icon: "📎" },
    ],
  },
  {
    id: "slab",
    title: "Slab Down",
    subtitle: "Stage 1 · Slab set-out, dimensions, step-downs and slab quality after the pour",
    sections: [
      { id: "sd_description", title: "Description & Overview", icon: "🏠" },
      { id: "sd_site_facilities", title: "Site & Facilities", icon: "🚧" },
      { id: "sd_measurements", title: "Site & Slab Measurements", icon: "📏" },
      { id: "sd_quality", title: "Slab Quality", icon: "✅" },
      { id: "sd_defects", title: "Defects", icon: "⚠️" },
      { id: "sd_summary", title: "Statement & Notes", icon: "📝" },
      { id: "sd_previous_defects", title: "Previous Defects", icon: "🔁" },
      { id: "sd_client_issues", title: "Client List of Issues", icon: "📎" },
    ],
  },
  {
    id: "framework",
    title: "Framework",
    subtitle: "Stage 2 · Roof, wall and floor frames, windows and doors, services progress",
    sections: [
      { id: "fr_description", title: "Description & Overview", icon: "🏠" },
      { id: "fr_site_facilities", title: "Site & Facilities", icon: "🚧" },
      { id: "fr_services", title: "Plasterwork & Services", icon: "🔧" },
      { id: "fr_roof_frame", title: "Roof Frame", icon: "🏘️" },
      { id: "fr_wall_floor", title: "Wall & Floor Frames", icon: "🧱" },
      { id: "fr_windows_doors", title: "Windows & Doors", icon: "🪟" },
      { id: "fr_progress", title: "General Works Progress", icon: "📈" },
      { id: "fr_defects", title: "Defects", icon: "⚠️" },
      { id: "fr_summary", title: "Statement & Notes", icon: "📝" },
      { id: "fr_previous_defects", title: "Previous Defects", icon: "🔁" },
      { id: "fr_client_issues", title: "Client List of Issues", icon: "📎" },
    ],
  },
  {
    id: "lock_up",
    title: "Lock-Up",
    subtitle: "Stage 3 · External walls, doors and windows, framework and roofing",
    sections: [
      { id: "lu_description", title: "Description & Overview", icon: "🏠" },
      { id: "lu_site_facilities", title: "Site & Facilities", icon: "🚧" },
      { id: "lu_external_walls", title: "External Walls", icon: "🧱" },
      { id: "lu_doors_windows", title: "Doors & Windows", icon: "🚪" },
      { id: "lu_framework", title: "Framework", icon: "🔧" },
      { id: "lu_roofing", title: "Roofing", icon: "🏘️" },
      { id: "lu_defects", title: "Defects", icon: "⚠️" },
      { id: "lu_summary", title: "Statement & Notes", icon: "📝" },
      { id: "lu_previous_defects", title: "Previous Defects", icon: "🔁" },
      { id: "lu_client_issues", title: "Client List of Issues", icon: "📎" },
    ],
  },
  {
    id: "fixing",
    title: "Fixing",
    subtitle: "Stage 4 (Pre-paint) · Plaster, doors, windows, cabinets and waterproofing",
    sections: [
      { id: "fx_description", title: "Description & Overview", icon: "🏠" },
      { id: "fx_site_facilities", title: "Site & Facilities", icon: "🚧" },
      { id: "fx_walls_ceilings", title: "Plaster, Walls & Ceilings", icon: "🧱" },
      { id: "fx_stairs_floors", title: "Stairs & Floors", icon: "🪜" },
      { id: "fx_doors_windows", title: "Doors & Windows", icon: "🚪" },
      { id: "fx_fitout", title: "Skirtings, Cabinets & Painting", icon: "🎨" },
      { id: "fx_waterproofing", title: "Waterproofing", icon: "💧" },
      { id: "fx_defects", title: "Defects", icon: "⚠️" },
      { id: "fx_summary", title: "Statement & Notes", icon: "📝" },
      { id: "fx_previous_defects", title: "Previous Defects", icon: "🔁" },
      { id: "fx_client_issues", title: "Client List of Issues", icon: "📎" },
    ],
  },
  {
    id: "pci",
    title: "PCI",
    subtitle: "Stage 5 · Practical Completion / Handover checklist",
    sections: [
      { id: "pci_description", title: "Description & Overview", icon: "🏠" },
      { id: "pci_site_facilities", title: "Site & Facilities", icon: "🚧", propertyTypes: ["residential_house"] },
      { id: "pci_roof", title: "Roof", icon: "🏘️" },
      { id: "pci_walls_doors", title: "Walls, Doors & Windows", icon: "🧱" },
      { id: "pci_garage_site", title: "Garage, Balconies & Site", icon: "🚗", propertyTypes: ["residential_house"] },
      { id: "pci_garage_site", title: "Balconies & Common Areas", icon: "🏢", propertyTypes: ["apartment"] },
      { id: "pci_internal", title: "Rooms", icon: "🛋️" },
      { id: "pci_finishes", title: "Finishes", icon: "🎨" },
      { id: "pci_services", title: "Services & Other", icon: "🔌" },
      { id: "pci_typical_defects", title: "Part 2: Identified Defects", icon: "🔎" },
      { id: "pci_defects", title: "Defects", icon: "⚠️" },
      { id: "pci_summary", title: "Statement & Notes", icon: "📝" },
      { id: "pci_previous_defects", title: "Previous Defects", icon: "🔁" },
      { id: "pci_client_issues", title: "Client List of Issues", icon: "📎" },
    ],
  },
  {
    id: "slab_frame",
    title: "Slab + Frame",
    subtitle: "Stages 2 & 3 in one visit · Slab measurements and quality, then the frame",
    combo: true,
    badge: "2+3",
    sections: [
      { id: "sf_description", title: "Description & Overview", icon: "🏠" },
      { id: "sf_site_facilities", title: "Site & Facilities", icon: "🚧" },
      { id: "sf_measurements", title: "Site & Slab Measurements", icon: "📏" },
      { id: "sf_quality", title: "Slab Quality", icon: "🧱" },
      { id: "sf_services", title: "Plasterwork & Services", icon: "🔌" },
      { id: "sf_roof_frame", title: "Roof Frame", icon: "🏘️" },
      { id: "sf_wall_floor", title: "Wall & Floor Frames", icon: "🪵" },
      { id: "sf_windows_doors", title: "Windows & Doors", icon: "🚪" },
      { id: "sf_progress", title: "General Works Progress", icon: "📈" },
      { id: "sf_defects", title: "Defects", icon: "⚠️" },
      { id: "sf_summary", title: "Statement & Notes", icon: "📝" },
      { id: "sf_previous_defects", title: "Previous Defects", icon: "🔁" },
      { id: "sf_client_issues", title: "Client List of Issues", icon: "📎" },
    ],
  },
  {
    id: "lock_fix",
    title: "Lock-Up + Fixing",
    subtitle: "Stages 4 & 5 in one visit · External walls, roofing, then plaster to waterproofing",
    combo: true,
    badge: "4+5",
    sections: [
      { id: "lf_description", title: "Description & Overview", icon: "🏠" },
      { id: "lf_site_facilities", title: "Site & Facilities", icon: "🚧" },
      { id: "lf_external_walls", title: "External Walls", icon: "🧱" },
      { id: "lf_roofing", title: "Roofing", icon: "🏘️" },
      { id: "lf_walls_ceilings", title: "Plaster, Walls & Ceilings", icon: "🧱" },
      { id: "lf_stairs_floors", title: "Stairs & Floors", icon: "🪜" },
      { id: "lf_doors_windows", title: "Doors & Windows (Lock Up & Fixing)", icon: "🚪" },
      { id: "lf_fitout", title: "Skirtings, Cabinets & Painting", icon: "🎨" },
      { id: "lf_waterproofing", title: "Waterproofing", icon: "💧" },
      { id: "lf_services", title: "Services to Frame Construction", icon: "🔌" },
      { id: "lf_defects", title: "Defects", icon: "⚠️" },
      { id: "lf_summary", title: "Statement & Notes", icon: "📝" },
      { id: "lf_previous_defects", title: "Previous Defects", icon: "🔁" },
      { id: "lf_client_issues", title: "Client List of Issues", icon: "📎" },
    ],
  },
]; 

export const CONSTRUCTION_STAGE_BY_ID: Record<string, ConstructionStage> = Object.fromEntries(CONSTRUCTION_STAGES.map((s) => [s.id, s]));

/** A stage's sections for one property type (most stages are the same for both). */
export const stageSectionsFor = (stageId: string | undefined, propertyTypeId?: string): ConstructionStageSection[] =>
  (CONSTRUCTION_STAGE_BY_ID[stageId ?? ""]?.sections ?? []).filter((s) => !s.propertyTypes || !propertyTypeId || s.propertyTypes.includes(propertyTypeId));

// ---- The other report types ------------------------------------------------------------------------------------------------
interface PropertyLayout {
  /** Section keys, in display order. */
  order: string[];
  /** Per-key section name where the profile calls a section something else. */
  names?: Record<string, string>;
}

const MASTER_ORDER = TEMPLATABLE_SECTIONS.map((s) => s.key);

/** Keyed "<inspectionType>:<propertyType>" for profiles with their own layout, else "<propertyType>"; no entry = the full list. */
const LAYOUTS: Record<string, PropertyLayout> = {
  "pre_purchase:residential_house": {
    order: ["job-info", "description", "roof_chimneys", "elevations", "garage_carport_sheds", "driveway", "paving_paths", "fences", "retaining_walls", "pool_spa", "internal_areas", "notes"],
    names: {
      roof_chimneys: "Roof",
      elevations: "External \u2014 Building",
      garage_carport_sheds: "Outbuildings",
      paving_paths: "External Paving",
      retaining_walls: "Retaining Walls & Trees",
      internal_areas: "Internal",
      notes: "Structural, Defects & Safety",
    },
  },
  public_assets: {
    order: ["job-info", "description", "elevations"],
    names: { elevations: "Site Survey" },
  },
  commercial_properties: {
    order: ["job-info", "description", "driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "elevations", "roof_chimneys", "internal_areas", "pool_spa", "notes"],
    names: {
      paving_paths: "Paving / Car Park",
      garage_carport_sheds: "Garage & Other Structures",
      roof_chimneys: "Roof & Chimneys",
      internal_areas: "Warehouse & Production",
      pool_spa: "Offices & Staff Facilities",
    },
  },
  apartment: {
    order: ["job-info", "description", "elevations", "roof_chimneys", "internal_areas", "paving_paths", "notes"],
    names: {
      elevations: "External",
      roof_chimneys: "Roof",
      internal_areas: "Internal \u2013 Unit Areas",
      paving_paths: "Common Areas",
      notes: "Structural & Safety",
    },
  },
};

const layoutFor = (inspectionTypeId: string, propertyTypeId: string): PropertyLayout | undefined => LAYOUTS[`${inspectionTypeId}:${propertyTypeId}`] ?? LAYOUTS[propertyTypeId];

/**
 * The sections a new inspection of this type starts with, in order. For Construction Stage pass the chosen stage; with no
 * stage there is nothing to survey yet, so only Job Information is returned (the mobile app does the same).
 */
export function sectionsForNewInspection(inspectionTypeId: string, propertyTypeId: string, stageId?: string): SeedSection[] {
  const jobInfo = TEMPLATABLE_SECTIONS.find((s) => s.key === "job-info")!;
  if (inspectionTypeId === "construction_stage") {
    return [jobInfo, ...stageSectionsFor(stageId, propertyTypeId).map((s) => ({ key: s.id, name: s.title, icon: s.icon }))];
  }
  const layout = layoutFor(inspectionTypeId, propertyTypeId);
  const order = layout?.order ?? MASTER_ORDER;
  return order.flatMap((key) => {
    const base = TEMPLATABLE_SECTIONS.find((s) => s.key === key);
    return base ? [{ key, name: layout?.names?.[key] ?? base.name, icon: base.icon }] : [];
  });
}

/** What the new draft's Job Information starts with: for Construction Stage, the chosen stage (the template's stage choices are gated on it). */
export function jobInfoAnswersForNewInspection(inspectionTypeId: string, stageId?: string): Record<string, unknown> | undefined {
  return inspectionTypeId === "construction_stage" && stageId ? { constructionStage: stageId } : undefined;
}
