// Two small, independent Dilapidation × Residential House fixes, both direct
// inspector feedback:
//
// Roof Covering & Chimneys: the "Inspection status / limitations" chip list
// carried a "Not applicable — apartment" option. Apartment has had its own,
// completely separate roof_chimneys template for a while now (roof covering,
// eaves, fascia, gutters, downpipes -- none of it shared with this one), so
// that option can never actually apply here. Dropped.
//
// Internal Areas: there was already a movement/bouncy-floors Yes/No with a
// gated "Where? Describe" box, but nothing for a general condition note that
// doesn't hinge on that Yes/No answer. Added a second, ungated textarea
// right after it for exactly that.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';

async function republish(sectionKey: string, mutate: (fields: TemplateField[]) => TemplateField[]) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error(`No published ${sectionKey} template found`);

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = mutate(published.fields as unknown as TemplateField[]);

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey,
      name: published.name,
      version: published.version + 1,
      status: 'DRAFT',
      fields: fields as unknown as object,
      layout: (published.layout ?? null) as unknown as object,
      createdById: admin.id,
    },
  });

  await prisma.$transaction([
    prisma.inspectionTemplate.updateMany({
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[roof-internal-fixes] ${sectionKey} -> v${draft.version}`);
}

async function main() {
  await republish('roof_chimneys', (fields) => {
    const sections = fields.find((f) => f.key === 'sections');
    const status = sections?.itemFields?.find((f) => f.key === 'inspectionStatus');
    if (!status?.options) throw new Error('roof_chimneys.sections.inspectionStatus not found -- shape changed');
    status.options = status.options.filter((o) => o.value !== 'not_applicable_apartment');
    return fields;
  });

  await republish('internal_areas', (fields) => {
    const i = fields.findIndex((f) => f.key === 'movementWhere');
    if (i === -1) throw new Error('internal_areas.movementWhere not found -- shape changed');
    const newField: TemplateField = {
      key: 'generalConditionComments',
      type: 'textarea',
      label: 'Other general condition issues — note the areas affected',
      order: 0,
      sectionLetter: 'General',
    };
    fields.splice(i + 1, 0, newField);
    return fields.map((f, idx) => ({ ...f, order: idx }));
  });

  await prisma.$disconnect();
}

void main();
