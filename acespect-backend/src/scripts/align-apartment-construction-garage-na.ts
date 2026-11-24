// Construction Stage / Apartment: the garage checklist rows get an "N/A" answer.
// The Apartment forms ask about garage doors, garage framing, garage plastering and garage architraves, but most apartments have no
// garage of their own, and those rows had no answer that says so. The inspector had to pick "OK" or "Not yet" for something that does
// not exist. "N/A" uses the value every other checklist row uses (n_a), so the report prints it as Not applicable.
//
// Idempotent: run it twice and the second run changes nothing. No field key is renamed or removed.
//
//   npx tsx src/scripts/align-apartment-construction-garage-na.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-apartment-construction-garage-na.ts              # dry run against the database
//   npx tsx src/scripts/align-apartment-construction-garage-na.ts --apply      # publish new template versions
//
// Inspectors see the change after they accept the template update in the app.
import { find, runAlignment, type Field } from './lib/align-helpers';

const PROFILE = { inspectionType: 'construction_stage', propertyType: 'apartment' };
/** Each section's garage rows. */
const GARAGE_ROWS: Record<string, string[]> = {
  pp_formwork: ['garageSlab'],
  fr_roof_frame: ['garageFramingTrusses', 'garageFraming'],
  lu_doors_windows: ['garageDoors'],
  fx_doors_windows: ['garageDoors'],
  fx_walls_ceilings: ['garagePlastering'],
  fx_fitout: ['garageArchitraves'],
  lf_doors_windows: ['garageDoors'],
  lf_walls_ceilings: ['garagePlastering'],
  lf_fitout: ['garageArchitraves'],
};

export function alignSection(sectionKey: string, fields: Field[]): boolean {
  let changed = false;
  for (const key of GARAGE_ROWS[sectionKey] ?? []) {
    const field = find(fields, key);
    if (!field?.options || field.options.some((o) => o.value === 'n_a')) continue;
    field.options.unshift({ label: 'N/A', value: 'n_a' });
    changed = true;
  }
  return changed;
}

if (require.main === module) {
  runAlignment(PROFILE, Object.keys(GARAGE_ROWS), alignSection).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
