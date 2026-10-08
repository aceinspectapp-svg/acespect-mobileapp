/**
 * Stage 4 -- Fixing (Pre-paint). Built from "Stage 4 Fixing (Pre-paint) Inspector template, 21 May 2024", following its
 * headings and row order exactly. Section keys start with "fx_". The header, Description and Site and Facilities are word
 * for word the Lock Up form's, so they are shared with it; the Fixing stage itself covers plaster, walls and ceilings,
 * stairs, floors, doors, windows, architraves and skirtings, cabinets and robes, painting, and the internal and balcony
 * waterproofing.
 */
import {
  Choice, Draft, SectionDef, bad, check, clientIssuesFields, defectsFields, na, numbered, ok, warn,
} from './constructionTemplates';
import { LOCK_UP_DESCRIPTION, LOCK_UP_PREVIOUS_DEFECTS, LOCK_UP_SITE_FACILITIES } from './constructionLockUp';

// The form words its choices a few different ways; these are its exact sets.
const OK_DEF = [ok('OK'), bad('Defect')];
const NO_DEF = [ok('No'), bad('Defect')];
const NOOK_DEF = [ok('No — OK'), bad('Defect')];
const OK_DEF_NA = [ok('OK'), bad('Defect'), na('N/A')];
const NA_OK_DEF = [na('N/A'), ok('OK'), bad('Defect')];
const OK_DEF_NOTYET = [ok('OK'), bad('Defect'), warn('Not yet')];
const NOTYET_OK_DEF = [warn('Not yet'), ok('OK'), bad('Defect')];
const NA_NOTYET_OK_DEF = [na('N/A'), warn('Not yet'), ok('OK'), bad('Defect')];
const APPLIES = [ok('Applicable'), na('Not applicable')];
const COMPLETE: Choice[] = [ok('Yes'), warn('Part done to — ground floor only'), warn('Part done to — first floor only')];

const gate = (fieldKey: string, equals: string) => ({ fieldKey, equals });
const gated = (rows: Draft[], g: { fieldKey: string; equals: string }): Draft[] => rows.map((r) => ({ ...r, gate: g }));
type Pair = [string, string, Choice[]];
const rows = (list: Pair[], group: string): Draft[] => list.flatMap(([key, label, choices]) => check(key, label, choices, group));
const SHOW_LEVEL = 'Photo showing the digital level';

// ───────────────────────── Fixing stage: plaster, walls and ceilings ─────────────────────────

const PLASTER = 'Plaster — use a digital level and measuring devices and show them in the photos';
const WALLS = 'Walls and ceilings';
const wallsCeilings: Draft[] = [
  ...check('plasterComplete', 'Plaster — complete?', COMPLETE, PLASTER),
  ...check('ceilingHeights', 'Ceiling heights correct', [ok('Yes — OK'), bad('Defect')], WALLS),
  ...rows([
    ['ceilingFlushing', 'Ceiling flushing', OK_DEF],
    ['bulkheads', 'Bulkheads plumb & level', OK_DEF],
    ['backBlocking', 'Back blocking to ceilings', [ok('OK'), bad('Defect'), warn('Not sighted')]],
    ['cornices', 'Cornices straight', [ok('OK'), bad('Defect'), warn('Not fitted'), ok('Square set')]],
  ], WALLS),
  ...check('wallsPlumb', 'Walls plumb — show digital level', OK_DEF, WALLS, { photosAlways: SHOW_LEVEL }),
  ...check('wallsBowed', 'Walls bowed — show digital level', OK_DEF, WALLS, { photosAlways: SHOW_LEVEL }),
  ...rows([
    ['nibWalls', 'Nib walls straight', OK_DEF],
    ['plasterReveals', 'Plaster reveals', OK_DEF],
    ['plasterDoorFrames', 'Plaster at door frames > 25 mm spacing', OK_DEF],
    ['manhole', 'Manhole installed', [ok('OK'), bad('Defect'), warn('Not yet — see notes')]],
    ['ceilingInsulation', 'Ceiling insulation', OK_DEF_NOTYET],
    ['plasterJoins', 'Plaster joins visible', NOOK_DEF],
    ['floatSet', 'Float & set complete', OK_DEF],
    ['plasterFinish', 'Plaster finish okay', OK_DEF],
    ['roomDimensions', 'Room dimensions', OK_DEF],
    ['garagePlastering', 'Garage plastering', OK_DEF_NOTYET],
    ['caulking', 'Caulking', [ok('OK'), bad('Defect'), warn('Not complete')]],
    ['powerPointCutOuts', 'Power point cut outs', OK_DEF_NOTYET],
    ['plumbingCutOuts', 'Plumbing cut outs', OK_DEF_NOTYET],
    ['dataTvCutOuts', 'Data, TV cut outs', OK_DEF_NOTYET],
  ], WALLS),
];

