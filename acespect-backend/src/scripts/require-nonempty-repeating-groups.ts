// "Only Paving & Description ask to save as draft or complete -- I want
// every incomplete section to ask this." Root cause: meetsAllRequiredFields
// (mobile) already handles this correctly for a required field whose value
// is an array -- `isFilled` checks `.length > 0` -- but a `repeating-group`
// container was never itself marked `required`, on the reasoning "it has no
// value of its own to fill in." That's wrong for a `strip`/addable group:
// with zero instances added, there's nothing inside for the recursive check
// to walk into, so it passes vacuously. Concretely: Retaining Walls'
// `present = yes` gates open an addable `items` list with no floor on how
// many get added -- add none, and the section reads as complete anyway.
// Paving/Elevations never hit this because they're `fixed-tabs` (a fixed
// slot per side, always checked regardless of visitation) and Description
// has no repeating-groups at all -- which is why only those reliably
// triggered the prompt.
//
// Fix: mark every `repeating-group` container `required: true` wherever it
// isn't already, at any nesting depth, across every published template
// (every inspection type, every property type -- this isn't Pre-Purchase-
// specific, Dilapidation has the identical gap). `damage-list` containers
// are deliberately excluded: their mandate is already correctly conditional
// via `repeat.requireWhen` (only once Condition is Average/Poor, say) --
// making them unconditionally required would force a defect entry even when
// nothing is wrong, which is a real regression, not a fix.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function fix(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const next = fields.map((f) => {
    let field = f;
    if (field.type === 'repeating-group' && !field.required) {
      changed += 1;
      field = { ...field, required: true };
    }
    if (field.itemFields) {
      const inner = fix(field.itemFields);
      changed += inner.changed;
      field = { ...field, itemFields: inner.fields };
    }
    return field;
  });
  return { fields: next, changed };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  let touched = 0;
  let totalFields = 0;

  for (const t of templates) {
    const { fields, changed } = fix(t.fields as unknown as TemplateField[]);
    if (changed === 0) continue;
    touched += 1;
    totalFields += changed;

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
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (${changed} repeating-group(s) marked required)`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${touched} template(s) republished, ${totalFields} repeating-group(s) marked required.`);
  await prisma.$disconnect();
}

void main();
