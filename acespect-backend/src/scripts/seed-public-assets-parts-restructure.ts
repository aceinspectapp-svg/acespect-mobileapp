// One-off content patch: publishes a v4 for the Dilapidation + Public Assets
// profile's elevations template, restructuring the "parts" repeating-group
// per admin feedback -- the rigid partType (Frontage vs Laneway) forced every
// category into one of two fixed buckets, but a real survey segment might
// mix categories (e.g. a laneway that also has a footpath). This transforms
// the CURRENT live template (which already has every category's full field
// set, including the earlier Guard Rails/Retaining Walls/Bridges follow-up
// patch) rather than rewriting content from scratch, so nothing already
// built is lost:
//   1. Adds `partName` (freely inspector-typed, e.g. "Part A" or a real
//      street name) as the instance's display title via repeat.titleFieldKey.
//   2. Removes the old `partType` field.
//   3. Adds `itemsPresent`, a chip-multiselect checklist ("what's present on
//      this part?") covering all 7 categories.
//   4. Re-gates every field belonging to a category (identified by its
//      existing, already-unique `sectionLetter`) from
//      {fieldKey:'partType', equals:'frontage'|'laneway'} to
//      {fieldKey:'itemsPresent', equals:'<that category's option value>'} --
//      relying on the just-added array-contains gate support.
// Only this one section/profile is touched; uses the existing versioning
// flow (archive prior published row, publish the new one).
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'public_assets';
const SECTION_KEY = 'elevations';

function numbered(fields: Omit<TemplateField, 'order'>[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Omit<TemplateField, 'order'>[]) : undefined,
  }));
}

const opt = (value: string, label: string): TemplateFieldOption => ({ value, label });

// sectionLetter -> the option label it should map to in the new itemsPresent checklist.
const CATEGORY_LABELS: Record<string, string> = {
  'Footpaths & Crossovers': 'Footpaths and Crossovers',
  'Nature Strip, Light Posts, Signage, Trees': 'Nature Strip, Light Posts, Signage, Trees',
  'Kerbs & Channel': 'Kerb and Channel',
  'Road Surface & Parking Bays': 'Road Surface & Parking Bays',
  'Left Side Fences & Walls of Laneway': 'Fencing / Walls — Left Side',
  'Right Side Fences & Walls of Laneway': 'Fencing / Walls — Right Side',
  'Laneway Surface': 'Laneway Surface',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

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

  const itemsPresentOptions: TemplateFieldOption[] = CATEGORY_ORDER.map((letter, i) => {
    const label = CATEGORY_LABELS[letter];
    if (!label) throw new Error(`No label for category "${letter}"`);
    return opt(`item${i}`, label);
  });
  const valueForLetter = (letter: string): string => {
    const idx = CATEGORY_ORDER.indexOf(letter);
    if (idx === -1) throw new Error(`Unknown category sectionLetter "${letter}" -- CATEGORY_LABELS is out of date`);
    return `item${idx}`;
  };

  const oldItemFields = parts.itemFields as unknown as TemplateField[];
  const partyType = oldItemFields.find((f) => f.key === 'partType');
  if (!partyType) throw new Error('partType field not found -- template shape has changed');

  const newItemFields: Omit<TemplateField, 'order'>[] = [];
  for (const f of oldItemFields) {
    if (f.key === 'partType') continue; // dropped
    const letter = f.sectionLetter;
    if (letter) {
      // A category field. Only re-gate the ones directly gated on the old
      // partType -- fields with their own more specific gate (e.g.
      // guardRailsDamages, gated on guardRails=yes from the earlier
      // follow-up patch) must keep it: they still resolve correctly because
      // their target field (guardRails) is itself gated on itemsPresent, so
      // the answer can only exist if that category was selected first.
      const gate = f.gate?.fieldKey === 'partType' ? { fieldKey: 'itemsPresent', equals: valueForLetter(letter) } : f.gate;
      newItemFields.push({ ...f, gate });
      continue;
    }
    // Survey-metadata field (roadLaneName, direction fields, photos, otherDescription) -- unchanged.
    newItemFields.push(f);
    // Insert the two new fields right after the last metadata field, before the first category field.
    if (f.key === 'otherDescription') {
      newItemFields.push(
        { key: 'partName', label: 'Name this part (e.g. "Part A", or the actual street/laneway name)', type: 'text' },
        {
          key: 'itemsPresent',
          label: 'What is present on this part? (select all that apply)',
          type: 'chip-multiselect',
          options: itemsPresentOptions,
        },
      );
    }
  }

  parts.itemFields = numbered(newItemFields) as unknown as TemplateField['itemFields'];
  parts.repeat = {
    ...(parts.repeat ?? { presentation: 'strip' }),
    presentation: 'strip',
    addable: true,
    addButtonLabel: 'Add Part',
    titleFieldKey: 'partName',
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
  console.log(`[public-assets-parts-restructure] published elevations v${draft.version} (${parts.itemFields?.length} parts.itemFields)`);

  await prisma.$disconnect();
}

void main();
