// Drops the `required` flag from every field on the Dilapidation × Public
// Assets job-info template. It was the only template in the whole dilapidation
// set that marked fields required, which meant a Public Assets survey -- often
// started on site before the job number or client details are to hand -- was
// the one profile whose "Next" button stayed disabled. Nothing else about the
// template changes; the fields all remain, just optional.
//
// Also adds the weather tile icons the other profiles already carry, so the
// tiles stop rendering as question marks.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'public_assets';
const SECTION_KEY = 'job-info';

const WEATHER_ICONS: Record<string, string> = {
  overcast: 'cloudy-outline',
  dry: 'thermometer-outline',
  sunny: 'sunny-outline',
  intermittent_showers: 'partly-sunny-outline',
  rain: 'rainy-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

/** Match an option to an icon by its value or a slugged label. */
function iconFor(value: string, label: string): string | undefined {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return WEATHER_ICONS[value] ?? WEATHER_ICONS[slug];
}

function strip(fields: TemplateField[]): TemplateField[] {
  return fields.map((f) => {
    const { required, ...rest } = f;
    void required;
    return {
      ...rest,
      options: f.key === 'weather' && f.options
        ? f.options.map((o) => ({ ...o, icon: o.icon ?? iconFor(o.value, o.label) }))
        : f.options,
      itemFields: f.itemFields ? strip(f.itemFields) : undefined,
    };
  });
}

async function main() {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('No published public_assets job-info template found');

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = strip(published.fields as unknown as TemplateField[]);

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
  console.log(`[public-assets-job-info] published v${draft.version} — ${fields.filter((f) => f.required).length} required fields remaining`);

  await prisma.$disconnect();
}

void main();
