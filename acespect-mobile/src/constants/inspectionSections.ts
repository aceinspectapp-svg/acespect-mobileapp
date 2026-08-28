/**
 * The 13 inspection sections, grouped, that drive the "Inspection Sections" hub
 * (reached after Setup Step 2). `route` is set only for sections that have a
 * real screen wired into the navigator today; the rest are placeholders until
 * their screens are built.
 */
import { AppStackParamList } from '../navigation/types';

export interface InspectionSectionItem {
  id: string;
  number: number;
  title: string;
  /** Navigable target when a screen exists; undefined = not built yet. */
  route?: keyof AppStackParamList;
}

export interface InspectionSectionGroup {
  title: string;
  sections: InspectionSectionItem[];
}

export const INSPECTION_SECTION_GROUPS: InspectionSectionGroup[] = [
  {
    title: 'Job Information',
    sections: [{ id: 'job_information', number: 1, title: 'Job Information', route: 'JobInformation' }],
  },
  {
    title: 'Description & Overview',
    sections: [{ id: 'description_overview', number: 2, title: 'Description & Overview', route: 'InspectionSetupStep2' }],
  },
  {
    title: 'External Inspection',
    sections: [
      { id: 'driveway', number: 3, title: 'Driveway', route: 'DrivewaySection' },
      { id: 'paving_paths', number: 4, title: 'Paving & Paths', route: 'PavingPaths' },
      { id: 'fences', number: 5, title: 'Fences', route: 'Fences' },
      { id: 'retaining_walls', number: 6, title: 'Retaining Walls', route: 'RetainingWalls' },
      { id: 'garage_carport_sheds', number: 7, title: 'Garage / Carport / Sheds', route: 'GarageCarport' },
      { id: 'pool_spa', number: 8, title: 'Pool / Spa', route: 'PoolSpa' },
    ],
  },
  {
    title: 'Main Structure / Elevations',
    sections: [
      { id: 'elevations', number: 9, title: 'Elevations (Front/Left/Rear/Right)', route: 'Elevations' },
    ],
  },
  {
    title: 'Roof Covering & Chimneys',
    sections: [{ id: 'roof_chimneys', number: 10, title: 'Roof Covering & Chimneys', route: 'RoofChimneys' }],
  },
  {
    title: 'Internal Inspection',
    sections: [{ id: 'internal_areas', number: 11, title: 'Internal Areas', route: 'InternalAreas' }],
  },
  {
    title: 'Notes & Post Project',
    sections: [{ id: 'notes_defects', number: 12, title: 'Notes / Post Project / Defects', route: 'NotesPostProject' }],
  },
  {
    title: 'Review & Submit',
    sections: [{ id: 'report_signoff', number: 13, title: 'Report Summary & Sign-Off', route: 'ReportSummary' }],
  },
];

/** Flat list of every section, in order. */
export const INSPECTION_SECTIONS: InspectionSectionItem[] = INSPECTION_SECTION_GROUPS.flatMap(
  (g) => g.sections,
);

export const TOTAL_SECTIONS = INSPECTION_SECTIONS.length;

/**
 * How one property type narrows and relabels the master section list.
 * `order` is authoritative for both which sections appear and the order they
 * appear in -- a profile can reuse a section slot for different subject matter
 * (Apartment serves its Common Areas out of the `paving_paths` slot) and still
 * place it where it belongs in the walk-through.
 */
interface PropertySectionConfig {
  /** Section ids, in display order. */
  order: string[];
  /** Per-section title overrides, keyed by section id. */
  titles: Record<string, { group?: string; section?: string }>;
}

/**
 * A few sections' template `sectionKey` differs from their section id here;
 * screens only know the former, so map back before looking up overrides.
 */
const SECTION_ID_BY_TEMPLATE_KEY: Record<string, string> = {
  'job-info': 'job_information',
  description: 'description_overview',
  notes: 'notes_defects',
};

/**
 * Keyed by `"<inspectionType>:<propertyType>"` for profiles that need their own
 * layout, falling back to `"<propertyType>"` for the ones where the property
 * type alone decides (Public Assets surveys the same way whatever the job is).
 * Pre-Purchase needs the specific key because it walks a house by building
 * element -- Roof, then External, then Internal -- rather than Dilapidation's
 * damage-oriented order.
 */
