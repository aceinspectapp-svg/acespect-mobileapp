// Dilapidation / Apartment form rebuilt in the shape of Houspect's Nov 2026 office template
// ("ACESPECT Dilapidation Multi Level Office Building _Office Template Nov 2026.dotm"), so the report can be written line by line:
//
//   Description            the template's line 14 (as before) + its extension line 15 + "approximately [north]" (line 21) and
//                          "part of the property at [where]" (line 22); the Pre-Purchase works / limitations / safety questions removed
//   Driveway               present? / to the [front] of the block / constructed of / condition / obscured by / defects / photos  (lines 31-35)
//   Paving / Parking areas / Basement car parks
//                          front, left, rear, right: present? / constructed of / condition / obscured by / defects / photos  (lines 36-45)
//   Fences                 front, left, rear, right: present? / constructed of / condition / obscured by / defects / photos  (lines 46-57)
//   Retaining Walls        any? / each: on the [left] side of the [property], running from the [front] to the [rear] / constructed of /
//                          condition / decay, bowed, leaning / defects / photos  (line 59)
//   Garage / Carport / Loading Bay / Shed
//                          garage, carport, loading bay, shed: present? / located at / walls / roof / condition / (shed) visible significant
//                          damage? / obscured by / defects / photos  (lines 60-71)
//   Main structure         front, left, rear, right elevation: inspected? / faces [north] / (left, rear, right) party wall, next property
//                          No., constructed of / condition / paint peeling, downpipe not connected, eaves stains or mould / defects /
//                          photos  (lines 72-110)
//   Roof Covering and Chimney
//                          how it was inspected (ground, ladder, OH&S, multi-level complex) / covering / condition / "with ..." / lower
//                          roof / chimney / defects / photos  (lines 111-118)
//   Internal               rooms, each on its floor: present? / floor / condition / obscured by / defects / photos  (lines 119-220)
//   Notes                  no access to ... / squeaky or unlevel floors / photographs restricted / other notes  (lines 222-225)
//   Additional structure   + located at, visible significant damage  (line 71)
//
// Defects ask what the template's defect line says: where, which part, the kind of defect, and for a crack where it starts and runs
// to and its width and length (no severity, direction or notes -- the template's line has none).
//
// Unlike the align-* scripts this REPLACES the sections' questions: inspections already in progress on the old form keep their own
// form version. Idempotent: run it twice and the second run changes nothing.
//
//   npx tsx src/scripts/restructure-apartment-form-template.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/restructure-apartment-form-template.ts              # dry run against the database
//   npx tsx src/scripts/restructure-apartment-form-template.ts --apply      # publish new template versions
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { slug, type Field } from './lib/align-helpers';

const PROFILE = { inspectionType: 'dilapidation', propertyType: 'apartment' };
const SNAPSHOT = join(__dirname, '..', '..', 'prisma', 'templates-snapshot.json');

const opts = (labels: string[]) => labels.map((label) => ({ label, value: slug(label) }));
const CONDITION = opts(['Satisfactory with typical wear and tear', 'Fair', 'Average', 'Poor', 'New']).map((o) => (o.label === 'Satisfactory with typical wear and tear' ? { ...o, value: 'satisfactory_with_typical_wear_and_tear' } : o));
const yes = (fieldKey: string) => ({ fieldKey, equals: 'yes' });
/** "Is there one?" -- Yes, No (the template's "There is no ..."), or Not inspected (the inspector could not see it: nothing is printed, the Notes say why). */
const THERE = opts(['Yes', 'No', 'Not inspected']);
const isThere = (label: string): Omit<Field, 'order'> => ({ key: 'present', type: 'pill-select', label, required: true, options: THERE });

/** Fields in order, numbered. */
function ordered(fields: Omit<Field, 'order'>[]): Field[] {
  return fields.map((f, i) => ({ ...f, order: i }) as Field);
}

