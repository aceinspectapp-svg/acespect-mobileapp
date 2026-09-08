// One-off content overlay: publishes a v2 for the Dilapidation + Commercial
// Properties profile's job-info, description, paving_paths, fences,
// retaining_walls, garage_carport_sheds, elevations, roof_chimneys and
// internal_areas templates, ported from the Houspect Victoria "Dilapidation
// Commercial/Industrial - Inspector Template" (1 May 2024): construction
// type & site overview, scope/safety/limitations intake, per-side paving
// and fencing surveys, garage/loading-dock/shed structures, elevation
// party-wall + cladding/window/downpipe detail, a simplified ground-level
// roof observation, and commercial room types (warehouse, production,
// hardstand, offices, meeting rooms, amenities, ...) replacing the
// residential room list. Every other (inspectionType, propertyType)
// lineage is untouched; uses the existing versioning flow (archive prior
// published row, publish the new one).
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'commercial_properties';

function numbered(fields: Omit<TemplateField, 'order'>[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Omit<TemplateField, 'order'>[]) : undefined,
  }));
}

const opt = (value: string, label: string): TemplateFieldOption => ({ value, label });
const items = (labels: string[]): TemplateFieldOption[] => labels.map((l, i) => opt(`item${i}`, l));
const YES_NO: TemplateFieldOption[] = [opt('yes', 'Yes'), opt('no', 'No')];
const yesno = (key: string, label: string) => ({ key, label, type: 'yesno' as const, options: YES_NO });
const chips = (key: string, label: string, options: string[]) => ({ key, label, type: 'pill-select' as const, options: items(options) });
const chipsMulti = (key: string, label: string, options: string[]) => ({ key, label, type: 'chip-multiselect' as const, allowOther: true, options: items(options) });
const text = (key: string, label: string) => ({ key, label, type: 'text' as const });
const CONDITION_TYPICAL = ['Satisfactory with typical wear and tear', 'Fair', 'Average', 'Poor', 'New'];
const RUNS = ['Vertical', 'Diagonal', 'Horizontal'];

/** Generic "cracking/gaps/other deterioration" sub-list: location, defect desc, runs (V/D/H), width, length, photos. */
function damageList(key: string, label: string, descOptions: string[]): Omit<TemplateField, 'order'> {
  return {
    key, label, type: 'damage-list',
    itemFields: numbered([
      { key: 'location', label: 'Damage location', type: 'text' },
      { key: 'damageType', label: 'Description', type: 'pill-select', options: items(descOptions) },
      { key: 'direction', label: 'Runs', type: 'pill-select', options: items(RUNS) },
      { key: 'widthMm', label: 'Width', type: 'numeric', unit: 'mm' },
      { key: 'lengthMm', label: 'Length', type: 'numeric', unit: 'mm' },
      { key: 'photos', label: 'Pics', type: 'photos' },
    ]),
  };
}

/** One elevation/side (Front/Left/Rear/Right) surveyed for paving, fencing, etc. -- fixed tabs, not addable, matching this form's structure. */
function sideRepeatingGroup(key: string, label: string, sides: { key: string; label: string }[], itemFields: Omit<TemplateField, 'order'>[]): Omit<TemplateField, 'order'> {
  return {
    key, label, type: 'repeating-group',
    repeat: { presentation: 'fixed-tabs', fixedInstances: sides, addable: false },
    itemFields: numbered(itemFields),
  };
}

async function publishOverlay(sectionKey: string, buildFields: (existing: TemplateField[]) => TemplateField[]) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  const latest = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const existingFields = ((published?.fields as unknown as TemplateField[]) ?? []) as TemplateField[];
  const nextFields = numbered(buildFields(existingFields) as Omit<TemplateField, 'order'>[]);

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE,
      propertyType: PROPERTY_TYPE,
      sectionKey,
      name: published?.name ?? sectionKey,
      version: (latest?.version ?? 0) + 1,
      status: 'DRAFT',
      fields: nextFields as unknown as object,
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
  console.log(`[commercial-dilapidation] published ${sectionKey} v${draft.version} (${nextFields.length} fields)`);
}

const SIDES = [
  { key: 'front', label: 'Front' },
  { key: 'left', label: 'Left' },
  { key: 'rear', label: 'Rear' },
  { key: 'right', label: 'Right' },
];

