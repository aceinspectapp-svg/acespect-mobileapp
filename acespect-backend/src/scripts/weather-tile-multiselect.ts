// Switches Weather (job-info) from chip-multiselect back to the original
// tile-card look, per direct inspector feedback -- but keeps multi-select
// (weather-multiselect-everywhere.ts's whole point), via the new
// tile-multiselect field type (ChoiceTileMultiGrid on mobile). Content
// (options, icons, required-ness) is untouched -- this only flips `type`.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

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
    if (fields[idx]!.type === 'tile-multiselect') {
      console.log(`${t.inspectionType}/${t.propertyType}: already tile-multiselect -- skipped`);
      continue;
    }

    const next = fields.map((f, i) => (i === idx ? { ...f, type: 'tile-multiselect' as const } : f));
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
    console.log(`${t.inspectionType}/${t.propertyType}/job-info -> v${draft.version}`);
  }

  console.log(`\nDONE -- ${touched} template(s) updated.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
