// Two new Pre-Purchase-only requirements from the validation spec:
//
// 1. Weather (Job Information) becomes multi-select -- was a single-select
//    `select-tiles` capped at 5 options; converts to `chip-multiselect` (the
//    engine's standard multi-select type -- ChipMultiSelectFieldRenderer
//    already exists and is used everywhere else this session), keeps the
//    existing options, adds the ones the spec names that weren't there
//    (Cloudy, Windy, Humid, Wet Conditions) plus Other, paired with the
//    same gated Other-specify textarea used throughout the app rather than
//    the field's own inline `allowOther` mechanism, for consistency.
//
// 2. A standardized, multi-select "General Comments" field, added to Notes
//    (the section every property type already has as its general wrap-up),
//    with the spec's 13 standard phrases plus Other + its own specify box --
//    lets inspectors tap common findings instead of typing them out.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const PROPERTY_TYPES = ['residential_house', 'apartment', 'commercial_properties'];

function mkOpts(labels: string[]): TemplateFieldOption[] {
  const seen = new Set<string>();
  return labels.map((label) => {
    let value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'opt';
    let n = 2;
    while (seen.has(value)) value = `${value.slice(0, 57)}_${n++}`;
    seen.add(value);
    return { value, label };
  });
}
const opts = (...labels: string[]) => mkOpts(labels);

const GENERAL_COMMENT_OPTIONS = opts(
  'No significant issues observed.',
  'Property generally appears to be in satisfactory condition.',
  'Minor defects observed; refer to individual sections for details.',
  'Maintenance recommended.',
  'Further investigation recommended.',
  'Specialist assessment recommended.',
  'Access was restricted during inspection.',
  'Area was not accessible at the time of inspection.',
  'No visible defects observed at the time of inspection.',
  'Evidence of previous repair observed.',
  'Condition should be monitored.',
  'Further maintenance may be required.',
  'Other',
);

async function republish(sectionKey: string, propertyType: string, mutate: (fields: TemplateField[]) => TemplateField[]) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { status: 'PUBLISHED', inspectionType: 'pre_purchase', propertyType, sectionKey },
    orderBy: { version: 'desc' },
  });
  if (!published) {
    // eslint-disable-next-line no-console
    console.log(`pre_purchase/${propertyType}/${sectionKey}: not found -- skipped`);
    return;
  }
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = mutate([...(published.fields as unknown as TemplateField[])]).map((f, i) => ({ ...f, order: i }));

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: 'pre_purchase', propertyType, sectionKey,
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
  console.log(`pre_purchase/${propertyType}/${sectionKey} -> v${draft.version}`);
}

async function main() {
  for (const pt of PROPERTY_TYPES) {
    await republish('job-info', pt, (fields) => {
      const idx = fields.findIndex((f) => f.key === 'weather');
      if (idx === -1) throw new Error(`${pt}/job-info: weather field not found`);
      const existingLabels = (fields[idx]!.options ?? []).map((o) => o.label);
      const merged = Array.from(new Set([...existingLabels, 'Cloudy', 'Windy', 'Humid', 'Wet Conditions', 'Other']));

      fields[idx] = { key: 'weather', type: 'chip-multiselect', label: 'Weather', required: fields[idx]!.required, options: opts(...merged), order: 0 };
      fields.splice(idx + 1, 0, {
        key: 'weatherOther', type: 'textarea', label: 'If Other — specify', required: true, order: 0,
        gate: { fieldKey: 'weather', equalsAny: ['other'] },
      });
      return fields;
    });

    await republish('notes', pt, (fields) => {
      if (fields.some((f) => f.key === 'generalComments')) {
        // eslint-disable-next-line no-console
        console.log(`  (generalComments already present, skipped)`);
        return fields;
      }
      fields.push(
        { key: 'generalComments', type: 'chip-multiselect', label: 'General Comments', required: true, options: GENERAL_COMMENT_OPTIONS, order: 0 },
        {
          key: 'generalCommentsOther', type: 'textarea', label: 'If Other — specify', required: true, order: 0,
          gate: { fieldKey: 'generalComments', equalsAny: ['other'] },
        },
      );
      return fields;
    });
  }

  await prisma.$disconnect();
}

void main();
