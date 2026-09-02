// Rolls the AS 4349.1 defect taxonomy (src/scripts/lib/defectTypes.ts) out
// to the last five Dilapidation x Residential House sections still on the
// old simple damage-list shape: Fences, Garage/Carport/Sheds, Pool/Spa,
// Roof/Chimneys, and Internal Areas/Rooms. Same pattern as Driveway/Paving/
// Retaining Walls/Elevations before them: defects move to sit directly
// below Condition, redesigned onto Location -> Element -> Defect Type ->
// Sub-type -> (crack dimensions if Cracking) -> Notes -> Photographs, and
// become mandatory once Condition is Average or Poor (the literal threshold
// given this time, matching Driveway's original spec -- not the "fair or
// lower" wording used for Paving/Retaining Walls/Elevations last time).
//
// Two sections needed their own Condition field cleaned up first, the same
// issue Retaining Walls had before: a chip-multiselect mixing severity words
// with defect observations in one list, rather than a clean severity scale.
// Those observations move into the new taxonomy, where they already exist
// as named sub-types:
//   - Fences: "Decayed" / "Loose or missing palings" / "Leaning" -> Material
//     Deterioration / Movement-Displacement.
//   - Roof/Chimneys: "Some surface rust" / "Cracked tiles" / "Gaps at
//     flashings" / "Gaps or cracking to chimney brickwork" / "Chimney
//     appears unstable" -> Material Deterioration / Cracking / Movement.
// Garage/Carport/Sheds (wallsCondition) and Pool/Spa (condition) already had
// a clean 4-point scale, so only defects + Other-boxes changed there.
//
// Rooms already got its own mandate last turn (Fair/Poor -- its own scale
// has no "Average"), left as-is; this only upgrades its damage-list shape
// onto the shared taxonomy for consistency.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption, FieldGate } from '../modules/templates/templates.schemas';
import { defectItemFields } from './lib/defectTypes';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';

type Field = Omit<TemplateField, 'order'>;

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
const numbered = (fields: Field[]): TemplateField[] => fields.map((f, i) => ({ ...f, order: i }));

const AVERAGE_OR_POOR = ['average', 'poor'];
const ALL_8 = ['cracking', 'surface_damage', 'material_deterioration', 'movement_displacement', 'moisture_evidence', 'operational_defects', 'previous_repairs', 'safety_issues'];
const NO_OPERATIONAL = ALL_8.filter((t) => t !== 'operational_defects');

// order:0 on these two -- both are only ever spliced directly into an
// already-built TemplateField[] (which the final `numbered()` call
// renumbers wholesale), never passed through `numbered()` themselves.
function otherDetail(key: string, sourceKey: string, label = 'If Other — specify'): TemplateField {
  return { key, type: 'textarea', label, required: true, order: 0, gate: { fieldKey: sourceKey, equalsAny: ['other'] } };
}

function buildDamages(conditionKey: string, include: string[], gate?: FieldGate): TemplateField {
  return {
    key: 'damages', type: 'damage-list', label: 'Damages', order: 0, ...(gate ? { gate } : {}),
    repeat: {
      presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect',
      requireWhen: { fieldKey: conditionKey, equals: AVERAGE_OR_POOR },
    },
    itemFields: defectItemFields({ include }),
  };
}

async function republish(sectionKey: string, mutate: (fields: TemplateField[]) => TemplateField[]) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error(`No published ${sectionKey} template found`);

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = mutate(published.fields as unknown as TemplateField[]);

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey,
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
  console.log(`[remaining-defect-redesign] ${sectionKey} -> v${draft.version}`);
}

