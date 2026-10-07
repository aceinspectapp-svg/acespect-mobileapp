/**
 * Stage 3 -- Lock Up. Built from "Stage 3 Lock-up Inspector template, 21 May 2024", following its headings and row order
 * exactly. Section keys start with "lu_". This is a newer form than the first three stages, so its Description and Site
 * and Facilities wording differ from theirs (more cladding, windows and roof questions; different choices on some rows);
 * Defects, the previous-defects list and the client list are the same blocks as every stage.
 */
import {
  COLOR, Choice, Draft, MEAS, SectionDef, attachedListFields, bad, check, clientIssuesFields, defectsFields, na, numbered, ok, opts, warn,
} from './constructionTemplates';

// The form words its choices a few different ways; these are its exact sets.
const OK_DEF = [ok('OK'), bad('Defect')];
const NO_DEF = [ok('No'), bad('Defect')];
const NOOK_DEF = [ok('No — OK'), bad('Defect')];
const OK_DEF_NA = [ok('OK'), bad('Defect'), na('N/A')];
const NA_OK_DEF = [na('N/A'), ok('OK'), bad('Defect')];
const YESOK_DEF_NA = [ok('Yes — OK'), bad('Defect'), na('N/A')];
const SATISFACTORY = [ok('Satisfactory'), bad('Refer defects'), warn('Refer notes')];
const APPLIES = [ok('Applicable'), na('Not applicable')];
const COMPLETE: Choice[] = [ok('Yes'), warn('Part done to — ground floor only'), warn('Part done to — first floor only')];
const ROUGH_IN = [ok('Roughed in'), na('Not yet'), warn('In progress')];

const gate = (fieldKey: string, equals: string) => ({ fieldKey, equals });
const gated = (rows: Draft[], g: { fieldKey: string; equals: string }): Draft[] => rows.map((r) => ({ ...r, gate: g }));

/** Two checks that sit side by side on the form: left then right. */
type Pair = [string, string, Choice[]];
const rows = (list: Pair[], group: string): Draft[] => list.flatMap(([key, label, choices]) => check(key, label, choices, group));

// ───────────────────────── Description and overview ─────────────────────────

const CLADDING = ['Brick veneer', 'Rendered brick', 'Cement sheet', 'Concrete panels', 'Hebel', 'Weatherboards', 'Styrene foam'];
const description: Draft[] = [
  { key: 'streetPhotos', type: 'photos', label: 'Site from the street — take 4 to 6 photos', required: true },
  { key: 'elevationPhotos', type: 'photos', label: 'Sides and rear elevations' },
  { key: 'neighbourPhotos', type: 'photos', label: 'The site in relation to neighbouring properties and streetscape' },
  { key: 'constructedBy', type: 'pill-select', label: 'Constructed by', options: opts('Metricon', 'Carlisle', 'Simonds', 'Creation Homes'), allowOther: true, required: true },
  { key: 'constructionIs', type: 'pill-select', label: 'Construction is', options: opts('Single storey', 'Double storey', 'Split level'), allowOther: true, required: true },
  { key: 'foundations', type: 'pill-select', label: 'Foundations are', options: opts('Concrete slab', 'Stumps', 'Brick piers'), allowOther: true, required: true },
  {
    key: 'groundCladding', type: 'chip-multiselect', label: 'Wall cladding — Ground floor', required: true,
    options: [...opts(...CLADDING), { value: 'combination_of', label: 'Combination of' }],
  },
  { key: 'groundCladdingCombo', type: 'textarea', label: 'Ground floor — combination of …', gate: { fieldKey: 'groundCladding', equalsAny: ['combination_of'] } },
  {
    key: 'firstCladding', type: 'chip-multiselect', label: 'Wall cladding — First floor', required: true,
    options: [{ value: 'not_applicable', label: 'Not applicable', exclusive: true }, ...opts(...CLADDING), { value: 'combination_of', label: 'Combination of' }],
  },
  { key: 'firstCladdingCombo', type: 'textarea', label: 'First floor — combination of …', gate: { fieldKey: 'firstCladding', equalsAny: ['combination_of'] } },
  { key: 'windowsAre', type: 'pill-select', label: 'Windows are', options: opts('Aluminium', 'Timber', 'Mix of aluminium and timber'), allowOther: true, required: true },
  { key: 'roofDesign', type: 'pill-select', label: 'Roof design is', options: opts('Pitched', 'Flat', 'Combination of pitched and flat'), allowOther: true, required: true },
  { key: 'roofCoveringIs', type: 'pill-select', label: 'Roof covering', options: opts('Concrete tile', 'Terracotta tile', 'Colorbond', 'Zincalume', 'Kliplock decking'), allowOther: true, required: true },
  { key: 'frontage', type: 'pill-select', label: 'Street frontage is', options: opts('North', 'South', 'East', 'West'), required: true },
  { key: 'blockSlope', type: 'pill-select', label: 'Block is', options: opts('Steep sloping', 'Gently sloping', 'Mostly flat'), required: true },
  { key: 'supervisorOnSite', type: 'yesno', label: 'Supervisor on site', required: true },
  { key: 'ownersOnSite', type: 'yesno', label: 'Owners on site', required: true },
  { key: 'safetyIssues', type: 'yesno', label: 'Safety issues', required: true },
  { key: 'safetyDescribe', type: 'textarea', label: 'Describe safety issues', required: true, gate: { fieldKey: 'safetyIssues', equals: 'yes' } },
  { key: 'plansSpecs', type: 'chip-multiselect', label: 'Plans & specs', required: true, options: opts('Full set of drawings', 'Working drawings', 'Schematics', 'List of specifications', 'Limited docs') },
  { key: 'previousDefectsList', type: 'pill-select', label: 'Previous defects list attached (print or refer to it and answer every item)', required: true, options: opts('Yes', 'N/A') },
  { key: 'clientIssuesList', type: 'pill-select', label: 'Client list of issues (print or refer to it and answer every item)', required: true, options: opts('N/A', 'Yes attached') },
];

