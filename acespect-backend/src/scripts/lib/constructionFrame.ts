/**
 * Stage 2 -- Framework ("Frame"). Built from "Stage 2 Framework Inspector template, 4 Aug 2023 Rev1", following its
 * headings and row order. Section keys start with "fr_". Description, Site and Facilities, Defects, the previous-defects
 * list and the client list are the same blocks as every stage. This stage adds Plasterwork and Services, the Roof Frame
 * (truss or non-truss), Wall and Floor Frames, Windows and Doors, and General Works progress.
 */
import {
  COLOR, Choice, Draft, SectionDef, attachedListFields, bad, check, clientIssuesFields, defectsFields, descriptionFields, na, numbered, ok, opts,
  siteFacilitiesFields, warn,
} from './constructionTemplates';

// The paper form words each row's choices slightly differently; these are its exact sets.
const OK_NODEF = [ok('OK'), bad('No — defect')];
const OK_YESDEF = [ok('OK'), bad('Yes — defect')];
const OK_DEF = [ok('OK'), bad('Defect')];
const NA_OK_DEF = [na('N/A'), ok('OK'), bad('Defect')];
const NA_OK_NODEF = [na('N/A'), ok('OK'), bad('No — defect')];
const YESOK_NODEF = [ok('Yes — OK'), bad('No — defect')];
const NA_YES_NODEF = [na('N/A'), ok('Yes'), bad('No — defect')];
const OK_NODEF_NA = [ok('OK'), bad('No — defect'), na('N/A')];
const NOT_YET_INSTALLED = [ok('OK'), bad('No — defect'), warn('Not yet installed')];

/** The three progress stages the form gives each service and each building element. */
const SERVICE_STATE = [warn('Not yet'), ok('Roughed in'), warn('In progress')];
const WORK_STATE = [warn('In progress'), ok('Completed')];

// ───────────────────────── Frame stage: plasterwork and services ─────────────────────────

const PLASTER = 'Plasterwork';
const SERVICES = 'Services to Construction — all roughed in? Check with the office re the Pre-plaster template';
const services: Draft[] = [
  { key: 'plasterwork', type: 'pill-select', label: 'Plasterwork is', required: true, sectionLetter: PLASTER, options: [
    { value: 'not_commenced', label: 'Not commenced', color: COLOR.na },
    { value: 'part_done', label: 'Part done to …', color: COLOR.warn },
    { value: 'completed', label: 'Completed', color: COLOR.ok },
  ] },
  { key: 'plasterworkPartDone', type: 'text', label: 'Part done to …', required: true, gate: { fieldKey: 'plasterwork', equals: 'part_done' }, sectionLetter: PLASTER },
  {
    key: 'combinedInspection', type: 'yesno', label: 'Plasterwork completed — should this be a combined Lock up and Fixing (Pre-paint) inspection?', required: true,
    gate: { fieldKey: 'plasterwork', equals: 'completed' }, sectionLetter: PLASTER,
  },
  ...check('plumbing', 'Plumbing', SERVICE_STATE, SERVICES),
  ...check('electrical', 'Electrical & Cabling', SERVICE_STATE, SERVICES),
  ...check('gas', 'Gas', SERVICE_STATE, SERVICES),
  ...check('heatCoolDucting', 'Heat-Cool ducting', SERVICE_STATE, SERVICES),
];

// ───────────────────────── Roof frame ─────────────────────────

const TRUSS = 'Truss construction';
const NONTRUSS = 'Non-Truss construction';
const trussOn = { fieldKey: 'trussConstruction', equals: 'applicable' };
const nonTrussOn = { fieldKey: 'nonTrussConstruction', equals: 'applicable' };
const APPLIES = [ok('Applicable'), na('Not applicable')];
/** A group of checks that only applies when the inspector says that construction is used on this house. */
const gated = (rows: Draft[], gate: { fieldKey: string; equals: string }): Draft[] => rows.map((r) => ({ ...r, gate }));
const roofFrame: Draft[] = [
  ...check('trussConstruction', 'Truss construction', APPLIES, TRUSS),
  ...gated([
    ...check('roofTrusses', 'Roof trusses okay', YESOK_NODEF, TRUSS),
    ...check('trussesFixed', 'Trusses fixed securely', YESOK_NODEF, TRUSS),
    ...check('holdingDownStraps', 'Holding down straps & bolts in place', YESOK_NODEF, TRUSS),
    ...check('strapsNailed', 'Straps nailed correctly', YESOK_NODEF, TRUSS),
    ...check('roofFramingAS1684', 'Roof framing per AS1684', YESOK_NODEF, TRUSS),
    ...check('garageFramingTrusses', 'Garage framing / trusses', [ok('OK'), bad('No — defect'), warn('Not yet installed')], TRUSS),
    ...check('fireBlanket', 'Fire blanket to parapet wall', NA_OK_NODEF, TRUSS),
    ...check('partyWall', 'Party wall okay', NA_OK_NODEF, TRUSS),
  ], trussOn),
  ...check('nonTrussConstruction', 'Non-Truss construction', APPLIES, NONTRUSS),
  ...gated([
    ...check('struttingBeamSizes', 'Strutting beam sizes', OK_NODEF, NONTRUSS),
    ...check('struttingBeamClearances', 'Strutting beam clearances', OK_NODEF, NONTRUSS),
    ...check('platesBolted', 'Plates bolted to strutting beams', OK_NODEF, NONTRUSS),
    ...check('strutsAngles', 'Struts at correct angles, correct cuts or strapped', OK_NODEF, NONTRUSS),
    ...check('underpurlins', 'Underpurlins at correct centres', OK_NODEF, NONTRUSS),
    ...check('garageFraming', 'Garage framing', NOT_YET_INSTALLED, NONTRUSS),
  ], nonTrussOn),
];

