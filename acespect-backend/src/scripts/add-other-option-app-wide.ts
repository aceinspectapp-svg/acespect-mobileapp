// Adds an "Other" option (+ allowOther: true) to every chip-multiselect
// field missing one, and to pill-select fields whose option list is clearly
// open-ended (materials, defect/deterioration/movement/moisture/repair/
// safety catalogs, construction types) -- not to exhaustive/binary ones
// (Yes/No, N/S/E/W orientation, Floor Level, condition/severity rating
// scales, Applicability/Reason exclusion gates). Per direct inspector
// feedback after noticing a defect-observation field with no escape hatch
// for something outside its listed options. Mirrors the same classification
// applied to prisma/templates-snapshot.json -- see git history for the
// pill-select ADD/SKIP list this was built from.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const SKIP_LABELS = new Set([
  'Location', 'Position', 'Orientation', 'Street frontage', 'Floor Level', 'Level', 'Floor level',
  'Attachment', 'Post Project or Pre Project?', 'Applicability', 'Reason', 'Gas supply', 'Gas supply is',
  'Door closer working', 'Client list of issues', 'Hand rails', 'Condition of hand rails',
  'Glazing beads appear', 'Damage overview', 'Cracking overview', 'The block is', 'Block slope',
  'Car space type', 'Carport is at', 'Inspection scope', 'Elevations inspected', 'Scope for inspection — confirm on day of inspection',
  'Project direction from property', 'Cladding condition', 'Windows & doors', 'Gutters & downpipes',
  'Construction is', 'There is a', 'Count', 'There are', 'Painted line markings are',
  'Limited views through plinth boards — condition', 'Any signs of failure', 'Any signs of failure?', 'Sub-floor inspected from manhole at',
  'In relation to the property inspected is to the', 'Which is approximately', 'Located at',
  'Which is to the', 'Approximately', 'The road / lane runs', 'Survey commenced at', 'And proceeded',
  'To end point of survey', 'It is', 'Attachment (if the basement is the garage, record it under Internal Areas)',
  'Adequately fixed to the house?',
]);
const SKIP_LABEL_RX = /orientation|frontage|scope|direction from property|condition of|applicability|^reason$/i;
const SCALE_OPTION_RX = /^(good|satisfactory|fair|average|poor|sound|serviceable|worn|new|varying)$/i;

function isNumericish(opts: { label: string }[]): boolean {
  return opts.every((o) => /^(nil|na|n\/a|not applicable)$/i.test(o.label) || /^\d+\+?$/.test(o.label));
}
function shouldSkipPill(f: TemplateField): boolean {
  const opts = f.options || [];
  if (SKIP_LABELS.has(f.label)) return true;
  if (SKIP_LABEL_RX.test(f.label)) return true;
  if (opts.length <= 3 && opts.every((o) => /^(yes|no|na|n\/a|not applicable)/i.test(o.label))) return true;
  if (isNumericish(opts)) return true;
  if (opts.filter((o) => SCALE_OPTION_RX.test(o.label)).length >= opts.length - 1 && opts.length >= 3) return true;
  return false;
}

function addOther(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const next = fields.map((f) => {
    let field = f;
    const hasOther = !!field.allowOther || (field.options || []).some((o) => o.value === 'other');
    if (field.type === 'chip-multiselect' && !hasOther) {
      field = { ...field, allowOther: true, options: [...(field.options || []), { value: 'other', label: 'Other' }] };
      changed++;
    } else if (field.type === 'pill-select' && !hasOther && !shouldSkipPill(field)) {
      field = { ...field, allowOther: true, options: [...(field.options || []), { value: 'other', label: 'Other' }] };
      changed++;
    }
    if (field.itemFields) {
      const sub = addOther(field.itemFields);
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

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const { fields: nextFields, changed } = addOther(fields);
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

  console.log(`\nDONE -- ${touchedTemplates} template(s), ${touchedFields} field(s) got an Other option.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
