import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function walk(fields: TemplateField[], path: string, cb: (f: TemplateField, path: string, siblings: TemplateField[]) => void) {
  for (const f of fields) {
    cb(f, path, fields);
    if (f.itemFields) walk(f.itemFields, path + '.' + f.key, cb);
  }
}

async function main() {
  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  console.log(`Auditing ${templates.length} published templates\n`);

  console.log('=== CONDITION-LIKE FIELDS ===');
  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    walk(fields, `${t.inspectionType}/${t.propertyType}/${t.sectionKey}`, (f, path) => {
      const keyLower = f.key.toLowerCase();
      if (keyLower.includes('condition') && (f.type === 'color-select' || f.type === 'chip-multiselect' || f.type === 'pill-select')) {
        const opts = (f.options || []).map((o) => o.value).join(',');
        console.log(`${path}.${f.key} [${f.type}]: ${opts}`);
      }
    });
  }

  console.log('\n=== "OTHER" OPTIONS MISSING A COMPANION TEXT BOX ===');
  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    walk(fields, `${t.inspectionType}/${t.propertyType}/${t.sectionKey}`, (f, path, siblings) => {
      const hasOther = (f.options || []).some((o) => o.value === 'other');
      if (!hasOther) return;
      const hasCompanion = siblings.some(
        (s) => s.gate && s.gate.fieldKey === f.key && (s.gate.equals === 'other' || s.gate.equalsAny?.includes('other')),
      );
      if (!hasCompanion) {
        console.log(`${path}.${f.key} [${f.type}] -- MISSING companion box`);
      }
    });
  }

  await prisma.$disconnect();
}
void main();
