// Pre-Purchase residential_house and commercial_properties turn out to use
// the same per-block pattern apartment did before add-apartment-block-defects.ts
// (<prefix>_condition / <prefix>_checks / <prefix>_comments / <prefix>_photos,
// no damage-list at all) across most of their sections -- not just Elevations.
// This is a generic version of that fix: at every level of every published
// Pre-Purchase template (top-level fields, and one level into any
// repeating-group's itemFields), it finds every condition field -- prefixed
// ("walls_condition") or bare ("condition") -- that has no paired damage-list
// sibling, and adds one directly after it: the shared AS 4349.1 taxonomy,
// mandatory once that condition is Average/Poor (this spec's explicit
// threshold, not the "fair or lower" used elsewhere).
//
// Existing damage-lists (already added for apartment, or wherever a section
// already had one) are left untouched -- this only fills genuine gaps.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';
import { defectItemFields } from './lib/defectTypes';

const AVERAGE_OR_POOR = ['average', 'poor'];
const ALL_8 = ['cracking', 'surface_damage', 'material_deterioration', 'movement_displacement', 'moisture_evidence', 'operational_defects', 'previous_repairs', 'safety_issues'];

function isConditionField(f: TemplateField): boolean {
  return f.key.toLowerCase().includes('condition') && !!f.options?.length && f.type !== 'damage-list';
}

/** "walls_condition" -> "walls_", "condition" -> "", "wallsCondition" -> "walls". */
function prefixOf(conditionKey: string): string {
  const snake = conditionKey.match(/^(.+_)condition$/i);
  if (snake) return snake[1]!;
  const camel = conditionKey.match(/^(.+)Condition$/);
  if (camel) return `${camel[1]}_`;
  return '';
}

interface Counts { added: number }

/** One level of a field tree: top-level `fields`, or one repeating-group's `itemFields`. */
function fixLevel(fields: TemplateField[], counts: Counts): TemplateField[] {
  const out = [...fields];

  // Recurse into each repeating-group's own itemFields as an independent level.
  for (let i = 0; i < out.length; i += 1) {
    if (out[i]!.itemFields) {
      out[i] = { ...out[i]!, itemFields: fixLevel(out[i]!.itemFields!, counts) };
    }
  }

  const conditions = out.filter(isConditionField);
  for (const cond of conditions) {
    const prefix = prefixOf(cond.key);
    const hasDamageList = out.some((f) => f.type === 'damage-list' && (prefix ? f.key.startsWith(prefix) : true) && isPairedTo(f, cond.key, out));
    if (hasDamageList) continue;

    const damages: TemplateField = {
      key: `${prefix}damages`, type: 'damage-list', label: 'Damages', order: 0,
      repeat: {
        presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect',
        requireWhen: { fieldKey: cond.key, equals: AVERAGE_OR_POOR },
      },
      itemFields: defectItemFields({ include: ALL_8 }),
    };
    const condIdx = out.indexOf(cond);
    out.splice(condIdx + 1, 0, damages);
    counts.added += 1;
  }

  return out.map((f, i) => ({ ...f, order: i }));
}

/** A damage-list already paired to this exact condition counts as "has one", however it's keyed. */
function isPairedTo(damageField: TemplateField, conditionKey: string, siblings: TemplateField[]): boolean {
  if (damageField.repeat?.requireWhen?.fieldKey === conditionKey) return true;
  // No requireWhen at all (legacy field): only trust a prefix match when
  // there's exactly one condition in scope, otherwise it's ambiguous.
  const conditionCount = siblings.filter(isConditionField).length;
  return !damageField.repeat?.requireWhen && conditionCount === 1;
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({
    where: { status: 'PUBLISHED', inspectionType: 'pre_purchase' },
  });
  let touched = 0;
  let totalAdded = 0;

  for (const t of templates) {
    const counts: Counts = { added: 0 };
    const fields = fixLevel(t.fields as unknown as TemplateField[], counts);
    if (counts.added === 0) continue;

    touched += 1;
    totalAdded += counts.added;

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: 'pre_purchase', propertyType: t.propertyType, sectionKey: t.sectionKey,
        name: t.name,
        version: t.version + 1,
        status: 'DRAFT',
        fields: fields as unknown as object,
        layout: (t.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: t.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    // eslint-disable-next-line no-console
    console.log(`${t.propertyType}/${t.sectionKey} -> v${draft.version} (${counts.added} damage-list(s) added)`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${touched} template(s) republished, ${totalAdded} damage-list(s) added.`);
  await prisma.$disconnect();
}

void main();
