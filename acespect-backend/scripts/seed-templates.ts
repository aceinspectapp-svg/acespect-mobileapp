// Seeds all 144 template lineages (12 valid inspectionType+propertyType
// combos x 12 templatable sections) as published v1, mirroring today's
// hardcoded mobile screen defaults so nothing breaks before admin
// customizes anything. Run: npx tsx scripts/seed-templates.ts
import { prisma } from '../src/lib/prisma';
import { TemplateField } from '../src/modules/templates/templates.schemas';
import { TEMPLATABLE_SECTIONS } from '../src/modules/templates/templates.sections';

// Same source data as acespect-mobile/src/constants/inspectionData.ts.
const INSPECTION_TYPES: { id: string; applicableProperties: string[] }[] = [
  {
    id: 'dilapidation',
    applicableProperties: ['residential_house', 'apartment', 'commercial_properties', 'public_assets'],
  },
  { id: 'pre_purchase', applicableProperties: ['residential_house', 'apartment', 'commercial_properties'] },
  { id: 'construction_stage', applicableProperties: ['residential_house', 'apartment'] },
  { id: 'investigations', applicableProperties: ['residential_house', 'apartment', 'commercial_properties'] },
];

const VALID_COMBOS: { inspectionType: string; propertyType: string }[] = INSPECTION_TYPES.flatMap((t) =>
  t.applicableProperties.map((propertyType) => ({ inspectionType: t.id, propertyType })),
);

/** Assigns `order` sequentially (by array position) so field lists below don't need manual numbering; recurses into itemFields. */
function numbered(fields: Omit<TemplateField, 'order'>[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Omit<TemplateField, 'order'>[]) : undefined,
  }));
}

const opt = (value: string, label: string, extra?: Partial<{ icon: string; color: string }>) => ({
  value,
  label,
  ...extra,
});

/** Standard damage/crack repeating sub-list, gated behind a yes/no field. */
function damageList(opts: { key?: string; label?: string; gateKey?: string; includeType?: boolean } = {}): Omit<
  TemplateField,
  'order'
> {
  const { key = 'damages', label = 'Damage Records', gateKey = 'hasDamage', includeType = true } = opts;
  return {
    key,
    label,
    type: 'damage-list',
    gate: { fieldKey: gateKey, equals: 'yes' },
    itemFields: numbered([
      ...(includeType
        ? ([
            {
              key: 'damageType',
              label: 'Type',
              type: 'pill-select',
              options: [opt('crack', 'Crack'), opt('spall', 'Spall'), opt('leaning', 'Leaning'), opt('other', 'Other')],
            },
          ] as Omit<TemplateField, 'order'>[])
        : []),
      { key: 'location', label: 'Location', type: 'text' },
      {
        key: 'direction',
        label: 'Direction',
        type: 'pill-select',
        options: [opt('horizontal', 'Horizontal'), opt('vertical', 'Vertical'), opt('diagonal', 'Diagonal')],
      },
      { key: 'widthMm', label: 'Width', type: 'numeric', unit: 'mm' },
      { key: 'lengthMm', label: 'Length', type: 'numeric', unit: 'mm' },
      { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500 },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ]),
  };
}

const CONDITION_OPTIONS = [
  opt('new', 'New', { color: '#16a34a' }),
  opt('satisfactory', 'Satisfactory', { color: '#65a30d' }),
  opt('fair', 'Fair', { color: '#d97706' }),
  opt('poor', 'Poor', { color: '#dc2626' }),
];

const YES_NO_OPTIONS = [opt('yes', 'Yes'), opt('no', 'No')];

