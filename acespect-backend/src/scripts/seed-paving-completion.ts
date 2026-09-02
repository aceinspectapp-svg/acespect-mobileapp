// "Paving should be marked as completed only when all four sections are
// being updated with condition" -- direct inspector feedback. Marks
// `present` and `condition` required on each of Paving's four fixed-tabs
// sides (Front/Left/Rear/Right). Nothing else about the template changes.
//
// This alone is what does the work: `meetsAllRequiredFields` (mobile,
// src/utils/flattenSectionToDraft.ts) now recurses into every repeating-
// group instance, and a fixed-tabs instance the inspector never opened
// still yields an empty scope -- so a required field inside it fails the
// check until that side is actually visited. `present` has no gate, so it's
// required on all four sides unconditionally; `condition` is required only
// once a side is marked present (it's already gated on `present = yes`),
// so a side answered "No" doesn't block completion on a condition it will
// never have.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';
const SECTION_KEY = 'paving_paths';

async function main() {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('No published paving_paths template found');

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = published.fields as unknown as TemplateField[];
  const areas = fields.find((f) => f.key === 'areas');
  if (!areas?.itemFields) throw new Error('paving_paths.areas.itemFields not found -- shape changed');
  for (const key of ['present', 'condition']) {
    const f = areas.itemFields.find((x) => x.key === key);
    if (!f) throw new Error(`paving_paths.areas.itemFields.${key} not found`);
    f.required = true;
  }

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY,
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
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[paving-completion] paving_paths -> v${draft.version}`);
  await prisma.$disconnect();
}

void main();
