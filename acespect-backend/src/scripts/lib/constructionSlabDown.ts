/**
 * Stage 1 -- Slab Down. Built from "Stage 1 Slab Down Inspector template, 4 Aug 2023", following its headings and row
 * order. Section keys start with "sd_". Description, Site and Facilities, Defects and the client list are the same blocks
 * as every stage; this stage adds the previous-defects list (from the Pre-Pour report), the slab dimensions, the porch,
 * alfresco and garage step-downs, and the slab quality checks, and has a single workmanship statement.
 */
import {
  COLOR, Draft, MEAS, NO_OK_YES_DEFECT, OK_DEFECT, SectionDef, attachedListFields, bad, boundaryPegs, check, clientIssuesFields, defectsFields, descriptionFields, na, numbered, ok,
  opts, resultPill, setbackBlock, siteFacilitiesFields, warn,
} from './constructionTemplates';

const SIDE_DATUM = ['Estimated from pegs', 'Permanent fence', 'Retaining wall', 'Brick wall'];

const DIM = 'Slab dimensions';
const onPlan = (key: string) => ({ fieldKey: key, equalsAny: ['ok', 'defect', 'infill_later_refer_notes'] });
/** "Step down on plan is ___ mm & on site approx ___ mm", then the result -- shared by the porch, alfresco and garage slabs. */
function stepDownSlab(key: string, title: string): Draft[] {
  return [
    ...check(key, title, [ok('OK'), bad('Defect'), warn('Infill later — refer notes'), na('Not on plan')], title, { photosAlways: MEAS }),
    // Asked only when the slab is on the plan (the form leaves them blank for "Not on plan").
    { key: `${key}StepPlan`, type: 'numeric', label: 'Step down on plan', unit: 'mm', sectionLetter: title, gate: onPlan(key) },
    { key: `${key}StepSite`, type: 'numeric', label: 'Step down on site (approx)', unit: 'mm', sectionLetter: title, gate: onPlan(key) },
    { ...resultPill(`${key}StepResult`, 'Step down — result', title), gate: onPlan(key) },
  ];
}

const measurements: Draft[] = [
  boundaryPegs,
  ...setbackBlock('front', 'Front setback', SIDE_DATUM),
  ...setbackBlock('right', 'Right side setback', SIDE_DATUM),
  ...setbackBlock('rear', 'Rear setback', SIDE_DATUM),
  ...setbackBlock('left', 'Left side setback', SIDE_DATUM),
  {
    key: 'slabDimensions', type: 'pill-select', label: 'Slab dimensions', required: true, sectionLetter: DIM,
    options: [
      { value: 'overhangs', label: 'Overhangs', color: COLOR.bad },
      { value: 'too_short', label: 'Too short', color: COLOR.bad },
      { value: 'ok', label: 'OK', color: COLOR.ok },
      { value: 'variation_okay', label: 'Variation appears to be okay', color: COLOR.ok },
      { value: 'builder_to_recheck', label: 'Builder to re-check', color: COLOR.warn },
    ],
  },
  // The form leaves the unit blank (the inspector writes it), so these are free text.
  { key: 'slabWidthPlan', type: 'text', label: 'Width on plan is', placeholder: 'e.g. 9500 mm', required: true, sectionLetter: DIM },
  { key: 'slabWidthSite', type: 'text', label: 'Width on site (approx)', placeholder: 'e.g. 9510 mm', required: true, sectionLetter: DIM },
  resultPill('slabWidthResult', 'Width — result', DIM),
  { key: 'slabLengthPlan', type: 'text', label: 'Length on plan is', placeholder: 'e.g. 18200 mm', required: true, sectionLetter: DIM },
  { key: 'slabLengthSite', type: 'text', label: 'Length on site (approx)', placeholder: 'e.g. 18190 mm', required: true, sectionLetter: DIM },
  resultPill('slabLengthResult', 'Length — result', DIM),
  ...stepDownSlab('porchSlab', 'Porch slab'),
  ...stepDownSlab('alfrescoSlab', 'Alfresco slab'),
  ...stepDownSlab('garageSlab', 'Garage slab'),
  ...check('inGroundPool', 'Inground pool', [na('N/A'), na('Not in scope'), ok('OK'), bad('Defect'), warn('Refer notes')], 'Inground pool'),
];

