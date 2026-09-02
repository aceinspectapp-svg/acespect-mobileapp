import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

async function main() {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: 'dilapidation', propertyType: 'residential_house', sectionKey: 'internal_areas', status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('not found');
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no admin');

  const fields = published.fields as unknown as TemplateField[];
  const rooms = fields.find((f) => f.key === 'rooms');
  if (!rooms?.itemFields) throw new Error('rooms.itemFields not found');

  const list = rooms.itemFields.filter((f) => f.key !== 'damages');
  const damages = rooms.itemFields.find((f) => f.key === 'damages')!;
  const gcIdx = list.findIndex((f) => f.key === 'generalCondition');
  list.splice(gcIdx + 1, 0, damages);
  rooms.itemFields = list.map((f, i) => ({ ...f, order: i }));

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: 'dilapidation', propertyType: 'residential_house', sectionKey: 'internal_areas',
      name: published.name, version: published.version + 1, status: 'DRAFT',
      fields: fields as unknown as object, layout: (published.layout ?? null) as unknown as object,
      createdById: admin.id,
    },
  });
  await prisma.$transaction([
    prisma.inspectionTemplate.updateMany({ where: { inspectionType: 'dilapidation', propertyType: 'residential_house', sectionKey: 'internal_areas', status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);
  console.log(`internal_areas -> v${draft.version}`);
  await prisma.$disconnect();
}
void main();
