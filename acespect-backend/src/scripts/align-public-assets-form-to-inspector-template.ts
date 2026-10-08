// Aligns the Dilapidation / Public Assets form with the REAL inspector template
// ("HOUSPECT VICTORIA DILAPIDATION REPORT PUBLIC ASSETS - Inspector Template Type 1", 12 September 2020).
//
// Additive and idempotent: it adds the fields and choices the real form has and ours lacked. It never renames or removes a
// field key, so inspections already in progress keep their answers. Run it twice and the second run changes nothing.
//
//   npx tsx src/scripts/align-public-assets-form-to-inspector-template.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-public-assets-form-to-inspector-template.ts              # dry run against the database
//   npx tsx src/scripts/align-public-assets-form-to-inspector-template.ts --apply      # publish new template versions
//
// Inspectors see the change after they accept the template update in the app.
import { addFieldAfter, addOptions, find, runAlignment, type Field } from './lib/align-helpers';

const PROFILE = { inspectionType: 'dilapidation', propertyType: 'public_assets' };
const SECTIONS = ['job-info', 'elevations'] as const;

/** What each category's "Details" line offers, beyond the choices the form already has (the real form words them differently per category). */
const SUMMARY_EXTRAS: Record<string, string[]> = {
  footpaths_summary: ['Damage to fence / gate'], // "... / is damage to fence/gate at ... / other"
  naturestrip_summary: ['Several minor items of deterioration', 'Numerous items of deterioration throughout'], // "no visible significant damage / are several minor items of deterioration / are numerous items of deterioration throughout"
  kerbs_summary: ['Numerous items of deterioration throughout'],
  roadsurface_summary: ['Numerous items of deterioration throughout'],
  fenceleft_summary: ['Numerous items of deterioration throughout'],
  fenceright_summary: ['Numerous items of deterioration throughout'],
  lanesurface_summary: ['Numerous items of deterioration throughout'],
};

const DEFECT_KINDS = ['OK', 'Crack', 'Subsidence', 'Gap', 'Chipping', 'Leaning', 'Damage', 'Rust', 'Graffiti'];

/** Applies the alignment to one section's fields in place. Returns true if anything changed. */
export function alignSection(sectionKey: string, fields: Field[]): boolean {
  let changed = false;
  switch (sectionKey) {
    case 'job-info': {
      // "Business signage: Business Name / signage (& take photos)"
      changed = addFieldAfter(fields, 'inspectionAddress', { key: 'businessName', type: 'text', label: 'Business name / signage', required: false }) || changed;
      changed = addFieldAfter(fields, 'businessName', { key: 'businessSignage', type: 'photos', label: 'Business signage (take photos)', required: false }) || changed;
      break;
    }
    case 'elevations': {
      const parts = find(fields, 'parts');
      const inner = parts?.itemFields;
      if (!inner) break;
      for (const [key, labels] of Object.entries(SUMMARY_EXTRAS)) {
        const field = inner.find((f) => f.key === key);
        if (!field?.options) continue;
        // before the trailing "Other" choice
        changed = addOptions(field, labels, 'Other') || changed;
      }
      // Each street asset: "Crack / subsidence / gap / chipping / OK", "Leaning / subsidence / damage / OK", ... -- what is wrong with it.
      for (const f of inner) {
        if (!f.key.endsWith('_assets') || !f.itemFields) continue;
        if (f.itemFields.some((g) => g.key === 'defectKind')) continue;
        const at = f.itemFields.findIndex((g) => g.key === 'condition');
        f.itemFields.splice(at + 1, 0, {
          key: 'defectKind',
          type: 'pill-select',
          label: 'Defect noted (Crack / subsidence / gap / chipping / leaning / damage ... or OK)',
          order: 0,
          required: false,
          options: DEFECT_KINDS.map((label) => ({ label, value: label.toLowerCase() })),
        });
        f.itemFields.forEach((g, i) => (g.order = i));
        changed = true;
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
