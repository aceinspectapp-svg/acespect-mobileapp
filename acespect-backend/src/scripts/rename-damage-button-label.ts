// Global rename: every published template's damage-list "Add damage item"
// button becomes "Add damage/defect" -- direct inspector feedback, applied
// everywhere at once rather than section by section. Walks each published
// template's full field tree (repeating-groups/damage-lists nest, so this
// recurses) and rewrites any `repeat.addButtonLabel` that's exactly the old
// string; nothing else about the templates changes, so this bumps a new
// version on every template touched but changes only that one string.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const OLD_LABEL = 'Add damage item';
const NEW_LABEL = 'Add damage/defect';

function rewrite(fields: TemplateField[]): { fields: TemplateField[]; changed: boolean } {
  let changed = false;
  const next = fields.map((f) => {
    let field = f;
    if (field.repeat?.addButtonLabel === OLD_LABEL) {
      changed = true;
      field = { ...field, repeat: { ...field.repeat, addButtonLabel: NEW_LABEL } };
    }
    if (field.itemFields) {
      const inner = rewrite(field.itemFields);
      if (inner.changed) {
        changed = true;
        field = { ...field, itemFields: inner.fields };
      }
    }
    return field;
  });
  return { fields: next, changed };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const published = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  let touched = 0;

  for (const t of published) {
    const { fields, changed } = rewrite(t.fields as unknown as TemplateField[]);
    if (!changed) continue;
    touched += 1;

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: t.inspectionType, propertyType: t.propertyType, sectionKey: t.sectionKey,
        name: t.name,
        version: t.version + 1,
        status: 'DRAFT',
        fields: fields as unknown as object,
        layout: (t.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: t.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    // eslint-disable-next-line no-console
    console.log(`[rename-damage-button] ${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[rename-damage-button] done -- ${touched} template(s) updated`);
  await prisma.$disconnect();
}

void main();
