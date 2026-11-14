// Dilapidation / Apartment form changes for the Nov 2026 office template's wording
// ("ACESPECT Dilapidation Multi Level Office Building _Office Template Nov 2026.dotm"). New questions only; nothing is removed or renamed:
//   - Description asks what the property is signed as, which way it faces and its design -- the template's "The property is a ... signed
//     as ..., facing ... on a ... block of land. It is of a ... design ...".
//   - The car space (External, and Garage / Carport / Sheds) asks its walls and its roof -- "There is a garage located at ..., constructed
//     of ... with a ..., and is generally in ... state of repair."
//   - A party wall asks the next property's number and which side it is on -- "The left elevation is a party wall abutting the next
//     property at No. ...".
//   - Every defect list asks where a crack runs to -- "there is a crack starting at ... and running to the ...".
//   - Job Information's weather offers the template's choices -- "Weather Conditions: Dry / Sunny / Intermittent showers / Rain /
//     Overcast" -- as the Residential form already does, instead of the Pre-Purchase form's Fine / Partly Cloudy / Light Rain. (The only
//     change of an existing question: its choices. A job saved before keeps the answer it was saved with.)
//
// Idempotent: run it twice and the second run changes nothing.
//
//   npx tsx src/scripts/align-apartment-form-nov2026.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-apartment-form-nov2026.ts              # dry run against the database
//   npx tsx src/scripts/align-apartment-form-nov2026.ts --apply      # publish new template versions
//
// Inspectors see the change after they accept the template update in the app.
import { addFieldAfter, find, runAlignment, slug, type Field } from './lib/align-helpers';

const PROFILE = { inspectionType: 'dilapidation', propertyType: 'apartment' };
const SECTIONS = ['job-info', 'description', 'elevations', 'garage_carport_sheds', 'roof_chimneys', 'internal_areas', 'paving_paths', 'notes', 'driveway', 'fences', 'retaining_walls', 'pool_spa', 'custom_structure'] as const;

const options = (labels: string[]) => labels.map((label) => ({ label, value: slug(label) }));

/** "Weather Conditions: Dry / Sunny / Intermittent showers / Rain / Overcast" -- the Residential form's choices, which follow the same words. */
const TEMPLATE_WEATHER = [
  { icon: 'cloudy-outline', label: 'Overcast', value: 'overcast' },
  { icon: 'thermometer-outline', label: 'Dry', value: 'dry' },
  { icon: 'sunny-outline', label: 'Sunny', value: 'sunny' },
  { icon: 'partly-sunny-outline', label: 'Intermittent showers', value: 'intermittent_showers' },
  { icon: 'rainy-outline', label: 'Rain', value: 'rain' },
  { icon: 'ellipsis-horizontal-circle-outline', label: 'Other', value: 'other' },
];

/** "Running to" after "Starting from location" in every defect list, at any depth. */
function addCrackEnd(fields: Field[]): boolean {
  let changed = false;
  for (const f of fields) {
    if (f.type === 'damage-list' && f.itemFields?.some((x) => x.key === 'crackStartLocation')) {
      const start = f.itemFields.find((x) => x.key === 'crackStartLocation')!;
      changed = addFieldAfter(f.itemFields, 'crackStartLocation', { key: 'crackEndLocation', type: 'text', label: 'Running to location', required: false, gate: start.gate }) || changed;
    }
    if (f.itemFields) changed = addCrackEnd(f.itemFields) || changed;
  }
  return changed;
}

/** The car space's walls and roof, asked only when there is one. */
function addCarSpace(fields: Field[], prefix: string): boolean {
  const type = find(fields, `${prefix}_type`);
  if (!type?.options) return false;
  const some = type.options.filter((o) => !/^no car space/i.test(o.label)).map((o) => o.value);
  const gate = { fieldKey: `${prefix}_type`, equalsAny: some };
  let changed = addFieldAfter(fields, `${prefix}_type`, {
    key: `${prefix}_walls`,
    type: 'pill-select',
    label: 'Constructed of',
    required: false,
    allowOther: true,
    gate,
    options: options(['Concrete', 'Brick', 'Blockwork', 'Precast concrete panels']),
  });
  changed =
    addFieldAfter(fields, `${prefix}_walls`, { key: `${prefix}_roof`, type: 'pill-select', label: 'Roof / ceiling', required: false, allowOther: true, gate, options: options(['Concrete slab', 'Metal deck', 'No roof (open)']) }) ||
    changed;
  return changed;
}

export function alignSection(sectionKey: string, fields: Field[]): boolean {
  let changed = addCrackEnd(fields);
  switch (sectionKey) {
    case 'job-info': {
      // The template's weather, with the same icons as the Residential form's.
      const weather = find(fields, 'weather');
      if (weather && weather.options?.map((o) => o.label).join('|') !== TEMPLATE_WEATHER.map((o) => o.label).join('|')) {
        weather.options = TEMPLATE_WEATHER.map((o) => ({ ...o }));
        changed = true;
      }
      break;
    }
    case 'description':
      changed = addFieldAfter(fields, 'storeys', { key: 'signedAs', type: 'text', label: 'Signed as (e.g. Unit 7)', required: false }) || changed;
      changed =
        addFieldAfter(fields, 'signedAs', {
          key: 'facing',
          type: 'pill-select',
          label: 'Facing',
          required: false,
          options: options(['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west']),
        }) || changed;
      changed =
        addFieldAfter(fields, 'slope', {
          key: 'design',
          type: 'pill-select',
          label: 'Design',
          required: false,
          allowOther: true,
          options: options(['Contemporary', 'Modern', 'Art Deco', 'Post-war', 'Mid-century']),
        }) || changed;
      break;
    case 'elevations': {
      const gate = { fieldKey: 'elev_overview_partyWall', equals: 'yes' };
      changed = addFieldAfter(fields, 'elev_overview_partyWall', { key: 'elev_overview_partyWallSide', type: 'pill-select', label: 'Party wall elevation', required: false, gate, options: options(['Front', 'Left', 'Rear', 'Right']) }) || changed;
      changed = addFieldAfter(fields, 'elev_overview_partyWallSide', { key: 'elev_overview_partyWallNo', type: 'text', label: 'Next property No. (e.g. 12)', required: false, gate }) || changed;
      changed = addCarSpace(fields, 'garage') || changed;
      break;
    }
    case 'garage_carport_sheds':
      changed = addCarSpace(fields, 'carspace') || changed;
      break;
  }
  return changed;
}

if (require.main === module) {
  runAlignment(PROFILE, SECTIONS, alignSection).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
