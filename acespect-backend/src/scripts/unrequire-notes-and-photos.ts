// Makes every "notes" and "photos" field optional app-wide, at any nesting
// depth (top-level, inside a repeating-group's itemFields, inside a nested
// damage-list within that, etc.) -- per direct inspector feedback that these
// two shouldn't block completing a section the way every other required
// field does. Everything else stays required exactly as it was.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function unrequire(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const next = fields.map((f) => {
    let field = f;
    if ((f.key === 'notes' || f.key === 'photos') && f.required) {
      field = { ...field, required: false };
      changed++;
    }
    if (field.itemFields) {
      const sub = unrequire(field.itemFields);
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
    const { fields: nextFields, changed } = unrequire(fields);
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

  console.log(`\nDONE -- ${touchedTemplates} template(s), ${touchedFields} field(s) unrequired.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
