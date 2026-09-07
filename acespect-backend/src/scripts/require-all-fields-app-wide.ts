// "It's still not working for driveway and retaining walls" -- root cause:
// Dilapidation never got the "every field is mandatory" treatment
// prepurchase-require-all-fields.ts applied to Pre-Purchase only. Concretely
// (checked live): Driveway has ZERO required fields at all, so
// meetsAllRequiredFields is trivially true no matter what's left blank --
// the draft-or-complete prompt has nothing to ever trigger on. Retaining
// Walls' `items` container itself got marked required by
// require-nonempty-repeating-groups.ts (so an empty list is correctly
// blocked), but the fields *inside* each item -- location, materials,
// condition -- were never required, so adding one blank item is enough to
// satisfy it.
//
// Given the requester has now asked for this consistently across every
// section, not just Pre-Purchase, this is the same field-level sweep
// applied app-wide: every field, every nesting depth, across every
// published template, every inspection type, every property type.
//
// Same one exclusion as the Pre-Purchase version, for the same reason: a
// repeating-group/damage-list container itself is never marked required
// here (it has no value of its own -- required-ness for "at least one
// instance" is what require-nonempty-repeating-groups.ts already handles
// separately, and deliberately does NOT touch damage-list, since those are
// correctly conditional via repeat.requireWhen rather than unconditionally
// mandatory).
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const CONTAINER_TYPES = new Set(['repeating-group', 'damage-list']);

function markRequired(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const next = fields.map((f) => {
    let field = f;
    if (!CONTAINER_TYPES.has(f.type) && !f.required) {
      changed += 1;
      field = { ...field, required: true };
    }
    if (field.itemFields) {
      const inner = markRequired(field.itemFields);
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
    const { fields, changed } = markRequired(t.fields as unknown as TemplateField[]);
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
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (${changed} field(s) marked required)`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${touched} template(s) republished, ${totalFields} field(s) marked required.`);
  await prisma.$disconnect();
}

void main();
