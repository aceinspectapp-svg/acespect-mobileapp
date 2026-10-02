// Two more option-label rewords, same reasoning/pattern as
// fix-roof-accessibility-label.ts: a label reads fine as a standalone pill
// but awkwardly once lowercased and dropped into its composed sentence.
// Values are left untouched (only existing answers' stored values matter),
// so no existing data is invalidated -- this only changes what's displayed.
// Pure data change (a new template version row per section), not a schema
// migration.
//
//  - roof_chimneys.accessibility: "Fully Inspected" -> "Full Inspection"
//    ("Comments are based on fully inspected." -> "...based on full inspection.")
//  - pool_spa.fenceSafety: "Not Safe" -> "Non-compliant"
//    ("...appears to be not safe." -> "...appears to be non-compliant.")
import { prisma } from '../lib/prisma';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';

const RELABELS: { sectionKey: string; fieldKey: string; value: string; newLabel: string }[] = [
  { sectionKey: 'roof_chimneys', fieldKey: 'accessibility', value: 'fully_inspected', newLabel: 'Full Inspection' },
  { sectionKey: 'pool_spa', fieldKey: 'fenceSafety', value: 'not_safe', newLabel: 'Non-compliant' },
];

function walk(list: Array<Record<string, unknown>>, fieldKey: string, value: string, newLabel: string): boolean {
  let changed = false;
  for (const f of list) {
    if (f.key === fieldKey && Array.isArray(f.options)) {
      for (const o of f.options as Array<Record<string, unknown>>) {
        if (o.value === value && o.label !== newLabel) {
          o.label = newLabel;
          changed = true;
        }
      }
    }
    if (Array.isArray(f.itemFields) && walk(f.itemFields as Array<Record<string, unknown>>, fieldKey, value, newLabel)) {
      changed = true;
    }
  }
  return changed;
}

async function relabelSection(sectionKey: string, fieldKey: string, value: string, newLabel: string) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error(`No published ${sectionKey} template found`);

  const fields = JSON.parse(JSON.stringify(published.fields)) as Array<Record<string, unknown>>;
  if (!walk(fields, fieldKey, value, newLabel)) {
    // eslint-disable-next-line no-console
    console.log(`[fix-wording-labels-batch2] ${sectionKey}.${fieldKey}="${value}" already "${newLabel}" -- skipping`);
    return;
  }

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE,
      propertyType: PROPERTY_TYPE,
      sectionKey,
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
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[fix-wording-labels-batch2] ${sectionKey} published v${draft.version}: "${value}" -> "${newLabel}"`);
}

async function main() {
  for (const r of RELABELS) {
    await relabelSection(r.sectionKey, r.fieldKey, r.value, r.newLabel);
  }
  await prisma.$disconnect();
}

void main();
