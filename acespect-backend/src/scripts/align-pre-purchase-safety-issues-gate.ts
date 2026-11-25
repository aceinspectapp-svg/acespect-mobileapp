// Pre-Purchase / Apartment and Commercial: "Describe safety issues" opens -- and is required -- only when "Safety issues?" is Yes.
// Both forms asked for the description on every inspection, so an inspector who answered "No" still had to type something before Next
// unlocked. The House form already gates it this way ({ fieldKey: 'safetyIssues', equals: 'yes' }); this gives Apartment and Commercial
// the same gate. A required question behind a closed gate is not asked (the app and the website skip it), so "No" asks nothing more.
//
// Idempotent: run it twice and the second run changes nothing. No field key is renamed or removed; a description already typed is kept.
//
//   npx tsx src/scripts/align-pre-purchase-safety-issues-gate.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-pre-purchase-safety-issues-gate.ts              # dry run against the database
//   npx tsx src/scripts/align-pre-purchase-safety-issues-gate.ts --apply      # publish new template versions
//
// Inspectors see the change after they accept the template update in the app.
import { find, runAlignment, type Field } from './lib/align-helpers';

const QUESTION = 'safetyIssues';
const DESCRIBE = 'safetyIssuesDescribe';

export function alignSection(_sectionKey: string, fields: Field[]): boolean {
  const question = find(fields, QUESTION);
  const describe = find(fields, DESCRIBE);
  if (!question || !describe) return false;
  // The question's own "Yes" value (both forms store it as "yes").
  const yes = question.options?.find((o) => /^yes\b/i.test(o.label))?.value ?? 'yes';
  const gate = describe.gate as { fieldKey?: string; equals?: unknown } | undefined;
  let changed = false;
  if (gate?.fieldKey !== QUESTION || gate?.equals !== yes) {
    describe.gate = { fieldKey: QUESTION, equals: yes };
    changed = true;
  }
  if (describe.required !== true) {
    describe.required = true;
    changed = true;
  }
  return changed;
}

async function main() {
  for (const propertyType of ['apartment', 'commercial_properties'] as const) {
    await runAlignment({ inspectionType: 'pre_purchase', propertyType }, ['job-info'], alignSection);
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
