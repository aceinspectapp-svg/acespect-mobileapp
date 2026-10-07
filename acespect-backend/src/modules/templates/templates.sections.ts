/**
 * The 12 real data-entry section keys that get templates. These are the
 * actual `Section.key` values written by `draft.setSection({ key, ... })`
 * on mobile (and read back by `buildReportHeader`/`ReviewerFormView` on
 * web) -- NOT the `id` values in acespect-mobile's
 * `constants/inspectionSections.ts` hub registry, which differ for three
 * of them (job_information -> job-info, description_overview ->
 * description, notes_defects -> notes). Report Summary & Sign-Off is
 * deliberately excluded: it's a declaration + signature screen that never
 * calls setSection, not a data section.
 */
export const TEMPLATABLE_SECTIONS: { key: string; name: string }[] = [
  { key: 'job-info', name: 'Job Information' },
  { key: 'description', name: 'Description & Overview' },
  { key: 'driveway', name: 'Driveway' },
  { key: 'paving_paths', name: 'Paving & Paths' },
  { key: 'fences', name: 'Fences' },
  { key: 'retaining_walls', name: 'Retaining Walls' },
  { key: 'garage_carport_sheds', name: 'Garage / Carport / Sheds' },
  { key: 'pool_spa', name: 'Pool / Spa' },
  { key: 'elevations', name: 'Elevations' },
  { key: 'roof_chimneys', name: 'Roof Covering & Chimneys' },
  { key: 'internal_areas', name: 'Internal Areas' },
  { key: 'notes', name: 'Notes / Post Project / Defects' },
];

export const TEMPLATABLE_SECTION_KEYS: string[] = TEMPLATABLE_SECTIONS.map((s) => s.key);

/**
 * Construction Stage inspections are one profile (inspectionType "construction_stage") whose form depends on the stage
 * chosen at the start (Pre-Pour, Slab, Framework, Lock-up, Fixing, PCI). Each stage owns its own section keys, prefixed
 * with a short stage code, so one profile can carry all six stages' templates without them colliding. Job Information
 * (key "job-info") is shared by every stage.
 */
export const CONSTRUCTION_STAGE_SECTIONS: { key: string; name: string }[] = [
  // Stage A1 -- Pre-Pour (slab), in the order of the paper form's headings
  { key: 'pp_description', name: 'Pre-Pour: Description & Overview' },
  { key: 'pp_site_facilities', name: 'Pre-Pour: Site & Facilities' },
  { key: 'pp_measurements', name: 'Pre-Pour: Site & Slab Measurements' },
  { key: 'pp_formwork', name: 'Pre-Pour: Formwork & Measurements' },
  { key: 'pp_general', name: 'Pre-Pour: General Other' },
  { key: 'pp_defects', name: 'Pre-Pour: Defects' },
  { key: 'pp_summary', name: 'Pre-Pour: Statements & Notes' },
  { key: 'pp_client_issues', name: 'Pre-Pour: Client List of Issues' },
  // Stage 1 -- Slab Down
  { key: 'sd_description', name: 'Slab Down: Description & Overview' },
  { key: 'sd_site_facilities', name: 'Slab Down: Site & Facilities' },
  { key: 'sd_measurements', name: 'Slab Down: Site & Slab Measurements' },
  { key: 'sd_quality', name: 'Slab Down: Slab Quality' },
  { key: 'sd_defects', name: 'Slab Down: Defects' },
  { key: 'sd_summary', name: 'Slab Down: Statement & Notes' },
  { key: 'sd_previous_defects', name: 'Slab Down: Previous Defects' },
  { key: 'sd_client_issues', name: 'Slab Down: Client List of Issues' },
  // Stage 2 -- Framework
  { key: 'fr_description', name: 'Frame: Description & Overview' },
  { key: 'fr_site_facilities', name: 'Frame: Site & Facilities' },
  { key: 'fr_services', name: 'Frame: Plasterwork & Services' },
  { key: 'fr_roof_frame', name: 'Frame: Roof Frame' },
  { key: 'fr_wall_floor', name: 'Frame: Wall & Floor Frames' },
  { key: 'fr_windows_doors', name: 'Frame: Windows & Doors' },
  { key: 'fr_progress', name: 'Frame: General Works Progress' },
  { key: 'fr_defects', name: 'Frame: Defects' },
  { key: 'fr_summary', name: 'Frame: Statement & Notes' },
  { key: 'fr_previous_defects', name: 'Frame: Previous Defects' },
  { key: 'fr_client_issues', name: 'Frame: Client List of Issues' },
  // Stage 3 -- Lock Up
  { key: 'lu_description', name: 'Lock Up: Description & Overview' },
  { key: 'lu_site_facilities', name: 'Lock Up: Site & Facilities' },
  { key: 'lu_external_walls', name: 'Lock Up: External Walls' },
  { key: 'lu_doors_windows', name: 'Lock Up: Doors & Windows' },
  { key: 'lu_framework', name: 'Lock Up: Framework' },
  { key: 'lu_roofing', name: 'Lock Up: Roofing' },
  { key: 'lu_defects', name: 'Lock Up: Defects' },
  { key: 'lu_summary', name: 'Lock Up: Statement & Notes' },
  { key: 'lu_previous_defects', name: 'Lock Up: Previous Defects' },
  { key: 'lu_client_issues', name: 'Lock Up: Client List of Issues' },
  // Stage 4 -- Fixing (Pre-paint)
  { key: 'fx_description', name: 'Fixing: Description & Overview' },
  { key: 'fx_site_facilities', name: 'Fixing: Site & Facilities' },
  { key: 'fx_walls_ceilings', name: 'Fixing: Plaster, Walls & Ceilings' },
  { key: 'fx_stairs_floors', name: 'Fixing: Stairs & Floors' },
  { key: 'fx_doors_windows', name: 'Fixing: Doors & Windows' },
  { key: 'fx_fitout', name: 'Fixing: Skirtings, Cabinets & Painting' },
  { key: 'fx_waterproofing', name: 'Fixing: Waterproofing' },
  { key: 'fx_defects', name: 'Fixing: Defects' },
  { key: 'fx_summary', name: 'Fixing: Statement & Notes' },
  { key: 'fx_previous_defects', name: 'Fixing: Previous Defects' },
  { key: 'fx_client_issues', name: 'Fixing: Client List of Issues' },
];

/**
 * The sections that carry a template for one inspection type. Construction Stage has only Job Information plus its
 * stage sections: the other eleven common sections (driveway, roof, internal ...) are never opened in a stage
 * inspection, so they are not offered for it.
 */
export function templatableSectionsFor(inspectionType: string): { key: string; name: string }[] {
  if (inspectionType !== 'construction_stage') return TEMPLATABLE_SECTIONS;
  return [...TEMPLATABLE_SECTIONS.filter((s) => s.key === 'job-info'), ...CONSTRUCTION_STAGE_SECTIONS];
}
export const templatableKeysFor = (inspectionType: string): string[] => templatableSectionsFor(inspectionType).map((s) => s.key);
