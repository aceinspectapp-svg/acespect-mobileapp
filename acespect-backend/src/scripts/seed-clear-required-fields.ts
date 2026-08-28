// Strips the `required` flag from every published template that still carries
// it. These are all leftovers from the original generic seed: job-info marked
// job number / date / client / address / inspector / weather / business-use as
// required, and description marked its five overview photos required. In
// practice that blocks "Next" on a site visit where the job number or client
// details aren't to hand yet, or where photos are taken later in the walk --
// and every hand-built template since has deliberately had none. This makes
// the whole set consistent.
//
// Fields are otherwise untouched; each affected template is republished as a
// new version through the normal flow, so the prior version stays as ARCHIVED.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function strip(fields: TemplateField[]): { fields: TemplateField[]; count: number } {
  let count = 0;
  const out = fields.map((f) => {
    const { required, ...rest } = f;
    if (required) count += 1;
    const nested = f.itemFields ? strip(f.itemFields) : undefined;
    if (nested) count += nested.count;
    return { ...rest, itemFields: nested?.fields };
  });
  return { fields: out, count };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const published = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  let changed = 0;

  for (const tpl of published) {
    const { fields, count } = strip(tpl.fields as unknown as TemplateField[]);
    if (count === 0) continue;

    const latest = await prisma.inspectionTemplate.findFirst({
      where: { inspectionType: tpl.inspectionType, propertyType: tpl.propertyType, sectionKey: tpl.sectionKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: tpl.inspectionType,
        propertyType: tpl.propertyType,
        sectionKey: tpl.sectionKey,
        name: tpl.name,
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        fields: fields as unknown as object,
        layout: (tpl.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });

    await prisma.$transaction([
      prisma.inspectionTemplate.updateMany({
        where: { inspectionType: tpl.inspectionType, propertyType: tpl.propertyType, sectionKey: tpl.sectionKey, status: 'PUBLISHED' },
        data: { status: 'ARCHIVED' },
      }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);

    changed += 1;
    // eslint-disable-next-line no-console
    console.log(`[clear-required] ${tpl.inspectionType}/${tpl.propertyType}/${tpl.sectionKey} -> v${draft.version} (cleared ${count})`);
  }

  // eslint-disable-next-line no-console
  console.log(`[clear-required] ${changed} template(s) updated`);
  await prisma.$disconnect();
}

void main();
