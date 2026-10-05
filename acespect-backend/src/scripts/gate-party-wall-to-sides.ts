// "Party wall abutting next property?" (Elevations, dilapidation residential
// + commercial) was asked unconditionally on all four sides -- a front or
// rear elevation faces the street/backyard, never a neighbouring property,
// so it can never physically BE a party wall. Gated to Left/Right only, via
// the mobile app's new `__instanceKey` synthetic scope field (see
// FixedTabsRenderer in fieldRenderers/index.tsx) -- the one piece of context
// ("which fixed instance is this") that wasn't otherwise available to a
// itemFields-level gate.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const TARGETS: { inspectionType: string; propertyType: string; sectionKey: string }[] = [
  { inspectionType: 'dilapidation', propertyType: 'residential_house', sectionKey: 'elevations' },
  { inspectionType: 'dilapidation', propertyType: 'commercial_properties', sectionKey: 'elevations' },
];

function fixFields(fields: TemplateField[]): { fields: TemplateField[]; changed: number } {
  let changed = 0;
  const next = fields.map((f) => {
    let field = f;
    if (field.key === 'partyWall' && !field.gate) {
      changed++;
      field = { ...field, gate: { fieldKey: '__instanceKey', equalsAny: ['left', 'right'] } };
    }
    if (field.itemFields) {
      const sub = fixFields(field.itemFields);
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

  let touchedTemplates = 0;
  let touchedFields = 0;

  for (const target of TARGETS) {
    const t = await prisma.inspectionTemplate.findFirst({ where: { ...target, status: 'PUBLISHED' } });
    if (!t) {
      console.log(`${target.inspectionType}/${target.propertyType}/${target.sectionKey}: not found, skipped`);
      continue;
    }
    const fields = t.fields as unknown as TemplateField[];
    const { fields: nextFields, changed } = fixFields(fields);
    if (changed === 0) {
      console.log(`${target.inspectionType}/${target.propertyType}/${target.sectionKey}: already gated, nothing to do`);
      continue;
    }
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

    await prisma.templateAcceptance.deleteMany({ where: target });
  }

  console.log(`\nDONE -- ${touchedTemplates} template(s), ${touchedFields} field(s) fixed.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
