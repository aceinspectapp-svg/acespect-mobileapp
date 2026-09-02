// Redesigns three more Dilapidation × Residential House sections per direct
// inspector feedback, following the same pattern established for Driveway
// (src/scripts/seed-driveway-defect-redesign.ts): the AS 4349.1-style defect
// taxonomy (src/scripts/lib/defectTypes.ts), moved to sit directly below
// Condition, mandatory once Condition drops low enough.
//
// One thing genuinely differs per section, taken directly from how each
// request was worded rather than assumed to match the others:
//   - Driveway (already shipped): mandatory at Average/Poor.
//   - Paving, Retaining Walls, Elevations (this script): mandatory at
//     Fair/Average/Poor -- "fair or lower" was explicit in all three asks.
// Flagged back to the requester in case that's meant to be one consistent
// rule rather than two.
//
// Paving:
//   - Material and "sections obscured by" both gain an Other option, each
//     paired with its own required-when-selected comment box (same pattern
//     as Description & Overview's Other fields).
//   - Damages move below Condition, redesigned onto the shared taxonomy
//     (7 of 8 types -- Operational Defects excluded, doesn't apply to a
//     paved surface), mandatory at Fair/Average/Poor.
//
// Retaining Walls:
//   - New leading label -- what actually counts as a reportable retaining
//     wall -- using `sectionLetter`'s existing banner styling rather than a
//     new field type, so no engine change was needed for it.
//   - Condition was a chip-multiselect mixing severity words ("Fair",
//     "Poor") with defect observations ("Decayed", "Leaning") in one list;
//     split into a clean 4-point color-select (the defect observations move
//     into the new taxonomy, where "Decayed" and "Leaning" already exist as
//     Material Deterioration / Movement-Displacement sub-types).
//   - The defect section is not just mandatory but HIDDEN until Condition is
//     Fair or lower (a `gate`, not just `requireWhen` -- explicitly asked
//     for here, unlike Driveway/Paving/Elevations which keep theirs always
//     visible).
//   - Materials/obscured-by both get the same Other-needs-comment treatment
//     as Paving, by inference from the same pattern rather than an explicit
//     re-ask for this section specifically.
//   - A Notes field that is NOT gated on condition at all, since the ask was
//     explicit that notes should exist "irrespective of the condition" --
//     the old `worstItem` free-text (now redundant with the structured
//     defect list) is dropped in its favour.
//
// Elevations:
//   - Just the validation: damages mandatory at Fair/Average/Poor. Also
//     moved the damages field below Condition and onto the shared taxonomy
//     for consistency with the rest -- not explicitly re-asked, but the
//     established pattern by this point.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';
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

function numbered(fields: Field[]): TemplateField[] {
  return fields.map((f, i) => ({ ...f, order: i }));
}

const YES = { fieldKey: 'present', equals: 'yes' };
const FAIR_OR_LOWER = ['fair', 'average', 'poor'];
// Hard surfaces / exterior fabric -- Operational Defects (doors/windows/
// gates) doesn't apply to any of these three sections.
const EXTERIOR_DEFECT_TYPES = [
  'cracking', 'surface_damage', 'material_deterioration',
  'movement_displacement', 'moisture_evidence', 'previous_repairs', 'safety_issues',
];

/** An "Other" pill/chip option paired with its own required-when-selected detail box. */
function otherDetail(key: string, sourceKey: string, label = 'If Other — specify material'): Field {
  return { key, type: 'textarea', label, required: true, gate: { fieldKey: sourceKey, equals: 'other' } };
}

async function republish(sectionKey: string, buildFields: (published: TemplateField[]) => Field[]) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error(`No published ${sectionKey} template found`);

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = numbered(buildFields(published.fields as unknown as TemplateField[]));

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
  console.log(`[defects-redesign] ${sectionKey} -> v${draft.version} (${fields.length} top-level fields)`);
}

