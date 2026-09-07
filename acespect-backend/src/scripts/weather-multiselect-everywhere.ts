// "allow the user to select multiple weather conditions at once" -- on
// Dilapidation this time, but the same ask that already went out to
// Pre-Purchase. Converts Weather from single-select `select-tiles` to
// `chip-multiselect` (the app's standard multi-select type) on every
// remaining job-info template that still has it that way: Dilapidation (all
// 4 property types), Construction Stage, Investigations -- Pre-Purchase was
// already done. Options are merged with the same additions Pre-Purchase got
// (Cloudy/Windy/Humid/Wet Conditions), so the two stay consistent. The
// gated `weatherOther` companion box already exists on every one of these
// (added earlier by the app-wide "Other needs a specify box" sweep) and
// already points at `weather` correctly -- left as-is.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

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

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED', sectionKey: 'job-info' } });
  let touched = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const idx = fields.findIndex((f) => f.key === 'weather');
    if (idx === -1 || fields[idx]!.type === 'chip-multiselect') continue;

    const existingLabels = (fields[idx]!.options ?? []).map((o) => o.label);
    const merged = Array.from(new Set([...existingLabels.filter((l) => l !== 'Other'), 'Cloudy', 'Windy', 'Humid', 'Wet Conditions', 'Other']));
    const next = fields.map((f, i) => (i === idx ? { key: 'weather', type: 'chip-multiselect' as const, label: 'Weather', required: f.required, options: opts(...merged), order: f.order } : f));

    touched += 1;
    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: t.inspectionType, propertyType: t.propertyType, sectionKey: t.sectionKey,
        name: t.name,
        version: t.version + 1,
        status: 'DRAFT',
        fields: next as unknown as object,
        layout: (t.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: t.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    // eslint-disable-next-line no-console
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version}`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${touched} template(s) converted.`);
  await prisma.$disconnect();
}

void main();
