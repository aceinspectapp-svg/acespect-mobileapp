/**
 * Stage A1 -- Pre-Pour (slab). Built from "Stage A1 Pre-Pour Inspector template, 4 Aug 2023", following its headings and
 * row order. Section keys start with "pp_".
 */
import {
  Draft, MEAS, OK_DEFECT, PEGS, SectionDef, YES_DEFECT, boundaryPegs, bad, check, clientIssuesFields, defectsFields, descriptionFields, numbered, ok, na, warn,
  setbackBlock, siteFacilitiesFields, COLOR,
} from './constructionTemplates';

const measurements: Draft[] = [
  boundaryPegs,
  ...setbackBlock('front', 'Front setback', ['Estimated from pegs', 'Footpath', 'Permanent fence', 'Retaining wall', 'Brick wall']),
  ...setbackBlock('right', 'Right side setback', ['Estimated from pegs', 'Permanent fence', 'Retaining wall', 'Brick wall']),
  ...setbackBlock('rear', 'Rear setback', ['Estimated from pegs', 'Permanent fence', 'Retaining wall', 'Brick wall']),
  ...setbackBlock('left', 'Left side setback', ['Estimated from pegs', 'Permanent fence', 'Retaining wall', 'Brick wall']),
];

const SLAB = 'Slab and formwork';
const REO = 'Reinforcing';
const WAFFLE = 'Waffle pods';
const SERVICES = 'Services and penetrations';
const POUR = [ok('Part of main pour & OK'), bad('Defect'), warn('Infill later — refer notes')];
const formwork: Draft[] = [
  ...check('slabDimensions', 'Slab formwork dimensions', [ok('OK'), bad('Defect'), bad('Overhangs, too short, etc.')], SLAB, { photosAlways: MEAS }),
  ...check('garageSlab', 'Garage slab formed', POUR, SLAB, { photosAlways: MEAS }),
  ...check('porchSlab', 'Porch slab formed', POUR, SLAB, { photosAlways: MEAS }),
  ...check('alfrescoSlab', 'Alfresco slab formed', POUR, SLAB, { photosAlways: MEAS }),
  ...check('poolFormed', 'Inground pool formed', [na('Not applicable'), ok('OK'), bad('Defect'), warn('Refer notes')], SLAB),
  ...check('formworkBowed', 'Formwork bowed', YES_DEFECT, SLAB),
  ...check('formworkPegged', 'Formwork pegged & secure', OK_DEFECT, SLAB),
  ...check('footingDepths', 'Footing depths', [ok('OK'), warn('Could not see')], SLAB),
  ...check('excessWater', 'Excess water to footings', [ok('No — OK'), warn('Could not see')], SLAB),
  ...check('polythene', 'Polyethylene positioned, overlaid and sealed', [ok('Yes — OK'), bad('No — defect'), warn('Covered in backfill')], SLAB),

  ...check('reoPosition', 'Reinforcing in position', OK_DEFECT, REO),
  ...check('reoClearances', 'Reinforcing clearances', OK_DEFECT, REO),
  ...check('reoDamaged', 'Reinforcing damaged', YES_DEFECT, REO),
  ...check('reoSaddles', 'Reo securely on saddles', OK_DEFECT, REO),
  ...check('sideBars', 'Side bars, corner bars in correct positions', OK_DEFECT, REO),

  ...check('wafflePositioned', 'Waffle pods positioned', OK_DEFECT, WAFFLE),
  ...check('waffleSpacings', 'Waffle pod spacings', OK_DEFECT, WAFFLE),
  ...check('waffleDamaged', 'Waffle pods damaged', YES_DEFECT, WAFFLE),

  ...check('waterSupplyPipe', 'Water supply pipe position to slab', OK_DEFECT, SERVICES),
  ...check('wastesCorrect', 'Wastes correct sizes & locations', OK_DEFECT, SERVICES),
  ...check('wasteCapped', 'Waste pipes capped', OK_DEFECT, SERVICES),
  ...check('utilityPenetrations', 'Utility supply penetrations positioned as per plan', OK_DEFECT, SERVICES),
  ...check('kitchenBenchPenetrations', 'Kitchen bench supply penetrations correct', OK_DEFECT, SERVICES),
  ...check('termitePartA', 'Termite Part A (collars at penetrations)', OK_DEFECT, SERVICES),
  ...check('showerSetDowns', 'Shower set downs apparent', OK_DEFECT, SERVICES),
];

