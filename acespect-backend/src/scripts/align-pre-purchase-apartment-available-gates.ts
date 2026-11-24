// Pre-Purchase / Apartment: an elevation or room answered "No" to "Available for inspection?" / "Present?" asks nothing more.
// Each elevation tab (External) and each room tab (Internal – Unit Areas) starts with that question, but nothing under it was gated
// on it: after "No" the inspector still had to pick an orientation, a condition, obstructions, a floor level and so on, and a
// condition left at Average / Poor still demanded a defect. Every other question in the tab now only shows on "Yes".
//
// A question that already opens on another answer (the damages list opens on "Any damage? Yes") keeps that gate: the question it
// hangs on now hides on "No", and the app and website treat a question whose opener is hidden as hidden too (withoutHiddenAnswers).
//
// Idempotent: run it twice and the second run changes nothing. No field key is renamed or removed.
//
//   npx tsx src/scripts/align-pre-purchase-apartment-available-gates.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-pre-purchase-apartment-available-gates.ts              # dry run against the database
//   npx tsx src/scripts/align-pre-purchase-apartment-available-gates.ts --apply      # publish new template versions
import { find, runAlignment, type Field } from './lib/align-helpers';

const PROFILE = { inspectionType: 'pre_purchase', propertyType: 'apartment' };
/** The tab group in each section, and its "available" question. */
const GROUPS: Record<string, { group: string; available: string }> = {
  elevations: { group: 'sides', available: 'available' },
  internal_areas: { group: 'rooms', available: 'available' },
};

export function alignSection(sectionKey: string, fields: Field[]): boolean {
  const spec = GROUPS[sectionKey];
  const group = spec ? find(fields, spec.group) : undefined;
  if (!spec || !group?.itemFields?.some((f) => f.key === spec.available)) return false;
  let changed = false;
  for (const f of group.itemFields) {
    if (f.key === spec.available || f.gate) continue;
    f.gate = { fieldKey: spec.available, equals: 'yes' };
    changed = true;
  }
  return changed;
}

if (require.main === module) {
  runAlignment(PROFILE, Object.keys(GROUPS), alignSection).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
