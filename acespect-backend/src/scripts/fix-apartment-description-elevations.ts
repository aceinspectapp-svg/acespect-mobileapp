// Four direct edits to Dilapidation/Apartment, per inspector feedback:
//
// Description & Overview:
//   - "Number of storeys" (pill-select, capped at "20") -> plain text so any
//     number can be entered.
//   - "Street frontage (m)" dropped entirely.
//
// Elevations ("External"):
//   - Elevation Overview + External Walls + Cladding merge into one
//     section-nav tab ("External Walls & Cladding") -- same three groups of
//     fields, same relative order, just one sectionLetter instead of three,
//     so they open together as a single form instead of three separate taps.
//   - Windows / Window Frames dropped entirely.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

async function republish(sectionKey: string, mutate: (fields: TemplateField[]) => TemplateField[]) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { status: 'PUBLISHED', inspectionType: 'dilapidation', propertyType: 'apartment', sectionKey },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error(`apartment/${sectionKey} not found`);

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = mutate([...(published.fields as unknown as TemplateField[])]).map((f, i) => ({ ...f, order: i }));

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: 'dilapidation', propertyType: 'apartment', sectionKey,
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
  // eslint-disable-next-line no-console
  console.log(`apartment/${sectionKey} -> v${draft.version}`);
}

async function main() {
  await republish('description', (fields) =>
    fields
      .filter((f) => f.key !== 'streetFrontage')
      .map((f) => (f.key === 'storeys' ? { key: f.key, type: 'text', label: f.label, order: f.order } : f)),
  );

  await republish('elevations', (fields) =>
    fields
      .filter((f) => f.sectionLetter !== 'Windows / Window Frames')
      .map((f) =>
        ['Elevation Overview', 'External Walls', 'Cladding'].includes(f.sectionLetter ?? '')
          ? { ...f, sectionLetter: 'External Walls & Cladding' }
          : f,
      ),
  );

  await prisma.$disconnect();
}

void main();