const SECTION_DEFAULTS: Record<string, TemplateField[]> = {
  'job-info': numbered([
    { key: 'jobNumber', label: 'Job Number', type: 'text', required: true },
    { key: 'inspectionDate', label: 'Inspection Date', type: 'date', required: true },
    { key: 'clientName', label: 'Client Name', type: 'text', required: true },
    { key: 'inspectionAddress', label: 'Inspection Address', type: 'text', required: true },
    // Was `readOnly: true` (meant to be auto-filled by an admin-assignment
    // flow), but nothing anywhere ever actually sets that value -- the field
    // was permanently blank and unfillable. Editable until a real
    // auto-assign mechanism exists.
    { key: 'assignedInspector', label: 'Assigned Inspector', type: 'text', required: true },
    {
      key: 'weather',
      label: 'Current Onsite Weather',
      type: 'select-tiles',
      required: true,
      options: [
        opt('sunny', 'Sunny', { icon: 'sunny-outline' }),
        opt('overcast', 'Overcast', { icon: 'cloud-outline' }),
        opt('dry', 'Dry', { icon: 'reorder-two-outline' }),
        opt('intermittent_showers', 'Intermittent Showers', { icon: 'rainy-outline' }),
        opt('rain', 'Rain', { icon: 'water-outline' }),
        opt('other', 'Other', { icon: 'help-circle-outline' }),
      ],
    },
    {
      key: 'usedAsBusiness',
      label: 'Is this property currently being used as a business?',
      type: 'yesno',
      required: true,
      options: YES_NO_OPTIONS,
    },
  ]),

  description: numbered([
    { key: 'front_elevation', label: 'Front Elevation', type: 'photos', required: true },
    { key: 'street_number', label: 'Street Number', type: 'photos', required: true },
    { key: 'street_view_context', label: 'Street View Context', type: 'photos', required: true },
    { key: 'neighboring_properties', label: 'Neighboring Properties', type: 'photos', required: true },
    { key: 'relationship_construction', label: 'Relationship to Construction Site', type: 'photos', required: true },
    { key: 'business_signage', label: 'Business Signage (if applicable)', type: 'photos' },
  ]),

  driveway: numbered([
    {
      key: 'items',
      label: 'Driveways',
      type: 'repeating-group',
      repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add Driveway' },
      itemFields: numbered([
        {
          key: 'location',
          label: 'Location',
          type: 'pill-select',
          options: [opt('front', 'Front'), opt('rear', 'Rear'), opt('left_side', 'Left Side'), opt('right_side', 'Right Side')],
        },
        {
          key: 'material',
          label: 'Material',
          type: 'pill-select',
          options: [
            opt('concrete', 'Concrete'),
            opt('exposed_aggregate', 'Exposed Aggregate Concrete'),
            opt('asphalt', 'Asphalt'),
            opt('pavers', 'Pavers'),
            opt('gravel', 'Gravel'),
          ],
        },
        { key: 'condition', label: 'Condition', type: 'color-select', options: CONDITION_OPTIONS },
        {
          key: 'obstructions',
          label: 'Obstructions',
          type: 'chip-multiselect',
          allowOther: true,
          options: [opt('parked_vehicle', 'Parked Vehicle'), opt('vegetation', 'Vegetation'), opt('stored_items', 'Stored Items')],
        },
        { key: 'notableDamage', label: 'Notable Damage?', type: 'yesno', options: YES_NO_OPTIONS },
        { key: 'safetyHazard', label: 'Safety Hazard?', type: 'yesno', options: YES_NO_OPTIONS },
        damageList({ gateKey: 'notableDamage' }),
        { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500 },
        { key: 'photos', label: 'Photos', type: 'photos' },
      ]),
    },
  ]),

  paving_paths: numbered([
    {
      key: 'areas',
      label: 'Paving & Path Areas',
      type: 'repeating-group',
      repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add Area' },
      itemFields: numbered([
        { key: 'name', label: 'Area', type: 'text' },
        {
          key: 'pathType',
          label: 'Path Type',
          type: 'pill-select',
          options: [opt('concrete', 'Concrete'), opt('pavers', 'Pavers'), opt('gravel', 'Gravel'), opt('asphalt', 'Asphalt')],
        },
        { key: 'condition', label: 'Condition', type: 'color-select', options: CONDITION_OPTIONS },
        {
          key: 'defects',
          label: 'Defects',
          type: 'chip-multiselect',
          allowOther: true,
          options: [opt('trip_hazard', 'Trip Hazard'), opt('surface_wear', 'Surface Wear'), opt('settlement', 'Settlement')],
        },
        {
          key: 'drainage',
          label: 'Drainage / Fall',
          type: 'color-select',
          options: [opt('adequate', 'Adequate', { color: '#16a34a' }), opt('minor_issue', 'Minor Issue', { color: '#d97706' }), opt('major_issue', 'Major Issue', { color: '#dc2626' })],
        },
        { key: 'drainageNote', label: 'Drainage Notes', type: 'textarea', maxLength: 500 },
        { key: 'notableCracking', label: 'Notable Cracking?', type: 'yesno', options: YES_NO_OPTIONS },
        damageList({ key: 'cracks', label: 'Cracks', gateKey: 'notableCracking', includeType: false }),
        { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500 },
        { key: 'photos', label: 'Photos', type: 'photos' },
      ]),
    },
  ]),
};

