// Redesigns the Driveway damage-entry shape for Dilapidation × Residential
// House, per direct inspector feedback on the live app:
//   1. "Add damage/defect" moves to sit right below Condition (was after the
//      cracking-overview / obscured-by / photos block).
//   2. A damage entry is now: Location -> Element -> Defect Type (8-category
//      AS 4349.1-style taxonomy, Driveway gets the 7 that apply -- excludes
//      "Operational Defects", which is about doors/windows/gates) -> that
//      type's own sub-type -> crack dimensions (only meaningful for
//      Cracking: starting location, running, width, length) -> Notes ->
//      Photographs. See src/scripts/lib/defectTypes.ts for the shared
//      taxonomy (built for reuse once other sections get the same redesign).
//   3. Recording a defect becomes mandatory once Condition is Average or
//      Poor, via the new `repeat.requireWhen` -- enforced as a soft
//      validation (inline warning + section marked "partial"), the same
//      non-blocking treatment every other required field already gets in
//      this app, not a hard block.
// The Condition field itself needed no change: its washed-out grey
// highlighting was a mobile rendering bug (ColorSelect fell back to grey
// whenever a color-select option had no explicit `color`, which is every
// color-select field built after the very first seed) fixed at the
// component level in acespect-mobile, not here.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';
import { defectItemFields } from './lib/defectTypes';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';
const SECTION_KEY = 'driveway';

const DRIVEWAY_DEFECT_TYPES = [
  'cracking',
  'surface_damage',
  'material_deterioration',
  'movement_displacement',
  'moisture_evidence',
  'previous_repairs',
  'safety_issues',
];

function numbered(fields: Omit<TemplateField, 'order'>[]): TemplateField[] {
  return fields.map((f, i) => ({ ...f, order: i }));
}

async function main() {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('No published residential driveway template found');

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = published.fields as unknown as TemplateField[];
  const YES = { fieldKey: 'present', equals: 'yes' };

  const byKey = new Map(fields.map((f) => [f.key, f]));
  const damagesField = byKey.get('damages');
  if (!damagesField) throw new Error('damages field not found -- driveway template shape has changed');

  const newDamages: Omit<TemplateField, 'order'> = {
    ...damagesField,
    itemFields: defectItemFields({ include: DRIVEWAY_DEFECT_TYPES }),
    repeat: {
      ...damagesField.repeat,
      presentation: 'strip',
      addable: true,
      addButtonLabel: 'Add damage/defect',
      requireWhen: { fieldKey: 'condition', equals: ['average', 'poor'] },
    },
  };

  // Explicit target order: everything else keeps its relative position,
  // damages moves to directly after condition.
  const order = ['present', 'locatedAt', 'material', 'condition', 'damages', 'crackingSummary', 'obscuredBy', 'photos', 'notes'];
  const reordered = order.map((key) => (key === 'damages' ? newDamages : byKey.get(key))).filter((f): f is TemplateField | Omit<TemplateField, 'order'> => !!f);
  // Any field not in the explicit list (shouldn't happen, but don't silently drop data) goes at the end.
  const leftover = fields.filter((f) => !order.includes(f.key));

  const finalFields = numbered([...reordered, ...leftover].map((f) => ({ ...f, gate: f.key === 'damages' ? YES : f.gate })));

  const latest = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY,
      name: published.name,
      version: (latest?.version ?? 0) + 1,
      status: 'DRAFT',
      fields: finalFields as unknown as object,
      layout: (published.layout ?? null) as unknown as object,
      createdById: admin.id,
    },
  });

  await prisma.$transaction([
    prisma.inspectionTemplate.updateMany({
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[driveway-defect-redesign] published v${draft.version} (${finalFields.length} fields, damages has ${newDamages.itemFields?.length} itemFields)`);

  await prisma.$disconnect();
}

void main();
