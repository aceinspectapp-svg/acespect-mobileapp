// The generic "take photos of this whole section" field (key:'photos',
// labeled "Pics" / "Driveway pics" / "Pool / spa pics" / "Photo Nos")
// consistently sits right before Notes at the very bottom of a template --
// annoying when photos are one of the first things an inspector actually
// captures on site. Moved into the top 5 top-level fields (index 4, the 5th
// slot) -- not first (a yes/no "is there a driveway at all" gate usually
// needs to come before anything else), but no longer buried at the end.
// Deliberately scoped to the literal key 'photos' only -- other
// bottom-sitting `type: 'photos'` fields in longer templates are named
// after a specific sub-topic (chimneys_photos, downpipes_photos, ...) and
// need a case-by-case look, not this same blanket treatment.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const TARGET_INDEX = 4;

function reorder(fields: TemplateField[]): { fields: TemplateField[]; changed: boolean } {
  const idx = fields.findIndex((f) => f.key === 'photos' && f.type === 'photos');
  if (idx <= TARGET_INDEX) return { fields, changed: false };
  const next = [...fields];
  const [photos] = next.splice(idx, 1);
  next.splice(TARGET_INDEX, 0, photos!);
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
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (photos moved to index ${TARGET_INDEX})`);
  }

  console.log(`\nDONE -- ${touched} template(s) reordered.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
