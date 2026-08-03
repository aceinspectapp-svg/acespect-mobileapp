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
 * Public Assets has no building to inspect -- there's no driveway, pool,
 * garage, roof or internal rooms on a road/laneway survey, and no post-
 * project/notes checklist. Only the sections the Houspect Public Assets
 * template actually asks for apply: Job Information, Description &
 * Overview (site/scope/safety), and the Elevations section (repurposed on
 * the backend as the Part A/B road + laneway survey, which already carries
 * its own safety-matters field), and the final sign-off.
 */
const PUBLIC_ASSETS_SECTION_IDS = new Set([
  'job_information',
  'description_overview',
  'elevations',
  'report_signoff',
]);

/**
 * Per-property-type title overrides -- "Elevations" doesn't make sense for a
 * road/laneway survey. "Site Survey" (rather than "Road & Laneway Survey")
 * because each Part the inspector adds is freely named and can carry any mix
 * of categories (footpaths, kerbs, fencing, ...) -- it's no longer a rigid
 * choice between "this part is a road" or "this part is a laneway".
 */
const PUBLIC_ASSETS_TITLE_OVERRIDES: Record<string, { group?: string; section?: string }> = {
  elevations: { group: 'Site Survey', section: 'Site Survey' },
};

/**
 * Returns the section groups relevant to a given property type, dropping
 * sections (and any group left empty) that don't apply. Every property
 * type other than Public Assets sees the full, unfiltered list.
 */
export function getSectionGroupsForProperty(propertyTypeId?: string): InspectionSectionGroup[] {
  if (propertyTypeId !== 'public_assets') return INSPECTION_SECTION_GROUPS;

  let n = 0;
  return INSPECTION_SECTION_GROUPS.map((group) => {
    const sections = group.sections
      .filter((s) => PUBLIC_ASSETS_SECTION_IDS.has(s.id))
      .map((s) => {
        const override = PUBLIC_ASSETS_TITLE_OVERRIDES[s.id];
        n += 1;
        return { ...s, number: n, title: override?.section ?? s.title };
      });
    if (sections.length === 0) return null;
    const groupOverride = sections
      .map((s) => PUBLIC_ASSETS_TITLE_OVERRIDES[s.id]?.group)
      .find(Boolean);
    return { title: groupOverride ?? group.title, sections };
  }).filter((g): g is InspectionSectionGroup => g !== null);
}
