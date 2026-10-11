/**
 * Combined inspections -- two stages done in one visit, each with its own form:
 *   "Stage 1&2 Slab&Frame Combo Inspector template, 4 Aug 2023 Rev1"    section keys "sf_*"
 *   "Stage 3&4 Lock Up&Fixing Combo Inspector template, 21 May 2024"    section keys "lf_*"
 *
 * Each combo form is the two stages' own checks laid end to end under ONE header, Description, Site and Facilities,
 * Defects table, workmanship statement, notes, previous-defects list and client list. The parts that repeat a single
 * stage word for word are shared with that stage's builder (so a correction there reaches the combo); what is written
 * here is only what the combo form words differently: its statement, notes, the Stage question in the Slab & Frame
 * header, the Plasterwork "completed" prompt, the Services block at the end of the Lock Up & Fixing form, and its
 * shorter client-list line.
 */
import { Draft, SectionDef, attachedListFields, check, clientIssuesFields, defectsFields, descriptionFields, numbered, ok, siteFacilitiesFields, warn } from './constructionTemplates';
import { SLAB_MEASUREMENTS, SLAB_QUALITY } from './constructionSlabDown';
import { FRAME_PROGRESS, FRAME_ROOF, FRAME_SERVICES, FRAME_WALL_FLOOR, FRAME_WINDOWS_DOORS } from './constructionFrame';
import { LOCK_UP_DESCRIPTION, LOCK_UP_EXTERNAL_WALLS, LOCK_UP_PREVIOUS_DEFECTS, LOCK_UP_ROOFING, LOCK_UP_SITE_FACILITIES } from './constructionLockUp';
import { FIXING_DOORS_WINDOWS, FIXING_FIT_OUT, FIXING_STAIRS_FLOORS, FIXING_WALLS_CEILINGS, FIXING_WATERPROOFING } from './constructionFixing';

const previousDefects: Draft[] = attachedListFields({
  key: 'previousDefects',
  label: 'Attach the previous stage Defects list with updates',
  updatesLabel: 'Status next to each previous report defect — "Done and satisfactory", "Not done" or "Could not inspect due to …"',
  photosLabel: 'The previous stage Defects list (photos)',
});

const GROUND_FALLS = 'Advise ground falls need to be graded away from the house / footings; water is ponding at slab …';
const notes = (): Draft[] => [
  { key: 'notesToInclude', type: 'chip-multiselect', label: 'Notes — tick any you want to add', sectionLetter: 'Notes', options: [{ value: 'ground_falls', label: 'Ground falls / water ponding at slab' }] },
  { key: 'groundFallsDetail', type: 'textarea', label: GROUND_FALLS, gate: { fieldKey: 'notesToInclude', equalsAny: ['ground_falls'] }, sectionLetter: 'Notes' },
  { key: 'otherConcerns', type: 'textarea', label: 'Any other concerns', sectionLetter: 'Notes' },
];

// ───────────────────────── Slab & Frame ─────────────────────────

/** The Frame stage's Plasterwork prompt, as the combo form words it: "If so, check if this should be a Lock up and/or Fixing (Pre-paint) inspection." */
const sfServices: Draft[] = FRAME_SERVICES.map((f) => (f.key === 'combinedInspection'
  ? { ...f, label: 'Plasterwork completed — should this be a Lock up and/or Fixing (Pre-paint) inspection?' }
  : f));

const sfSummary: Draft[] = [
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the Slab and Framework is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Statement' },
  ...notes(),
];