function structureSection(itemNoun: string, structureOptions: { value: string; label: string }[]): TemplateField[] {
  return numbered([
    {
      key: 'items',
      label: `${itemNoun} Items`,
      type: 'repeating-group',
      repeat: { presentation: 'strip', addable: true, addButtonLabel: `Add ${itemNoun}` },
      itemFields: numbered([
        {
          key: 'location',
          label: 'Location',
          type: 'pill-select',
          options: [opt('front', 'Front'), opt('left', 'Left'), opt('right', 'Right'), opt('rear', 'Rear')],
        },
        { key: 'structureType', label: 'Type', type: 'pill-select', options: structureOptions },
        {
          key: 'material',
          label: 'Material',
          type: 'pill-select',
          options: [opt('timber', 'Timber'), opt('brick', 'Brick'), opt('block', 'Block'), opt('metal', 'Metal')],
        },
        { key: 'condition', label: 'Condition', type: 'color-select', options: CONDITION_OPTIONS },
        {
          key: 'obstructions',
          label: 'Obstructions',
          type: 'chip-multiselect',
          allowOther: true,
          options: [opt('vegetation', 'Vegetation'), opt('stored_items', 'Stored Items')],
        },
        { key: 'notableDamage', label: 'Notable Damage?', type: 'yesno', options: YES_NO_OPTIONS },
        { key: 'notableCracking', label: 'Notable Cracking?', type: 'yesno', options: YES_NO_OPTIONS },
        damageList({ key: 'cracks', label: 'Cracks', gateKey: 'notableCracking', includeType: false }),
        { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500 },
        { key: 'photos', label: 'Photos', type: 'photos' },
      ]),
    },
  ]);
}

SECTION_DEFAULTS.fences = structureSection('Fence', [
  opt('timber_paling', 'Timber Paling'),
  opt('colorbond', 'Colorbond'),
  opt('brick', 'Brick'),
  opt('chain_wire', 'Chain Wire'),
]);
SECTION_DEFAULTS.retaining_walls = structureSection('Retaining Wall', [
  opt('timber_sleeper', 'Timber Sleeper'),
  opt('besser_block', 'Besser Block'),
  opt('concrete', 'Concrete'),
  opt('rock', 'Rock'),
]);