/** The template's defect line: "At the [location], there is a crack starting at [..] and running to the [..]. The crack is [..] millimetres wide and [..] millimetres long." / "There is damage to the [part] at [location]." */
function defects(base: Field[], conditionKey: string, gate?: unknown): Omit<Field, 'order'> {
  const keep = base.filter((f) => !['sub_cracking', 'direction', 'notes'].includes(f.key));
  const relabel: Record<string, string> = {
    location: 'At the (where)',
    element: 'Which part (e.g. wall, render, slab, door)',
    damageType: 'Defect type',
    crackStartLocation: 'Crack starting at',
    crackEndLocation: 'Running to',
    widthMm: 'Width (mm)',
    lengthMm: 'Length (mm)',
    photos: 'Photographs',
  };
  return {
    key: 'damages',
    type: 'damage-list',
    label: 'Cracks and other defects',
    ...(gate ? { gate } : {}),
    repeat: { addable: true, presentation: 'strip', addButtonLabel: 'Add defect', requireWhen: { fieldKey: conditionKey, equals: ['average', 'poor'] } },
    itemFields: ordered(
      keep.map((f) => {
        const g: Field = JSON.parse(JSON.stringify(f));
        if (relabel[g.key]) g.label = relabel[g.key]!;
        if (g.key === 'element') g.required = false;
        if (g.key === 'crackEndLocation') g.required = true;
        delete (g as any).order;
        return g;
      }),
    ),
  };
}

const photos = (label: string, gate?: unknown): Omit<Field, 'order'> => ({ key: 'photos', type: 'photos', label, required: true, ...(gate ? { gate } : {}) });
const condition = (label = 'Condition', gate?: unknown): Omit<Field, 'order'> => ({ key: 'condition', type: 'color-select', label, required: true, options: CONDITION, ...(gate ? { gate } : {}) });

