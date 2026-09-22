// Trims Weather back down to 6 options per direct inspector feedback --
// drops the 4 added by weather-multiselect-everywhere.ts/prepurchase-
// weather-general-comments.ts (Cloudy, Windy, Humid, Wet Conditions).
// Drop-list, not a keep-list: some profiles (dilapidation/apartment) had
// their own differently-worded original 6 (Fine, Partly Cloudy, Light Rain,
// ...) predating the generic seed's wording, so hardcoding "the" 6 values
// silently wrecked that profile the first time this ran -- see git history.
// Dropping only the 4 known additions preserves whatever each profile's
// own original set actually was.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const DROP_VALUES = new Set(['cloudy', 'windy', 'humid', 'wet_conditions']);

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED', sectionKey: 'job-info' } });
  let touched = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const idx = fields.findIndex((f) => f.key === 'weather');
    if (idx === -1) {
      console.log(`${t.inspectionType}/${t.propertyType}: no weather field -- skipped`);
      continue;
    }

    const options = fields[idx]!.options ?? [];
    const trimmed = options.filter((o) => !DROP_VALUES.has(o.value));
    if (trimmed.length === options.length) {
      console.log(`${t.inspectionType}/${t.propertyType}: no droppable options present -- skipped`);
      continue;
    }

    const next = fields.map((f, i) => (i === idx ? { ...f, options: trimmed } : f));
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
    console.log(`${t.inspectionType}/${t.propertyType}/job-info -> v${draft.version} (${trimmed.length} options)`);
  }

  console.log(`\nDONE -- ${touched} template(s) updated.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
