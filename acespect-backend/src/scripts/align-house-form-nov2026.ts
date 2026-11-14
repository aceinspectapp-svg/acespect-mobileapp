// Dilapidation / Residential House form changes for the Nov 2026 office template's wording
// ("ACESPECT Dilapidation Residential Structure Generic_Office Template NOV 2026.dotm"):
//   - Pool / Spa asks "Pool or spa?", so the report says "There is a pool ..." or "There is a spa ...", never "pool/spa".
//   - Pool / Spa asks the fence condition and the surrounds condition; Roof asks the chimney material and condition (the
//     template's "The chimney is constructed of ... and appears to be in ... condition with ...").
//   - Driveway "Sections obscured by" offers a parked car, a trailer and a caravan as separate choices instead of one
//     "Parked cars / trailer / caravan" choice, so the report names the one that was there. Answers already given with the
//     old choice are worded "a parked vehicle" (the template's word), since they do not say which it was.
//
// Idempotent: run it twice and the second run changes nothing. No field key is renamed.
//
//   npx tsx src/scripts/align-house-form-nov2026.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-house-form-nov2026.ts              # dry run against the database
//   npx tsx src/scripts/align-house-form-nov2026.ts --apply      # publish new template versions
//
// Inspectors see the change after they accept the template update in the app.
import { addFieldAfter, addOptions, find, runAlignment, type Field } from './lib/align-helpers';

const PROFILE = { inspectionType: 'dilapidation', propertyType: 'residential_house' };
const SECTIONS = ['pool_spa', 'driveway', 'roof_chimneys'] as const;

export function alignSection(sectionKey: string, fields: Field[]): boolean {
  let changed = false;
  switch (sectionKey) {
    case 'pool_spa': {
      changed =
        addFieldAfter(fields, 'present', {
          key: 'poolKind',
          type: 'pill-select',
          label: 'Pool or spa?',
          required: true,
          gate: { fieldKey: 'present', equals: 'yes' },
          options: [
            { label: 'Pool', value: 'pool' },
            { label: 'Spa', value: 'spa' },
            { label: 'Pool and spa', value: 'pool_and_spa' },
          ],
        }) || changed;
      // "The pool fence is constructed of ... and is in {grade} condition with typical weathering. The pool surrounds are paved with ... in {grade} condition."
      const grades = find(fields, 'condition')?.options;
      if (!grades) break;
      changed =
        addFieldAfter(fields, 'fenceSafety', { key: 'fenceCondition', type: 'color-select', label: 'Pool / spa fence condition', required: false, gate: { fieldKey: 'present', equals: 'yes' }, options: grades.map((o) => ({ ...o })) }) || changed;
      changed =
        addFieldAfter(fields, 'paving', { key: 'pavingCondition', type: 'color-select', label: 'Surrounds (paving) condition', required: false, gate: { fieldKey: 'present', equals: 'yes' }, options: grades.map((o) => ({ ...o })) }) || changed;
      break;
    }
    case 'roof_chimneys': {
      // "The chimney is constructed of {material} and appears to be in {grade} condition with {what was noted}."
      const group = find(fields, 'sections');
      const inner = group?.itemFields;
      const grades = inner?.find((f) => f.key === 'condition')?.options;
      if (!inner || !grades) break;
      changed =
        addFieldAfter(inner, 'generalCondition', {
          key: 'chimneyMaterial',
          type: 'chip-multiselect',
          label: 'Chimney constructed of (leave blank if no chimney)',
          required: false,
          allowOther: true,
          options: [
            { label: 'Brick', value: 'brick' },
            { label: 'Rendered brick', value: 'rendered_brick' },
            { label: 'Stone', value: 'stone' },
            { label: 'Metal flue', value: 'metal_flue' },
          ],
        }) || changed;
      changed = addFieldAfter(inner, 'chimneyMaterial', { key: 'chimneyCondition', type: 'color-select', label: 'Chimney condition', required: false, options: grades.map((o) => ({ ...o })) }) || changed;
      break;
    }
    case 'driveway': {
      const obscured = find(fields, 'obscuredBy');
      if (!obscured?.options) break;
      const at = obscured.options.findIndex((o) => o.value === 'parked_cars_trailer_caravan');
      if (at >= 0) {
        obscured.options.splice(at, 1, { label: 'Parked car', value: 'parked_car' }, { label: 'Trailer', value: 'trailer' }, { label: 'Caravan', value: 'caravan' });
        changed = true;
      } else {
        changed = addOptions(obscured, ['Parked car', 'Trailer', 'Caravan'], 'Stored goods') || changed;
      }
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