// ───────────────────────── Stairwells and floors ─────────────────────────

const STAIRS = 'Stairwell/s';
const FLOORS = 'Floors';
const stairwellOn = gate('stairwells', 'applicable');
const stairsFloors: Draft[] = [
  ...check('stairwells', 'Stairwell/s', APPLIES, STAIRS),
  ...gated([
    ...rows([
      ['handrailHeight', 'Handrail & height', [na('N/A'), ok('OK'), bad('Defect'), warn('Not yet')]],
      ['handrailContinuous', 'Handrail continuous', [na('N/A'), ok('OK'), bad('Defect'), warn('Not yet fitted')]],
      ['stairTreads', 'Stair treads > 240 mm', OK_DEF],
      ['stairRisers', 'Stair risers < 190 mm', NA_OK_DEF],
      ['stairwellWallsPlumb', 'Stairwell walls plumb', OK_DEF],
      ['expansionJointCover', 'Expansion joint cover / trim', OK_DEF_NOTYET],
    ], STAIRS),
    { key: 'stairwellOther', type: 'textarea', label: 'Stairwell/s — other', sectionLetter: STAIRS } as Draft,
  ], stairwellOn),
  ...rows([
    ['floorsLevel', 'Floors level', OK_DEF_NA],
    ['floorSheetsCupped', 'Floor sheets cupped', [ok('No'), bad('Defect'), na('N/A')]],
    ['floorsSqueak', 'Floors squeak / bounce', [ok('No'), bad('Defect'), na('N/A')]],
    ['fixingsAdequate', 'Fixings adequate', [ok('Yes'), bad('Defect')]],
  ], FLOORS),
];

// ───────────────────────── Doors and windows ─────────────────────────

const DOORS = 'Doors';
const WINDOWS = 'Windows';
const doorsWindows: Draft[] = [
  ...check('frontDoor', 'Front door & sidelights correct', [ok('OK'), bad('Defect'), warn('Temp door only')], DOORS),
  ...check('doorFramesStraight', 'External door frames straight / plumb', OK_DEF, DOORS),
  ...check('doorsInstalled', 'External doors installed & secure', [ok('OK'), bad('Defect'), warn("Temp builder's doors")], DOORS),
  ...rows([
    ['slidingDoors', 'External sliding doors', OK_DEF],
    ['doorsFlashed', 'Doors flashed', OK_DEF],
    ['doorSizes', 'Door sizes & positions correct', OK_DEF],
    ['doorHeights', 'Door heights as per plan', OK_DEF],
    ['externalDoorsDamaged', 'External doors damaged', NO_DEF],
    ['garageDoors', 'Garage doors', [warn('Not yet'), ok('OK'), bad('Defect')]],
    ['internalDoorsFitted', 'Internal doors fitted', NOTYET_OK_DEF],
    ['doorsHungStraight', 'Doors hung straight', [warn('Off hinges for painting'), ok('OK'), bad('Defect')]],
    ['doorFramesRubbed', 'Door frames rubbed down for painter', NOTYET_OK_DEF],
    ['doorFinish', 'Finish to doors okay (sealed top & bottom)', NOTYET_OK_DEF],
    ['cavitySliders', 'Internal cavity sliders', NA_OK_DEF],
  ], DOORS),
  ...rows([
    ['windowsLevel', 'Windows level', OK_DEF],
    ['windowsStraight', 'Windows straight', OK_DEF],
    ['glazingOkay', 'Glazing okay', OK_DEF],
    ['windowSizes', 'Windows sizes & positions', OK_DEF],
    ['windowMaterial', 'Correct material', OK_DEF],
    ['opaqueAsPlan', 'Opaque as per plan', OK_DEF_NA],
    ['windowsDamaged', 'Windows damaged', OK_DEF],
    ['windowsFlashed', 'Flashed', OK_DEF],
    ['infillsFitted', 'Infills fitted', OK_DEF],
    ['doubleGlazed', 'Double glazed as per plan', OK_DEF_NA],
  ], WINDOWS),
];

// ───────────────────────── Architraves, skirtings, cabinets, painting ─────────────────────────

