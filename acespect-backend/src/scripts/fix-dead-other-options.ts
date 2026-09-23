// Flips allowOther on for every pill-select/chip-multiselect field that
// already had a plain "Other" option from historical seeding but never got
// the flag -- a dead button, selectable but with no "Please specify" box
// following it (the renderers gate that box on allowOther, not on the
// option's mere presence). Adds no new option; only unlocks the ones
// already there. Found while verifying add-other-option-app-wide.ts's run.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function fix(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const next = fields.map((f) => {
    let field = f;
    if (
      (field.type === 'pill-select' || field.type === 'chip-multiselect') &&
      !field.allowOther &&
      (field.options || []).some((o) => o.value === 'other')
    ) {
      field = { ...field, allowOther: true };
      changed++;
    }
    if (field.itemFields) {
      const sub = fix(field.itemFields);
      if (sub.changed > 0) {
        field = { ...field, itemFields: sub.fields };
        changed += sub.changed;
      }
    }
    return field;
  });
  return { fields: next, changed };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  let touchedTemplates = 0;
  let touchedFields = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const { fields: nextFields, changed } = fix(fields);
    if (changed === 0) continue;
    touchedTemplates += 1;
    touchedFields += changed;

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: t.inspectionType, propertyType: t.propertyType, sectionKey: t.sectionKey,
        name: t.name,
        version: t.version + 1,
        status: 'DRAFT',
        fields: nextFields as unknown as object,
        layout: (t.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: t.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (${changed} field(s))`);
  }

  console.log(`\nDONE -- ${touchedTemplates} template(s), ${touchedFields} field(s) unlocked.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