const PROPERTY_SECTION_CONFIG: Record<string, PropertySectionConfig> = {
  /**
   * Building (Pre-Purchase), House. Follows the source template's own order:
   * the whole roof, then everything external, then everything internal, and
   * finally the structural / major-defect / safety determinations that a
   * pre-purchase report turns on.
   */
  'pre_purchase:residential_house': {
    order: [
      'job_information',
      'description_overview',
      'roof_chimneys',
      'elevations',
      'garage_carport_sheds',
      'driveway',
      'paving_paths',
      'fences',
      'retaining_walls',
      'pool_spa',
      'internal_areas',
      'notes_defects',
      'report_signoff',
    ],
    titles: {
      roof_chimneys: { group: 'Roof', section: 'Roof' },
      elevations: { group: 'External', section: 'External — Building' },
      garage_carport_sheds: { group: 'External', section: 'Outbuildings' },
      driveway: { group: 'External', section: 'Driveway' },
      paving_paths: { group: 'External', section: 'External Paving' },
      fences: { group: 'External', section: 'Fences' },
      retaining_walls: { group: 'External', section: 'Retaining Walls & Trees' },
      pool_spa: { group: 'External', section: 'Pool / Spa' },
      internal_areas: { group: 'Internal', section: 'Internal' },
      notes_defects: { group: 'Assessment', section: 'Structural, Defects & Safety' },
    },
  },
  /**
   * Public Assets has no building to inspect -- no driveway, pool, garage,
   * roof or internal rooms on a road/laneway survey, and no post-project
   * checklist. "Site Survey" (rather than "Road & Laneway Survey") because
   * each Part the inspector adds is freely named and can carry any mix of
   * categories -- it's no longer a rigid road-vs-laneway choice.
   */
  public_assets: {
    order: ['job_information', 'description_overview', 'elevations', 'report_signoff'],
    titles: { elevations: { group: 'Site Survey', section: 'Site Survey' } },
  },
  /**
   * Commercial / industrial follows the same external walk as residential, but
   * its interior splits in two: the warehouse and production floor (located by
   * aisle number) and the office / staff facilities. Those are two sections
   * rather than one so each area stays a single tap from the hub -- Offices is
   * served out of the `pool_spa` slot, which a commercial site never uses.
   */
  commercial_properties: {
    order: [
      'job_information',
      'description_overview',
      'driveway',
      'paving_paths',
      'fences',
      'retaining_walls',
      'garage_carport_sheds',
      'elevations',
      'roof_chimneys',
      'internal_areas',
      'pool_spa',
      'notes_defects',
      'report_signoff',
    ],
    titles: {
      paving_paths: { section: 'Paving / Car Park' },
      garage_carport_sheds: { section: 'Garage & Other Structures' },
      roof_chimneys: { section: 'Roof & Chimneys' },
      internal_areas: { section: 'Warehouse & Production' },
      pool_spa: { group: 'Internal Inspection', section: 'Offices & Staff Facilities' },
    },
  },
  /**
   * An apartment inspection is organised by where you stand rather than by
   * building element: External, Roof, the unit's Internal areas, then the
   * shared Common Areas, then the structural/safety wrap-up. Driveway, fences,
   * retaining walls, garage and pool don't get their own sections -- garage is
   * a sub-area of External, and driveway/paving/pool/fences are sub-areas of
   * Common Areas because on a strata property they're shared land.
   */
  apartment: {
    order: [
      'job_information',
      'description_overview',
      'elevations',
      'roof_chimneys',
      'internal_areas',
      'paving_paths',
      'notes_defects',
      'report_signoff',
    ],
    titles: {
      elevations: { group: 'External', section: 'External' },
      roof_chimneys: { group: 'Roof', section: 'Roof' },
      internal_areas: { group: 'Internal – Unit Areas', section: 'Internal – Unit Areas' },
      paving_paths: { group: 'Common Areas', section: 'Common Areas' },
      notes_defects: { group: 'Structural & Safety', section: 'Structural & Safety' },
    },
  },
};

/** The master-list group a section belongs to, before any override. */
const DEFAULT_GROUP_BY_SECTION_ID = new Map(
  INSPECTION_SECTION_GROUPS.flatMap((g) => g.sections.map((s) => [s.id, g.title] as const)),
);

/**
 * Per-property-type display title for one section, so a section screen's own
 * header matches the hub tile it was opened from (e.g. "Site Survey" not
 * "Elevations" on Public Assets, "External" on Apartment). Falls back to the
 * title the navigator passed when the profile has no override.
 */
/** Most specific config wins: inspectionType+propertyType, then propertyType alone. */
function configFor(inspectionTypeId?: string, propertyTypeId?: string): PropertySectionConfig | undefined {
  if (!propertyTypeId) return undefined;
  return (
    (inspectionTypeId ? PROPERTY_SECTION_CONFIG[`${inspectionTypeId}:${propertyTypeId}`] : undefined) ??
    PROPERTY_SECTION_CONFIG[propertyTypeId]
  );
}

export function getSectionTitle(
  templateKey: string,
  propertyTypeId: string | undefined,
  fallback: string,
  inspectionTypeId?: string,
): string {
  const cfg = configFor(inspectionTypeId, propertyTypeId);
  if (!cfg) return fallback;
  const sectionId = SECTION_ID_BY_TEMPLATE_KEY[templateKey] ?? templateKey;
  return cfg.titles[sectionId]?.section ?? fallback;
}

/**
 * Returns the section groups relevant to a given property type, in that
 * profile's own order. Property types without a config see the full,
 * unfiltered master list.
 */
export function getSectionGroupsForProperty(
  propertyTypeId?: string,
  inspectionTypeId?: string,
): InspectionSectionGroup[] {
  const cfg = configFor(inspectionTypeId, propertyTypeId);
  if (!cfg) return INSPECTION_SECTION_GROUPS;

  const byId = new Map(INSPECTION_SECTIONS.map((s) => [s.id, s]));
  const groups: InspectionSectionGroup[] = [];
  let n = 0;

  for (const id of cfg.order) {
    const base = byId.get(id);
    if (!base) continue;
    const override = cfg.titles[id];
    n += 1;
    const section = { ...base, number: n, title: override?.section ?? base.title };
    const groupTitle = override?.group ?? DEFAULT_GROUP_BY_SECTION_ID.get(id) ?? base.title;
    const last = groups[groups.length - 1];
    if (last && last.title === groupTitle) last.sections.push(section);
    else groups.push({ title: groupTitle, sections: [section] });
  }
  return groups;
}