SECTION_DEFAULTS.garage_carport_sheds = numbered([
  {
    key: 'structures',
    label: 'Structures',
    type: 'repeating-group',
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add Structure' },
    itemFields: numbered([
      { key: 'name', label: 'Name', type: 'text', sectionLetter: 'A' },
      { key: 'available', label: 'Present on Site?', type: 'yesno', options: YES_NO_OPTIONS, sectionLetter: 'A' },
      {
        key: 'attachment',
        label: 'Attachment',
        type: 'pill-select',
        options: [opt('attached', 'Attached'), opt('separate', 'Separate')],
        sectionLetter: 'B',
      },
      {
        key: 'position',
        label: 'Position',
        type: 'pill-select',
        options: [opt('front', 'Front'), opt('left', 'Left'), opt('rear', 'Rear'), opt('right', 'Right')],
        sectionLetter: 'B',
      },
      {
        key: 'wallConstruction',
        label: 'Wall Construction',
        type: 'chip-multiselect',
        options: [opt('timber', 'Timber'), opt('brick', 'Brick'), opt('metal', 'Metal')],
        sectionLetter: 'C',
      },
      {
        key: 'roofConstruction',
        label: 'Roof Construction',
        type: 'chip-multiselect',
        options: [opt('metal', 'Metal Sheet'), opt('tile', 'Tile')],
        sectionLetter: 'C',
      },
      {
        key: 'floorType',
        label: 'Floor Type',
        type: 'chip-multiselect',
        options: [opt('concrete', 'Concrete'), opt('gravel', 'Gravel')],
        sectionLetter: 'C',
      },
      { key: 'condition', label: 'Condition', type: 'color-select', options: CONDITION_OPTIONS, sectionLetter: 'D' },
      {
        key: 'obstructions',
        label: 'Obstructions',
        type: 'chip-multiselect',
        allowOther: true,
        options: [opt('shelving', 'Shelving'), opt('stored_goods', 'Stored Goods'), opt('parked_vehicle', 'Parked Vehicle'), opt('limited_access', 'Limited Access')],
        sectionLetter: 'D',
      },
      { key: 'hasDamage', label: 'Damage Present?', type: 'yesno', options: YES_NO_OPTIONS, sectionLetter: 'E' },
      { ...damageList({ gateKey: 'hasDamage' }), sectionLetter: 'E' } as Omit<TemplateField, 'order'>,
      { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500, sectionLetter: 'F' },
      { key: 'photos', label: 'Photos', type: 'photos', sectionLetter: 'F' },
    ]),
  },
]);

SECTION_DEFAULTS.pool_spa = numbered([
  {
    key: 'items',
    label: 'Pool / Spa',
    type: 'repeating-group',
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add Pool / Spa' },
    itemFields: numbered([
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'available', label: 'Present on Site?', type: 'yesno', options: YES_NO_OPTIONS },
      {
        key: 'poolType',
        label: 'Type',
        type: 'pill-select',
        options: [opt('inground', 'In-Ground'), opt('above_ground', 'Above Ground'), opt('spa', 'Spa')],
      },
      {
        key: 'construction',
        label: 'Construction',
        type: 'chip-multiselect',
        options: [opt('concrete', 'Concrete'), opt('fibreglass', 'Fibreglass'), opt('vinyl', 'Vinyl')],
      },
      {
        key: 'fenceType',
        label: 'Fence Type',
        type: 'chip-multiselect',
        options: [opt('glass', 'Glass'), opt('metal', 'Metal'), opt('timber', 'Timber')],
      },
      {
        key: 'fenceSafety',
        label: 'Fence Safety',
        type: 'color-select',
        options: [opt('compliant', 'Compliant', { color: '#16a34a' }), opt('not_safe', 'Not Safe', { color: '#dc2626' }), opt('not_observed', 'Not Observed', { color: '#94a3b8' })],
      },
      { key: 'condition', label: 'Condition', type: 'color-select', options: CONDITION_OPTIONS },
      {
        key: 'obstructions',
        label: 'Obstructions',
        type: 'chip-multiselect',
        allowOther: true,
        options: [opt('furniture', 'Furniture'), opt('equipment', 'Pool Equipment')],
      },
      { key: 'hasDamage', label: 'Damage Present?', type: 'yesno', options: YES_NO_OPTIONS },
      damageList({ gateKey: 'hasDamage' }),
      { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500 },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ]),
  },
]);