export const SLAB_FRAME_SECTIONS: SectionDef[] = [
  { key: 'sf_description', name: 'Description & Overview', fields: numbered(descriptionFields({ previousDefectsList: true })) },
  { key: 'sf_site_facilities', name: 'Site & Facilities', fields: numbered(siteFacilitiesFields) },
  { key: 'sf_measurements', name: 'Slab Down: Site & Slab Measurements', fields: numbered(SLAB_MEASUREMENTS) },
  { key: 'sf_quality', name: 'Slab Down: Slab Quality', fields: numbered(SLAB_QUALITY) },
  { key: 'sf_services', name: 'Frame Stage: Plasterwork & Services', fields: numbered(sfServices) },
  { key: 'sf_roof_frame', name: 'Frame Stage: Roof Frame', fields: numbered(FRAME_ROOF) },
  { key: 'sf_wall_floor', name: 'Frame Stage: Wall & Floor Frames', fields: numbered(FRAME_WALL_FLOOR) },
  { key: 'sf_windows_doors', name: 'Frame Stage: Windows & Doors', fields: numbered(FRAME_WINDOWS_DOORS) },
  { key: 'sf_progress', name: 'Frame Stage: General Works Progress', fields: numbered(FRAME_PROGRESS) },
  { key: 'sf_defects', name: 'Defects', fields: numbered(defectsFields) },
  { key: 'sf_summary', name: 'Statement & Notes', fields: numbered(sfSummary) },
  { key: 'sf_previous_defects', name: 'Previous Defects', fields: numbered(previousDefects) },
  { key: 'sf_client_issues', name: 'Client List of Issues', fields: numbered(clientIssuesFields) },
];

// ───────────────────────── Lock Up & Fixing ─────────────────────────

const SERVICES = 'Services to Frame Construction';
const ROUGH_IN = [ok('Roughed in'), warn('Not yet'), warn('In progress')];
const lfServices: Draft[] = [
  ...check('plumbing', 'Plumbing', ROUGH_IN, SERVICES),
  ...check('electrical', 'Electrical', ROUGH_IN, SERVICES),
  ...check('gas', 'Gas', ROUGH_IN, SERVICES),
  ...check('heatCoolDucting', 'Heat-Cool ducting', ROUGH_IN, SERVICES),
];

const lfSummary: Draft[] = [
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the Lock up and Fixing stages is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Statement' },
  ...notes(),
];

// This form's client line is shorter than the other forms': "Client Issues list with your Comments/Updates — Attached / NA".
const lfClientIssues: Draft[] = attachedListFields({
  key: 'clientList',
  label: 'Attach the Client Issues list with your Comments / Updates',
  updatesLabel: 'Your comments / updates next to each client issue',
  photosLabel: 'The client issues list (photos)',
});

export const LOCK_FIX_SECTIONS: SectionDef[] = [
  { key: 'lf_description', name: 'Description & Overview', fields: numbered(LOCK_UP_DESCRIPTION) },
  { key: 'lf_site_facilities', name: 'Site & Facilities', fields: numbered(LOCK_UP_SITE_FACILITIES) },
  { key: 'lf_external_walls', name: 'Lock Up Stage: External Walls', fields: numbered(LOCK_UP_EXTERNAL_WALLS) },
  { key: 'lf_roofing', name: 'Lock Up Stage: Roofing', fields: numbered(LOCK_UP_ROOFING) },
  { key: 'lf_walls_ceilings', name: 'Fixing Stage: Plaster, Walls & Ceilings', fields: numbered(FIXING_WALLS_CEILINGS) },
  { key: 'lf_stairs_floors', name: 'Fixing Stage: Stairs & Floors', fields: numbered(FIXING_STAIRS_FLOORS) },
  { key: 'lf_doors_windows', name: 'Lock Up & Fixing: Doors & Windows', fields: numbered(FIXING_DOORS_WINDOWS) },
  { key: 'lf_fitout', name: 'Fixing Stage: Skirtings, Cabinets & Painting', fields: numbered(FIXING_FIT_OUT) },
  { key: 'lf_waterproofing', name: 'Fixing Stage: Waterproofing', fields: numbered(FIXING_WATERPROOFING) },
  { key: 'lf_services', name: 'Fixing Stage: Services to Frame Construction', fields: numbered(lfServices) },
  { key: 'lf_defects', name: 'Defects', fields: numbered(defectsFields) },
  { key: 'lf_summary', name: 'Statement & Notes', fields: numbered(lfSummary) },
  { key: 'lf_previous_defects', name: 'Previous Defects', fields: numbered(LOCK_UP_PREVIOUS_DEFECTS) },
  { key: 'lf_client_issues', name: 'Client List of Issues', fields: numbered(lfClientIssues) },
];

