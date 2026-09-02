// Fixes: "when I touch Average or Poor the defect specification box does
// not come like residential" -- on apartment and public_assets, several
// damage-lists were left gated behind an old pre-screening Yes/No
// ("Notable Damage?" / "Damage Present?" / "Notable Cracking?") that
// predates the AS 4349.1 mandate. The earlier global rollout
// (rollout-defect-taxonomy-all.ts) added `repeat.requireWhen` on condition
// everywhere, but never touched each field's own top-level `gate` -- so on
// these sections the damage-list stayed invisible until that unrelated
// Yes/No was ALSO answered "yes", no matter what Condition was set to.
// Residential never had this pattern, which is why it worked there and not
// on apartment/public_assets.
//
// Fix: drop the gate itself. The field becomes always-visible (same as
// Driveway/Paving/Elevations on residential), and `requireWhen` alone
// drives the mandatory-once-Average-or-Poor behaviour.
//
// Left alone, deliberately: gates that ask "is this feature/part present at
// all" (`present`, `itemsPresent`, `guardRails`, `retainingWalls`,
// `bridges`) -- those are legitimate scope questions, not damage
// pre-screening, and match the pattern residential already uses.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const ORPHAN_GATE_KEYS = new Set(['notableDamage', 'notableCracking', 'hasDamage']);

function fix(fields: TemplateField[]): { fields: TemplateField[]; changed: boolean } {
  let changed = false;
  const next = fields.map((f) => {
    let field = f;
    if (field.type === 'damage-list' && field.gate && ORPHAN_GATE_KEYS.has(field.gate.fieldKey)) {
      changed = true;
      const { gate, ...rest } = field;
      field = rest as TemplateField;
    }
    if (field.itemFields) {
      const inner = fix(field.itemFields);
      if (inner.changed) {
        changed = true;
        field = { ...field, itemFields: inner.fields };
      }
    }
    return field;
  });
  return { fields: next, changed };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const published = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED', inspectionType: 'dilapidation' } });
  let touched = 0;

  for (const t of published) {
    const { fields, changed } = fix(t.fields as unknown as TemplateField[]);
    if (!changed) continue;
    touched += 1;

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
    console.log(`${t.propertyType}/${t.sectionKey} -> v${draft.version}`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${touched} template(s) fixed.`);
  await prisma.$disconnect();
}

void main();
