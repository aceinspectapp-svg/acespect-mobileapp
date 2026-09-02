// "The first word [of Job No] is permanent, keep it fixed on every
// inspection on every category — VIC-." Sets `prefix: 'VIC-'` on the
// `jobNumber` field across every published Job Information template --
// every inspection type x property type combination, not just one. The
// prefix itself is a new, generic TemplateField capability
// (templates.schemas.ts + TextFieldRenderer/AppTextInput on mobile): a
// locked, non-editable segment the inspector can't select or delete,
// rendered outside the actual text input. This script just turns it on for
// jobNumber everywhere it exists.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const published = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED', sectionKey: 'job-info' } });
  let touched = 0;

  for (const t of published) {
    const fields = t.fields as unknown as TemplateField[];
    const idx = fields.findIndex((f) => f.key === 'jobNumber');
    if (idx === -1) {
      // eslint-disable-next-line no-console
      console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey}: no jobNumber field -- skipped`);
      continue;
    }
    if (fields[idx]!.prefix === 'VIC-') {
      // eslint-disable-next-line no-console
      console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey}: already set`);
      continue;
    }

    const next = fields.map((f, i) => (i === idx ? { ...f, prefix: 'VIC-' } : f));
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
  console.log(`\nDONE -- ${touched} template(s) updated.`);
  await prisma.$disconnect();
}

void main();