const Q = 'Slab quality';
const quality: Draft[] = [
  ...check('slabLevels', 'Slab surface levels — less than 4 mm variation per any 2 metres', [ok('OK'), bad('No — defect')], Q, {
    photosAlways: 'Photos of the spirit level showing the variances (check a dozen points with a laser or straight edge)',
  }),
  ...check('slabSurface', 'Slab surface: pitted / excessive trowelling / poorly formed edges / other', NO_OK_YES_DEFECT, Q),
  ...check('reentrantCracks', 'Re-entrant cracks', NO_OK_YES_DEFECT, Q),
  ...check('slabEdges', 'Slab edges rough / honeycomb or excess', NO_OK_YES_DEFECT, Q),
  {
    key: 'polythene', type: 'pill-select', label: 'Polyethylene (plastic) visible at edges of slab and in satisfactory condition', required: true, sectionLetter: Q, allowOther: true,
    options: [{ value: 'yes_ok', label: 'Yes — OK', color: COLOR.ok }, { value: 'no_defect', label: 'No — defect', color: COLOR.bad }, { value: 'covered_in_backfill', label: 'Covered in backfill', color: COLOR.warn }],
  },
  ...check('wastesCorrect', 'Wastes correct sizes & locations', OK_DEFECT, Q),
  ...check('wasteCapped', 'Waste pipes capped', OK_DEFECT, Q),
  ...check('utilityPenetrations', 'Utility supply penetrations positioned as per plan', OK_DEFECT, Q),
  ...check('kitchenBenchPenetrations', 'Kitchen bench supply penetrations correct', OK_DEFECT, Q),
  ...check('retainingWalls', 'Retaining walls as per plan / waterproofed?', [na('N/A'), ok('Yes — OK'), bad('No — defect')], Q),
  ...check('adviseRetaining', 'Advise retaining wall/s would be prudent?', [ok('No'), warn('Yes — recommend, see notes')], Q),
  ...check('siteDrainage', 'Any concerns re site drainage / ground falls?', NO_OK_YES_DEFECT, Q),
  ...check('agiDrain', 'Recommend agi drain/s?', [ok('No'), warn('Yes — recommend, refer to notes')], Q),
  ...check('garageKerb', 'Alignment of garage & kerb crossing per plan', OK_DEFECT, Q),
  ...check('frameSetOut', 'Frame set-out marked on slab', [ok('Yes'), warn('Not yet')], Q),
  { key: 'qualityOther', type: 'textarea', label: 'Other', placeholder: 'Any other point (the form has two blank rows)', sectionLetter: Q },
];

const summary: Draft[] = [
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the Slab Down stage is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Statement' },
  {
    key: 'notesToInclude', type: 'chip-multiselect', label: 'Notes — tick any you want to add', sectionLetter: 'Notes',
    options: [{ value: 'retaining_walls', label: 'Advise retaining walls' }, { value: 'agi_drains', label: 'Advise agi drains' }, { value: 'ground_falls', label: 'Ground falls / water ponding at slab' }],
  },
  { key: 'retainingWallsDetail', type: 'textarea', label: 'Advise retaining walls? Describe …', gate: { fieldKey: 'notesToInclude', equalsAny: ['retaining_walls'] }, sectionLetter: 'Notes' },
  { key: 'agiDrainsDetail', type: 'textarea', label: 'Advise agi drains? Describe where …', gate: { fieldKey: 'notesToInclude', equalsAny: ['agi_drains'] }, sectionLetter: 'Notes' },
  { key: 'groundFallsDetail', type: 'textarea', label: 'Advise ground falls need to be graded away from the house / footings; water is ponding at slab …', gate: { fieldKey: 'notesToInclude', equalsAny: ['ground_falls'] }, sectionLetter: 'Notes' },
  { key: 'otherConcerns', type: 'textarea', label: 'Any other concerns', sectionLetter: 'Notes' },
];

const previousDefects: Draft[] = attachedListFields({
  key: 'previousDefects',
  label: 'Attach the previous stage Defects list with updates',
  updatesLabel: 'Status next to each Pre-pour defect — "Done and satisfactory", "Not done" or "Could not inspect due to …"',
  photosLabel: 'The previous stage Defects list (photos)',
});

export const SLAB_DOWN_SECTIONS: SectionDef[] = [
  { key: 'sd_description', name: 'Description & Overview', fields: numbered(descriptionFields({ previousDefectsList: true })) },
  { key: 'sd_site_facilities', name: 'Site & Facilities', fields: numbered(siteFacilitiesFields) },
  { key: 'sd_measurements', name: 'Slab Down: Site & Slab Measurements', fields: numbered(measurements) },
  { key: 'sd_quality', name: 'Slab Down: Slab Quality', fields: numbered(quality) },
  { key: 'sd_defects', name: 'Defects', fields: numbered(defectsFields) },
  { key: 'sd_summary', name: 'Statement & Notes', fields: numbered(summary) },
  { key: 'sd_previous_defects', name: 'Previous Defects', fields: numbered(previousDefects) },
  { key: 'sd_client_issues', name: 'Client List of Issues', fields: numbered(clientIssuesFields) },
];

void opts;
