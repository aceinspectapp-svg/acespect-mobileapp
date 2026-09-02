// Builds every Dilapidation × Commercial Properties section template from the
// "HOUSPECT VIC Dilapidation Industrial / Commercial Structures — Inspector
// Template (Std) 1 May 2024" source PDF.
//
// Navigation over scrolling, everywhere it earns its keep:
//   * Any section with a fixed set of repeated subjects (4 paving sides, 4
//     fences, 4 elevations, the 10 office/staff areas, the free-standing
//     structures) uses `repeat.collapsible` -- a numbered checklist with a
//     progress bar, each row opening its own full-screen form.
//   * Internal is split by `layout.mode = 'section-nav'` into General,
//     Warehouse, Production, Hardstand & Floors and Roof Underside, so the
//     inspector taps into one at a time instead of scrolling four blocks.
//   * Offices & Staff Facilities is served out of the (otherwise unused for
//     commercial) `pool_spa` slot as its own top-level section rather than
//     nesting inside Internal -- that keeps every drill-down one modal deep.
// Commercial damage vocabularies differ from residential and from each other:
// external is Crack/subsidence/gap/hole/chipping, warehouse and office areas
// are Crack/gap/stains, and hardstand/roof-frame damage is located by aisle
// number rather than by free text.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'commercial_properties';

type Field = Omit<TemplateField, 'order'>;

function mkOpts(labels: string[]): TemplateFieldOption[] {
  const seen = new Set<string>();
  return labels.map((label) => {
    let value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'opt';
    let n = 2;
    while (seen.has(value)) value = `${value.slice(0, 57)}_${n++}`;
    seen.add(value);
    return { value, label };
  });
}
const opts = (...labels: string[]) => mkOpts(labels);

function numbered(fields: Field[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Field[]) : undefined,
  }));
}

const RUNS = () => ({ key: 'direction', type: 'pill-select' as const, label: 'Runs', options: opts('Vertical', 'Diagonal', 'Horizontal') });
const SIZE = (): Field[] => [
  { key: 'widthMm', type: 'numeric', label: 'Width', unit: 'mm' },
  { key: 'lengthMm', type: 'numeric', label: 'Length', unit: 'mm' },
  { key: 'notes', type: 'textarea', label: 'Notes' },
  { key: 'photos', type: 'photos', label: 'Pics' },
];

/** External fabric: Crack / subsidence / gap / hole / chipping, free-text location. */
function externalDamages(label = 'Cracking / gaps / other deterioration — note the 2 or 3 most significant items'): Field {
  return {
    key: 'damages', type: 'damage-list', label,
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect' },
    itemFields: numbered([
      { key: 'location', type: 'text', label: 'Damage location' },
      { key: 'damageType', type: 'pill-select', label: 'Description', options: opts('Crack', 'Subsidence', 'Gap', 'Hole', 'Chipping') },
      RUNS(), ...SIZE(),
    ]),
  };
}

/** Warehouse / production / office interiors: Crack / gap / stains against a named element. */
function interiorDamages(locationOptions: string[], label = 'Damage — the most significant items are'): Field {
  return {
    key: 'damages', type: 'damage-list', label,
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect' },
    itemFields: numbered([
      { key: 'location', type: 'pill-select', label: 'Location', options: opts(...locationOptions) },
      { key: 'locationDetail', type: 'text', label: 'Location detail' },
      { key: 'damageType', type: 'pill-select', label: 'Description', options: opts('Crack', 'Gap', 'Stains') },
      RUNS(), ...SIZE(),
    ]),
  };
}

/** Hardstand and roof frame: the PDF locates damage by aisle / painted marking. */
function aisleDamages(label: string): Field {
  return {
    key: 'damages', type: 'damage-list', label,
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect' },
    itemFields: numbered([
      { key: 'location', type: 'text', label: 'Aisle No / painted marking' },
      { key: 'damageType', type: 'pill-select', label: 'Description', options: opts('Crack', 'Gap', 'Stains') },
      RUNS(), ...SIZE(),
    ]),
  };
}

