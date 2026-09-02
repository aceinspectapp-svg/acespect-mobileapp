// A generic, reusable template for the "add an extra structure/room" button
// on the mobile hub -- one shared form (material, condition, defects,
// photos, notes) that every inspector-created custom section renders
// through, regardless of what they named it. The mobile side gives each
// instance its own draft key (custom_<slug>_<n>) but always fetches this
// same sectionKey for the template itself.
//
// Seeded once per Dilapidation property type actually in active use
// (residential house, apartment, commercial, public assets) since template
// lookup has no wildcard/fallback -- every (inspectionType, propertyType,
// sectionKey) triple is looked up exactly.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';
import { defectItemFields } from './lib/defectTypes';

const INSPECTION_TYPE = 'dilapidation';
const SECTION_KEY = 'custom_structure';
const PROPERTY_TYPES = ['residential_house', 'apartment', 'commercial_properties', 'public_assets'];

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
const numbered = (fields: Omit<TemplateField, 'order'>[]): TemplateField[] => fields.map((f, i) => ({ ...f, order: i }));

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = numbered([
    { key: 'description', type: 'textarea', label: 'Brief description of this item' },
    { key: 'material', type: 'chip-multiselect', label: 'Material', options: opts('Timber', 'Brick', 'Steel / metal', 'Concrete', 'Fibre cement', 'Other') },
    { key: 'materialOther', type: 'textarea', label: 'If Other — specify material', required: true, gate: { fieldKey: 'material', equalsAny: ['other'] } },
    { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory', 'Fair', 'Average', 'Poor') },
    {
      key: 'damages', type: 'damage-list', label: 'Damages',
      repeat: {
        presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect',
        requireWhen: { fieldKey: 'condition', equals: ['fair', 'average', 'poor'] },
      },
      itemFields: defectItemFields({
        include: ['cracking', 'surface_damage', 'material_deterioration', 'movement_displacement', 'moisture_evidence', 'operational_defects', 'previous_repairs', 'safety_issues'],
      }),
    },
    { key: 'photos', type: 'photos', label: 'Pics' },
    { key: 'notes', type: 'textarea', label: 'Notes' },
  ]);

  for (const propertyType of PROPERTY_TYPES) {
    const existing = await prisma.inspectionTemplate.findFirst({
      where: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
    });
    if (existing) {
      // eslint-disable-next-line no-console
      console.log(`[custom-structure] ${propertyType} already published (v${existing.version}) -- skipping`);
      continue;
    }
    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: INSPECTION_TYPE, propertyType, sectionKey: SECTION_KEY,
        name: 'Additional Structure / Room',
        version: 1,
        status: 'DRAFT',
        fields: fields as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    // eslint-disable-next-line no-console
    console.log(`[custom-structure] ${propertyType} -> v1 published`);
  }

  await prisma.$disconnect();
}

void main();