async function main() {
  // -- Fences ---------------------------------------------------------------
  await republish('fences', (fields) => {
    const items = fields.find((f) => f.key === 'items');
    if (!items?.itemFields) throw new Error('fences.items.itemFields not found');
    const byKey = new Map(items.itemFields.map((f) => [f.key, f]));
    const YES: FieldGate = { fieldKey: 'present', equals: 'yes' };

    const newFields: Field[] = [
      byKey.get('present')!,
      { ...byKey.get('material')!, gate: YES },
      { ...otherDetail('materialOther', 'material'), gate: YES },
      { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory', 'Fair', 'Average', 'Poor'), gate: YES },
      buildDamages('condition', ALL_8, YES),
      { ...byKey.get('obscuredBy')!, gate: YES },
      { ...otherDetail('obscuredByOther', 'obscuredBy'), gate: YES },
      { ...byKey.get('photos')!, gate: YES },
      // worstItem dropped -- superseded by the structured defect list.
      { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
    ];
    items.itemFields = numbered(newFields);
    return fields;
  });

  // -- Garage / Carport / Sheds ----------------------------------------------
  await republish('garage_carport_sheds', (fields) => {
    const structs = fields.find((f) => f.key === 'structures');
    if (!structs?.itemFields) throw new Error('garage_carport_sheds.structures.itemFields not found');
    const list = structs.itemFields;
    const wcIdx = list.findIndex((f) => f.key === 'wallsCondition');
    const obIdx = list.findIndex((f) => f.key === 'obscuredBy');
    if (wcIdx === -1 || obIdx === -1) throw new Error('garage_carport_sheds shape changed');

    list.splice(wcIdx + 1, 0, buildDamages('wallsCondition', ALL_8));
    const newObIdx = list.findIndex((f) => f.key === 'obscuredBy');
    list.splice(newObIdx + 1, 0, otherDetail('obscuredByOther', 'obscuredBy'));

    structs.itemFields = numbered(list);
    return fields;
  });

  // -- Pool / Spa -------------------------------------------------------------
  await republish('pool_spa', (fields) => {
    const rest = fields.filter((f) => f.key !== 'damages');
    const condIdx = rest.findIndex((f) => f.key === 'condition');
    if (condIdx === -1) throw new Error('pool_spa shape changed (condition)');

    rest.splice(condIdx + 1, 0, buildDamages('condition', ALL_8));
    const newObIdx = rest.findIndex((f) => f.key === 'obscuredBy');
    if (newObIdx === -1) throw new Error('pool_spa shape changed (obscuredBy)');
    rest.splice(newObIdx + 1, 0, otherDetail('obscuredByOther', 'obscuredBy'));

    return numbered(rest);
  });

  // -- Roof Covering & Chimneys ------------------------------------------------
  await republish('roof_chimneys', (fields) => {
    const sections = fields.find((f) => f.key === 'sections');
    if (!sections?.itemFields) throw new Error('roof_chimneys.sections.itemFields not found');
    const list = sections.itemFields.filter((f) => f.key !== 'damages');
    const gcIdx = list.findIndex((f) => f.key === 'generalCondition');
    if (gcIdx === -1) throw new Error('roof_chimneys shape changed');

    // Replace the messy chip-multiselect with a clean severity scale --
    // its old descriptive options now live as taxonomy sub-types.
    list[gcIdx] = { key: 'condition', type: 'color-select', label: 'Condition', order: 0, options: opts('Satisfactory', 'Fair', 'Average', 'Poor') };
    list.splice(gcIdx + 1, 0, buildDamages('condition', NO_OPERATIONAL));

    sections.itemFields = numbered(list);
    return fields;
  });

  // -- Internal Areas / Rooms -- taxonomy upgrade only, mandate already set --
  await republish('internal_areas', (fields) => {
    const rooms = fields.find((f) => f.key === 'rooms');
    const damages = rooms?.itemFields?.find((f) => f.key === 'damages');
    if (!damages) throw new Error('internal_areas.rooms.damages not found');
    damages.itemFields = defectItemFields({ include: ALL_8 });
    if (damages.repeat) damages.repeat.addButtonLabel = 'Add damage/defect';
    return fields;
  });

  await prisma.$disconnect();
}

void main();
