// Follow-up to move-section-photos-up.ts: that script placed the generic
// section photos field at a fixed index (4), but several templates already
// had their 'condition' field sitting at or before that same index --
// landing photos right after condition instead of before it. Inspectors
// take photos before judging condition, not after, so photos needs to
// directly precede condition specifically, not just land somewhere in the
// top 5 by coincidence.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function reorder(fields: TemplateField[]): { fields: TemplateField[]; changed: boolean } {
  const photosIdx = fields.findIndex((f) => f.key === 'photos' && f.type === 'photos');
  const conditionIdx = fields.findIndex((f) => f.key === 'condition');
  if (photosIdx === -1 || conditionIdx === -1 || photosIdx < conditionIdx) return { fields, changed: false };

  const next = [...fields];
  const [photos] = next.splice(photosIdx, 1);
  // conditionIdx shifts down by one now that photos was removed from before it.
  const insertAt = next.findIndex((f) => f.key === 'condition');
  next.splice(insertAt, 0, photos!);
  return { fields: next.map((f, i) => ({ ...f, order: i })), changed: true };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  let touched = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const { fields: nextFields, changed } = reorder(fields);
    if (!changed) continue;
    touched += 1;

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
    await prisma.templateAcceptance.deleteMany({
      where: { inspectionType: t.inspectionType, propertyType: t.propertyType, sectionKey: t.sectionKey },
    });
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (photos moved before condition)`);
  }

  console.log(`\nDONE -- ${touched} template(s) reordered.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
