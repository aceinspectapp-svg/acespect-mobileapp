// Read-only audit: which published templates still have an old-style
// damage-list (no AS 4349.1 taxonomy) and/or a condition field with no
// mandatory-defect rule attached.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const TAXONOMY_MARKER = 'sub_cracking';

function walk(fields: TemplateField[], cb: (f: TemplateField, siblings: TemplateField[]) => void) {
  for (const f of fields) {
    cb(f, fields);
    if (f.itemFields) walk(f.itemFields, cb);
  }
}

async function main() {
  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' }, orderBy: [{ inspectionType: 'asc' }, { propertyType: 'asc' }, { sectionKey: 'asc' }] });

  let old = 0;
  let modern = 0;
  let noMandate = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const rows: string[] = [];
    walk(fields, (f, siblings) => {
      if (f.type !== 'damage-list') return;
      const hasTaxonomy = (f.itemFields ?? []).some((x) => x.key === TAXONOMY_MARKER);
      const req = f.repeat?.requireWhen;
      // Is there a condition field alongside this damage list to key off?
      const cond = siblings.find((s) => s.key.toLowerCase().includes('condition') && s.options?.length);
      const condIdx = cond ? siblings.indexOf(cond) : -1;
      const dmgIdx = siblings.indexOf(f);
      const adjacent = condIdx !== -1 && dmgIdx === condIdx + 1;

      if (hasTaxonomy) modern += 1; else old += 1;
      if (cond && !req) noMandate += 1;

      rows.push(
        `    ${f.key}: taxonomy=${hasTaxonomy ? 'YES' : 'no '} mandate=${req ? JSON.stringify(req.equals) : 'NONE'} conditionSibling=${cond?.key ?? 'none'} belowCondition=${adjacent}`,
      );
    });
    if (rows.length) {
      console.log(`${t.inspectionType}/${t.propertyType}/${t.sectionKey} v${t.version}`);
      rows.forEach((r) => console.log(r));
    }
  }

  console.log(`\nSUMMARY: ${modern} damage-list(s) already on the taxonomy, ${old} still old-style, ${noMandate} with a condition sibling but no mandatory-defect rule.`);
  await prisma.$disconnect();
}

void main();
