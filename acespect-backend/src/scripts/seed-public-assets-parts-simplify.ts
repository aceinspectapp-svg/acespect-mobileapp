// v5 content patch for the Dilapidation + Public Assets elevations ("Site
// Survey") template: drops the leftover road/laneway-survey preamble fields
// that v4 still carried unconditionally on every Part (roadLaneName,
// runsDirection, surveyStart/End, start/endRef, start/endPhotos) -- with
// itemsPresent now driving which category's fields show, a Part that's just
// "Nature Strip" shouldn't force the inspector through road-direction
// questions. `partName` + `itemsPresent` become the only always-visible
// fields, `otherDescription` becomes a general per-part notes field, and the
// rest of each category's own fields (material/condition/photos/damages/
// assets/obscuredBy, already gated on itemsPresent) are carried over
// unchanged. Also fixes the duplicate `lineMarkings` key (shared by Road
// Surface and Laneway Surface, which collided if an inspector selected
// both) by giving each category its own prefixed key. Also marks the
// repeating group `collapsible` so each Part can be collapsed to just its
// title once filled -- with up to ~7 categories' worth of fields per part,
// leaving everything permanently expanded doesn't scale.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'public_assets';
const SECTION_KEY = 'elevations';

const DROP_KEYS = new Set([
  'roadLaneName',
  'startEndPhotos',
  'runsDirection',
  'surveyStart',
  'startRef',
  'surveyDirection',
  'surveyEnd',
  'endRef',
  'endPhotos',
]);

// key -> unique replacement, only where a key collides across categories.
const RENAME_BY_CONTEXT: { afterLetter: string; from: string; to: string }[] = [
  { afterLetter: 'Road Surface & Parking Bays', from: 'lineMarkings', to: 'roadsurface_lineMarkings' },
  { afterLetter: 'Laneway Surface', from: 'lineMarkings', to: 'lanesurface_lineMarkings' },
];

function numbered(fields: Omit<TemplateField, 'order'>[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Omit<TemplateField, 'order'>[]) : undefined,
  }));
}

async function main() {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('No published elevations template found for dilapidation/public_assets');

  const latest = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = published.fields as unknown as TemplateField[];
  const parts = fields.find((f) => f.key === 'parts');
  if (!parts?.itemFields) throw new Error('parts.itemFields not found -- template shape has changed');

  const oldItemFields = parts.itemFields as unknown as TemplateField[];
  if (!oldItemFields.some((f) => f.key === 'partName') || !oldItemFields.some((f) => f.key === 'itemsPresent')) {
    throw new Error('partName/itemsPresent not found -- expected the v4 free-form-parts shape, run the prior migration first');
  }

  const renamed = oldItemFields.map((f) => {
    const hit = RENAME_BY_CONTEXT.find((r) => r.from === f.key && f.sectionLetter === r.afterLetter);
    return hit ? { ...f, key: hit.to } : f;
  });

  const kept = renamed.filter((f) => !DROP_KEYS.has(f.key));

  const partName = kept.find((f) => f.key === 'partName')!;
  const itemsPresent = kept.find((f) => f.key === 'itemsPresent')!;
  const otherDescription = kept.find((f) => f.key === 'otherDescription');
  const categoryFields = kept.filter((f) => f.key !== 'partName' && f.key !== 'itemsPresent' && f.key !== 'otherDescription');

  const newItemFields: Omit<TemplateField, 'order'>[] = [
    partName,
    itemsPresent,
    ...(otherDescription ? [{ ...otherDescription, label: 'Additional notes about this part (optional)' }] : []),
    ...categoryFields,
  ];

  parts.itemFields = numbered(newItemFields) as unknown as TemplateField['itemFields'];
  parts.repeat = {
    ...(parts.repeat ?? { presentation: 'strip' }),
    presentation: 'strip',
    addable: true,
    addButtonLabel: 'Add Part',
    titleFieldKey: 'partName',
    collapsible: true,
  };

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY,
      name: published.name,
      version: (latest?.version ?? 0) + 1,
      status: 'DRAFT',
      fields: numbered(fields as unknown as Omit<TemplateField, 'order'>[]) as unknown as object,
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
  console.log(`[public-assets-parts-simplify] published elevations v${draft.version} (${parts.itemFields?.length} parts.itemFields, was ${oldItemFields.length})`);

  await prisma.$disconnect();
}

void main();
