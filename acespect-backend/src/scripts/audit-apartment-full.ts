// Read-only: every damage-list on Dilapidation/Apartment, with its full
// gate + requireWhen + paired-condition state, section by section.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function walk(fields: TemplateField[], path: string, cb: (f: TemplateField, path: string, siblings: TemplateField[]) => void) {
  for (const f of fields) {
    cb(f, path, fields);
    if (f.itemFields) walk(f.itemFields, `${path}.${f.key}`, cb);
  }
}

async function main() {
  const ts = await prisma.inspectionTemplate.findMany({
    where: { status: 'PUBLISHED', inspectionType: 'dilapidation', propertyType: 'apartment' },
    orderBy: { sectionKey: 'asc' },
  });
  for (const t of ts) {
    const fields = t.fields as unknown as TemplateField[];
    const rows: string[] = [];
    walk(fields, t.sectionKey, (f, path, siblings) => {
      if (f.type !== 'damage-list') return;
      const hasTaxonomy = (f.itemFields ?? []).some((x) => x.key === 'sub_cracking');
      const cond = siblings.find((s) => s.key.toLowerCase().includes('condition') && s.options?.length);
      rows.push(
        `    ${path}.${f.key}: gate=${JSON.stringify(f.gate)} requireWhen=${JSON.stringify(f.repeat?.requireWhen)} taxonomy=${hasTaxonomy} conditionSibling=${cond?.key ?? 'NONE'}`,
      );
    });
    console.log(`${t.sectionKey} v${t.version}${rows.length ? '' : '  (no damage-lists)'}`);
    rows.forEach((r) => console.log(r));
  }
  await prisma.$disconnect();
}
void main();
