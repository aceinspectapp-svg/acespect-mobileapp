// Public Assets Dilapidation's "Survey Parts" category blocks (Footpaths,
// Nature Strip, Kerbs, Road Surface, Fencing left/right, Laneway) each have
// a `${prefix}_summary` pill-select ("Cracking / gaps / other deterioration")
// with a purpose-built `${prefix}_summaryOther` "Other (define)" companion
// field -- but that companion's gate only ever checked `itemsPresent`, the
// SAME condition its own parent block gates on, never actually checking
// whether "Other" was picked. It showed, and was required, unconditionally
// for every one of these 7 fields, every time the category was present at
// all. On top of that, add-other-option-app-wide.ts (run earlier this
// session) added `allowOther: true` onto the `_summary` pill-select itself,
// not knowing a dedicated companion already existed -- a second, redundant
// "Other" input layered onto the first.
//
// Fixed per prefix:
// 1. Remove the redundant `allowOther` from `${prefix}_summary`.
// 2. Add a literal {value:'other', label:'Other'} option to it instead --
//    a pill-select's own value is fully overwritten by typed specify text
//    (`__other__:<text>`) once allowOther's inline box is used, which would
//    break a same-value gate the moment the inspector starts typing; a plain
//    option keeps the stored value as the bare string 'other' permanently,
//    which is what makes gating on it reliable (same pattern already used
//    correctly elsewhere for a chip-multiselect parent, e.g.
//    wallCladdingGroundOther -- multi-select's 'other' entry persists in the
//    array even once text is added, so gating just worked there already).
// 3. Point `${prefix}_summaryOther`'s gate at `${prefix}_summary === 'other'`
//    directly -- sufficient on its own since `_summary` can only ever be
//    answered (let alone be 'other') once its own itemsPresent gate already
//    holds.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const PREFIXES = ['footpaths', 'naturestrip', 'kerbs', 'roadsurface', 'fenceleft', 'fenceright', 'lanesurface'];

function fixFields(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const relevant = PREFIXES.some((p) => byKey.has(`${p}_summary`) && byKey.has(`${p}_summaryOther`));
  if (!relevant) {
    // Still recurse into nested itemFields (this block lives inside a
    // repeating "Part" instance), same as every other app-wide script this
    // session.
    let sub = { fields, changed: 0 };
    let touchedAny = false;
    const next = fields.map((f) => {
      if (!f.itemFields) return f;
      const r = fixFields(f.itemFields);
      if (r.changed === 0) return f;
      touchedAny = true;
      changed += r.changed;
      return { ...f, itemFields: r.fields };
    });
    return { fields: touchedAny ? next : fields, changed };
  }

  const next = fields.map((f) => {
    for (const prefix of PREFIXES) {
      if (f.key === `${prefix}_summary` && f.allowOther) {
        const hasLiteralOther = (f.options ?? []).some((o) => o.value === 'other');
        changed++;
        return {
          ...f,
          allowOther: undefined,
          options: hasLiteralOther ? f.options : [...(f.options ?? []), { value: 'other', label: 'Other' }],
        };
      }
      if (f.key === `${prefix}_summaryOther`) {
        if (f.gate?.fieldKey === `${prefix}_summary` && f.gate?.equals === 'other') return f; // already correct
        changed++;
        return { ...f, gate: { fieldKey: `${prefix}_summary`, equals: 'other' } };
      }
    }
    return f;
  });
  return { fields: next, changed };
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  let touchedTemplates = 0;
  let touchedFields = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const { fields: nextFields, changed } = fixFields(fields);
    if (changed === 0) continue;
    touchedTemplates += 1;
    touchedFields += changed;

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
    console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} -> v${draft.version} (${changed} field(s))`);
  }

  let unpinned = 0;
  if (touchedTemplates > 0) {
    const res = await prisma.templateAcceptance.deleteMany({
      where: { inspectionType: 'dilapidation', propertyType: 'public_assets' },
    });
    unpinned = res.count;
  }

  console.log(`\nDONE -- ${touchedTemplates} template(s), ${touchedFields} field(s) fixed. ${unpinned} stale acceptance row(s) cleared.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
