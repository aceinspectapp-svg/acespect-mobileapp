// Rolls the AS 4349.1 defect setup out to EVERY remaining published template
// -- all property types and all inspection types, not just Dilapidation
// Residential House, which is all the earlier per-section scripts covered.
//
// For each damage-list still on the old shape it:
//   1. Replaces its itemFields with the shared taxonomy (Location -> Element
//      -> Defect Type -> Sub-type -> crack dimensions -> Notes -> Photos).
//   2. Pairs it with its own condition field and makes defects mandatory once
//      that condition is Average or Poor.
//   3. Moves it to sit directly below that condition field.
//   4. Renames its add button to "Add damage/defect".
//
// Pairing is prefix-aware, which matters for Public Assets' road/laneway
// survey: one scope there holds footpaths_damages, kerbs_damages,
// roadsurface_damages, fenceleft_damages and more side by side, each with its
// own <prefix>_condition. Naively taking "the condition field in this scope"
// would key every one of them to footpaths. Where a list has no condition to
// pair with at all (Notes' general "additional damage records", Public
// Assets' guard rails / bridges / retaining walls, which have no condition
// field of their own), it still gets the taxonomy but no mandate -- there is
// nothing to trigger one from.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';
import { defectItemFields } from './lib/defectTypes';

const TAXONOMY_MARKER = 'sub_cracking';
const AVERAGE_OR_POOR = ['average', 'poor'];

const ALL_8 = ['cracking', 'surface_damage', 'material_deterioration', 'movement_displacement', 'moisture_evidence', 'operational_defects', 'previous_repairs', 'safety_issues'];
const NO_OPERATIONAL = ALL_8.filter((t) => t !== 'operational_defects');

// Operational Defects (doors/windows/gates/garage doors) doesn't apply to a
// slab, a path or a roof covering; everywhere else it can.
const TYPES_BY_SECTION: Record<string, string[]> = {
  driveway: NO_OPERATIONAL,
  paving_paths: NO_OPERATIONAL,
  elevations: NO_OPERATIONAL,
  retaining_walls: NO_OPERATIONAL,
  roof_chimneys: NO_OPERATIONAL,
};

function typesFor(sectionKey: string, propertyType: string): string[] {
  // Public Assets' "elevations" is a civil road/laneway survey (fences and
  // their gates included), not a building elevation -- it keeps all 8.
  if (propertyType === 'public_assets') return ALL_8;
  return TYPES_BY_SECTION[sectionKey] ?? ALL_8;
}

function isConditionField(f: TemplateField): boolean {
  return f.key.toLowerCase().includes('condition') && !!f.options?.length;
}

/** "footpaths_damages" -> "footpaths", "guardRailsDamages" -> "guardrails", "cracks" -> "". */
function prefixOf(damageKey: string): string {
  return damageKey
    .replace(/[_]?(damages|damage|cracks|cracking)$/i, '')
    .replace(/[_]+$/, '')
    .toLowerCase();
}

/** The condition field this damage list belongs to, or undefined. */
function pairedCondition(damage: TemplateField, siblings: TemplateField[]): TemplateField | undefined {
  const conditions = siblings.filter(isConditionField);
  if (conditions.length === 0) return undefined;

  const prefix = prefixOf(damage.key);
  if (prefix) {
    const prefixed = conditions.find((c) => c.key.toLowerCase().startsWith(prefix));
    if (prefixed) return prefixed;
  }
  // No prefix match: only safe to fall back when the scope is unambiguous.
  return conditions.length === 1 ? conditions[0] : undefined;
}

interface Counts { lists: number; mandates: number; moved: number }

function processLevel(fields: TemplateField[], sectionKey: string, propertyType: string, counts: Counts): TemplateField[] {
  // Recurse first so nested scopes are handled independently.
  let out = fields.map((f) => (f.itemFields ? { ...f, itemFields: processLevel(f.itemFields, sectionKey, propertyType, counts) } : { ...f }));

  const rebuilt: TemplateField[] = [];
  for (const f of out) {
    if (f.type !== 'damage-list' || (f.itemFields ?? []).some((x) => x.key === TAXONOMY_MARKER)) {
      rebuilt.push(f);
      continue;
    }
    counts.lists += 1;
    const cond = pairedCondition(f, out);
    const next: TemplateField = {
      ...f,
      itemFields: defectItemFields({ include: typesFor(sectionKey, propertyType) }),
      repeat: {
        ...(f.repeat ?? { presentation: 'strip' as const }),
        presentation: f.repeat?.presentation ?? 'strip',
        addable: true,
        addButtonLabel: 'Add damage/defect',
        ...(cond ? { requireWhen: { fieldKey: cond.key, equals: AVERAGE_OR_POOR } } : {}),
      },
    };
    if (cond) counts.mandates += 1;
    rebuilt.push(next);
  }
  out = rebuilt;

  // Move each damage list to sit directly below the condition it pairs with.
  const damageLists = out.filter((f) => f.type === 'damage-list');
  for (const dmg of damageLists) {
    const cond = pairedCondition(dmg, out);
    if (!cond) continue;
    const from = out.indexOf(dmg);
    const condIdx = out.indexOf(cond);
    if (from === condIdx + 1) continue;
    out.splice(from, 1);
    out.splice(out.indexOf(cond) + 1, 0, dmg);
    counts.moved += 1;
  }

  return out.map((f, i) => ({ ...f, order: i }));
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const published = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  const totals: Counts = { lists: 0, mandates: 0, moved: 0 };
  let touched = 0;

  for (const t of published) {
    const before = JSON.stringify(t.fields);
    const counts: Counts = { lists: 0, mandates: 0, moved: 0 };
    const fields = processLevel(t.fields as unknown as TemplateField[], t.sectionKey, t.propertyType, counts);
    if (JSON.stringify(fields) === before) continue;

    touched += 1;
    totals.lists += counts.lists;
    totals.mandates += counts.mandates;
    totals.moved += counts.moved;

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: t.inspectionType, propertyType: t.propertyType, sectionKey: t.sectionKey,
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
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (lists:${counts.lists} mandates:${counts.mandates} moved:${counts.moved})`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${touched} template(s) republished; ${totals.lists} damage-list(s) upgraded, ${totals.mandates} mandatory-defect rule(s) added, ${totals.moved} moved below their condition.`);
  await prisma.$disconnect();
}

void main();