const GEN = 'General';
const general: Draft[] = [
  ...check('retainingWalls', 'Retaining walls as per plan / waterproofed?', [na('N/A'), ok('Yes — OK'), bad('No — defect')], GEN),
  ...check('adviseRetaining', 'Advise retaining wall/s would be prudent?', [ok('No'), warn('Yes — recommend, see notes')], GEN),
  ...check('siteDrainage', 'Any concerns re site drainage / ground falls?', [ok('No — OK'), bad('Yes — defect')], GEN),
  ...check('agiDrain', 'Recommend agi drain/s?', [ok('No'), warn('Yes — recommend, refer to notes')], GEN),
  ...check('garageKerb', 'Alignment of garage & kerb crossing per plan', OK_DEFECT, GEN),
  { key: 'generalOther', type: 'textarea', label: 'Other', placeholder: 'Any other point (the form has two blank rows)', sectionLetter: GEN },
];

const summary: Draft[] = [
  {
    key: 'worksStatus', type: 'pill-select', label: 'The works are', required: true, sectionLetter: 'Complete these 3 statements',
    options: [{ value: 'complete', label: 'Complete', color: COLOR.ok }, { value: 'mostly_complete', label: 'Mostly complete, defects being rectified at time of inspection', color: COLOR.warn }],
    allowOther: true,
  },
  { key: 'contactedSupervisor', type: 'yesno', label: 'I have contacted the slab / site supervisor regarding defects / concerns', required: true, sectionLetter: 'Complete these 3 statements' },
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the Pre-pour stage is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Complete these 3 statements' },
  {
    key: 'notesToInclude', type: 'chip-multiselect', label: 'Notes — tick any you want to include', sectionLetter: 'Notes',
    options: [{ value: 'security_fencing', label: 'Security fencing needs reinstating' }, { value: 'ground_falls', label: 'Ground falls / water ponding at slab' }],
  },
  { key: 'securityFencingDetail', type: 'textarea', label: 'Security fencing is … and needs to be reinstated', gate: { fieldKey: 'notesToInclude', equalsAny: ['security_fencing'] }, sectionLetter: 'Notes' },
  { key: 'groundFallsDetail', type: 'textarea', label: 'Ground falls need to be graded away from the house / footings; water is ponding at slab …', gate: { fieldKey: 'notesToInclude', equalsAny: ['ground_falls'] }, sectionLetter: 'Notes' },
  { key: 'otherConcerns', type: 'textarea', label: 'Any other concerns', sectionLetter: 'Notes' },
];

export const PRE_POUR_SECTIONS: SectionDef[] = [
  { key: 'pp_description', name: 'Description & Overview', fields: numbered(descriptionFields()) },
  { key: 'pp_site_facilities', name: 'Site & Facilities', fields: numbered(siteFacilitiesFields) },
  { key: 'pp_measurements', name: 'Pre-Pour: Site & Slab Measurements', fields: numbered(measurements) },
  { key: 'pp_formwork', name: 'Pre-Pour: Formwork & Measurements', fields: numbered(formwork) },
  { key: 'pp_general', name: 'Pre-Pour: General Other', fields: numbered(general) },
  { key: 'pp_defects', name: 'Defects', fields: numbered(defectsFields) },
  { key: 'pp_summary', name: 'Statements & Notes', fields: numbered(summary) },
  { key: 'pp_client_issues', name: 'Client List of Issues', fields: numbered(clientIssuesFields) },
];

void PEGS;