const ARCHS = 'Archs & skirtings';
const CABINETS = 'Cabinets & robes';
const PAINTING = 'Painting';
const COVERED: Choice[] = [ok('Roughed in'), warn('Not yet'), ok('Covered for painters')];
const fitOut: Draft[] = [
  ...rows([
    ['skirtingBoards', 'Skirting boards', [ok('OK'), bad('Defect'), warn('Not complete')]],
    ['architraves', 'Architraves', [ok('OK'), bad('Defect'), warn('Not complete')]],
    ['garageArchitraves', 'Garage architraves, skirtings', OK_DEF_NOTYET],
  ], ARCHS),
  ...rows([
    ['cabinetHeights', 'Cabinet heights & positioning', COVERED],
    ['robesFittings', 'Robes & fittings', OK_DEF_NOTYET],
    ['shelving', 'Shelving', OK_DEF_NOTYET],
    ['cabinetDoors', 'Cabinet doors & fittings', COVERED],
    ['fridgeCavity', 'Fridge cavity space as per plan (L x W x H)', OK_DEF],
    ['ovenCavity', 'Oven cavity per plan', OK_DEF],
    ['dishwasherSpace', 'Dishwasher space per plan', OK_DEF],
    ['kitchenTiling', 'Kitchen tiling / splashbacks', OK_DEF_NOTYET],
  ], CABINETS),
  ...rows([
    ['paintingStatus', 'Painting', [na('Not commenced'), warn('In progress')]],
    ['paintingFinish', 'Painting finish okay', OK_DEF],
  ], PAINTING),
  { key: 'fitOutOther', type: 'textarea', label: 'Other?', sectionLetter: PAINTING },
];

// ───────────────────────── Waterproofing ─────────────────────────

const BATH = 'Waterproofing — internals: Bathroom, ensuites, powder room';
const LAUNDRY = 'Laundry';
const BALCONY = 'Balcony waterproofing';
const balconyOn = gate('balconyWp', 'applicable');
const NO_BATH: Choice[] = [na('No bath'), warn('Not yet'), ok('OK'), bad('Defect')];
const waterproofing: Draft[] = [
  ...rows([
    ['bathWp', 'Bath WP', NO_BATH],
    ['bathHobWp', 'Bath hob WP height, junctions, air-pockets', NO_BATH],
    ['hobDamage', 'Hob damage', NA_OK_DEF],
    ['bathroomWaterstops', 'Bathroom waterstops', NOTYET_OK_DEF],
    ['showerWp', 'Shower WP', NOTYET_OK_DEF],
    ['showerWpHeight', 'Shower WP height >1800 mm than tile level of shower', OK_DEF],
    ['showerWaterstops', 'Shower waterstops', NOTYET_OK_DEF],
    ['showerFalls', 'Shower falls to drain — ratio >1:60 to 1:80', OK_DEF],
    ['showerDrainWp', 'Shower drain WP', NOTYET_OK_DEF],
    ['mainFloorWpJunctions', 'Main floor WP junctions & coverage', NOTYET_OK_DEF],
    ['mainFloorFalls', 'Main floor falls — ratio 1:80 to 1:100', NA_OK_DEF],
    ['fallsToFloorDrain', 'Falls to floor drain', NA_OK_DEF],
    ['outletsAlign', 'Shower & floor outlets align with waste pipes', OK_DEF],
    ['wpPenetrationsSealed', 'WP to penetrations sealed', NOTYET_OK_DEF],
    ['debrisDrainOutlet', 'Debris in drain outlet', NO_DEF],
    ['drainWpDamage', 'Drain WP damage', NO_DEF],
    ['screedMaterial', 'Screed material', OK_DEF],
    ['screedFalls', 'Screed formed & falls correct', OK_DEF],
    ['showerScreen', 'Shower screen installed', NOTYET_OK_DEF],
    ['bathroomCaulking', 'Caulking', NOTYET_OK_DEF],
  ], BATH),
  ...rows([
    ['laundryWpTop', 'Laundry — WP junctions, borders & coverage', NOTYET_OK_DEF],
    ['laundryWpJunctions', 'WP junctions, borders & coverage', NOTYET_OK_DEF],
    ['benchesWp', 'Benches WP junctions, borders & coverage', NOTYET_OK_DEF],
    ['laundryFloorFalls', 'Floor falls to drain', NA_OK_DEF],
    ['laundryWpFloorDrain', 'WP to floor drain', NA_NOTYET_OK_DEF],
    ['laundryWaterstops', 'Waterstops', NA_NOTYET_OK_DEF],
    ['laundryWpPenetrations', 'WP to penetrations sealed', NOTYET_OK_DEF],
    ['laundryCaulking', 'Caulking', NOTYET_OK_DEF],
    ['laundryWpDamage', 'WP damage', NO_DEF],
    ['tilingFloors', 'Tiling to floors', NOTYET_OK_DEF],
    ['tilingWalls', 'Tiling to walls', NOTYET_OK_DEF],
  ], LAUNDRY),
  ...check('balconyWp', 'Balcony waterproofing', APPLIES, BALCONY),
  ...gated(rows([
    ['balconyWpInstalled', 'WP installed', NOTYET_OK_DEF],
    ['balconyWpHeight', 'WP height, junctions & coverage, air pockets', NOTYET_OK_DEF],
    ['balconyWaterstops', 'Waterstops', [na('N/A'), ok('Yes — OK'), bad('Defect')]],
    ['balconyFalls', 'Falls away from walls — ratio 1:80 to 1:100', OK_DEF],
    ['balconyFallsDrain', 'Falls to floor drain', NA_OK_DEF],
    ['drainFittedWp', 'Drain fitted & WP', NA_OK_DEF],
    ['balconyDebris', 'Debris in drain outlet', NA_OK_DEF],
    ['balconyDrainDamage', 'Drain WP damage', OK_DEF],
    ['flashingSeals', 'Flashing / seals to door hob', NOTYET_OK_DEF],
    ['balconyPenetrations', 'WP to plumbing penetrations, sealed', NOTYET_OK_DEF],
    ['balusters', 'Balusters / walls and waterproof', [warn('Incomplete'), bad('Defect'), ok('Completed & okay')]],
    ['balconyTiling', 'Tiling', [na('N/A'), warn('Not yet'), ok('OK'), bad('Defect')]],
  ], BALCONY), balconyOn),
];

