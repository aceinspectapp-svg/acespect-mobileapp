// Read-only: finds every damage-list whose own `gate` points at a field
// OTHER than "present" (a legitimate "is this feature here at all" gate) or
// the condition field its own requireWhen is keyed to (a legitimate
// show-once-condition-warrants-it gate, e.g. Retaining Walls). Anything else
// is a leftover legacy gate blocking the field behind an unrelated question.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function walk(fields: TemplateField[], path: string, cb: (f: TemplateField, path: string) => void) {
  for (const f of fields) {
    cb(f, path);
    if (f.itemFields) walk(f.itemFields, `${path}.${f.key}`, cb);
  }
}

async function main() {
  const ts = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED', inspectionType: 'dilapidation' } });
  let count = 0;
  for (const t of ts) {
    walk(t.fields as unknown as TemplateField[], `${t.propertyType}/${t.sectionKey}`, (f, path) => {
      if (f.type !== 'damage-list' || !f.gate) return;
      const condKey = f.repeat?.requireWhen?.fieldKey;
      if (f.gate.fieldKey === 'present' || f.gate.fieldKey === condKey) return;
      count += 1;
      console.log(`${path}.${f.key}: gate on "${f.gate.fieldKey}" (=${f.gate.equals ?? f.gate.equalsAny}) -- unrelated to condition ("${condKey}")`);
    });
  }
  console.log(`\n${count} orphan gate(s) found.`);
  await prisma.$disconnect();
}
void main();