// ───────────────────────── Site and facilities ─────────────────────────

const SITE = 'Site and facilities';
const siteFacilities: Draft[] = [
  ...check('builderSign', "Builder's sign displayed", OK_DEF, SITE),
  ...check('powerSupply', 'Power supply to site', [ok('Yes'), warn('No — see notes')], SITE),
  ...check('waterSupply', 'Water supply to site', [ok('Yes'), warn('No — see notes')], SITE),
  ...check('siteToilet', 'Site toilet in position', [ok('Yes'), warn('No — see notes')], SITE),
  ...check('securityFencing', 'Security fencing in place', [ok('Yes'), warn('No — see notes')], SITE),
  ...check('rubbishDangerous', 'Rubbish dangerous on site', [ok('No'), bad('Yes')], SITE),
  ...check('siteManaged', 'Is the site well managed?', [ok('Yes'), warn('Can be improved by cleaning up rubbish for access & safety reasons')], SITE),
  ...check('kerbDamage', 'Damage to kerb / path / crossover / nature strip', [warn('Yes — see notes'), ok('No')], SITE),
  { key: 'kerbOther', type: 'textarea', label: 'Other', sectionLetter: SITE },
];

// ───────────────────────── Lock up stage: external walls ─────────────────────────

const WALLS = 'External walls — use a digital level and measuring devices and show them in the photos';
const BRICK = 'Masonry / brick work';
const brickOn = gate('masonryBrickwork', 'applicable');
const hebelOn = gate('hebelWork', 'applicable');
const boardOn = gate('boardWork', 'applicable');
const SHOW_LEVEL = 'Photo showing the digital level';