// ───────────────────────── Wall and floor frames ─────────────────────────

const WF = 'Wall and floor frames';
const wallFloor: Draft[] = [
  ...check('floorFraming', 'Floor Framing to AS1684', NA_OK_DEF, WF),
  ...check('sheetFloors', 'Sheet floors squeaking, peaking at joins', NA_OK_DEF, WF),
  ...check('stripFlooring', 'Strip flooring squeaking, peaking', NA_OK_DEF, WF),
  ...check('correctFlooring', 'Correct thickness & type of flooring', NA_OK_DEF, WF),
  ...check('expansionJoints', 'Expansion joints to floors', NA_OK_DEF, WF),
  ...check('flooringSecured', 'Flooring secured per AS1684', NA_OK_DEF, WF),
  ...check('timberFloorsLevel', 'Timber floors level', NA_OK_DEF, WF),
  ...check('showerFalls', 'Shower falls okay', OK_DEF, WF),
  ...check('waterstops', 'Waterstops in place', OK_DEF, WF),
  ...check('balconyFalls', 'Balcony floor falls okay', NA_OK_DEF, WF),
  ...check('frameSizes', 'Frame sizes correct', OK_NODEF, WF),
  ...check('framesClean', 'Frames clean', OK_NODEF, WF),
  ...check('studsOkay', 'Studs okay', OK_NODEF, WF),
  ...check('studsStraightened', 'Studs straightened / packed / plumb', OK_NODEF, WF),
  ...check('wallFramingStraight', 'Wall framing straight', OK_NODEF, WF),
  ...check('wallsPlumb', 'Walls plumb', OK_NODEF, WF),
  ...check('roomDimensions', 'Room dimensions', OK_NODEF, WF),
  ...check('frameShort', 'Frame short / slab too wide', OK_YESDEF, WF),
  ...check('noggins', 'Noggins okay', OK_NODEF, WF),
  ...check('floorPlatesFixed', 'Floor plates correctly fixed to slab / sub-floor', OK_NODEF, WF),
  ...check('floorPlateOverhang', 'Frame floor plate overhang', OK_YESDEF, WF),
  ...check('topPlates', 'Top plates straightened / packed / plumb', OK_NODEF, WF),
  ...check('ceilingJoists', 'Ceiling joists or batten straightened / packed level', OK_NODEF, WF),
  ...check('bulkheads', 'Bulkheads straightened / packed level', OK_NODEF, WF),
  ...check('beamsBearers', 'Beams / Bearers etc okay', OK_NODEF, WF),
  ...check('fixingsOkay', 'Fixings okay', OK_NODEF, WF),
  ...check('ceilingHeights', 'Ceiling heights correct', OK_NODEF, WF),
  ...check('blockingCeilings', 'Blocking to ceilings', OK_NODEF, WF),
  ...check('steelWork', 'Steel work as per plan', OK_NODEF_NA, WF),
  ...check('steelWelding', 'Steel welding, fixings', OK_NODEF_NA, WF),
  ...check('archways', 'Archways straightened / packed level', OK_NODEF, WF),
  ...check('nibWalls', 'Nib walls straightened / packed level', NA_OK_NODEF, WF),
  ...check('damageToFrame', 'Damage to frame', [ok('No'), bad('Yes — defect')], WF),
  ...check('blockingCorners', 'Blocking to corners', OK_NODEF, WF),
  ...check('sisalation', 'Sisalation taped & sealed', OK_NODEF, WF),
  ...check('wallInsulation', 'Insulation to walls (batts between studs) in place', [ok('Yes'), bad('No — defect')], WF),
  ...check('bracingFixing', 'Bracing and fixing', OK_NODEF, WF),
  ...check('bracingNailed', 'Bracing nailed to standards', YESOK_NODEF, WF),
  ...check('lintels', 'Lintels straightened / packed level', OK_NODEF, WF),
  ...check('ceilingInsulation', 'Ceiling insulation installed', [ok('Yes'), warn('No — see notes')], WF),
];