SECTION_DEFAULTS.elevations = numbered([
  {
    key: 'sides',
    label: 'Elevations',
    type: 'repeating-group',
    repeat: {
      presentation: 'fixed-tabs',
      fixedInstances: [
        { key: 'front', label: 'Front' },
        { key: 'left', label: 'Left' },
        { key: 'rear', label: 'Rear' },
        { key: 'right', label: 'Right' },
      ],
      addable: false,
    },
    itemFields: numbered([
      { key: 'available', label: 'Available for Inspection?', type: 'yesno', options: YES_NO_OPTIONS },
      {
        key: 'orientation',
        label: 'Orientation',
        type: 'pill-select',
        options: [opt('north', 'North'), opt('south', 'South'), opt('east', 'East'), opt('west', 'West')],
      },
      { key: 'condition', label: 'Condition', type: 'color-select', options: CONDITION_OPTIONS },
      {
        key: 'generalDamage',
        label: 'General Damage',
        type: 'color-select',
        options: [
          opt('none', 'None', { color: '#16a34a' }),
          opt('minor', 'Minor', { color: '#65a30d' }),
          opt('multiple', 'Multiple', { color: '#d97706' }),
          opt('localised', 'Localised', { color: '#ea580c' }),
          opt('structural', 'Structural', { color: '#dc2626' }),
        ],
      },
      {
        key: 'claddingObs',
        label: 'Cladding Observations',
        type: 'chip-multiselect',
        options: [opt('paint_flaking', 'Paint Flaking'), opt('render_cracking', 'Render Cracking')],
      },
      {
        key: 'windowDoorObs',
        label: 'Windows/Doors Observations',
        type: 'chip-multiselect',
        options: [opt('sticking', 'Sticking'), opt('seal_failure', 'Seal Failure')],
      },
      { key: 'hasDamage', label: 'Damage Present?', type: 'yesno', options: YES_NO_OPTIONS },
      damageList({ gateKey: 'hasDamage' }),
      { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500 },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ]),
  },
]);

SECTION_DEFAULTS.roof_chimneys = numbered([
  {
    key: 'sections',
    label: 'Roof Sections',
    type: 'repeating-group',
    repeat: {
      presentation: 'fixed-tabs',
      fixedInstances: [
        { key: 'upper', label: 'Upper Roof & Chimneys' },
        { key: 'lower', label: 'Lower Roof & Chimneys' },
      ],
      addable: false,
    },
    itemFields: numbered([
      { key: 'available', label: 'Available for Inspection?', type: 'yesno', options: YES_NO_OPTIONS },
      {
        key: 'accessibility',
        label: 'Accessibility',
        type: 'chip-multiselect',
        options: [opt('fully_inspected', 'Fully Inspected'), opt('inspected_partly_from', 'Inspected Partly From'), opt('not_accessible', 'Not Accessible')],
      },
      {
        key: 'coveringType',
        label: 'Covering Type',
        type: 'chip-multiselect',
        options: [opt('tile', 'Tile'), opt('metal', 'Metal'), opt('slate', 'Slate')],
      },
      { key: 'generalCondition', label: 'General Condition', type: 'color-select', options: CONDITION_OPTIONS },
      {
        key: 'generalObservations',
        label: 'General Observations',
        type: 'chip-multiselect',
        options: [opt('moss_growth', 'Moss Growth'), opt('debris', 'Debris')],
      },
      { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500 },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ]),
  },
]);

SECTION_DEFAULTS.internal_areas = numbered([
  {
    key: 'rooms',
    label: 'Rooms',
    type: 'repeating-group',
    repeat: {
      presentation: 'nested',
      addable: true,
      addButtonLabel: 'Add Another Instance',
      fixedInstances: [
        { key: 'front_entry_hallway', label: 'Front Entry & Hallway' },
        { key: 'living_room', label: 'Living Room' },
        { key: 'dining_area', label: 'Dining Area' },
        { key: 'kitchen', label: 'Kitchen' },
        { key: 'bedroom', label: 'Bedroom' },
        { key: 'bathroom', label: 'Bathroom' },
        { key: 'laundry', label: 'Laundry' },
        { key: 'toilet', label: 'Toilet' },
        { key: 'stairwell', label: 'Stairwell' },
        { key: 'other', label: 'Other Internal Area' },
      ],
    },
    itemFields: numbered([
      { key: 'available', label: 'Present?', type: 'yesno', options: YES_NO_OPTIONS },
      {
        key: 'floorLevel',
        label: 'Floor Level',
        type: 'pill-select',
        // Matches Houspect Victoria's own report template, which groups
        // Internal Areas by these four floor headings (see ReportView.tsx's
        // FLOOR_LEVEL_ORDER, used to render the same grouping in the report).
        options: [opt('ground', 'Ground Floor'), opt('first', 'First Floor'), opt('second', 'Second Floor'), opt('basement', 'Basement')],
      },
      {
        key: 'obstruction',
        label: 'Obstructions',
        type: 'chip-multiselect',
        options: [opt('furniture', 'Furniture'), opt('stored_items', 'Stored Items')],
      },
      { key: 'generalCondition', label: 'General Condition', type: 'color-select', options: CONDITION_OPTIONS },
      { key: 'hasDamage', label: 'Damage Present?', type: 'yesno', options: YES_NO_OPTIONS },
      damageList({ gateKey: 'hasDamage' }),
      {
        key: 'moistureObservations',
        label: 'Moisture Observations',
        type: 'chip-multiselect',
        options: [opt('staining', 'Staining'), opt('musty_odour', 'Musty Odour')],
      },
      { key: 'notes', label: 'Notes', type: 'textarea', maxLength: 500 },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ]),
  },
]);

