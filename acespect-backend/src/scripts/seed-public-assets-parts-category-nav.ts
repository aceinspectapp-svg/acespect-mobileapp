// v6 content patch for the Dilapidation + Public Assets elevations ("Site
// Survey") template. Two changes, both from direct inspector feedback on
// the v5 shape:
//
// 1. v5 dropped the road/lane survey-detail fields (direction, start/end
//    reference, start/end wide photos) entirely, assuming they no longer
//    made sense once a Part could be just a footpath or nature strip. That
//    was wrong -- the inspector wants them back, unconditionally, right
//    after `partName` and before `itemsPresent`. Restored verbatim from the
//    v3/v4 shape (only the redundant `roadLaneName` field is dropped, since
//    `partName` already covers "name this part/road/lane").
//
// 2. Once itemsPresent is answered, v5 rendered every selected category's
//    full field set inline in one long scrolling card. The inspector wants
//    each selected category to instead appear as a row in a list (shown
//    after the lead fields), navigated into one at a time to fill --
//    `repeat.categoryNav.selectorFieldKey` flags this for the mobile
//    renderer, which groups itemFields by `sectionLetter` and opens each
//    group in its own full-screen view rather than inline.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'public_assets';
const SECTION_KEY = 'elevations';

const RESTORED_FIELDS: Omit<TemplateField, 'order'>[] = [
  { key: 'startEndPhotos', type: 'photos', label: 'Wide view photos and street signs (start, min 4)' },
  {
    key: 'runsDirection', type: 'pill-select', label: 'The road / lane runs',
    options: [{ label: 'South to north', value: 'item0' }, { label: 'East to West', value: 'item1' }, { label: 'Other', value: 'item2' }],
  },
  {
    key: 'surveyStart', type: 'pill-select', label: 'Survey commenced at',
    options: [{ label: 'South end', value: 'item0' }, { label: 'West end', value: 'item1' }, { label: 'East end', value: 'item2' }, { label: 'Other', value: 'item3' }],
  },
  { key: 'startRef', type: 'text', label: 'Start reference (e.g. 3m past boundary of house no. / crossover / corner / intersection)' },
  {
    key: 'surveyDirection', type: 'pill-select', label: 'And proceeded',
    options: [{ label: 'North', value: 'item0' }, { label: 'East', value: 'item1' }, { label: 'West', value: 'item2' }, { label: 'Other', value: 'item3' }],
  },
  {
    key: 'surveyEnd', type: 'pill-select', label: 'To end point of survey',
    options: [{ label: 'North end', value: 'item0' }, { label: 'West end', value: 'item1' }, { label: 'East end', value: 'item2' }, { label: 'Other', value: 'item3' }],
  },
  { key: 'endRef', type: 'text', label: 'End reference (e.g. 3m past boundary of house no. / crossover / corner / intersection)' },
  { key: 'endPhotos', type: 'photos', label: 'Wide view photos looking back (end, min 4)' },
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

  const current = parts.itemFields as unknown as TemplateField[];
  const partName = current.find((f) => f.key === 'partName');
  const itemsPresent = current.find((f) => f.key === 'itemsPresent');
  const otherDescription = current.find((f) => f.key === 'otherDescription');
  if (!partName || !itemsPresent || !otherDescription) {
    throw new Error('partName/itemsPresent/otherDescription not found -- expected the v5 shape, run the prior migration first');
  }
  if (current.some((f) => RESTORED_FIELDS.some((r) => r.key === f.key))) {
    throw new Error('one of the restored field keys already exists on the current template -- already migrated?');
  }

  const categoryFields = current.filter((f) => !!f.sectionLetter);

  const newItemFields: Omit<TemplateField, 'order'>[] = [
    partName,
    ...RESTORED_FIELDS,
    { ...otherDescription, label: 'Other description' },
    itemsPresent,
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
    categoryNav: { selectorFieldKey: 'itemsPresent' },
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
  console.log(`[public-assets-parts-category-nav] published elevations v${draft.version} (${parts.itemFields?.length} parts.itemFields, ${categoryFields.length} in categories)`);

  await prisma.$disconnect();
}

void main();