/** The three fabric rows the PDF repeats under the garage and every elevation. */
function fabricBlocks(gate?: TemplateField['gate']): Field[] {
  return [
    { key: 'cladding', type: 'chip-multiselect', label: 'Cladding', options: opts('Paint is weathered', 'Paint is flaking from sections', 'Timber is cracked', 'Decay to some boards'), gate },
    { key: 'claddingPhotos', type: 'photos', label: 'Cladding pics', gate },
    { key: 'windowsDoors', type: 'chip-multiselect', label: 'Windows / Doors', options: opts('Paint flaking from timber', 'Gaps at windows & cladding', 'Decay to some frames or sashes', 'Broken glazing', 'Door delaminating'), gate },
    { key: 'windowsDoorsPhotos', type: 'photos', label: 'Windows / Doors pics', gate },
    { key: 'downpipesGutters', type: 'chip-multiselect', label: 'Downpipes / gutters', options: opts('Rusted', 'Sagging or loose', 'Not connected to stormwater system'), gate },
    { key: 'downpipesGuttersPhotos', type: 'photos', label: 'Downpipes / gutters pics', gate },
  ];
}

const YES = { fieldKey: 'present', equals: 'yes' };
const SIDES = [
  { key: 'front', label: 'Front' }, { key: 'left', label: 'Left' },
  { key: 'rear', label: 'Rear' }, { key: 'right', label: 'Right' },
];

