// "All fields within each Dilapidation -> Pre-Purchase section are
// mandatory... Do not assume a field is optional unless it is explicitly
// designed to be optional." Marks `required: true` on every field, at every
// nesting depth, across every published Pre-Purchase template (all three
// property types) that doesn't already have it.
//
// This is a direct reversal of an earlier explicit instruction on this same
// project ("don't make the fields as required on pre purchase apartment"),
// which is why it's called out here rather than silently applied: this new
// spec is far more detailed and explicit about wanting the opposite, so it's
// treated as superseding that instruction -- but it's worth the requester
// knowing this undoes something they asked for before, in case that wasn't
// the intent.
//
// One deliberate exclusion: a repeating-group/damage-list container field
// itself is never marked required (it has no "value" of its own to fill in
// -- required-ness lives on the fields inside each instance, which this
// script reaches too via the recursion).
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

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED', inspectionType: 'pre_purchase' } });
  let touched = 0;
  let totalFields = 0;

  for (const t of templates) {
    const { fields, changed } = markRequired(t.fields as unknown as TemplateField[]);
    if (changed === 0) {
      // eslint-disable-next-line no-console
      console.log(`${t.propertyType}/${t.sectionKey}: already all required`);
      continue;
    }
    touched += 1;
    totalFields += changed;

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
    console.log(`${t.propertyType}/${t.sectionKey} -> v${draft.version} (${changed} field(s) marked required)`);
  }

  // eslint-disable-next-line no-console
  console.log(`\nDONE -- ${touched} template(s) republished, ${totalFields} field(s) marked required.`);
  await prisma.$disconnect();
}

void main();