// ───────────────────────── Statement and notes ─────────────────────────

const summary: Draft[] = [
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the Fixing (Pre-paint) stage is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Statement' },
  { key: 'notesToInclude', type: 'chip-multiselect', label: 'Notes — tick any you want to add', sectionLetter: 'Notes', options: [{ value: 'ground_falls', label: 'Ground falls / water ponding at slab' }] },
  { key: 'groundFallsDetail', type: 'textarea', label: 'Advise ground falls need to be graded away from the house / footings; water is ponding at slab …', gate: { fieldKey: 'notesToInclude', equalsAny: ['ground_falls'] }, sectionLetter: 'Notes' },
  { key: 'otherConcerns', type: 'textarea', label: 'Any other concerns', sectionLetter: 'Notes' },
];

// The Lock Up & Fixing combo form repeats the Fixing stage's parts word for word.
export const FIXING_WALLS_CEILINGS = wallsCeilings;
export const FIXING_STAIRS_FLOORS = stairsFloors;
export const FIXING_DOORS_WINDOWS = doorsWindows;
export const FIXING_FIT_OUT = fitOut;
export const FIXING_WATERPROOFING = waterproofing;

export const FIXING_SECTIONS: SectionDef[] = [
  { key: 'fx_description', name: 'Description & Overview', fields: numbered(LOCK_UP_DESCRIPTION) },
  { key: 'fx_site_facilities', name: 'Site & Facilities', fields: numbered(LOCK_UP_SITE_FACILITIES) },
  { key: 'fx_walls_ceilings', name: 'Fixing Stage: Plaster, Walls & Ceilings', fields: numbered(wallsCeilings) },
  { key: 'fx_stairs_floors', name: 'Fixing Stage: Stairs & Floors', fields: numbered(stairsFloors) },
  { key: 'fx_doors_windows', name: 'Fixing Stage: Doors & Windows', fields: numbered(doorsWindows) },
  { key: 'fx_fitout', name: 'Fixing Stage: Skirtings, Cabinets & Painting', fields: numbered(fitOut) },
  { key: 'fx_waterproofing', name: 'Fixing Stage: Waterproofing', fields: numbered(waterproofing) },
  { key: 'fx_defects', name: 'Defects', fields: numbered(defectsFields) },
  { key: 'fx_summary', name: 'Statement & Notes', fields: numbered(summary) },
  { key: 'fx_previous_defects', name: 'Previous Defects', fields: numbered(LOCK_UP_PREVIOUS_DEFECTS) },
  { key: 'fx_client_issues', name: 'Client List of Issues', fields: numbered(clientIssuesFields) },
];