async function main() {
  // ── Paving & Paths ─────────────────────────────────────────────────────
  await republish('paving_paths', () => [
    {
      key: 'areas', type: 'repeating-group',
      label: 'Paving (put pool, alfresco and lightwell paving into their own sections)',
      repeat: {
        presentation: 'fixed-tabs',
        fixedInstances: [
          { key: 'front', label: 'Front' }, { key: 'left', label: 'Left' },
          { key: 'rear', label: 'Rear' }, { key: 'right', label: 'Right' },
        ],
      },
      itemFields: numbered([
        { key: 'present', type: 'yesno', label: 'Is there paving to this side?' },
        { key: 'material', type: 'chip-multiselect', label: 'Material', options: opts('Concrete', 'Pavers', 'Gravel', 'Grass only', 'Other'), gate: YES },
        { ...otherDetail('materialOther', 'material'), gate: YES },
        { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory', 'Fair', 'Average', 'Poor', 'Good in relation to its age'), gate: YES },
        {
          key: 'damages', type: 'damage-list', label: 'Damages', gate: YES,
          repeat: {
            presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect',
            requireWhen: { fieldKey: 'condition', equals: FAIR_OR_LOWER },
          },
          itemFields: defectItemFields({ include: EXTERIOR_DEFECT_TYPES }),
        },
        { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other'), gate: YES },
        { ...otherDetail('obscuredByOther', 'obscuredBy', 'If Other — specify'), gate: YES },
        { key: 'photos', type: 'photos', label: 'Pics', gate: YES },
        { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
      ]),
    },
  ]);

  // ── Retaining Walls ────────────────────────────────────────────────────
  await republish('retaining_walls', () => [
    { key: 'present', type: 'yesno', label: 'Are there any retaining walls?' },
    {
      key: 'items', type: 'repeating-group', label: 'Retaining walls', gate: YES,
      repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add retaining wall', titleFieldKey: 'location' },
      itemFields: numbered([
        {
          key: 'location', type: 'pill-select', label: 'Location', options: opts('Left', 'Right', 'Rear', 'Front'),
          // Guidance banner, not a question -- gets the inspector thinking
          // about what actually counts as a reportable retaining wall before
          // they start filling this in. Reuses the existing sectionLetter
          // banner styling rather than a new field type.
          sectionLetter: 'Retaining walls supporting other structures OR landscaping retaining walls more than 700mm high',
        },
        { key: 'materials', type: 'chip-multiselect', label: 'Materials', options: opts('Brick', 'Gal steel post & sleepers', 'Timber sleepers', 'Other') },
        otherDetail('materialsOther', 'materials'),
        { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory', 'Fair', 'Average', 'Poor') },
        {
          // Hidden entirely until Condition warrants it (not just mandatory
          // once shown) -- the explicit ask for this section, unlike the
          // other three which keep their defect list always visible.
          key: 'damages', type: 'damage-list', label: 'Damages',
          gate: { fieldKey: 'condition', equalsAny: FAIR_OR_LOWER },
          repeat: {
            presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect',
            requireWhen: { fieldKey: 'condition', equals: FAIR_OR_LOWER },
          },
          itemFields: defectItemFields({ include: EXTERIOR_DEFECT_TYPES }),
        },
        { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other') },
        otherDetail('obscuredByOther', 'obscuredBy', 'If Other — specify'),
        { key: 'photos', type: 'photos', label: 'Pics' },
        // Ungated -- present regardless of Condition, per the explicit ask.
        { key: 'notes', type: 'textarea', label: 'Notes' },
      ]),
    },
  ]);

  // ── Elevations ─────────────────────────────────────────────────────────
  await republish('elevations', (published) => {
    const sides = published.find((f) => f.key === 'sides');
    if (!sides?.itemFields) throw new Error('elevations.sides.itemFields not found -- template shape has changed');
    const byKey = new Map(sides.itemFields.map((f) => [f.key, f]));

    const damages: Field = {
      key: 'damages', type: 'damage-list', label: 'Damages',
      repeat: {
        presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect',
        requireWhen: { fieldKey: 'condition', equals: FAIR_OR_LOWER },
      },
      itemFields: defectItemFields({ include: EXTERIOR_DEFECT_TYPES }),
    };

    const order = ['orientation', 'partyWall', 'partyWallNumber', 'partialInspection', 'condition', 'damages', 'obscuredBy', 'damageSummary', 'photos'];
    const reordered: Field[] = order.map((k) => (k === 'damages' ? damages : byKey.get(k))).filter((f): f is Field => !!f);
    const rest = sides.itemFields.filter((f) => !order.includes(f.key) && f.key !== 'damages');

    return [{ ...sides, itemFields: numbered([...reordered, ...rest]) }];
  });

  await prisma.$disconnect();
}

void main();
