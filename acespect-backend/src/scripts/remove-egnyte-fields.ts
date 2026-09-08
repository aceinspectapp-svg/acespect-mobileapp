// Egnyte-specific inspector-facing fields ("Photos loaded to Egnyte?",
// "How many photos?") no longer make sense now that photo upload is
// automatic as part of normal submission -- there's no separate manual
// "load to Egnyte" step for an inspector to confirm anymore. Removes both
// from the one live template that still had them.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const published = await prisma.inspectionTemplate.findFirst({
    where: { status: 'PUBLISHED', inspectionType: 'dilapidation', propertyType: 'public_assets', sectionKey: 'job-info' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('template not found');

  const fields = (published.fields as unknown as TemplateField[])
    .filter((f) => f.key !== 'egnytePhotosLoaded' && f.key !== 'egnytePhotoCount')
    .map((f, i) => ({ ...f, order: i }));

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: 'dilapidation', propertyType: 'public_assets', sectionKey: 'job-info',
      name: published.name,
      version: published.version + 1,
      status: 'DRAFT',
      fields: fields as unknown as object,
      layout: (published.layout ?? null) as unknown as object,
      createdById: admin.id,
    },
  });
  await prisma.$transaction([
    prisma.inspectionTemplate.update({ where: { id: published.id }, data: { status: 'ARCHIVED' } }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);
  console.log(`dilapidation/public_assets/job-info -> v${draft.version}`);
  await prisma.$disconnect();
}

void main();
