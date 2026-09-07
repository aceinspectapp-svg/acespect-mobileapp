// Fixes a duplicate `weatherOther` on apartment/commercial Pre-Purchase
// Job Information -- prepurchase-weather-general-comments.ts spliced a new
// companion box after `weather` without first checking one didn't already
// exist there, and it did on these two (unclear which earlier pass added
// the first one). Both copies are identical; keeps one.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  for (const propertyType of ['apartment', 'commercial_properties']) {
    const published = await prisma.inspectionTemplate.findFirst({
      where: { status: 'PUBLISHED', inspectionType: 'pre_purchase', propertyType, sectionKey: 'job-info' },
      orderBy: { version: 'desc' },
    });
    if (!published) throw new Error(`${propertyType}/job-info not found`);

    const fields = published.fields as unknown as TemplateField[];
    const dupes = fields.filter((f) => f.key === 'weatherOther');
    if (dupes.length < 2) {
      // eslint-disable-next-line no-console
      console.log(`${propertyType}/job-info: only ${dupes.length} weatherOther, nothing to fix`);
      continue;
    }

    let removedOne = false;
    const next = fields
      .filter((f) => {
        if (f.key !== 'weatherOther') return true;
        if (!removedOne) { removedOne = true; return false; }
        return true;
      })
      .map((f, i) => ({ ...f, order: i }));

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: 'pre_purchase', propertyType, sectionKey: 'job-info',
        name: published.name,
        version: published.version + 1,
        status: 'DRAFT',
        fields: next as unknown as object,
        layout: (published.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: published.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    // eslint-disable-next-line no-console
    console.log(`${propertyType}/job-info -> v${draft.version} (removed 1 duplicate weatherOther)`);
  }
  await prisma.$disconnect();
}

void main();
