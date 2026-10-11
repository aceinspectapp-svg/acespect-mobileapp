// Aligns the Dilapidation / Residential House form with the REAL inspector template
// ("HOUSPECT VIC DILAPIDATION Residential Structures - Inspector Template (Std) At 1 May 2024").
//
// Additive and idempotent: it adds the fields and choices the real form has and ours lacked, and changes the
// labels / order of the fixed room list to the real form's. It never renames or removes a field key, so
// inspections already in progress keep their answers. Run it twice and the second run changes nothing.
//
//   npx tsx src/scripts/align-house-form-to-inspector-template.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-house-form-to-inspector-template.ts              # dry run against the database
//   npx tsx src/scripts/align-house-form-to-inspector-template.ts --apply      # publish new template versions
//
// Inspectors see the change after they accept the template update in the app.
import { addFieldAfter, addOptions, find, relabelFixed, renumber, runAlignment, slug, type Field, type Option } from './lib/align-helpers';

const PROFILE = { inspectionType: 'dilapidation', propertyType: 'residential_house' };
const SECTIONS = ['job-info', 'description', 'fences', 'retaining_walls', 'garage_carport_sheds', 'roof_chimneys', 'internal_areas'] as const;

const CONDITION_DETAILS: Option[] = [
  { label: 'Typical weathering and some gaps', value: 'typical_weathering_and_some_gaps' },
  { label: 'Decayed', value: 'decayed' },
  { label: 'Loose or missing palings', value: 'loose_or_missing_palings' },
  { label: 'Leaning', value: 'leaning' },
];

/** Applies the alignment to one section's fields in place. Returns true if anything changed. */
export function alignSection(sectionKey: string, fields: Field[]): boolean {
  let changed = false;
  switch (sectionKey) {
    case 'job-info': {
      // "If house converted to business: provide business name / signage (& take photos)", the photo sequence for the job, and POST PROJECT?
      changed = addFieldAfter(fields, 'inspectionAddress', { key: 'businessName', type: 'text', label: 'If house converted to business: business name / signage', required: false }) || changed;
      changed = addFieldAfter(fields, 'businessName', { key: 'businessSignage', type: 'photos', label: 'Business signage (take photos)', required: false }) || changed;
      changed = addFieldAfter(fields, 'weatherOther', { key: 'firstPicNo', type: 'text', label: 'Photos sequence for entire job - 1st pic no', required: false }) || changed;
      changed = addFieldAfter(fields, 'firstPicNo', { key: 'lastPicNo', type: 'text', label: 'Photos sequence for entire job - last pic no', required: false }) || changed;
      changed = addFieldAfter(fields, 'lastPicNo', { key: 'postProject', type: 'yesno', label: 'Post project? (if yes, use the previous report and update every item with new pics)', required: false }) || changed;
      break;
    }
    case 'description': {
      changed = addOptions(find(fields, 'constructionIs'), ['Apartment in a multi-level apartment complex']) || changed;
      changed = addOptions(find(fields, 'wallCladdingGround'), ['Combo of']) || changed;
      changed = addOptions(find(fields, 'wallCladdingFirst'), ['Combo of']) || changed;
      changed = addOptions(find(fields, 'roofCovering'), ['Mix of']) || changed;
      changed = addOptions(find(fields, 'windows'), ['Mix of aluminium and timber'], 'Steel') || changed;
      break;
    }
    case 'fences':
    case 'retaining_walls': {
      const items = find(fields, 'items');
      const inner = items?.itemFields;
      if (inner && !inner.some((f) => f.key === 'conditionDetails')) {
        const at = inner.findIndex((f) => f.key === 'condition');
        inner.splice(at + 1, 0, {
          key: 'conditionDetails',
          type: 'chip-multiselect',
          label: 'Condition - what was noted',
          order: 0,
          required: false,
          options: CONDITION_DETAILS.map((o) => ({ ...o })),
          allowOther: true,
          ...(inner[at]?.gate ? { gate: inner[at].gate } : {}),
        });
        renumber(inner);
        changed = true;
      }
      break;
    }
    case 'garage_carport_sheds': {
      const group = find(fields, 'structures');
      if (group?.itemFields && !group.itemFields.some((f) => f.key === 'structureName')) {
        group.itemFields.unshift({ key: 'structureName', type: 'text', label: 'Name this structure (e.g. Pergola, Shed) - optional', order: 0, required: false });
        renumber(group.itemFields);
        changed = true;
      }
      break;
    }
    case 'roof_chimneys': {
      const group = find(fields, 'sections');
      const inner = group?.itemFields;
      if (inner) {
        changed = addOptions(find(inner, 'inspectionStatus'), ['Not applicable - apartment'], 'No chimney/s') || changed;
        if (!inner.some((f) => f.key === 'generalCondition')) {
          const at = inner.findIndex((f) => f.key === 'condition');
          inner.splice(at + 1, 0, {
            key: 'generalCondition',
            type: 'chip-multiselect',
            label: 'General condition - what was noted',
            order: 0,
            required: false,
            options: [
              'Satisfactory to fair with typical weathering',
              'Some surface rust',
              'Cracked tiles',
              'Gaps at flashings',
              'Gaps / cracking to chimney brickwork',
              'Chimney appears unstable',
            ].map((label) => ({ label, value: slug(label) })),
            allowOther: true,
          });
          renumber(inner);
          changed = true;
        }
      }
      break;
    }
    case 'internal_areas': {
      const rooms = find(fields, 'rooms');
      if (rooms) {
        // The real form's room list, in its order. Existing keys keep their answers; only labels change, and new rooms are added.
        changed =
          relabelFixed(rooms, [
            { key: 'front_entry_hallway', label: 'Front entry and hallway' },
            { key: 'kitchen', label: 'Kitchen / Family / Living' },
            { key: 'living_room', label: 'Lounge (separate, if any)' },
            { key: 'dining_area', label: 'Dining (separate, if any)' },
            { key: 'bedroom', label: 'Bedroom 1' },
            { key: 'bedroom_2', label: 'Bedroom 2' },
            { key: 'bedroom_3', label: 'Bedroom 3' },
            { key: 'bedroom_4_study', label: 'Bedroom 4 / Study' },
            { key: 'bathroom', label: 'Bathroom' },
            { key: 'toilet', label: 'WC / Powder room' },
            { key: 'laundry', label: 'Laundry' },
            { key: 'stairwell', label: 'Stairs / Stairwell / Landing / hallway' },
            { key: 'balcony_terrace', label: 'Balcony / Terrace' },
            { key: 'other', label: 'Other internal area' },
          ]) || changed;
        // "Bedroom 1 [ ] with Ensuite": the real form's tick box, on Bedroom 1 and Bedroom 2 only. Ticked, the report words the
        // room "Bedroom 1 and ensuite". `__instanceKey` is the existing synthetic gate that names the room the field is asked in.
        const inner = rooms.itemFields;
        const ensuiteGate = { fieldKey: '__instanceKey', equalsAny: ['bedroom', 'bedroom_2'] };
        const existing = inner?.find((f) => f.key === 'withEnsuite');
        if (inner && !existing) {
          const at = inner.findIndex((f) => f.key === 'floorLevel');
          inner.splice(at + 1, 0, { key: 'withEnsuite', type: 'yesno', label: 'With ensuite?', order: 0, required: false, gate: ensuiteGate });
          renumber(inner);
          changed = true;
        } else if (existing && JSON.stringify(existing.gate) !== JSON.stringify(ensuiteGate)) {
          existing.gate = ensuiteGate;
          existing.label = 'With ensuite?';
          changed = true;
        }
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