// ───────────────────────── Windows and doors ─────────────────────────

const WD = 'Windows and doors';
const windowsDoors: Draft[] = [
  ...check('windowSizes', 'Window sizes & positions', OK_NODEF, WD),
  ...check('windowsFlashed', 'Windows flashed', OK_NODEF, WD),
  ...check('windowMaterial', 'Windows correct material', OK_NODEF, WD),
  ...check('windowsStraight', 'Windows straight / level', OK_NODEF, WD),
  ...check('windowsPacked', 'Windows packed', OK_NODEF, WD),
  ...check('windowReveals', 'Window reveals damaged', OK_YESDEF, WD),
  ...check('windowsOpaque', 'Windows at first floor opaque — if specified', [na('N/A'), ok('Yes'), bad('No — defect')], WD),
  ...check('windowsDoubleGlazed', 'Windows double glazed — if specified', [na('N/A'), ok('Yes'), bad('No — defect')], WD),
  ...check('doorSizes', 'Door sizes & positions correct', OK_NODEF, WD),
  ...check('doorsFlashed', 'Doors flashed', OK_NODEF, WD),
  ...check('frontDoor', 'Front door & sidelights / transom correct', OK_NODEF, WD),
  ...check('externalDoorFrames', 'External doors frames straight / plumb', OK_NODEF, WD),
  ...check('externalDoorsDamaged', 'External doors damaged', OK_YESDEF, WD),
  ...check('sillTrays', 'Sill trays at sliding doors', NA_OK_NODEF, WD),
];

// ───────────────────────── General works progress ─────────────────────────

const progress: Draft[] = [
  ...check('roofCovering', 'Roof covering — if cladding and roof covering are both done, check with the office before you leave site (Lock-up report)', WORK_STATE, 'General works progress'),
  ...check('brickwork', 'Brickwork', WORK_STATE, 'General works progress'),
  ...check('cladding', 'Cladding', WORK_STATE, 'General works progress'),
  ...check('hebel', 'Hebel', WORK_STATE, 'General works progress'),
];

// ───────────────────────── Statement, notes, previous defects ─────────────────────────

const summary: Draft[] = [
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the Frame stage is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Statement' },
  {
    key: 'notesToInclude', type: 'chip-multiselect', label: 'Notes — tick any you want to add', sectionLetter: 'Notes',
    options: [{ value: 'retaining_walls', label: 'Advise retaining walls' }, { value: 'ground_falls', label: 'Ground falls / water ponding at slab' }],
  },
  { key: 'retainingWallsDetail', type: 'textarea', label: 'Advise retaining walls? Describe …', gate: { fieldKey: 'notesToInclude', equalsAny: ['retaining_walls'] }, sectionLetter: 'Notes' },
  { key: 'groundFallsDetail', type: 'textarea', label: 'Advise ground falls need to be graded away from the house / footings; water is ponding at slab …', gate: { fieldKey: 'notesToInclude', equalsAny: ['ground_falls'] }, sectionLetter: 'Notes' },
  { key: 'otherConcerns', type: 'textarea', label: 'Any other concerns', sectionLetter: 'Notes' },
];

const previousDefects: Draft[] = attachedListFields({
  key: 'previousDefects',
  label: 'Attach the previous stage Defects list with updates',
  updatesLabel: 'Status next to each previous defect — "Done and satisfactory", "Not done" or "Could not inspect due to …"',
  photosLabel: 'The previous stage Defects list (photos)',
});

export const FRAME_SECTIONS: SectionDef[] = [
  { key: 'fr_description', name: 'Description & Overview', fields: numbered(descriptionFields({ previousDefectsList: true })) },
  { key: 'fr_site_facilities', name: 'Site & Facilities', fields: numbered(siteFacilitiesFields) },
  { key: 'fr_services', name: 'Frame Stage: Plasterwork & Services', fields: numbered(services) },
  { key: 'fr_roof_frame', name: 'Frame Stage: Roof Frame', fields: numbered(roofFrame) },
  { key: 'fr_wall_floor', name: 'Frame Stage: Wall & Floor Frames', fields: numbered(wallFloor) },
  { key: 'fr_windows_doors', name: 'Frame Stage: Windows & Doors', fields: numbered(windowsDoors) },
  { key: 'fr_progress', name: 'Frame Stage: General Works Progress', fields: numbered(progress) },
  { key: 'fr_defects', name: 'Defects', fields: numbered(defectsFields) },
  { key: 'fr_summary', name: 'Statement & Notes', fields: numbered(summary) },
  { key: 'fr_previous_defects', name: 'Previous Defects', fields: numbered(previousDefects) },
  { key: 'fr_client_issues', name: 'Client List of Issues', fields: numbered(clientIssuesFields) },
];

void opts;
void (null as unknown as Choice);
