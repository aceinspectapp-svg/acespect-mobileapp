// Removes the "With ensuite? (bedrooms only)" field from the Internal Areas
// repeating room group -- it was applied to every room instance (including
// non-bedrooms like Stairwell, Hallway, etc.), not just bedrooms, per direct
// inspector feedback. Only touches dilapidation/residential_house/internal_areas.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const t = await prisma.inspectionTemplate.findFirst({
    where: { status: 'PUBLISHED', inspectionType: 'dilapidation', propertyType: 'residential_house', sectionKey: 'internal_areas' },
  });
  if (!t) throw new Error('template not found');

  const fields = t.fields as unknown as TemplateField[];
  const roomsIdx = fields.findIndex((f) => f.key === 'rooms');
  if (roomsIdx === -1) throw new Error('rooms field not found');

  const rooms = fields[roomsIdx]!;
  const itemFields = rooms.itemFields ?? [];
  const before = itemFields.length;
  const nextItemFields = itemFields.filter((f) => f.key !== 'withEnsuite');
  if (nextItemFields.length === before) {
    console.log('withEnsuite not present -- nothing to do');
    await prisma.$disconnect();
    return;
  }

  const nextFields = fields.map((f, i) => (i === roomsIdx ? { ...f, itemFields: nextItemFields } : f));

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
  console.log(`dilapidation/residential_house/internal_areas -> v${draft.version} (removed withEnsuite from rooms.itemFields)`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