async function main() {
  // ── job-info ────────────────────────────────────────────────────
  await publishOverlay('job-info', (existing) => [
    ...existing,
    text('inspectorInitials', 'Inspector initials') as TemplateField,
    { key: 'businessSignage', label: 'Business name / signage (take photos)', type: 'photos' } as TemplateField,
    text('firstPicNo', '1st pic No (entire job sequence)') as TemplateField,
    text('lastPicNo', 'Last pic No (entire job sequence)') as TemplateField,
    { ...yesno('postProject', 'POST PROJECT? (if yes, use previous report & update every item with new pics)') } as TemplateField,
  ]);

  // ── description (site overview, construction, scope/safety/limitations) ──
  await publishOverlay('description', (existing) => [
    ...existing,
    { key: 'siteOverviewPhotos', label: 'Property & Project Site Overview — street views (4–6 pics)', type: 'photos' } as TemplateField,
    chipsMulti('constructionIs', 'Construction is', ['Retail shop', 'Warehouse', 'Factory', 'Office & distribution complex', 'School', 'Church', 'Hospital']) as TemplateField,
    text('constructedYear', 'Constructed (year / decade, or under construction at stage)') as TemplateField,
    chips('streetFrontageDirection', 'Street frontage faces', ['North', 'South', 'East', 'West']) as TemplateField,
    chips('blockSlope', 'The block is', ['Steep sloping', 'Gently sloping', 'Mostly flat']) as TemplateField,
    chips('wallCladdingGround', 'Wall cladding — ground floor', ['Concrete panels', 'Hebel', 'Brick', 'Metal', 'Combo of']) as TemplateField,
    chips('wallCladdingFirst', 'Wall cladding — first floor', ['Not applicable', 'Concrete panels', 'Hebel', 'Brick', 'Metal']) as TemplateField,
    text('foundations', 'Foundations') as TemplateField,
    chips('roofDesign', 'Roof design', ['Pitched', 'Flat', 'Combo of pitched and flat', 'Other']) as TemplateField,
    chips('roofCovering', 'Roof covering', ['Tile', 'Colorbond', 'Zincalume', 'Kliplock decking', 'Mix of']) as TemplateField,
    chips('windowsAre', 'Windows are', ['Aluminium', 'Timber', 'Mix of aluminium and timber', 'Steel', 'Other']) as TemplateField,
    chips('proposedWorksType', 'The proposed works are to the', ['Residential property', 'Development site', 'Road', 'Pipeline', 'Rail line', 'Bridge', 'New housing estate', 'Other']) as TemplateField,
    text('projectSiteAddress', 'Project site address') as TemplateField,
    chips('relativePosition', 'Which, in relation to the property inspected, is to the', ['Left-hand side', 'Right-hand side', 'Rear', 'Front']) as TemplateField,
    chips('approxDirection', 'Which is approximately', ['North', 'East', 'South', 'West', 'NE', 'NW', 'SE', 'SW']) as TemplateField,
    chipsMulti('scopeConfirmed', 'Scope for inspection (confirm on day of inspection)', ['External and internal to all structures', 'External & internal to part of property at', 'Internal only', 'External only']) as TemplateField,
    text('scopeAt', 'Scope — "at" / changes to scope') as TemplateField,
    yesno('scopeLimitations', 'Any limitations to scope?') as TemplateField,
    { key: 'scopeLimitationsNotes', label: 'If yes, describe', type: 'textarea', maxLength: 500 } as TemplateField,
    yesno('safetyIssues', 'Any safety issues?') as TemplateField,
    { key: 'safetyIssuesNotes', label: 'If yes, describe', type: 'textarea', maxLength: 500 } as TemplateField,
  ]);

  // ── paving_paths: Front/Left/Rear/Right paving & car park survey ──
  await publishOverlay('paving_paths', () => {
    const gate = { fieldKey: 'applicability', equals: 'Assessed' };
    return [
      sideRepeatingGroup('sides', 'Paving / Car Park', SIDES, [
        chips('applicability', 'Applicability', ['Assessed', 'Not applicable']),
        { ...chips('material', 'Material', ['Concrete', 'Pavers', 'Gravel', 'Grass only']), gate },
        { ...chips('condition', 'Condition', ['Satisfactory', 'Fair', 'Average', 'Poor', 'Good in relation to its age']), gate },
        { ...chipsMulti('obscuredBy', 'Sections obscured by', ['Vegetation', 'Stored goods']), gate },
        { ...damageList('damages', 'Cracking / gaps / other deterioration', ['Crack', 'Subsidence', 'Gap', 'Hole', 'Chipping']), gate },
        { key: 'photos', label: 'Pics', type: 'photos' as const, gate },
      ]) as TemplateField,
    ];
  });

  // ── fences: Front/Left/Rear/Right fencing survey ──
  await publishOverlay('fences', () => [
    sideRepeatingGroup('sides', 'Fences', SIDES, [
      chips('present', 'Fence present', ['There is no fence', 'Timber pickets', 'Palings', 'Brick', 'Gal steel post & mesh wire', 'Metal sheets', 'Other']),
      { ...chips('condition', 'Condition', ['Satisfactory with typical weathering and some gaps', 'Decayed', 'Loose or missing palings', 'Leaning', 'Fair', 'Average', 'Poor']), gate: { fieldKey: 'present', equals: 'Timber pickets' } },
      { key: 'damageDescribe', label: 'Describe worst item', type: 'textarea', maxLength: 500 },
      chipsMulti('obscuredBy', 'Sections obscured by', ['Vegetation', 'Stored goods']),
      { key: 'photos', label: 'Pics', type: 'photos' },
    ]) as TemplateField,
  ]);

  // ── retaining_walls: NA/Left/right/rear/front ──
  await publishOverlay('retaining_walls', (existing) => {
    const items0 = existing.find((f) => f.key === 'items');
    if (items0?.itemFields) {
      const loc = items0.itemFields.find((f) => f.key === 'location');
      if (loc) loc.options = items(['Not applicable', 'Left', 'Right', 'Rear', 'Front']);
      const material = items0.itemFields.find((f) => f.key === 'material');
      if (material) material.options = items(['Brick', 'Gal steel post & sleepers', 'Timber sleepers', 'Other']);
    }
    return existing;
  });

  // ── garage_carport_sheds: Garage + other free-standing structures ──
  await publishOverlay('garage_carport_sheds', () => [
    {
      key: 'garage', label: 'Garage', type: 'repeating-group',
      repeat: { presentation: 'strip', addable: false },
      itemFields: numbered([
        chips('location', 'Garage', ['Not applicable', 'Basement', 'Separate — left', 'Separate — right', 'Separate — rear', 'Separate — front']),
        chips('walls', 'Walls', ['Brick', 'Metal', 'Fibre cement', 'Basement']),
        chips('wallsCondition', 'Walls condition', ['Satisfactory with typical wear and tear', 'Fair', 'Average', 'Poor']),
        chips('roof', 'Roof', ['Metal', 'Colorbond', 'NA as basement']),
        chips('floor', 'Floor', ['Concrete hardstand', 'Pavers']),
        chipsMulti('obscuredBy', 'Sections of walls and floor obscured by', ['Shelving', 'Stored goods', 'Parked car/s', 'Other']),
        damageList('damages', 'Cracking / gaps / other deterioration', ['Crack', 'Subsidence', 'Gap', 'Hole', 'Chipping']),
        text('cladding', 'Cladding condition'),
        text('windowsDoors', 'Windows / doors condition'),
        text('downpipesGutters', 'Downpipes / gutters condition'),
        { key: 'photos', label: 'Pics', type: 'photos' },
      ]),
    } as TemplateField,
    {
      key: 'otherStructures', label: 'Any Other Free-Standing Structures (Sheds / Loading Dock)', type: 'repeating-group',
      repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add structure' },
      itemFields: numbered([
        chips('type', 'Structure', ['Shed/s', 'Loading dock']),
        chips('location', 'Not applicable, or at', ['Not applicable', 'Left', 'Right', 'Rear', 'Front']),
        chips('walls', 'Walls', ['Brick', 'Metal', 'Fibre cement', 'Concrete panel']),
        chips('wallsCondition', 'Walls condition', ['Satisfactory with typical wear and tear', 'Fair', 'Poor', 'New', 'Other']),
        chips('roof', 'Roof', ['Metal', 'Colorbond', 'Tiles', 'Fibre cement']),
        chips('floor', 'Floor', ['Concrete hardstand', 'Gravel', 'Pavers']),
        chipsMulti('obscuredBy', 'Sections of walls and floor obscured by', ['Parked vehicles', 'Shelving', 'Stored goods']),
        damageList('damages', 'Cracking / gaps / other deterioration', ['Crack', 'Subsidence', 'Gap', 'Hole', 'Chipping']),
        { key: 'photos', label: 'Pic seq', type: 'photos' },
      ]),
    } as TemplateField,
  ]);

  // ── elevations: enrich each side with party wall + cladding/windows/downpipes ──
  await publishOverlay('elevations', (existing) => {
    const sides0 = existing.find((f) => f.key === 'sides');
    if (sides0?.itemFields) {
      sides0.itemFields.push(
        ...numbered([
          yesno('partyWallAbutting', 'Party wall abutting next property'),
          text('partyWallNumber', 'Abutting property number'),
          chips('partyWallInspection', 'Could only be partly inspected to', ['Front', 'Rear', 'Side', 'Parapet above roof line', 'Other', 'Not restricted']),
          chipsMulti('claddingCondition', 'Cladding', ['Paint is weathered', 'Paint is flaking from sections', 'Timber is cracked', 'Decay to some boards']),
          chipsMulti('windowsDoorsCondition', 'Windows / doors', ['Paint flaking from timber', 'Gaps at windows & cladding', 'Decay to some frames or sashes', 'Broken glazing', 'Door delaminating']),
          chipsMulti('downpipesGuttersCondition', 'Downpipes / gutters', ['Rusted', 'Sagging or loose', 'Not connected to stormwater system']),
        ]),
      );
    }
    return existing;
  });

  // ── roof_chimneys: simplified ground-level observation ──
  await publishOverlay('roof_chimneys', () => [
    chips('couldNotObserve', 'Roof & chimneys', ['Could observe', 'Could not observe due to flat roof', 'No chimney/s']) as TemplateField,
    chipsMulti('generalCondition', 'General condition (limited ground-level observation using camera zoom — upper roof is generally)', ['Satisfactory to fair with typical weathering', 'Some surface rust', 'Gaps at flashings', 'Gaps / cracking to chimney brickwork', 'Chimney appears unstable']) as TemplateField,
    { key: 'photos', label: 'Pics', type: 'photos' } as TemplateField,
  ]);

  // ── internal_areas: commercial room types + General intake fields ──
  const COMMERCIAL_ROOMS = [
    { key: 'warehouse', label: 'Warehouse (Walls, Windows, Doors)' },
    { key: 'production', label: 'Production (Walls, Windows, Doors)' },
    { key: 'hardstand', label: 'Hardstand & Other Floors' },
    { key: 'warehouse_roof', label: 'Warehouse Roof Underside & Frame' },
    { key: 'reception', label: 'Reception / Foyer' },
    { key: 'offices', label: 'Offices' },
    { key: 'boardroom', label: 'Board Room' },
    { key: 'meeting_room_1', label: 'Meeting Room 1' },
    { key: 'meeting_room_2', label: 'Meeting Room 2' },
    { key: 'staff_rooms', label: 'Staff Rooms / Kitchens' },
    { key: 'wc', label: 'WC Male / Female' },
    { key: 'stairs', label: 'Stairs / Stairwell / Landing' },
    { key: 'storerooms', label: 'Storerooms' },
  ];
  await publishOverlay('internal_areas', (existing) => {
    const rooms = existing.find((f) => f.key === 'rooms');
    if (rooms?.repeat) {
      rooms.repeat.fixedInstances = COMMERCIAL_ROOMS;
      rooms.repeat.addable = true;
      rooms.repeat.addButtonLabel = 'Add additional room / area';
    }
    if (rooms?.itemFields) {
      const floorLevel = rooms.itemFields.find((f) => f.key === 'floorLevel');
      if (floorLevel) floorLevel.options = items(['Ground floor', '1st floor', '2nd floor', 'Mezzanine']);
      const obstruction = rooms.itemFields.find((f) => f.key === 'obstruction');
      if (obstruction) obstruction.options = items(['Shelving', 'Bench', 'Equipment / machinery', 'Pallets', 'Stored goods']);
    }
    return [
      yesno('renovationsInProgress', 'Renovations in progress?') as TemplateField,
      { key: 'renovationsWhichRooms', label: 'Which rooms/area? Include pics', type: 'photos' } as TemplateField,
      yesno('safetyAdvisories', 'Safety advisories to owner?') as TemplateField,
      chipsMulti('safetyAdvisoriesDetail', 'Safety advisory detail', ['Exposed electrical cables', 'Leaking gas odor']) as TemplateField,
      { key: 'roomsNotAccessed', label: 'Any rooms not accessed — which & why?', type: 'textarea', maxLength: 500 } as TemplateField,
      yesno('movementIndicators', 'Bouncy floors, sloping floors, binding doors & windows, or anything indicating movement?') as TemplateField,
      { key: 'movementIndicatorsDetail', label: 'Where? Describe issues', type: 'textarea', maxLength: 500 } as TemplateField,
      ...existing,
    ];
  });

  await prisma.$disconnect();
}

void main();
