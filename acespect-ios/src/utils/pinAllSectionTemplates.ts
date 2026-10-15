import { ActiveTemplate, getActiveTemplateCached } from '../services/templateApi';
import { stageSectionKeys } from '../constants/constructionStages';

/**
 * Mirrors acespect-backend's `templates.sections.ts` TEMPLATABLE_SECTION_KEYS
 * -- the 12 real data-entry section keys that carry a template, addressed by
 * their `Section.key` (template) values, not the hub's `constants/inspectionSections.ts`
 * ids (three of which differ: job_information -> job-info, description_overview
 * -> description, notes_defects -> notes).
 */
const TEMPLATABLE_SECTION_KEYS = [
  'job-info',
  'description',
  'driveway',
  'paving_paths',
  'fences',
  'retaining_walls',
  'garage_carport_sheds',
  'pool_spa',
  'elevations',
  'roof_chimneys',
  'internal_areas',
  'notes',
];

interface DraftLike {
  getActiveTemplate: (pinKey: string) => unknown;
  setActiveTemplate: (pinKey: string, template: ActiveTemplate) => void;
}

/**
 * Pins every templatable section's currently-accepted template onto this
 * draft up front, at inspection start, instead of leaving each section to
 * fetch lazily whenever its screen is first opened. Without this, a section
 * not yet visited in an in-progress inspection would fetch whatever's
 * current AT THE TIME IT'S OPENED -- which could be a version the inspector
 * accepted (or that got published) after this inspection began, silently
 * changing the form mid-inspection. Eagerly snapshotting everything here
 * means the whole inspection uses one consistent set of versions from the
 * moment it's created, matching "never change the template of an inspection
 * already in progress".
 *
 * Idempotent and non-blocking: already-pinned keys are skipped, so calling
 * this again (e.g. from a second screen that also sets inspectionTypeId/
 * propertyTypeId) or on a resumed draft is a no-op. Failures are swallowed
 * per-section -- the section screen's own lazy fetch (already in place) is
 * the fallback if a given section couldn't be warmed here.
 */
export function pinAllSectionTemplates(
  draft: DraftLike,
  inspectionTypeId: string,
  propertyTypeId: string,
  stageId?: string,
): void {
  // A Construction Stage inspection also pins every section of the chosen stage.
  // A Construction Stage inspection uses only Job Information and its own stage's sections.
  const keys = inspectionTypeId === 'construction_stage' ? ['job-info', ...stageSectionKeys(stageId, propertyTypeId)] : TEMPLATABLE_SECTION_KEYS;
  for (const sectionKey of keys) {
    const pinKey = `${inspectionTypeId}:${propertyTypeId}:${sectionKey}`;
    if (draft.getActiveTemplate(pinKey)) continue;
    getActiveTemplateCached(inspectionTypeId, propertyTypeId, sectionKey)
      .then((t) => draft.setActiveTemplate(pinKey, t))
      .catch(() => {});
  }
}