const externalWalls: Draft[] = [
  ...check('wallsComplete', 'Complete?', COMPLETE, WALLS),

  ...check('masonryBrickwork', 'Masonry / brick work', APPLIES, BRICK),
  ...gated([
    ...check('brickworkClean', 'Brickwork clean', OK_DEF, BRICK),
    ...check('brickworkPlumb', 'Brickwork plumb — show digital level', OK_DEF, BRICK, { photosAlways: SHOW_LEVEL }),
    ...check('brickworkSquare', 'Brickwork square', OK_DEF, BRICK),
    ...check('brickworkBowed', 'Brickwork bowed — show digital level', OK_DEF, BRICK, { photosAlways: SHOW_LEVEL }),
    ...rows([
      ['brickworkCracking', 'Brickwork cracking', NO_DEF],
      ['bricksCut', 'Bricks cut cleanly', OK_DEF],
      ['positionedToSlab', 'Positioned to slab correctly', OK_DEF],
      ['articulationJoints', 'Articulation joints correct', OK_DEF],
      ['brickSills', 'Brick sills within tolerances', OK_DEF],
      ['sillsShedWater', 'Sills will shed water', OK_DEF],
      ['weepHoles', 'Weep holes', OK_DEF],
      ['dampProofCourse', 'Damp proof course', OK_DEF],
      ['lintelsCorrect', 'Lintels correct', OK_DEF],
      ['wireTies', 'Wire ties correct', [warn('Not sighted'), ok('OK'), bad('Defect')]],
      ['brickReinforcing', 'Brick reinforcing correct', OK_DEF],
      ['tieDownStraps', 'Tie-down straps correct', OK_DEF],
      ['stoppingOffHeights', 'Stopping off heights correct', OK_DEF],
      ['bondingOverOpenings', 'Bonding over openings', OK_DEF],
      ['bondingAroundLintels', 'Bonding around lintels', OK_DEF],
      ['bondingWallJunctions', 'Bonding at wall junctions', OK_DEF],
      ['mortarFinish', 'Mortar finish correct — flush / rolled / raked', OK_DEF],
      ['perpEnds', 'Perp ends tolerances', OK_DEF],
      ['mortarBed', 'Mortar bed tolerances', OK_DEF],
      ['mortarVoids', 'Mortar voids', NOOK_DEF],
      ['mortarCracking', 'Mortar cracking', NO_DEF],
      ['mortarPorous', 'Mortar porous / brittle', NOOK_DEF],
      ['colourVariations', 'Colour variations', NOOK_DEF],
      ['brickRendering', 'Rendering', OK_DEF_NA],
    ], BRICK),
  ], brickOn),

  ...check('hebelWork', 'Hebel', APPLIES, 'Hebel'),
  ...gated(rows([
    ['hebelPanels', 'Panels secure & straight', OK_DEF],
    ['hebelPlumb', 'Hebel plumb', OK_DEF],
    ['hebelSquare', 'Hebel square', OK_DEF],
    ['hebelCracking', 'Hebel cracking', OK_DEF],
    ['hebelPositioned', 'Positioned to slab correctly', OK_DEF],
    ['hebelArticulation', 'Articulation joints correct', OK_DEF],
    ['hebelSills', 'Sills within tolerances', OK_DEF],
    ['hebelSillDetail', 'Sill detail correct', OK_DEF],
    ['hebelRendering', 'Rendering coverage / finish', OK_DEF_NA],
  ], 'Hebel'), hebelOn),
  ...gated([{ key: 'hebelOther', type: 'textarea', label: 'Hebel — other', sectionLetter: 'Hebel' } as Draft], hebelOn),

  ...check('boardWork', 'Blueboard, weatherboard, styrene foam, timber', APPLIES, 'Blueboard, weatherboard, styrene foam, timber'),
  ...gated(rows([
    ['blueboard', 'Blueboard secure & straight', OK_DEF_NA],
    ['metalCladding', 'Metal cladding', YESOK_DEF_NA],
    ['styreneFoam', 'Styrene foam to 2nd storey', OK_DEF_NA],
    ['boardsSecure', 'Boards secure & straight', YESOK_DEF_NA],
    ['verticalShiplap', 'Vertical shiplap boards', OK_DEF_NA],
    ['boardRendering', 'Rendering coverage', YESOK_DEF_NA],
  ], 'Blueboard, weatherboard, styrene foam, timber'), boardOn),
  ...gated([{ key: 'boardOther', type: 'textarea', label: 'Blueboard, weatherboard, styrene foam, timber — other', sectionLetter: 'Blueboard, weatherboard, styrene foam, timber' } as Draft], boardOn),
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
    ['doorsDamaged', 'External doors damaged', NO_DEF],
    ['garageDoors', 'Garage doors', [warn('Not yet'), ok('OK'), bad('Defect')]],
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

// ───────────────────────── Framework ─────────────────────────

const PLASTER = 'Plaster — rough ins done but plaster not? Check the brief and office re the Pre-plaster template';
const SERVICES = 'Services — frame exposed and no rough ins? Check fix carpenters have straightened the frame';
const FRAME = 'Frame';
const framework: Draft[] = [
  ...check('plasterComplete', 'Plaster — complete?', COMPLETE, PLASTER),
  {
    key: 'combinedInspection', type: 'yesno', label: 'Plaster completed — should this be a combined Lock up and Fixing (Pre-paint) inspection?', required: true,
    gate: { fieldKey: 'plasterComplete', equals: 'yes' }, sectionLetter: PLASTER,
  },
  ...check('plumbing', 'Plumbing', ROUGH_IN, SERVICES),
  ...check('electrical', 'Electrical', ROUGH_IN, SERVICES),
  ...check('gas', 'Gas', ROUGH_IN, SERVICES),
  ...check('heatCoolDucting', 'Heat-Cool ducting', ROUGH_IN, SERVICES),
  ...rows([
    ['studsOkay', 'Studs okay', OK_DEF],
    ['beamsBearers', 'Beams / Bearers', OK_DEF],
    ['floorPlates', 'Floor plates', OK_DEF],
    ['floorPlatesFixed', 'Floor plates fixed correctly', OK_DEF],
    ['topPlates', 'Top plates', OK_DEF],
    ['noggins', 'Noggins okay', OK_DEF],
    ['lintelsOkay', 'Lintels okay', OK_DEF],
    ['wallsPlumb', 'Walls plumb', OK_DEF],
    ['framesStraightened', 'Frames straightened', OK_DEF],
    ['ceilingsStraight', 'Ceilings straight', OK_DEF],
    ['bulkheads', 'Bulkheads level, straight', OK_DEF],
    ['blockingCorners', 'Blocking to corners', OK_DEF],
    ['sisalation', 'Sisalation fitted', OK_DEF],
    ['framesClean', 'Frames clean', OK_DEF],
    ['damageToFrame', 'Damage to frame', NOOK_DEF],
    ['roofFrameConcerns', 'Roof frame concerns', NOOK_DEF],
  ], FRAME),
];

// ───────────────────────── Roofing ─────────────────────────

const ROOF = 'Roof covering, flashings — use a digital level and measuring devices, show them in the photos';
const GUTTERS = 'Gutters and downpipes';
const roofing: Draft[] = [
  ...check('roofingComplete', 'Roofing — complete?', COMPLETE, ROOF),
  ...check('upperRoofFrom', 'Upper roof covering inspected from (double storey: is there safe access to the roof from scaffolding?)', [na('N/A'), ok('Scaffold'), warn('Ground only')], ROOF),
  ...check('upperRoofAppears', 'Upper roof — generally appears to be', SATISFACTORY, ROOF),
  ...check('lowerRoofLadder', 'Lower level roof covering inspected from ladder', SATISFACTORY, ROOF),
  ...rows([
    ['roofLineStraight', 'Roof line straight', OK_DEF],
    ['roofFlashing', 'Roof flashing', OK_DEF],
    ['parapetFlashing', 'Parapet flashing / capping', NA_OK_DEF],
    ['valleyIrons', 'Valley irons', OK_DEF],
    ['ridgesStrapped', 'Ridges strapped metal roof', NA_OK_DEF],
    ['roofScrewsCentres', 'Roof screws correct centres', NA_OK_DEF],
    ['metalSheets', 'Metal sheets correctly overlapped & straight', NA_OK_DEF],
    ['flatRoofFall', 'Flat roof fall >2 degrees', NA_OK_DEF],
    ['screwSpaced', 'Screw spaced correctly', NO_DEF],
    ['grommets', 'Grommets not squashed', NO_DEF],
    ['roofDented', 'Roof dented / scratched', NO_DEF],
    ['sarking', 'Sarking to roof', NA_OK_DEF],
    ['pitched', 'Pitched ~ 22.5 degrees', NA_OK_DEF],
    ['tilesCracked', 'Tiles cracked, broken', OK_DEF],
    ['tilesCutValleys', 'Tiles cut clean to valleys', OK_DEF],
    ['ridgeTiles', 'Ridge tiles correct', OK_DEF],
    ['tilesSeated', 'Tiles seated — no gaps', OK_DEF],
    ['flashingsToTiles', 'Flashings to tiles — no gaps', OK_DEF],
    ['flashingsParapets', 'Flashings to parapets', OK_DEF],
    ['gableDetails', 'Gable details correct', OK_DEF_NA],
    ['swarf', 'Swarf on roof', OK_DEF],
    ['pipePenetrations', 'Pipe penetrations flashed', OK_DEF],
    ['verges', 'Verges correct', NA_OK_DEF],
    ['roofVentilators', 'Roof ventilators correct', OK_DEF],
    ['fasciasStraight', 'Fascias straight', OK_DEF],
    ['fasciaCorners', 'Fascia corners secured', OK_DEF],
  ], ROOF),
  ...check('safeAccessGuttering', 'Did you have safe access to upper guttering?', [ok('Yes'), warn('No — see next line')], GUTTERS),
  ...gated(check('upperGutteringGround', 'If No, observations from the ground indicate upper guttering is', [ok('Satisfactory'), ok('OK'), bad('Defect'), warn('Refer notes')], GUTTERS), gate('safeAccessGuttering', 'no_see_next_line')),
  ...check('lowerGutteringLadder', 'Lower level guttering inspected from ladder is', [ok('OK'), bad('Defect'), warn('Refer notes')], GUTTERS),
  ...rows([
    ['guttersFitted', 'Gutters fitted & clipped', OK_DEF],
    ['gutterFall', 'Gutter fall to downpipes', OK_DEF],
    ['roofOverhang', 'Roof overhang at gutters within tolerances', OK_DEF],
    ['debrisGutters', 'Debris in gutters', [ok('No'), bad('Yes — defect')]],
    ['guttersHoldingWater', 'Gutters holding water >10 mm deep', NO_DEF],
    ['downpipePositions', 'Downpipes correct positions', OK_DEF],
    ['downpipeSpacing', 'Downpipes correct spacing (approx 12 m)', OK_DEF],
    ['downpipeSocks', 'Temporary downpipe socks fitted', OK_DEF_NA],
    ['boxGutters', 'Box gutters as specified', OK_DEF],
    ['rainheads', 'Rainheads as specified', OK_DEF],
    ['guttersFasciasStraight', 'Fascias straight', OK_DEF],
    ['guttersFasciaCorners', 'Fascia corners secured', OK_DEF],
  ], GUTTERS),
];

// ───────────────────────── Statement, notes, previous defects ─────────────────────────

const summary: Draft[] = [
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the Lock up stage is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Statement' },
  { key: 'notesToInclude', type: 'chip-multiselect', label: 'Notes — tick any you want to add', sectionLetter: 'Notes', options: [{ value: 'ground_falls', label: 'Ground falls / water ponding at slab' }] },
  { key: 'groundFallsDetail', type: 'textarea', label: 'Advise ground falls need to be graded away from the house / footings; water is ponding at slab …', gate: { fieldKey: 'notesToInclude', equalsAny: ['ground_falls'] }, sectionLetter: 'Notes' },
  { key: 'otherConcerns', type: 'textarea', label: 'Any other concerns', sectionLetter: 'Notes' },
];

const previousDefects: Draft[] = attachedListFields({
  key: 'previousDefects',
  label: 'Attach the previous stage Defects list with updates',
  updatesLabel: 'Status next to each previous report defect — "Done and satisfactory", "Not done" or "Could not inspect due to …"',
  photosLabel: 'The previous stage Defects list (photos)',
});

// The Fixing form's header, Description, Site and Facilities and previous-defects block are word for word the same.
export const LOCK_UP_DESCRIPTION = description;
export const LOCK_UP_SITE_FACILITIES = siteFacilities;
export const LOCK_UP_PREVIOUS_DEFECTS = previousDefects;

export const LOCK_UP_SECTIONS: SectionDef[] = [
  { key: 'lu_description', name: 'Description & Overview', fields: numbered(description) },
  { key: 'lu_site_facilities', name: 'Site & Facilities', fields: numbered(siteFacilities) },
  { key: 'lu_external_walls', name: 'Lock Up Stage: External Walls', fields: numbered(externalWalls) },
  { key: 'lu_doors_windows', name: 'Lock Up Stage: Doors & Windows', fields: numbered(doorsWindows) },
  { key: 'lu_framework', name: 'Lock Up Stage: Framework', fields: numbered(framework) },
  { key: 'lu_roofing', name: 'Lock Up Stage: Roofing', fields: numbered(roofing) },
  { key: 'lu_defects', name: 'Defects', fields: numbered(defectsFields) },
  { key: 'lu_summary', name: 'Statement & Notes', fields: numbered(summary) },
  { key: 'lu_previous_defects', name: 'Previous Defects', fields: numbered(previousDefects) },
  { key: 'lu_client_issues', name: 'Client List of Issues', fields: numbered(clientIssuesFields) },
];

void COLOR;
void MEAS;
