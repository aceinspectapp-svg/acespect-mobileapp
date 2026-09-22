// Re-applies this session's earlier fix (lost in the 2026-09-18 DB reset):
// the "No access to" section on Notes/Post Project/Defects reads as
// mandatory to the inspector, which it shouldn't be -- not every
// inspection has an area the inspector couldn't access. Sets
// `required: false` on `noAccess` (9 of 10 profiles) or on
// `post_project_describe` (dilapidation/apartment, which uses that field
// instead) across every profile with a published "notes" template.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const COMBOS: { inspectionType: string; propertyType: string }[] = [
  { inspectionType: 'investigations', propertyType: 'residential_house' },
  { inspectionType: 'investigations', propertyType: 'apartment' },
  { inspectionType: 'investigations', propertyType: 'commercial_properties' },
  { inspectionType: 'dilapidation', propertyType: 'residential_house' },
  { inspectionType: 'dilapidation', propertyType: 'commercial_properties' },
  { inspectionType: 'dilapidation', propertyType: 'apartment' },
  { inspectionType: 'pre_purchase', propertyType: 'apartment' },
  { inspectionType: 'pre_purchase', propertyType: 'commercial_properties' },
  { inspectionType: 'construction_stage', propertyType: 'residential_house' },
  { inspectionType: 'construction_stage', propertyType: 'apartment' },
];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  let touched = 0;
  for (const { inspectionType, propertyType } of COMBOS) {
    const published = await prisma.inspectionTemplate.findFirst({
      where: { inspectionType, propertyType, sectionKey: 'notes', status: 'PUBLISHED' },
    });
    if (!published) {
      console.log(`${inspectionType}/${propertyType}/notes: not found -- skipped`);
      continue;
    }

    const fields = published.fields as unknown as TemplateField[];
    let changed = false;
    const next = fields.map((f) => {
      if ((f.key === 'noAccess' || f.key === 'post_project_describe') && f.required) {
        changed = true;
        return { ...f, required: false };
      }
      return f;
    });

    if (!changed) {
      console.log(`${inspectionType}/${propertyType}/notes: already optional -- skipped`);
      continue;
    }

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType, propertyType, sectionKey: 'notes',
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
    touched += 1;
    console.log(`${inspectionType}/${propertyType}/notes -> v${draft.version}`);
  }

  console.log(`\nDONE -- ${touched} template(s) updated.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
