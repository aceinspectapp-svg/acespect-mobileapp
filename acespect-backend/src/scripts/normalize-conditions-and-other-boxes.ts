// Two global, app-wide standardisation passes over every published template
// (all inspection types, all property types, all sections), both direct
// inspector feedback:
//
// 1. "If there is a button called Other, leave a text area to specify what it
//    is -- throughout the mobile app."
//    Every pill-select / chip-multiselect / select-tiles field carrying an
//    "Other" option gets a companion textarea, required and gated so it only
//    appears once Other is actually picked. Purely additive: no existing
//    option or field is changed or removed. Fields that already had such a
//    companion (Paving, Retaining Walls, Fences, Rooms, Description &
//    Overview, etc. -- added section by section previously) are skipped.
//
// 2. "The Driveway condition on Dilapidation Residential is correct -- follow
//    it for every other condition template."
//    Driveway's is a 5-point color-select: Satisfactory with typical wear and
//    tear / Fair / Average / Poor / New. Every other condition-rating field
//    is rewritten to match it exactly.
//
//    This also fixes a real functional bug rather than just an inconsistency:
//    most templates outside Dilapidation Residential used a 4-point scale
//    with NO "Average" (new/satisfactory/fair/poor), while the mandatory-
//    defect rule fires on Average or Poor -- so on those templates the
//    Average branch could never be reached at all. Several others mixed
//    severity words with defect observations in one list ("Significant
//    cracks and chipping", "Patches", "Varying", "Decayed"), which the
//    AS 4349.1 defect taxonomy now covers properly.
//
//    Any damage-list `requireWhen` pointing at a normalised condition field
//    is retargeted to ['average','poor'] to match, since scales that
//    previously lacked "Average" had been keyed on ['fair','poor'].
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

// Copied verbatim from dilapidation/residential_house/driveway.condition.
const CANONICAL_CONDITION: TemplateFieldOption[] = [
  { value: 'satisfactory_with_typical_wear_and_tear', label: 'Satisfactory with typical wear and tear' },
  { value: 'fair', label: 'Fair' },
  { value: 'average', label: 'Average' },
  { value: 'poor', label: 'Poor' },
  { value: 'new', label: 'New' },
];

const SELECTABLE = new Set(['pill-select', 'chip-multiselect', 'select-tiles', 'color-select']);

function isConditionField(f: TemplateField): boolean {
  return (
    f.key.toLowerCase().includes('condition') &&
    SELECTABLE.has(f.type) &&
    Array.isArray(f.options) &&
    f.options.length > 0
  );
}

function hasOtherOption(f: TemplateField): boolean {
  return SELECTABLE.has(f.type) && (f.options ?? []).some((o) => o.value === 'other');
}

function hasCompanion(key: string, siblings: TemplateField[]): boolean {
  return siblings.some(
    (s) => s.gate?.fieldKey === key && (s.gate.equals === 'other' || s.gate.equalsAny?.includes('other')),
  );
}

interface Counts { conditions: number; otherBoxes: number; requireWhen: number }

/** Rewrites one sibling array (and recurses into every itemFields below it). */
function processLevel(fields: TemplateField[], counts: Counts): TemplateField[] {
  const normalisedConditionKeys = new Set<string>();
  const out: TemplateField[] = [];

  for (const original of fields) {
    let f: TemplateField = { ...original };

    if (isConditionField(f)) {
      normalisedConditionKeys.add(f.key);
      const alreadyCanonical =
        f.type === 'color-select' &&
        f.options!.length === CANONICAL_CONDITION.length &&
        f.options!.every((o, i) => o.value === CANONICAL_CONDITION[i]!.value);
      if (!alreadyCanonical) {
        counts.conditions += 1;
        f = { ...f, type: 'color-select', options: CANONICAL_CONDITION.map((o) => ({ ...o })) };
      }
    }

    if (f.itemFields) f = { ...f, itemFields: processLevel(f.itemFields, counts) };

    out.push(f);

    // Companion "specify" box, inserted directly after its source field.
    if (hasOtherOption(f) && !hasCompanion(f.key, fields)) {
      counts.otherBoxes += 1;
      out.push({
        key: `${f.key}Other`,
        type: 'textarea',
        label: 'If Other — please specify',
        required: true,
        order: 0,
        gate: { fieldKey: f.key, equalsAny: ['other'] },
        ...(f.sectionLetter ? { sectionLetter: f.sectionLetter } : {}),
      });
    }
  }

  // Retarget any requireWhen keyed on a condition field we just normalised --
  // scales that had no "Average" were keyed on ['fair','poor'].
  return out.map((f, i) => {
    const req = f.repeat?.requireWhen;
    if (req && normalisedConditionKeys.has(req.fieldKey)) {
      const wanted = ['average', 'poor'];
      const same = req.equals.length === wanted.length && wanted.every((v) => req.equals.includes(v));
      if (!same) {
        counts.requireWhen += 1;
        return { ...f, order: i, repeat: { ...f.repeat!, requireWhen: { ...req, equals: wanted } } };
      }
    }
    return { ...f, order: i };
  });
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const published = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  const totals: Counts = { conditions: 0, otherBoxes: 0, requireWhen: 0 };
  let touched = 0;

  for (const t of published) {
    const before = JSON.stringify(t.fields);
    const counts: Counts = { conditions: 0, otherBoxes: 0, requireWhen: 0 };
    const fields = processLevel(t.fields as unknown as TemplateField[], counts);
    if (JSON.stringify(fields) === before) continue;

    touched += 1;
    totals.conditions += counts.conditions;
    totals.otherBoxes += counts.otherBoxes;
    totals.requireWhen += counts.requireWhen;

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
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (conditions:${counts.conditions} other:${counts.otherBoxes} requireWhen:${counts.requireWhen})`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${touched} template(s) republished; ${totals.conditions} condition fields normalised, ${totals.otherBoxes} Other boxes added, ${totals.requireWhen} requireWhen rules retargeted.`);
  await prisma.$disconnect();
}

void main();
