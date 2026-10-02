// Rewords one option label on the Roof Covering & Chimneys template's
// "Accessibility" field: "Inspected Partly From" reads as an incomplete
// phrase once it's lowercased and dropped into the composed report sentence
// ("Comments are based on inspected partly from."). Renamed to "Partial
// Inspection From Ground Level", a complete noun phrase that reads naturally
// in that same sentence ("Comments are based on partial inspection from
// ground level."). The option's VALUE is left untouched (only `fully_
// inspected`/`inspected_partly_from`/`not_accessible` ever gets stored), so
// every existing answer stays valid -- this only changes what's displayed.
// Pure data change (a new template version row), not a schema migration.
import { prisma } from '../lib/prisma';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';
const SECTION_KEY = 'roof_chimneys';
const FIELD_KEY = 'accessibility';
const OPTION_VALUE = 'inspected_partly_from';
const NEW_LABEL = 'Partial Inspection From Ground Level';

async function main() {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('No published roof_chimneys template found');

  const fields = JSON.parse(JSON.stringify(published.fields)) as Array<Record<string, unknown>>;

  function walk(list: Array<Record<string, unknown>>): boolean {
    let changed = false;
    for (const f of list) {
      if (f.key === FIELD_KEY && Array.isArray(f.options)) {
        for (const o of f.options as Array<Record<string, unknown>>) {
          if (o.value === OPTION_VALUE && o.label !== NEW_LABEL) {
            o.label = NEW_LABEL;
            changed = true;
          }
        }
      }
      if (Array.isArray(f.itemFields) && walk(f.itemFields as Array<Record<string, unknown>>)) changed = true;
    }
    return changed;
  }

  if (!walk(fields)) {
    // eslint-disable-next-line no-console
    console.log('[fix-roof-accessibility-label] label already up to date -- nothing to do');
    await prisma.$disconnect();
    return;
  }

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE,
      propertyType: PROPERTY_TYPE,
      sectionKey: SECTION_KEY,
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
  console.log(`[fix-roof-accessibility-label] published v${draft.version} with "${OPTION_VALUE}" relabelled to "${NEW_LABEL}"`);
  await prisma.$disconnect();
}

void main();
