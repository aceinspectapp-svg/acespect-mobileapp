// Read-only: finds every itemFields/fields array (at any nesting depth, any
// inspection type / property type) that has more than one field sharing the
// same `key` -- these collide as React list keys on mobile and, worse, one
// copy's `gate` can silently override the other's visibility.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function walk(fields: TemplateField[], path: string, report: (path: string, dupes: TemplateField[]) => void) {
  const byKey = new Map<string, TemplateField[]>();
  for (const f of fields) {
    if (!byKey.has(f.key)) byKey.set(f.key, []);
    byKey.get(f.key)!.push(f);
  }
  for (const [key, group] of byKey) {
    if (group.length > 1) report(`${path} [${key}]`, group);
  }
  for (const f of fields) {
    if (f.itemFields) walk(f.itemFields, `${path}.${f.key}`, report);
  }
}

async function main() {
  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  let totalDupeGroups = 0;
  let templatesAffected = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const rows: string[] = [];
    walk(fields, `${t.inspectionType}/${t.propertyType}/${t.sectionKey}`, (path, dupes) => {
      totalDupeGroups += 1;
      rows.push(`  ${path}: ${dupes.length}x  gates=${dupes.map((d) => JSON.stringify(d.gate)).join(' | ')}`);
    });
    if (rows.length) {
      templatesAffected += 1;
      console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} v${t.version}`);
      rows.forEach((r) => console.log(r));
    }
  }

  console.log(`\nSUMMARY: ${templatesAffected} template(s) affected, ${totalDupeGroups} duplicate-key group(s) total.`);
  await prisma.$disconnect();
}

void main();
