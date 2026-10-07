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
  // Stage A1 -- Pre-Pour (slab)
  { key: 'pp_description', name: 'Pre-Pour: Description & Overview' },
  { key: 'pp_site_facilities', name: 'Pre-Pour: Site & Facilities' },
  { key: 'pp_measurements', name: 'Pre-Pour: Site & Slab Measurements' },
  { key: 'pp_formwork', name: 'Pre-Pour: Formwork & Services' },
  { key: 'pp_general', name: 'Pre-Pour: General' },
  { key: 'pp_defects', name: 'Pre-Pour: Defects' },
  { key: 'pp_summary', name: 'Pre-Pour: Summary, Notes & Client Issues' },
];

/** The sections that carry a template for one inspection type: the common ones, plus the stage sections for Construction Stage. */
export function templatableSectionsFor(inspectionType: string): { key: string; name: string }[] {
  return inspectionType === 'construction_stage' ? [...TEMPLATABLE_SECTIONS, ...CONSTRUCTION_STAGE_SECTIONS] : TEMPLATABLE_SECTIONS;
}
export const templatableKeysFor = (inspectionType: string): string[] => templatableSectionsFor(inspectionType).map((s) => s.key);
