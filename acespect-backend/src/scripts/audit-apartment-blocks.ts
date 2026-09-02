// Read-only: apartment's Elevations/Paving/Roof-Interior/Internal-Areas use
// a per-block pattern (<prefix>_applicable, <prefix>_condition,
// <prefix>_checks, <prefix>_comments, <prefix>_photos) instead of a single
// damage-list field. Groups every top-level field by its <prefix>_ and
// reports which prefixes have their own _condition but no damage-list --
// those are the gaps.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const SECTIONS = ['elevations', 'paving_paths', 'roof_chimneys', 'internal_areas'];

function prefixOf(key: string): string | null {
  const m = key.match(/^(.+)_(applicable|naReason|condition|checks|checks1|comments|photos|material|materialOther)$/);
  return m ? m[1]! : null;
}

async function main() {
  for (const sectionKey of SECTIONS) {
    const t = await prisma.inspectionTemplate.findFirst({
      where: { status: 'PUBLISHED', inspectionType: 'dilapidation', propertyType: 'apartment', sectionKey },
      orderBy: { version: 'desc' },
    });
    if (!t) { console.log(`${sectionKey}: NOT FOUND`); continue; }
    const fields = t.fields as unknown as TemplateField[];
    const byPrefix = new Map<string, TemplateField[]>();
    for (const f of fields) {
      const p = prefixOf(f.key);
      if (!p) continue;
      if (!byPrefix.has(p)) byPrefix.set(p, []);
      byPrefix.get(p)!.push(f);
    }
    console.log(`\n=== ${sectionKey} v${t.version} (${byPrefix.size} blocks) ===`);
    for (const [prefix, group] of byPrefix) {
      const hasCondition = group.some((f) => f.key === `${prefix}_condition`);
      const hasDamageList = fields.some((f) => f.type === 'damage-list' && f.key.startsWith(prefix));
      const checksField = group.find((f) => f.key === `${prefix}_checks`);
      console.log(
        `  ${prefix}: condition=${hasCondition} damageList=${hasDamageList}${!hasCondition ? '  (no condition -- skip)' : hasDamageList ? '' : '  <-- GAP'}`,
      );
      if (!hasDamageList && hasCondition && checksField) {
        console.log(`      checks options: ${(checksField.options ?? []).map((o) => o.value).slice(0, 4).join(', ')}...`);
      }
    }
  }
  await prisma.$disconnect();
}
void main();
