// Apartment's Elevations/Paving/Roof-Interior/Internal-Areas were built on
// a different pattern from every other section: instead of one "damages"
// damage-list per scope, each sub-feature is its own self-contained block
// (<prefix>_applicable, _condition, _checks, _comments, _photos) with a
// curated multi-select of common issues for that specific feature. That
// pattern has no damage-list field at all, so the AS 4349.1 taxonomy +
// mandatory-at-Average/Poor rule -- which every other section on every
// property type now has -- had nothing to attach to here. This is why
// "still this is not added to apartments" persisted after the gate fix:
// that fix only helped sections that already HAD a damage-list; these 21
// blocks never did.
//
// Adds a `<prefix>_damages` damage-list directly after each block's own
// `<prefix>_condition`, mandatory once that condition is Average/Poor --
// same taxonomy, same rule, same position as everywhere else. The existing
// `_checks` curated multi-select is left in place untouched (purely
// additive, same principle as the Other-box sweep): it's a quick tick-list
// of that feature's own common issues, complementary to the new structured
// per-defect record, not a replacement for it.
//
// Defect-type subset is picked per block, same reasoning as every other
// section this pass: Operational Defects only where the block genuinely has
// an operable element (windows, doors, lifts, cabinets); dropped everywhere
// else (walls, cladding, paving, gutters, ceilings, stairs, balconies).
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';
import { defectItemFields } from './lib/defectTypes';

const ALL_8 = ['cracking', 'surface_damage', 'material_deterioration', 'movement_displacement', 'moisture_evidence', 'operational_defects', 'previous_repairs', 'safety_issues'];
const NO_OPERATIONAL = ALL_8.filter((t) => t !== 'operational_defects');
const AVERAGE_OR_POOR = ['average', 'poor'];

const BLOCKS: Record<string, { prefixes: Record<string, string[]> }> = {
  elevations: {
    prefixes: {
      ext_walls: NO_OPERATIONAL,
      cladding: NO_OPERATIONAL,
      garage: NO_OPERATIONAL,
      windows_ext: ALL_8,
      front_door: ALL_8,
      other_doors_ext: ALL_8,
      balconies: NO_OPERATIONAL,
    },
  },
  paving_paths: {
    prefixes: {
      foyer: NO_OPERATIONAL,
      lifts: ALL_8, // lift doors are an operable element
      driveway_common: NO_OPERATIONAL,
      ext_paving: NO_OPERATIONAL,
    },
  },
  roof_chimneys: {
    prefixes: {
      eaves: NO_OPERATIONAL,
      fascia: NO_OPERATIONAL,
      gutters: NO_OPERATIONAL,
      downpipes: NO_OPERATIONAL,
    },
  },
  internal_areas: {
    prefixes: {
      ceilings: NO_OPERATIONAL,
      int_walls: NO_OPERATIONAL,
      int_stairs: NO_OPERATIONAL,
      int_windows: ALL_8,
      int_doors: ALL_8,
      cabinets: ALL_8,
    },
  },
};

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  let totalAdded = 0;

  for (const [sectionKey, { prefixes }] of Object.entries(BLOCKS)) {
    const published = await prisma.inspectionTemplate.findFirst({
      where: { status: 'PUBLISHED', inspectionType: 'dilapidation', propertyType: 'apartment', sectionKey },
      orderBy: { version: 'desc' },
    });
    if (!published) throw new Error(`apartment/${sectionKey} not found`);

    const fields = [...(published.fields as unknown as TemplateField[])];
    let added = 0;

    for (const [prefix, types] of Object.entries(prefixes)) {
      const condKey = `${prefix}_condition`;
      const condIdx = fields.findIndex((f) => f.key === condKey);
      if (condIdx === -1) throw new Error(`apartment/${sectionKey}: ${condKey} not found -- shape changed`);
      const damageKey = `${prefix}_damages`;
      if (fields.some((f) => f.key === damageKey)) continue; // already present, skip

      fields.splice(condIdx + 1, 0, {
        key: damageKey, type: 'damage-list', label: 'Damages', order: 0,
        repeat: {
          presentation: 'strip', addable: true, addButtonLabel: 'Add damage/defect',
          requireWhen: { fieldKey: condKey, equals: AVERAGE_OR_POOR },
        },
        itemFields: defectItemFields({ include: types }),
      });
      added += 1;
    }

    if (added === 0) {
      // eslint-disable-next-line no-console
      console.log(`apartment/${sectionKey}: nothing to add`);
      continue;
    }

    const numbered = fields.map((f, i) => ({ ...f, order: i }));
    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: 'dilapidation', propertyType: 'apartment', sectionKey,
        name: published.name,
        version: published.version + 1,
        status: 'DRAFT',
        fields: numbered as unknown as object,
        layout: (published.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: published.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    totalAdded += added;
    // eslint-disable-next-line no-console
    console.log(`apartment/${sectionKey} -> v${draft.version} (${added} damage-list(s) added)`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${totalAdded} damage-list(s) added across apartment's block-style sections.`);
  await prisma.$disconnect();
}

void main();
