/**
 * The six stages of a Construction Stage inspection, in build order. The inspector picks one after choosing the property
 * type; each stage has its own set of sections (templates), published on the server under the stage's section keys.
 *
 * `available` is false until that stage's template has been built and published, so the inspector can see the whole
 * programme but cannot start a stage that has nothing to fill in yet.
 */
import type { ConstructionStageId } from '../types/inspection';
export type { ConstructionStageId };

export interface ConstructionStageSection {
  /** Hub id, and also the template section key and draft key (they are the same string for stage sections). */
  id: string;
  title: string;
  /** Hub group heading. */
  group: string;
  icon: string;
}

export interface ConstructionStage {
  id: ConstructionStageId;
  title: string;
  subtitle: string;
  icon: string;
  available: boolean;
  /** Sections between Job Information and Report Summary & Sign-Off, in order. */
  sections: ConstructionStageSection[];
}

export const CONSTRUCTION_STAGES: ConstructionStage[] = [
  {
    id: 'pre_pour',
    title: 'Pre-Pour',
    subtitle: 'Stage A1 · Slab set-out, formwork, reinforcing and services before the pour',
    icon: 'water-outline',
    available: true,
    sections: [
      { id: 'pp_description', title: 'Description & Overview', group: 'Overview', icon: '🏠' },
      { id: 'pp_site_facilities', title: 'Site & Facilities', group: 'Site', icon: '🚧' },
      { id: 'pp_measurements', title: 'Site & Slab Measurements', group: 'Pre-Pour', icon: '📏' },
      { id: 'pp_formwork', title: 'Formwork & Measurements', group: 'Pre-Pour', icon: '🧱' },
      { id: 'pp_general', title: 'General Other', group: 'Pre-Pour', icon: '📋' },
      { id: 'pp_defects', title: 'Defects', group: 'Defects, Statements & Notes', icon: '⚠️' },
      { id: 'pp_summary', title: 'Statements & Notes', group: 'Defects, Statements & Notes', icon: '📝' },
      { id: 'pp_client_issues', title: 'Client List of Issues', group: 'Client List of Issues', icon: '📎' },
    ],
  },
  {
    id: 'slab',
    title: 'Slab Down',
    subtitle: 'Stage 1 · Slab set-out, dimensions, step-downs and slab quality after the pour',
    icon: 'square-outline',
    available: true,
    sections: [
      { id: 'sd_description', title: 'Description & Overview', group: 'Overview', icon: '🏠' },
      { id: 'sd_site_facilities', title: 'Site & Facilities', group: 'Site', icon: '🚧' },
      { id: 'sd_measurements', title: 'Site & Slab Measurements', group: 'Slab Down', icon: '📏' },
      { id: 'sd_quality', title: 'Slab Quality', group: 'Slab Down', icon: '✅' },
      { id: 'sd_defects', title: 'Defects', group: 'Defects, Statement & Notes', icon: '⚠️' },
      { id: 'sd_summary', title: 'Statement & Notes', group: 'Defects, Statement & Notes', icon: '📝' },
      { id: 'sd_previous_defects', title: 'Previous Defects', group: 'Previous Defects', icon: '🔁' },
      { id: 'sd_client_issues', title: 'Client List of Issues', group: 'Client List of Issues', icon: '📎' },
    ],
  },
  { id: 'framework', title: 'Framework', subtitle: 'Frame and roof structure', icon: 'grid-outline', available: false, sections: [] },
  { id: 'lock_up', title: 'Lock-Up', subtitle: 'Roof, windows and doors fitted', icon: 'lock-closed-outline', available: false, sections: [] },
  { id: 'fixing', title: 'Fixing', subtitle: 'Linings, fit-out and fixtures', icon: 'construct-outline', available: false, sections: [] },
  { id: 'pci', title: 'PCI', subtitle: 'Practical Completion / Handover', icon: 'checkmark-done-outline', available: false, sections: [] },
];

export const CONSTRUCTION_STAGE_BY_ID: Record<string, ConstructionStage> = Object.fromEntries(CONSTRUCTION_STAGES.map((s) => [s.id, s]));

/** Template section keys a stage uses, for pinning its templates when the inspection starts. */
export const stageSectionKeys = (stageId: string | undefined): string[] => CONSTRUCTION_STAGE_BY_ID[stageId ?? '']?.sections.map((s) => s.id) ?? [];
