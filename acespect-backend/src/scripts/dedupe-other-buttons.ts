// Fixes fields that show the "Other" pill TWICE. Only pill-select and
// chip-multiselect render this way: PillSelect/ChipMultiSelect
// (src/components/inspection/fieldKit.tsx) render `options.map(...)` and
// THEN, separately, `{allowOther && <Pressable>Other</Pressable>}` --
// so any field that already has a literal `{value:'other', label:'Other'}`
// option in its list AND `allowOther: true` gets two identical-looking
// buttons that both write the same 'other' value. This combination exists
// app-wide because add-other-option-app-wide.ts and fix-dead-other-options.ts
// both set allowOther:true without first checking whether the field already
// carried a plain 'other' option that would now be redundant.
// select-tiles/tile-multiselect are unaffected -- their tile grids don't
// synthesize an extra "Other" tile from allowOther.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const DUPLICATING_TYPES = new Set(['pill-select', 'chip-multiselect']);

function isOtherOption(o: { value: string; label: string }): boolean {
  return o.value?.toLowerCase() === 'other' || o.label?.trim().toLowerCase() === 'other';
}

function dedupe(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const next = fields.map((f) => {
    let field = f;
    if (DUPLICATING_TYPES.has(field.type) && field.allowOther && (field.options ?? []).some(isOtherOption)) {
      const filtered = (field.options ?? []).filter((o) => !isOtherOption(o));
      if (filtered.length !== (field.options ?? []).length) {
        field = { ...field, options: filtered };
        changed++;
      }
    }
    if (field.itemFields) {
      const sub = dedupe(field.itemFields);
      if (sub.changed > 0) {
        field = { ...field, itemFields: sub.fields };
        changed += sub.changed;
      }
    }
    return field;
  });
  return { fields: next, changed };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  let touchedTemplates = 0;
  let touchedFields = 0;
  const touchedLineages: { inspectionType: string; propertyType: string; sectionKey: string }[] = [];

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const { fields: nextFields, changed } = dedupe(fields);
    if (changed === 0) continue;
    touchedTemplates += 1;
    touchedFields += changed;
    touchedLineages.push({ inspectionType: t.inspectionType, propertyType: t.propertyType, sectionKey: t.sectionKey });

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: t.inspectionType, propertyType: t.propertyType, sectionKey: t.sectionKey,
        name: t.name,
        version: t.version + 1,
        status: 'DRAFT',
        fields: nextFields as unknown as object,
        layout: (t.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: t.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (${changed} field(s) deduped)`);
  }

  // Un-pin every inspector from the old version of anything touched -- next
  // fetch auto-accepts the latest published (see getActiveForInspector).
  let unpinned = 0;
  for (const lineage of touchedLineages) {
    const res = await prisma.templateAcceptance.deleteMany({ where: lineage });
    unpinned += res.count;
  }

  console.log(`\nDONE -- ${touchedTemplates} template(s), ${touchedFields} field(s) deduped. ${unpinned} stale acceptance row(s) cleared.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