SECTION_DEFAULTS.notes = numbered([
  {
    key: 'movement',
    label: 'Movement / Safety Checklist',
    type: 'repeating-group',
    repeat: {
      presentation: 'checklist',
      addable: false,
      fixedInstances: [
        { key: 'bouncyFloors', label: 'Bouncy / Squeaking Floors' },
        { key: 'slopingFloors', label: 'Floors Out of Level / Subsidence' },
        { key: 'doorsBinding', label: 'Doors Binding' },
        { key: 'looseBricks', label: 'Loose Bricks Safety Concern' },
        { key: 'leaningFences', label: 'Leaning Fences Safety Concern' },
        { key: 'balconyCondition', label: 'Balcony Poor Condition' },
      ],
    },
    itemFields: numbered([
      { key: 'value', label: 'Observed?', type: 'yesno', options: YES_NO_OPTIONS },
      { key: 'note', label: 'Describe location and details', type: 'textarea', maxLength: 500, gate: { fieldKey: 'value', equals: 'yes' } },
    ]),
  },
  {
    key: 'noAccess',
    label: 'No Access Areas',
    type: 'repeating-group',
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add No Access Area' },
    itemFields: numbered([
      { key: 'area', label: 'Area', type: 'text' },
      { key: 'reason', label: 'Reason', type: 'text' },
    ]),
  },
  {
    key: 'postProject',
    label: 'Post Project or Pre Project?',
    type: 'pill-select',
    options: [opt('yes', 'Yes — Post Project'), opt('no', 'No — Pre Project')],
  },
  { key: 'hasDamage', label: 'Additional Damage Present?', type: 'yesno', options: YES_NO_OPTIONS },
  damageList({ gateKey: 'hasDamage' }),
  { key: 'additionalNotes', label: 'Additional Notes', type: 'textarea', maxLength: 1000 },
]);

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) {
    // eslint-disable-next-line no-console
    console.log('[seed-templates] no ADMIN user found — aborting');
    return;
  }

  let created = 0;
  for (const { inspectionType, propertyType } of VALID_COMBOS) {
    for (const { key: sectionKey, name } of TEMPLATABLE_SECTIONS) {
      const already = await prisma.inspectionTemplate.findFirst({
        where: { inspectionType, propertyType, sectionKey, status: 'PUBLISHED' },
      });
      if (already) continue;

      const fields = SECTION_DEFAULTS[sectionKey];
      if (!fields) {
        // eslint-disable-next-line no-console
        console.warn(`[seed-templates] no defaults for section "${sectionKey}" — skipping`);
        continue;
      }

      await prisma.inspectionTemplate.create({
        data: {
          inspectionType,
          propertyType,
          sectionKey,
          name,
          version: 1,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          fields: fields as unknown as object,
          createdById: admin.id,
        },
      });
      created++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`[seed-templates] created ${created} published v1 lineages across ${VALID_COMBOS.length} combos`);
  await prisma.$disconnect();
}

void main();
