// Read-only: exact current state of every published Pre-Purchase template
// against the new spec -- required-field coverage, defect-mandate
// threshold, and whether General Comments / Weather fields exist yet.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

function walk(fields: TemplateField[], cb: (f: TemplateField, path: string) => void, path = '') {
  for (const f of fields) {
    cb(f, path);
    if (f.itemFields) walk(f.itemFields, cb, `${path}.${f.key}`);
  }
}

async function main() {
  const templates = await prisma.inspectionTemplate.findMany({
    where: { status: 'PUBLISHED', inspectionType: 'pre_purchase' },
    orderBy: [{ propertyType: 'asc' }, { sectionKey: 'asc' }],
  });

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    let total = 0;
    let required = 0;
    let conditions = 0;
    let damageLists = 0;
    let mandated = 0;
    const mandateThresholds = new Set<string>();
    let hasWeather = false;
    let hasGeneralComments = false;

    walk(fields, (f) => {
      total += 1;
      if (f.required) required += 1;
      if (f.key.toLowerCase().includes('condition') && f.options?.length) conditions += 1;
      if (f.type === 'damage-list') {
        damageLists += 1;
        if (f.repeat?.requireWhen) {
          mandated += 1;
          mandateThresholds.add(JSON.stringify(f.repeat.requireWhen.equals));
        }
      }
      if (/weather/i.test(f.key) || /weather/i.test(f.label)) hasWeather = true;
      if (/generalcomment|general_comment/i.test(f.key) || /general comment/i.test(f.label)) hasGeneralComments = true;
    });

    console.log(
      `${t.propertyType}/${t.sectionKey} v${t.version}: fields=${total} required=${required} conditions=${conditions} damageLists=${damageLists} mandated=${mandated} thresholds=${[...mandateThresholds].join(',')} weather=${hasWeather} generalComments=${hasGeneralComments}`,
    );
  }
  await prisma.$disconnect();
}

void main();
