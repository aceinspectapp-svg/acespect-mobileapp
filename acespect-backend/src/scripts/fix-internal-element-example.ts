// The generic damage-list "Element (which part of the location, e.g. walls,
// kerb, slab)" field is shared across every section's damage-list itemFields
// app-wide -- a fine example for exterior sections (driveway, footpaths,
// elevations, retaining walls, ...) but "kerb"/"slab" mean nothing inside a
// Living Room, Bedroom, or any other Internal Areas room type. Scoped to
// sectionKey 'internal_areas' only -- every other section's damage-lists
// keep the original exterior-appropriate wording.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const OLD_LABEL = 'Element (which part of the location, e.g. walls, kerb, slab)';
const NEW_LABEL = 'Element (which part of the location, e.g. walls, ceiling, skirting, floor)';

function fixFields(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const next = fields.map((f) => {
    let field = f;
    if (field.key === 'element' && field.label === OLD_LABEL) {
      field = { ...field, label: NEW_LABEL };
      changed++;
    }
    if (field.itemFields) {
      const sub = fixFields(field.itemFields);
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

  const templates = await prisma.inspectionTemplate.findMany({
    where: { status: 'PUBLISHED', sectionKey: 'internal_areas' },
  });
  let touchedTemplates = 0;
  let touchedFields = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const { fields: nextFields, changed } = fixFields(fields);
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

  let unpinned = 0;
  if (touchedTemplates > 0) {
    const res = await prisma.templateAcceptance.deleteMany({ where: { sectionKey: 'internal_areas' } });
    unpinned = res.count;
  }

  console.log(`\nDONE -- ${touchedTemplates} template(s), ${touchedFields} field(s) fixed. ${unpinned} stale acceptance row(s) cleared.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
