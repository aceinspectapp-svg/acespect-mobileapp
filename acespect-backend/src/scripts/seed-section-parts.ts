// Divides the single-item categories of the Dilapidation x Residential House
// form into parts, so every category shows its parts separately.
//
// Until now Driveway and Pool / Spa were ONE item each (one "Is there one?",
// one Condition), so the report could only ever print one condition label for
// them. Fences, Paving, Elevations, Garage, Roof and Internal Areas are already
// divided into fixed parts -- each with its own present / condition / defects --
// and each part gets its own label in the Condition Summary and in the report.
// This gives the remaining two categories the same shape:
//
//   Driveway  -> Front left, Front right, Rear, Side
//                (the old "Located at" question goes: the part now says where it
//                is. "Semi-circle with 2 entries/exits" was a shape, not a place,
//                so it has no part -- record it under Notes.)
//   Pool / Spa -> Pool, Spa
//                (every existing question, including "Located at", now sits
//                inside each part.)
//
// Retaining Walls is already a list with one entry (and one label) per wall, and
// Notes / Description have no condition grade, so they are left alone.
//
// DRY RUN by default. Publishes new template versions only with --apply.
//   npx tsx src/scripts/seed-section-parts.ts                 # show the plan
//   npx tsx src/scripts/seed-section-parts.ts --apply         # publish both
//   npx tsx src/scripts/seed-section-parts.ts --apply --only=pool_spa
//
// Idempotent: a section that is already divided is skipped. Existing inspections
// keep the answers they already have; inspectors keep the template version they
// last accepted until they accept this update. Run
// scripts/export-templates-snapshot.ts afterwards to refresh the snapshot.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

interface SectionPlan {
  sectionKey: string;
  groupLabel: string;
  presentLabel: string;
  parts: { key: string; label: string }[];
  /** Questions that the part itself now answers. */
  drop: string[];
}

const PLANS: SectionPlan[] = [
  {
    sectionKey: 'driveway',
    groupLabel: 'Driveway -- record each part that exists',
    presentLabel: 'Is there a driveway to this part?',
    parts: [
      { key: 'front_left', label: 'Front left' },
      { key: 'front_right', label: 'Front right' },
      { key: 'rear', label: 'Rear' },
      { key: 'side', label: 'Side' },
    ],
    drop: ['locatedAt'],
  },
  {
    sectionKey: 'pool_spa',
    groupLabel: 'Pool / Spa -- record each part that exists',
    presentLabel: 'Present on site?',
    parts: [
      { key: 'pool', label: 'Pool' },
      { key: 'spa', label: 'Spa' },
    ],
    drop: [],
  },
];

async function divide(plan: SectionPlan, adminId: string) {
  const where = { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: plan.sectionKey };
  const published = await prisma.inspectionTemplate.findFirst({ where: { ...where, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
  if (!published) throw new Error(`[${plan.sectionKey}] no published template found`);

  const fields = published.fields as unknown as TemplateField[];
  if (fields.some((f) => f.type === 'repeating-group')) {
    // eslint-disable-next-line no-console
    console.log(`[${plan.sectionKey}] v${published.version} is already divided into parts -- skipped.`);
    return;
  }
  if (!fields.some((f) => f.key === 'present') || !fields.some((f) => f.key === 'condition')) {
    throw new Error(`[${plan.sectionKey}] template shape has changed (no present/condition field) -- not touching it`);
  }

  // Every existing question moves inside each part, in the same order, minus the dropped ones.
  const itemFields: TemplateField[] = fields
    .filter((f) => !plan.drop.includes(f.key))
    .sort((a, b) => a.order - b.order)
    .map((f, i) => ({ ...f, order: i, ...(f.key === 'present' ? { label: plan.presentLabel } : {}) }));

  const group: TemplateField = {
    key: 'parts',
    type: 'repeating-group',
    label: plan.groupLabel,
    order: 0,
    required: true,
    repeat: { presentation: 'fixed-tabs', fixedInstances: plan.parts },
    itemFields,
  };

  // eslint-disable-next-line no-console
  console.log(
    `[${plan.sectionKey}] v${published.version} (${fields.length} flat questions) -> ${plan.parts.length} parts ` +
      `(${plan.parts.map((p) => p.label).join(', ')}), ${itemFields.length} questions in each` +
      (plan.drop.length ? `; removed: ${plan.drop.join(', ')}` : ''),
  );
  if (!APPLY) return;

  const latest = await prisma.inspectionTemplate.findFirst({ where, orderBy: { version: 'desc' }, select: { version: true } });
  const draft = await prisma.inspectionTemplate.create({
    data: {
      ...where,
      name: published.name,
      version: (latest?.version ?? 0) + 1,
      status: 'DRAFT',
      fields: [group] as unknown as object,
      layout: (published.layout ?? undefined) as unknown as object | undefined,
      createdById: adminId,
    },
  });
  await prisma.$transaction([
    prisma.inspectionTemplate.updateMany({ where: { ...where, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);
  // eslint-disable-next-line no-console
  console.log(`[${plan.sectionKey}] published v${draft.version}.`);
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');
  for (const plan of PLANS.filter((p) => !ONLY || p.sectionKey === ONLY)) await divide(plan, admin.id);
  if (!APPLY) {
    // eslint-disable-next-line no-console
    console.log('Dry run -- nothing was changed. Re-run with --apply to publish.');
  }
  await prisma.$disconnect();
}

void main();
