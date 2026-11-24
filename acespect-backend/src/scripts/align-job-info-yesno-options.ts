// Job Information: yes/no questions get their Yes / No options written into the form.
// The phone's Job Information screen draws a yes/no question's buttons from the question's option list. Two questions were published
// without one -- Pre-Purchase / House "Occupied?" and Dilapidation / House "Post project?" -- so the phone showed the question with no
// buttons, and "Occupied?" (required) left Next locked: an inspector could not start a Pre-Purchase house inspection. The app is fixed
// too (it falls back to Yes / No), but phones only get that with an app update; this script fixes the forms themselves, which phones
// pick up when the inspector accepts the template update.
//
// Idempotent: run it twice and the second run changes nothing. Values stay "yes" / "no", the same as every other yes/no question.
//
//   npx tsx src/scripts/align-job-info-yesno-options.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-job-info-yesno-options.ts              # dry run against the database
//   npx tsx src/scripts/align-job-info-yesno-options.ts --apply      # publish new template versions
import { runAlignment, type Field } from './lib/align-helpers';

const YES_NO = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

export function alignSection(_sectionKey: string, fields: Field[]): boolean {
  let changed = false;
  for (const f of fields) {
    if (f.type !== 'yesno' || f.options?.length) continue;
    f.options = YES_NO.map((o) => ({ ...o }));
    changed = true;
  }
  return changed;
}

async function main() {
  for (const profile of [
    { inspectionType: 'pre_purchase', propertyType: 'residential_house' },
    { inspectionType: 'dilapidation', propertyType: 'residential_house' },
  ]) {
    await runAlignment(profile, ['job-info'], alignSection);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