/** One interior area block (warehouse, production, an office room). */
function areaFields(locationOptions: string[], floorLevels: string[]): Field[] {
  return [
    { key: 'floorLevel', type: 'pill-select', label: 'Level', options: opts(...floorLevels) },
    { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Shelving', 'Bench', 'Equipment / machinery', 'Pallets', 'Stored goods', 'Other') },
    { key: 'generalCondition', type: 'pill-select', label: 'General condition', options: opts('Satisfactory with typical wear and tear', 'Fair', 'Poor', 'New', 'Other') },
    { key: 'damageSummary', type: 'pill-select', label: 'Damage overview', options: opts('No visible significant damage', 'Several minor gaps and cracks', 'Multiple items of damage throughout') },
    { key: 'photos', type: 'photos', label: 'Pic seq' },
    interiorDamages(locationOptions),
    { key: 'notes', type: 'textarea', label: 'Notes' },
  ];
}

/** Prefix a block's keys and tag it with its section-nav group. */
function grouped(prefix: string, letter: string, fields: Field[]): Field[] {
  return fields.map((f) => ({ ...f, key: `${prefix}${f.key}`, sectionLetter: letter }));
}

const OFFICE_LOCATIONS = ['Window', 'Door', 'Floor', 'Ceiling', 'Wall', 'Arches'];
const LEVELS = ['Ground floor', '1st floor', '2nd floor', 'Mezzanine'];

const SECTIONS: Record<string, { name: string; fields: Field[]; layout?: object }> = {
  // PDF page 1 — job header.
  'job-info': {
    name: 'Job Information',
    fields: [
      { key: 'jobNumber', type: 'text', label: 'Job No' },
      { key: 'inspectionDate', type: 'date', label: 'Inspection Date' },
      { key: 'assignedInspector', type: 'text', label: 'Inspector initials' },
      { key: 'clientName', type: 'text', label: 'Client name' },
      { key: 'inspectionAddress', type: 'text', label: 'Inspection Address' },
      { key: 'businessName', type: 'text', label: 'Business name / signage' },
      {
        key: 'weather', type: 'select-tiles', label: 'Weather',
        options: [
          { value: 'overcast', label: 'Overcast', icon: 'cloudy-outline' },
          { value: 'dry', label: 'Dry', icon: 'thermometer-outline' },
          { value: 'sunny', label: 'Sunny', icon: 'sunny-outline' },
          { value: 'intermittent_showers', label: 'Intermittent showers', icon: 'partly-sunny-outline' },
          { value: 'rain', label: 'Rain', icon: 'rainy-outline' },
          { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
        ],
      },
    ],
  },

  // PDF page 1 — description & overview + scope, safety and limitations.
  description: {
    name: 'Description & Overview',
    fields: [
      { key: 'businessSignagePhotos', type: 'photos', label: 'Business name & signage pics', sectionLetter: 'Property & Project Site Overview' },
      { key: 'streetViews', type: 'photos', label: 'Street views (4–6 pics) — front of property, street number, project site, neighbours', sectionLetter: 'Property & Project Site Overview' },

      { key: 'constructionIs', type: 'chip-multiselect', label: 'Construction is', options: opts('Retail shop', 'Warehouse', 'Factory', 'Office & distribution complex', 'School', 'Church', 'Hospital', 'Other'), sectionLetter: 'Property Description' },
      { key: 'constructedYear', type: 'text', label: 'Constructed — year or decade', sectionLetter: 'Property Description' },
      { key: 'underConstructionStage', type: 'text', label: 'Or under construction at stage', sectionLetter: 'Property Description' },
      { key: 'streetFrontage', type: 'pill-select', label: 'Street frontage', options: opts('North', 'South', 'East', 'West'), sectionLetter: 'Property Description' },
      { key: 'blockSlope', type: 'pill-select', label: 'The block is', options: opts('Steep sloping', 'Gently sloping', 'Mostly flat'), sectionLetter: 'Property Description' },
      { key: 'wallCladdingGround', type: 'chip-multiselect', label: 'Wall cladding — Ground floor', options: opts('Concrete panels', 'Hebel', 'Brick', 'Metal', 'Combo of'), sectionLetter: 'Property Description' },
      { key: 'wallCladdingFirst', type: 'chip-multiselect', label: 'Wall cladding — First floor', options: opts('Not applicable', 'Concrete panels', 'Hebel', 'Brick', 'Metal', 'Combo of'), sectionLetter: 'Property Description' },
      { key: 'foundations', type: 'pill-select', label: 'Foundations', options: opts('Concrete slab', 'Other'), sectionLetter: 'Property Description' },
      { key: 'roofDesign', type: 'pill-select', label: 'Roof design', options: opts('Pitched', 'Flat', 'Combo of pitched and flat', 'Other'), sectionLetter: 'Property Description' },
      { key: 'roofCovering', type: 'chip-multiselect', label: 'Roof covering', options: opts('Tile', 'Colorbond', 'Zincalume', 'Kliplock decking', 'Mix of'), sectionLetter: 'Property Description' },
      { key: 'windows', type: 'pill-select', label: 'Windows are', options: opts('Aluminium', 'Timber', 'Mix of aluminium and timber', 'Steel', 'Other'), sectionLetter: 'Property Description' },

      { key: 'proposedWorksType', type: 'pill-select', label: 'The proposed works are to', options: opts('Residential property', 'Development site', 'Road', 'Pipeline', 'Rail line', 'Bridge', 'New housing estate', 'Other'), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'projectSiteAddress', type: 'text', label: 'Project site address', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'siteSide', type: 'pill-select', label: 'In relation to the property inspected is to the', options: opts('Left-hand side', 'Right-hand side', 'Rear', 'Front'), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'siteDirection', type: 'pill-select', label: 'Which is approximately', options: opts('North', 'East', 'South', 'West', 'NE', 'NW', 'SE', 'SW'), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeForInspection', type: 'chip-multiselect', label: 'Scope for inspection — confirm on day of inspection', options: opts('External and internal to all structures', 'External & internal to part of property', 'Internal only to', 'External only to'), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeDetail', type: 'text', label: 'If part / internal only / external only — specify where', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeChanges', type: 'textarea', label: 'Changes to scope?', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeLimitations', type: 'yesno', label: 'Any limitations to scope?', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeLimitationsNotes', type: 'textarea', label: 'If yes, describe', gate: { fieldKey: 'scopeLimitations', equals: 'yes' }, sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'safetyIssues', type: 'yesno', label: 'Any safety issues?', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'safetyIssuesNotes', type: 'textarea', label: 'If yes, describe', gate: { fieldKey: 'safetyIssues', equals: 'yes' }, sectionLetter: 'Scope, Safety and Limitations' },
    ],
  },

  // PDF page 1–2 — Driveway.
  driveway: {
    name: 'Driveway',
    fields: [
      { key: 'present', type: 'yesno', label: 'Is there a driveway?' },
      { key: 'locatedAt', type: 'pill-select', label: 'Located at', options: opts('Front left', 'Front right', 'Rear', 'Side', 'Semi-circle with 2 entries/exits'), gate: YES },
      { key: 'material', type: 'pill-select', label: 'Material', options: opts('Concrete', 'Pavers', 'Asphalt', 'Gravel', 'Other'), gate: YES },
      { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory with typical wear and tear', 'Fair', 'Average', 'Poor', 'New'), gate: YES },
      { key: 'crackingSummary', type: 'pill-select', label: 'Cracking overview', options: opts('No visible significant cracking', 'Several minor cracks', 'Numerous cracking throughout'), gate: YES },
      { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Parked cars / trailer / caravan', 'Stored goods', 'Other'), gate: YES },
      { key: 'photos', type: 'photos', label: 'Pic seq', gate: YES },
      { ...externalDamages(), gate: YES },
      { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
    ],
  },

  // PDF page 2 — Paving / Car park, four sides.
  paving_paths: {
    name: 'Paving / Car Park',
    fields: [
      {
        key: 'areas', type: 'repeating-group', label: 'Paving / car park by side',
        repeat: { presentation: 'fixed-tabs', collapsible: true, itemNoun: 'side', titleFieldKey: 'areaName', fixedInstances: SIDES },
        itemFields: numbered([
          { key: 'areaName', type: 'text', label: 'Rename this area (optional)' },
          { key: 'present', type: 'yesno', label: 'Is there paving / car park to this side?' },
          { key: 'material', type: 'chip-multiselect', label: 'Material', options: opts('Concrete', 'Pavers', 'Gravel', 'Grass only'), gate: YES },
          { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory', 'Fair', 'Average', 'Poor', 'Good in relation to its age'), gate: YES },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other'), gate: YES },
          { key: 'photos', type: 'photos', label: 'Pics', gate: YES },
          { ...externalDamages(), gate: YES },
          { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
        ]),
      },
    ],
  },

  // PDF page 2–4 — Fences, four sides.
  fences: {
    name: 'Fences',
    fields: [
      {
        key: 'items', type: 'repeating-group',
        label: 'Fences (note only worst items — decayed posts and railings, rusted posts, leaning, missing palings)',
        repeat: { presentation: 'fixed-tabs', collapsible: true, itemNoun: 'fence', titleFieldKey: 'fenceName', fixedInstances: SIDES },
        itemFields: numbered([
          { key: 'fenceName', type: 'text', label: 'Rename this fence (optional)' },
          { key: 'present', type: 'yesno', label: 'Is there a fence to this side?' },
          { key: 'material', type: 'chip-multiselect', label: 'Material', options: opts('Timber pickets', 'Timber palings', 'Brick', 'Gal steel post & mesh wire', 'Metal sheets', 'Other'), gate: YES },
          { key: 'condition', type: 'chip-multiselect', label: 'Condition', options: opts('Satisfactory with typical weathering and some gaps', 'Decayed', 'Loose or missing palings', 'Leaning', 'Fair', 'Average', 'Poor'), gate: YES },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other'), gate: YES },
          { key: 'worstItem', type: 'textarea', label: 'Damage — describe worst item', gate: YES },
          { key: 'photos', type: 'photos', label: 'Pics', gate: YES },
          { ...externalDamages('Additional damage records (optional)'), gate: YES },
        ]),
      },
    ],
  },

  // PDF page 4 — Retaining walls.
  retaining_walls: {
    name: 'Retaining Walls',
    fields: [
      { key: 'present', type: 'yesno', label: 'Are there any retaining walls?' },
      {
        key: 'items', type: 'repeating-group', label: 'Retaining walls', gate: YES,
        repeat: { presentation: 'strip', addable: true, collapsible: true, itemNoun: 'wall', addButtonLabel: 'Add retaining wall', titleFieldKey: 'wallName' },
        itemFields: numbered([
          { key: 'wallName', type: 'text', label: 'Name this wall (optional)' },
          { key: 'location', type: 'pill-select', label: 'Location', options: opts('Left', 'Right', 'Rear', 'Front') },
          { key: 'materials', type: 'chip-multiselect', label: 'Materials', options: opts('Brick', 'Gal steel post & sleepers', 'Timber sleepers', 'Other') },
          { key: 'condition', type: 'chip-multiselect', label: 'Condition', options: opts('Satisfactory with typical weathering and some gaps', 'Decayed', 'Leaning', 'Fair', 'Average', 'Poor') },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other') },
          { key: 'worstItem', type: 'textarea', label: 'Damage — describe worst item' },
          { key: 'photos', type: 'photos', label: 'Pics' },
          externalDamages('Additional damage records (optional)'),
        ]),
      },
    ],
  },

  // PDF page 4 — Garage + any other free-standing structures (sheds, loading dock).
  garage_carport_sheds: {
    name: 'Garage & Other Structures',
    fields: [
      {
        key: 'structures', type: 'repeating-group', label: 'Structures',
        repeat: {
          presentation: 'fixed-tabs', collapsible: true, addable: true, itemNoun: 'structure',
          addButtonLabel: 'Add structure', titleFieldKey: 'structureName',
          fixedInstances: [
            { key: 'garage', label: 'Garage' },
            { key: 'sheds', label: 'Shed/s' },
            { key: 'loading_dock', label: 'Loading dock' },
          ],
        },
        itemFields: numbered([
          { key: 'structureName', type: 'text', label: 'Rename this structure (optional)' },
          { key: 'present', type: 'yesno', label: 'Present on site?' },
          { key: 'attachment', type: 'pill-select', label: 'Attachment', options: opts('Basement', 'Separate to building'), gate: YES },
          { key: 'position', type: 'pill-select', label: 'Position', options: opts('Left', 'Right', 'Rear', 'Front'), gate: YES },
          { key: 'walls', type: 'chip-multiselect', label: 'Walls', options: opts('Brick', 'Metal', 'Fibre cement', 'Concrete panel', 'Basement'), gate: YES },
          { key: 'wallsCondition', type: 'color-select', label: 'Condition', options: opts('Satisfactory condition with typical wear and tear', 'Fair', 'Average', 'Poor', 'New', 'Other'), gate: YES },
          { key: 'roof', type: 'chip-multiselect', label: 'Roof', options: opts('Metal', 'Colorbond', 'Tiles', 'Fibre cement', 'Not applicable as basement'), gate: YES },
          { key: 'floor', type: 'chip-multiselect', label: 'Floor', options: opts('Concrete hardstand', 'Pavers', 'Gravel'), gate: YES },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections of walls and floor obscured by', options: opts('Shelving', 'Stored goods', 'Parked car/s', 'Parked vehicles', 'Other'), gate: YES },
          { key: 'photos', type: 'photos', label: 'Pic seq', gate: YES },
          { ...externalDamages(), gate: YES },
          ...fabricBlocks(YES),
          { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
        ]),
      },
    ],
  },

  // PDF page 4–6 — MAIN STRUCTURE, the four elevations.
  elevations: {
    name: 'Elevations',
    fields: [
      {
        key: 'sides', type: 'repeating-group', label: 'Main structure elevations',
        repeat: { presentation: 'fixed-tabs', collapsible: true, itemNoun: 'elevation', titleFieldKey: 'elevationName', fixedInstances: SIDES },
        itemFields: numbered([
          { key: 'elevationName', type: 'text', label: 'Rename this elevation (optional)' },
          { key: 'orientation', type: 'pill-select', label: 'Orientation', options: opts('North', 'South', 'East', 'West', 'Other') },
          { key: 'partyWall', type: 'yesno', label: 'Party wall abutting next property?' },
          { key: 'partyWallNumber', type: 'text', label: 'Abutting property number — could not be inspected', gate: { fieldKey: 'partyWall', equals: 'yes' } },
          { key: 'partialInspection', type: 'chip-multiselect', label: 'Could only be partly inspected to the', options: opts('Front', 'Rear', 'Side', 'To parapet above the roof line', 'Other') },
          { key: 'condition', type: 'color-select', label: 'General condition', options: opts('Satisfactory condition with typical wear and tear', 'Fair', 'Average', 'Poor') },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Appliances', 'Trailer', 'Caravan', 'Sheds', 'Stored goods', 'Other') },
          { key: 'damageSummary', type: 'pill-select', label: 'Damage overview', options: opts('No visible significant damage', 'Several minor gaps and cracks', 'Multiple items of damage throughout') },
          { key: 'photos', type: 'photos', label: 'Pic seq' },
          externalDamages(),
          ...fabricBlocks(),
          { key: 'notes', type: 'textarea', label: 'Notes' },
        ]),
      },
    ],
  },

  // PDF page 7 — Roof covering & chimneys, one block (no upper/lower split).
  roof_chimneys: {
    name: 'Roof & Chimneys',
    fields: [
      {
        key: 'inspectionStatus', type: 'chip-multiselect', label: 'Inspection status / limitations',
        options: opts('Could not observe due to flat roof', 'No chimney/s', 'Limited observations from ground level using camera zoom', 'Inspected from ladder'),
      },
      { key: 'coveringType', type: 'chip-multiselect', label: 'Roof covering', options: opts('Tile', 'Colorbond', 'Zincalume', 'Kliplock decking', 'Mix of') },
      {
        key: 'generalCondition', type: 'chip-multiselect', label: 'General condition',
        options: opts('Satisfactory to fair with typical weathering', 'Some surface rust', 'Gaps at flashings', 'Gaps / cracking to chimney brickwork', 'Chimney appears unstable'),
      },
      { key: 'photos', type: 'photos', label: 'Pics' },
      externalDamages('Damage records (optional)'),
      { key: 'notes', type: 'textarea', label: 'Notes' },
    ],
  },

  // PDF page 8 — Internal: general, warehouse, production, hardstand, roof underside.
  internal_areas: {
    name: 'Warehouse & Production',
    layout: {
      mode: 'section-nav',
      groups: [
        { letter: 'General', icon: '📋', hint: 'Renovations, safety advisories, access, movement' },
        { letter: 'Warehouse Area', icon: '🏭', hint: 'Walls, windows and doors' },
        { letter: 'Production Area', icon: '⚙️', hint: 'Walls, windows and doors' },
        { letter: 'Hardstand & Floors', icon: '🧱', hint: 'Floors located by aisle number' },
        { letter: 'Roof Underside & Frame', icon: '🔩', hint: 'Covering, frame, water stains' },
      ],
    },
    fields: [
      ...grouped('gen_', 'General', [
        { key: 'renovationsInProgress', type: 'yesno', label: 'Renovations in progress?' },
        { key: 'renovationsRooms', type: 'textarea', label: 'Which rooms / area?', gate: { fieldKey: 'gen_renovationsInProgress', equals: 'yes' } },
        { key: 'renovationsPhotos', type: 'photos', label: 'Renovation pics', gate: { fieldKey: 'gen_renovationsInProgress', equals: 'yes' } },
        { key: 'safetyAdvisories', type: 'yesno', label: 'Safety advisories to owner?' },
        { key: 'safetyAdvisoryTypes', type: 'chip-multiselect', label: 'Safety advisory', options: opts('Exposed electrical cables', 'Leaking gas odour', 'Other'), gate: { fieldKey: 'gen_safetyAdvisories', equals: 'yes' } },
        { key: 'safetyAdvisoryNotes', type: 'textarea', label: 'Describe', gate: { fieldKey: 'gen_safetyAdvisories', equals: 'yes' } },
        { key: 'roomsNotAccessed', type: 'textarea', label: 'Any rooms not accessed — which rooms & why no access?' },
        { key: 'movementObserved', type: 'yesno', label: 'Bouncy floors / sloping floors / binding doors & windows — anything indicating movement?' },
        { key: 'movementWhere', type: 'textarea', label: 'Where? Describe issues', gate: { fieldKey: 'gen_movementObserved', equals: 'yes' } },
      ]),
      ...grouped('wh_', 'Warehouse Area', areaFields(['Wall', 'Window', 'Door'], LEVELS)),
      ...grouped('prod_', 'Production Area', areaFields(['Wall', 'Window', 'Door'], LEVELS)),
      ...grouped('hard_', 'Hardstand & Floors', [
        { key: 'floorLevel', type: 'pill-select', label: 'Level', options: opts(...LEVELS) },
        { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Shelving', 'Bench', 'Equipment / machinery', 'Pallets', 'Stored goods', 'Other') },
        { key: 'generalCondition', type: 'pill-select', label: 'General condition', options: opts('Satisfactory with typical wear and tear', 'Fair', 'Poor', 'New', 'Other') },
        { key: 'damageSummary', type: 'pill-select', label: 'Damage overview', options: opts('No visible significant damage', 'Several minor gaps and cracks', 'Multiple items of damage throughout') },
        { key: 'photos', type: 'photos', label: 'Pic seq' },
        aisleDamages('Damage — use aisle numbers or painted markings to locate'),
        { key: 'notes', type: 'textarea', label: 'Notes' },
      ]),
      ...grouped('roofin_', 'Roof Underside & Frame', [
        { key: 'coveringOf', type: 'chip-multiselect', label: 'Covering of', options: opts('Kliplock', 'Corrugated metal', 'Other') },
        { key: 'sarking', type: 'yesno', label: 'Sections obscured by sarking' },
        { key: 'frameOf', type: 'pill-select', label: 'Frame of', options: opts('Steel', 'Timber') },
        { key: 'generalCondition', type: 'pill-select', label: 'General condition', options: opts('Satisfactory and in typical condition', 'Fair', 'Poor', 'New', 'Other') },
        { key: 'damageSummary', type: 'chip-multiselect', label: 'Observations', options: opts('Water stains', 'Cracks and gaps', 'Items of damage throughout') },
        { key: 'photos', type: 'photos', label: 'Pic seq' },
        aisleDamages('Most significant items — use aisle numbers to locate'),
        { key: 'notes', type: 'textarea', label: 'Notes' },
      ]),
    ],
  },

  // PDF page 10–12 — Offices and staff facilities. Its own section (rather than
  // a fifth group inside Internal) so each area is still just one tap deep.
  pool_spa: {
    name: 'Offices & Staff Facilities',
    fields: [
      {
        key: 'areas', type: 'repeating-group',
        label: 'Areas — look up at ceilings for water stains and gaps, and down at floor coverings and skirts',
        repeat: {
          presentation: 'fixed-tabs', collapsible: true, addable: true, itemNoun: 'area',
          addButtonLabel: 'Add area', titleFieldKey: 'areaName',
          fixedInstances: [
            { key: 'reception_foyer', label: 'Reception / Foyer' },
            { key: 'offices', label: 'Offices' },
            { key: 'board_room', label: 'Board room' },
            { key: 'meeting_room_1', label: 'Meeting room 1' },
            { key: 'meeting_room_2', label: 'Meeting room 2' },
            { key: 'staff_rooms_kitchens', label: 'Staff rooms / kitchens' },
            { key: 'wc_male_female', label: 'WC Male / Female' },
            { key: 'stairs_landing', label: 'Stairs / stairwell / Landing' },
            { key: 'storerooms', label: 'Storerooms' },
            { key: 'other_area', label: 'Other area' },
          ],
        },
        itemFields: numbered([
          { key: 'areaName', type: 'text', label: 'Area name (leave blank to keep the standard name)' },
          { key: 'present', type: 'yesno', label: 'Present / inspected?' },
          { key: 'floorLevel', type: 'pill-select', label: 'Level', options: opts(...LEVELS), gate: YES },
          { key: 'generalCondition', type: 'pill-select', label: 'General condition', options: opts('Satisfactory and in typical condition', 'Fair', 'Poor', 'New', 'Other'), gate: YES },
          { key: 'damageSummary', type: 'pill-select', label: 'Damage overview', options: opts('No visible significant damage', 'Several minor cracks and gaps', 'Items of damage throughout'), gate: YES },
          { key: 'photos', type: 'photos', label: 'Pic seq', gate: YES },
          { ...interiorDamages(OFFICE_LOCATIONS), gate: YES },
          { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
        ]),
      },
    ],
  },

  // PDF page 12 — Notes. No balcony item in the commercial set.
  notes: {
    name: 'Notes / Post Project / Defects',
    fields: [
      { key: 'postProject', type: 'yesno', label: 'Post project? (if yes, use the previous report and update every item with new pics)' },
      {
        key: 'movement', type: 'repeating-group', label: 'Movement / safety checklist',
        repeat: {
          presentation: 'checklist',
          fixedInstances: [
            { key: 'bouncy_floors', label: 'Floors are bouncy / squeaking at…' },
            { key: 'floors_out_of_level', label: 'Floors are out of level, there is subsidence at…' },
            { key: 'doors_binding', label: 'Doors are binding indicating subsidence at…' },
            { key: 'loose_bricks', label: 'Loose bricks that could fall due to excavations / vibrations. Where?' },
            { key: 'leaning_fences', label: 'Leaning fences that could fall over and be blamed on project works. Where?' },
          ],
        },
        itemFields: numbered([
          { key: 'value', type: 'yesno', label: 'Observed?' },
          { key: 'note', type: 'textarea', label: 'Describe location and details', gate: { fieldKey: 'value', equals: 'yes' } },
        ]),
      },
      {
        key: 'noAccess', type: 'repeating-group', label: 'No access to…',
        repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add area', titleFieldKey: 'area' },
        itemFields: numbered([
          { key: 'area', type: 'text', label: 'Area' },
          { key: 'reason', type: 'text', label: 'Reason' },
        ]),
      },
      externalDamages('Additional damage records'),
      { key: 'additionalNotes', type: 'textarea', label: 'Additional notes' },
    ],
  },
};

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  for (const [sectionKey, def] of Object.entries(SECTIONS)) {
    const latest = await prisma.inspectionTemplate.findFirst({
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey,
        name: def.name,
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        fields: numbered(def.fields) as unknown as object,
        layout: (def.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });

    await prisma.$transaction([
      prisma.inspectionTemplate.updateMany({
        where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
        data: { status: 'ARCHIVED' },
      }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);

    // eslint-disable-next-line no-console
    console.log(`[commercial] ${sectionKey} -> v${draft.version} (${def.fields.length} fields${def.layout ? ', section-nav' : ''})`);
  }

  await prisma.$disconnect();
}

void main();
