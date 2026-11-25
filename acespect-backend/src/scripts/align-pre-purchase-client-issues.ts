// Pre-Purchase: "Client list of issues" gets a box to write the issues in.
// The question was only Yes / N/A, with nowhere to put the issues themselves. The client's issues usually arrive with the job brief
// in Zeus, so when the inspector answers Yes a text box opens under the question for them to paste or type (or dictate: every text box
// on the phone has the mic). Apartment and Commercial ask the question on Job Information; the House form asks it on Description &
// Overview.
//
// Idempotent: run it twice and the second run changes nothing. No field key is renamed or removed.
//
//   npx tsx src/scripts/align-pre-purchase-client-issues.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-pre-purchase-client-issues.ts              # dry run against the database
//   npx tsx src/scripts/align-pre-purchase-client-issues.ts --apply      # publish new template versions
import { addFieldAfter, find, runAlignment, type Field } from './lib/align-helpers';

const QUESTION = 'clientListOfIssues';

export function alignSection(_sectionKey: string, fields: Field[]): boolean {
  const question = find(fields, QUESTION);
  // The question's own "Yes" answer opens the box (its value differs per form: "item0" on Apartment / Commercial, "yes_answer_every_item" on House).
  const yes = question?.options?.find((o) => /^yes\b/i.test(o.label));
  if (!question || !yes) return false;
  return addFieldAfter(fields, QUESTION, {
    key: 'clientIssues',
    type: 'textarea',
    label: "Client's issues — paste them from the Zeus job brief, or type or dictate them",
    required: true,
    gate: { fieldKey: QUESTION, equals: yes.value },
  });
}

async function main() {
  for (const [propertyType, sectionKey] of [
    ['apartment', 'job-info'],
    ['commercial_properties', 'job-info'],
    ['residential_house', 'description'],
  ] as const) {
    await runAlignment({ inspectionType: 'pre_purchase', propertyType }, [sectionKey], alignSection);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
