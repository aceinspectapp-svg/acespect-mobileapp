// Fixes three duplicate-field-key bugs found via direct screenshots: a
// second, wrongly-gated copy of `materialOther`/`obscuredByOther`/`damages`
// sitting alongside the correct one in the same itemFields array. Same
// symptom, two visible effects:
//   - React sees two list items with the same key ("Encountered two
//     children with the same key") -- the toast in the screenshots.
//   - The stray copy's gate is wrong (usually just `present == 'yes'`,
//     which is true whenever the side/structure is present at all, not
//     "Other was actually selected"), so it renders unconditionally --
//     an "Other -- specify" box appears with nothing set to Other, and
//     Garage/Carport/Sheds shows two identical "Add damage/defect" blocks.
//
// In every case here the two copies are otherwise near-identical (same
// itemFields/taxonomy where relevant); the fix is just to drop the
// wrongly-gated one and keep the correctly-gated one, not to reconcile
// content. Exactly which stray script run produced the extra copy isn't
// fully reconstructable from the data alone -- this fixes the symptom
// directly rather than chasing that down further.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';

async function republish(sectionKey: string, groupKey: string, itemsGroupKey: string, isCorrectCopy: (f: TemplateField) => boolean) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { status: 'PUBLISHED', inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error(`${sectionKey} not found`);
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = published.fields as unknown as TemplateField[];
  const group = fields.find((f) => f.key === itemsGroupKey);
  if (!group?.itemFields) throw new Error(`${sectionKey}.${itemsGroupKey}.itemFields not found`);

  const dupes = group.itemFields.filter((f) => f.key === groupKey);
  if (dupes.length < 2) {
    // eslint-disable-next-line no-console
    console.log(`${sectionKey}.${groupKey}: only ${dupes.length} found, nothing to fix`);
    return;
  }
  const keep = dupes.find(isCorrectCopy);
  if (!keep) throw new Error(`${sectionKey}.${groupKey}: none of the ${dupes.length} copies matched the "correct" predicate`);

  group.itemFields = group.itemFields
    .filter((f) => f.key !== groupKey)
    .concat(keep)
    .sort((a, b) => a.order - b.order)
    .map((f, i) => ({ ...f, order: i }));

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
    prisma.inspectionTemplate.update({ where: { id: published.id }, data: { status: 'ARCHIVED' } }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);
  // eslint-disable-next-line no-console
  console.log(`${sectionKey} -> v${draft.version} (removed ${dupes.length - 1} stray "${groupKey}" cop${dupes.length - 1 === 1 ? 'y' : 'ies'})`);
}

async function main() {
  const gatedOnOther = (fieldKey: string) => (f: TemplateField) => f.gate?.fieldKey === fieldKey && !!f.gate.equalsAny?.includes('other');
  const gatedOnPresent = (f: TemplateField) => f.gate?.fieldKey === 'present' && f.gate.equals === 'yes';

  await republish('paving_paths', 'materialOther', 'areas', gatedOnOther('material'));
  await republish('paving_paths', 'obscuredByOther', 'areas', gatedOnOther('obscuredBy'));
  await republish('fences', 'materialOther', 'items', gatedOnOther('material'));
  await republish('fences', 'obscuredByOther', 'items', gatedOnOther('obscuredBy'));
  await republish('garage_carport_sheds', 'damages', 'structures', gatedOnPresent);

  await prisma.$disconnect();
}

void main();