function build(base: Record<string, { name: string; fields: Field[] }>): Record<string, { name: string; fields: Field[] }> {
  const dmg = base.elevations!.fields.find((f) => f.key === 'ext_walls_damages')?.itemFields ?? base.__damage!.fields;
  const out: Record<string, { name: string; fields: Field[] }> = {};

  // ---- Description (line 14 as before; + lines 15, 21, 22) ----
  const drop = new Set(['worksType', 'worksTypeOther', 'limitations', 'limitationsNotes', 'safetyIssues', 'safetyIssuesNotes']);
  const desc = base.description!.fields.filter((f) => !drop.has(f.key) && !/^extension|^directionCompass$|^scopePartAt$/.test(f.key));
  const pick = (k: string) => desc.find((f) => f.key === k)!;
  const at = (k: string) => desc.findIndex((f) => f.key === k);
  const extension: Omit<Field, 'order'>[] = [
    { key: 'extension', type: 'yesno', label: 'Is there an extension?', required: true },
    { key: 'extensionTo', type: 'pill-select', label: 'Extension to the', required: true, gate: yes('extension'), options: opts(['Front', 'Rear', 'Left side', 'Right side']) },
    { key: 'extensionYear', type: 'text', label: 'Extension built around (year)', required: true, gate: yes('extension') },
    { key: 'extensionWalls', type: 'pill-select', label: 'Extension walls', required: true, allowOther: true, gate: yes('extension'), options: (pick('cladding').options ?? []) as any },
    { key: 'extensionFoundations', type: 'pill-select', label: 'Extension on', required: true, allowOther: true, gate: yes('extension'), options: (pick('foundations').options ?? []) as any },
    { key: 'extensionRoofDesign', type: 'pill-select', label: 'Extension roof', required: true, allowOther: true, gate: yes('extension'), options: (pick('roofDesign').options ?? []) as any },
    { key: 'extensionRoofCovering', type: 'pill-select', label: 'Extension roof covering', required: true, allowOther: true, gate: yes('extension'), options: (pick('roofCovering').options ?? []) as any },
  ];
  desc.splice(at('windowsOther') + 1, 0, ...(extension as Field[]));
  desc.splice(at('direction') + 1, 0, { key: 'directionCompass', type: 'pill-select', label: 'Which is approximately', required: false, options: opts(['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west']) } as Field);
  const partial = (pick('scopeType').options ?? []).find((o) => /^partial/i.test(o.label))?.value ?? 'partial';
  desc.splice(at('scopeType') + 1, 0, { key: 'scopePartAt', type: 'text', label: 'Part of the property at', required: true, gate: { fieldKey: 'scopeType', equals: partial } } as Field);
  out.description = { name: base.description!.name, fields: ordered(desc) };

  // ---- Driveway (lines 31-35) ----
  const present = yes('present');
  out.driveway = {
    name: 'Driveway',
    fields: ordered([
      isThere('Is there a driveway?'),
      { key: 'location', type: 'pill-select', label: 'The driveway is to the ... of the block', required: true, gate: present, options: opts(['Front', 'Left side', 'Rear', 'Right side']) },
      { key: 'material', type: 'pill-select', label: 'Constructed of', required: true, allowOther: true, gate: present, options: opts(['Concrete', 'Exposed aggregate concrete', 'Asphalt', 'Pavers', 'Gravel']) },
      condition('Condition', present),
      { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections of the driveway were obscured by', required: false, allowOther: true, gate: present, options: opts(['A parked vehicle', 'Vegetation', 'Stored goods']) },
      defects(dmg, 'condition', present),
      photos('Driveway photos', present),
    ]),
  };

  // ---- Paving / Parking areas / Basement car parks (lines 36-45) ----
  const sides = [
    { key: 'front', label: 'Front' },
    { key: 'left', label: 'Left' },
    { key: 'rear', label: 'Rear' },
    { key: 'right', label: 'Right' },
  ];
  out.paving_paths = {
    name: 'Paving / Parking areas / Basement car parks',
    fields: ordered([
      {
        key: 'areas',
        type: 'repeating-group',
        label: 'Paving to each side of the block',
        required: true,
        repeat: { presentation: 'fixed-tabs', fixedInstances: sides },
        itemFields: ordered([
          isThere('Is there paving to this side?'),
          { key: 'material', type: 'chip-multiselect', label: 'Constructed of', required: true, allowOther: true, gate: present, options: opts(['Concrete', 'Pavers', 'Asphalt', 'Tiles', 'Gravel']) },
          condition('Condition', present),
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections of the paving were obscured by', required: false, allowOther: true, gate: present, options: opts(['Parked vehicles', 'Vegetation', 'Stored goods']) },
          defects(dmg, 'condition', present),
          photos('Paving photos', present),
        ]),
      },
    ]),
  };

  // ---- Fences (lines 46-57) ----
  out.fences = {
    name: 'Fences',
    fields: ordered([
      {
        key: 'items',
        type: 'repeating-group',
        label: 'Fences to each side',
        required: true,
        repeat: { presentation: 'fixed-tabs', fixedInstances: sides },
        itemFields: ordered([
          isThere('Is there a fence to this side?'),
          { key: 'material', type: 'chip-multiselect', label: 'Constructed of', required: true, allowOther: true, gate: present, options: opts(['Timber palings', 'Timber pickets', 'Colorbond', 'Brick', 'Rendered masonry', 'Steel palisade', 'Glass panels', 'Chain mesh wire']) },
          condition('Condition', present),
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections of the fence are obscured by', required: false, allowOther: true, gate: present, options: opts(['Vegetation', 'Stored goods']) },
          defects(dmg, 'condition', present),
          photos('Fence photos', present),
        ]),
      },
    ]),
  };

  // ---- Retaining Walls (line 59) ----
  out.retaining_walls = {
    name: 'Retaining Walls',
    fields: ordered([
      { key: 'present', type: 'yesno', label: 'Are there any retaining walls?', required: true },
      {
        key: 'items',
        type: 'repeating-group',
        label: 'Retaining walls',
        required: true,
        gate: present,
        repeat: { addable: true, presentation: 'strip', itemNoun: 'retaining wall', addButtonLabel: 'Add retaining wall', min: 1 },
        itemFields: ordered([
          { key: 'side', type: 'pill-select', label: 'On the ... side', required: true, options: opts(['Left', 'Right', 'Front', 'Rear']) },
          { key: 'of', type: 'pill-select', label: 'Of the', required: true, options: opts(['Property', 'Building', 'Driveway', 'Block']) },
          { key: 'runningFrom', type: 'pill-select', label: 'Running from the', required: false, options: opts(['Front', 'Rear', 'Left', 'Right']) },
          { key: 'runningTo', type: 'pill-select', label: 'To the', required: false, options: opts(['Front', 'Rear', 'Left', 'Right']) },
          { key: 'material', type: 'chip-multiselect', label: 'Constructed of', required: true, allowOther: true, options: opts(['Timber sleepers', 'Besser block', 'Concrete', 'Brick', 'Stone', 'Steel posts and sleepers']) },
          condition('Condition'),
          { key: 'details', type: 'chip-multiselect', label: 'Also noted', required: false, options: opts(['There is some decay', 'The wall is bowed', 'The wall is leaning']) },
          defects(dmg, 'condition'),
          photos('Retaining wall photos'),
        ]),
      },
    ]),
  };

  // ---- Garage / Carport / Loading Bay / Shed (lines 60-71) ----
  const located = opts(['In the basement', 'At the front of the property', 'At the rear of the property', 'At the left of the property', 'At the right of the property']);
  out.garage_carport_sheds = {
    name: 'Garage / Carport / Loading Bay / Shed',
    fields: ordered([
      {
        key: 'structures',
        type: 'repeating-group',
        label: 'Garage, carport, loading bay and shed',
        required: true,
        repeat: {
          presentation: 'fixed-tabs',
          fixedInstances: [
            { key: 'garage', label: 'Garage' },
            { key: 'carport', label: 'Carport' },
            { key: 'loading_bay', label: 'Loading bay' },
            { key: 'shed', label: 'Shed' },
          ],
        },
        itemFields: ordered([
          isThere('Is there one?'),
          { key: 'locatedAt', type: 'pill-select', label: 'Located', required: true, gate: present, options: located },
          { key: 'walls', type: 'chip-multiselect', label: 'Constructed of', required: true, allowOther: true, gate: present, options: opts(['Concrete', 'Brick', 'Blockwork', 'Metal', 'Fibre cement', 'Timber']) },
          { key: 'roof', type: 'chip-multiselect', label: 'With a ... roof', required: true, allowOther: true, gate: present, options: opts(['Concrete slab', 'Colorbond', 'Metal', 'Tile', 'Polycarbonate']) },
          condition('Condition', present),
          { key: 'significantDamage', type: 'yesno', label: 'Is there visible significant damage?', required: true, gate: { fieldKey: '__instanceKey', equalsAny: ['shed'] } },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Obscured by', required: false, allowOther: true, gate: present, options: opts(['Shelving', 'Stored goods', 'A parked car']) },
          defects(dmg, 'condition', present),
          photos('Photos', present),
        ]),
      },
    ]),
  };

  // ---- Main structure: the four elevations (lines 72-110) ----
  out.elevations = {
    name: 'Main structure (Elevations)',
    fields: ordered([
      {
        key: 'sides',
        type: 'repeating-group',
        label: 'Elevations',
        required: true,
        repeat: {
          presentation: 'fixed-tabs',
          fixedInstances: [
            { key: 'front', label: 'Front' },
            { key: 'left', label: 'Left' },
            { key: 'rear', label: 'Rear' },
            { key: 'right', label: 'Right' },
          ],
        },
        itemFields: ordered([
          { key: 'present', type: 'yesno', label: 'Was this elevation inspected?', required: true },
          { key: 'orientation', type: 'pill-select', label: 'Faces', required: true, gate: present, options: opts(['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west']) },
          { key: 'partyWall', type: 'yesno', label: 'Is it a party wall abutting the next property?', required: true, gate: { fieldKey: '__instanceKey', equalsAny: ['left', 'rear', 'right'] } },
          { key: 'partyWallNo', type: 'text', label: 'Next property No.', required: true, gate: yes('partyWall') },
          { key: 'partyWallMaterial', type: 'text', label: 'Party wall constructed of', required: true, gate: yes('partyWall') },
          condition('Condition', present),
          {
            key: 'alsoNoted',
            type: 'chip-multiselect',
            label: 'Also noted',
            required: false,
            gate: present,
            options: opts(['Paint is peeling from weatherboards', 'Downpipe is not connected to the stormwater system', 'Eaves have water stains', 'Eaves have mould']),
          },
          defects(dmg, 'condition', present),
          photos('Elevation photos', present),
        ]),
      },
    ]),
  };

  // ---- Roof Covering and Chimney (lines 111-118) ----
  const statuses = opts([
    'Observed from the ground using a camera zoom',
    'Observed from a ladder to the lower roof and from the ground using a camera zoom',
    'Upper roof could not be accessed safely (OH&S) - observed from the ground',
    'Not inspected - multi-level building complex',
  ]);
  const observed = { fieldKey: 'status', equalsAny: statuses.slice(0, 3).map((o) => o.value) };
  out.roof_chimneys = {
    name: 'Roof Covering and Chimney',
    fields: ordered([
      { key: 'status', type: 'pill-select', label: 'How the roof was inspected', required: true, options: statuses },
      { key: 'covering', type: 'chip-multiselect', label: 'The roof covering of', required: true, allowOther: true, gate: observed, options: opts(['Tiles', 'Colorbond', 'Zincalume', 'Membrane', 'Concrete slab', 'Kliplock decking']) },
      { key: 'condition', type: 'color-select', label: 'Appears to be in ... condition', required: true, gate: observed, options: CONDITION },
      { key: 'with', type: 'chip-multiselect', label: 'With', required: false, allowOther: true, gate: observed, options: opts(['Typical weathering', 'Some surface rust', 'Cracked tiles', 'Gaps at flashings', 'Loose sheets']) },
      { key: 'lowerCondition', type: 'color-select', label: 'The lower level roofing appears to be in ... condition', required: true, gate: { fieldKey: 'status', equalsAny: [statuses[2]!.value] }, options: CONDITION },
      { key: 'chimney', type: 'yesno', label: 'Is there a chimney?', required: true },
      { key: 'chimneyMaterial', type: 'chip-multiselect', label: 'The chimney is constructed of', required: true, allowOther: true, gate: yes('chimney'), options: opts(['Brick', 'Rendered brick', 'Stone', 'Metal flue']) },
      { key: 'chimneyCondition', type: 'color-select', label: 'The chimney appears to be in ... condition', required: true, gate: yes('chimney'), options: CONDITION },
      { key: 'chimneyWith', type: 'chip-multiselect', label: 'With', required: false, allowOther: true, gate: yes('chimney'), options: opts(['Typical weathering', 'Gaps and cracking to the brickwork', 'Loose flashings']) },
      defects(dmg, 'condition'),
      photos('Roof photos'),
    ]),
  };

  // ---- Internal: the rooms, by floor (lines 119-220) ----
  out.internal_areas = {
    name: 'Internal',
    fields: ordered([
      {
        key: 'rooms',
        type: 'repeating-group',
        label: 'Rooms -- check and photograph every room',
        required: true,
        repeat: {
          addable: true,
          collapsible: true,
          itemNoun: 'room',
          presentation: 'fixed-tabs',
          titleFieldKey: 'roomName',
          addButtonLabel: 'Add room',
          fixedInstances: [
            { key: 'entry_hallway', label: 'Entry / Hallway' },
            { key: 'living_room', label: 'Living Room' },
            { key: 'dining', label: 'Dining' },
            { key: 'kitchen', label: 'Kitchen' },
            { key: 'bedroom_1', label: 'Bedroom 1' },
            { key: 'bedroom_2', label: 'Bedroom 2' },
            { key: 'bedroom_3', label: 'Bedroom 3' },
            { key: 'study', label: 'Study' },
            { key: 'bathroom', label: 'Bathroom' },
            { key: 'ensuite', label: 'Ensuite' },
            { key: 'toilet', label: 'Toilet' },
            { key: 'laundry', label: 'Laundry' },
            { key: 'reception_foyer', label: 'Reception / Foyer' },
            { key: 'stairwell_landing', label: 'Stairwell / Landing' },
            { key: 'other', label: 'Other area' },
          ],
        },
        itemFields: ordered([
          { key: 'roomName', type: 'text', label: 'Room name (leave blank to keep the standard name)', required: false },
          { key: 'present', type: 'yesno', label: 'Present / inspected?', required: true },
          { key: 'floorLevel', type: 'pill-select', label: 'Floor', required: true, allowOther: true, gate: present, options: opts(['Ground Floor', 'First Floor', 'Second Floor']) },
          condition('Condition', present),
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections were obscured by', required: false, allowOther: true, gate: present, options: opts(['Furniture', 'Shelving', 'Work benches', 'Equipment', 'Machinery', 'Stored goods', 'Pallets']) },
          defects(dmg, 'condition', present),
          photos('Room photos', present),
        ]),
      },
    ]),
  };

  // ---- Notes (lines 222-225) ----
  out.notes = {
    name: 'Notes',
    fields: ordered([
      {
        key: 'noAccess',
        type: 'repeating-group',
        label: 'No access to ...',
        required: false,
        repeat: { addable: true, presentation: 'strip', itemNoun: 'area', addButtonLabel: 'Add an area not accessed' },
        itemFields: ordered([
          { key: 'area', type: 'text', label: 'Area', required: true },
          { key: 'reason', type: 'text', label: 'Due to', required: false },
        ]),
      },
      { key: 'squeakyFloors', type: 'yesno', label: 'Squeaky flooring?', required: true },
      { key: 'squeakyWhere', type: 'text', label: 'Where?', required: true, gate: yes('squeakyFloors') },
      { key: 'unlevelFloors', type: 'yesno', label: 'Unlevel flooring?', required: true },
      { key: 'unlevelWhere', type: 'text', label: 'Where?', required: true, gate: yes('unlevelFloors') },
      { key: 'photosRestricted', type: 'yesno', label: 'Did the owner restrict the photographs?', required: true },
      { key: 'photosRestrictedTo', type: 'text', label: 'Restricted to', required: true, gate: yes('photosRestricted') },
      { key: 'additionalNotes', type: 'textarea', label: 'Other notes (one per line)', required: false },
    ]),
  };

  // ---- An added structure (line 71) ----
  const custom = base.custom_structure!.fields.filter((f) => !['notes', 'locatedAt', 'significantDamage'].includes(f.key));
  const ci = custom.findIndex((f) => f.key === 'description');
  custom.splice(ci + 1, 0, { key: 'locatedAt', type: 'pill-select', label: 'Located', required: true, options: located } as Field);
  const di = custom.findIndex((f) => f.key === 'condition');
  custom.splice(di + 1, 0, { key: 'significantDamage', type: 'yesno', label: 'Is there visible significant damage?', required: true } as Field);
  out.custom_structure = { name: base.custom_structure!.name, fields: ordered(custom) };
  return out;
}

const SECTIONS = ['description', 'driveway', 'paving_paths', 'fences', 'retaining_walls', 'garage_carport_sheds', 'elevations', 'roof_chimneys', 'internal_areas', 'notes', 'custom_structure'];

/** The damage-list questions to build from: the Apartment form's own (from the snapshot, so every run builds the same). */
function snapshotBase(): Record<string, { name: string; fields: Field[] }> {
  const rows: any[] = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'));
  const base: Record<string, { name: string; fields: Field[] }> = {};
  for (const r of rows) if (r.inspectionType === PROFILE.inspectionType && r.propertyType === PROFILE.propertyType) base[r.sectionKey] = { name: r.name, fields: r.fields };
  // A rebuilt snapshot no longer has the old elevations defect list: build from a rebuilt section's (the same questions).
  if (!base.elevations?.fields.some((f) => f.key === 'ext_walls_damages')) {
    base.__damage = { name: '', fields: base.driveway?.fields.find((f) => f.type === 'damage-list')?.itemFields ?? [] };
  }
  return base;
}

async function main(): Promise<void> {
  const mode = process.argv.includes('--snapshot') ? 'snapshot' : process.argv.includes('--apply') ? 'apply' : 'dry-run';
  const wanted = build(snapshotBase());
  // Compared with the keys in one order: the database hands JSON back with its keys reordered.
  const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as any)[k])])) : v);
  const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

  if (mode === 'snapshot') {
    const rows: any[] = JSON.parse(readFileSync(SNAPSHOT, 'utf-8'));
    let n = 0;
    for (const row of rows) {
      if (row.inspectionType !== PROFILE.inspectionType || row.propertyType !== PROFILE.propertyType || !SECTIONS.includes(row.sectionKey)) continue;
      const w = wanted[row.sectionKey]!;
      if (same(row.fields, w.fields) && row.name === w.name) continue;
      row.fields = w.fields;
      row.name = w.name;
      row.version += 1;
      n += 1;
      console.log(`  ${row.sectionKey} -> "${w.name}" v${row.version}`);
    }
    if (n > 0) writeFileSync(SNAPSHOT, JSON.stringify(rows, null, 2) + '\n');
    console.log(`${n} section(s) rebuilt in ${SNAPSHOT}`);
    return;
  }

  const { prisma } = await import('../lib/prisma');
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');
  let n = 0;
  for (const sectionKey of SECTIONS) {
    const w = wanted[sectionKey]!;
    const published = await prisma.inspectionTemplate.findFirst({ where: { ...PROFILE, sectionKey, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    if (published && same(published.fields, w.fields) && published.name === w.name) {
      console.log(`  ${sectionKey}: already rebuilt`);
      continue;
    }
    const version = (published?.version ?? 0) + 1;
    n += 1;
    console.log(`  ${sectionKey}: ${mode === 'apply' ? 'publishing' : 'would publish'} "${w.name}" v${version}`);
    if (mode !== 'apply') continue;
    await prisma.$transaction(async (tx) => {
      await tx.inspectionTemplate.updateMany({ where: { ...PROFILE, sectionKey, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
      await tx.inspectionTemplate.create({ data: { ...PROFILE, sectionKey, name: w.name, version, status: 'PUBLISHED', publishedAt: new Date(), fields: w.fields as object, createdById: admin.id } });
    });
  }
  console.log(`${n} section(s) ${mode === 'apply' ? 'published' : 'to publish'}.`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
