// Aligns the Dilapidation / Commercial Properties form with the REAL inspector template
// ("HOUSPECT VIC Dilapidation Industrial / Commercial Structures - Inspector Template At 1 May 2024").
//
// Additive and idempotent: it adds the fields and choices the real form has and ours lacked. It never renames or removes a
// field key, so inspections already in progress keep their answers. Run it twice and the second run changes nothing.
//
//   npx tsx src/scripts/align-commercial-form-to-inspector-template.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-commercial-form-to-inspector-template.ts              # dry run against the database
//   npx tsx src/scripts/align-commercial-form-to-inspector-template.ts --apply      # publish new template versions
//
// Inspectors see the change after they accept the template update in the app.
import { addFieldAfter, addOptions, find, renumber, runAlignment, slug, type Field } from './lib/align-helpers';

const PROFILE = { inspectionType: 'dilapidation', propertyType: 'commercial_properties' };
const SECTIONS = ['job-info', 'driveway', 'fences', 'retaining_walls', 'roof_chimneys'] as const;

const chips = (labels: string[]) => labels.map((label) => ({ label, value: slug(label) }));

/** "Condition - what was noted" on a fence / retaining wall: the real form's condition choices beyond the grade. */
function addConditionDetails(items: Field | undefined, labels: string[]): boolean {
  const inner = items?.itemFields;
  if (!inner || inner.some((f) => f.key === 'conditionDetails')) return false;
  const at = inner.findIndex((f) => f.key === 'condition');
  inner.splice(at + 1, 0, {
    key: 'conditionDetails',
    type: 'chip-multiselect',
    label: 'Condition - what was noted',
    order: 0,
    required: false,
    options: chips(labels),
    allowOther: true,
    ...(inner[at]?.gate ? { gate: inner[at].gate } : {}),
  });
  renumber(inner);
  return true;
}

/** Applies the alignment to one section's fields in place. Returns true if anything changed. */
export function alignSection(sectionKey: string, fields: Field[]): boolean {
  let changed = false;
  switch (sectionKey) {
    case 'job-info': {
      // "Photos sequence for entire Job: 1st pic No / Last pic No"
      changed = addFieldAfter(fields, 'weatherOther', { key: 'firstPicNo', type: 'text', label: 'Photos sequence for entire job - 1st pic no', required: false }) || changed;
      changed = addFieldAfter(fields, 'firstPicNo', { key: 'lastPicNo', type: 'text', label: 'Photos sequence for entire job - last pic no', required: false }) || changed;
      break;
    }
    case 'driveway': {
      // The real form lists them one by one: "vegetation / parked cars / trailer / caravan / stored goods / other".
      changed = addOptions(find(fields, 'obscuredBy'), ['Parked cars', 'Trailer', 'Caravan'], 'Parked cars / trailer / caravan') || changed;
      break;
    }
    case 'fences': {
      changed = addConditionDetails(find(fields, 'items'), ['Typical weathering and some gaps', 'Decayed', 'Loose or missing palings', 'Leaning']) || changed;
      break;
    }
    case 'retaining_walls': {
      changed = addConditionDetails(find(fields, 'items'), ['Typical weathering and some gaps', 'Decayed', 'Leaning']) || changed;
      break;
    }
    case 'roof_chimneys': {
      // "Limited observations from ground level using camera zoom indicate the roof is generally: [ ] Satisfactory to fair with typical weathering [ ] some surface rust ..."
      changed =
        addFieldAfter(fields, 'generalCondition', {
          key: 'generalObservations',
          type: 'chip-multiselect',
          label: 'General condition - what was noted',
          required: false,
          options: chips(['Satisfactory to fair with typical weathering', 'Some surface rust', 'Gaps at flashings', 'Gaps / cracking to chimney brickwork', 'Chimney appears unstable']),
          allowOther: true,
        }) || changed;
      break;
    }
  }
  return changed;
}

if (require.main === module) {
  runAlignment(PROFILE, SECTIONS, alignSection).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
