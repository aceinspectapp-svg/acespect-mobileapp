// Read-only coverage summary: defect taxonomy + mandatory-defect rules +
// canonical condition scale, broken down by property type.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

interface Stat { lists: number; taxonomy: number; mandate: number; cond: number; canonical: number }

async function main() {
  const ts = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED' } });
  const stats: Record<string, Stat> = {};

  function walk(fs: TemplateField[], key: string) {
    for (const f of fs) {
      if (f.type === 'damage-list') {
        stats[key]!.lists += 1;
        if ((f.itemFields ?? []).some((x) => x.key === 'sub_cracking')) stats[key]!.taxonomy += 1;
        if (f.repeat?.requireWhen) stats[key]!.mandate += 1;
      }
      if (f.key.toLowerCase().includes('condition') && f.options?.length) {
        stats[key]!.cond += 1;
        if (f.type === 'color-select' && f.options.length === 5 && f.options[2]?.value === 'average') stats[key]!.canonical += 1;
      }
      if (f.itemFields) walk(f.itemFields, key);
    }
  }

  for (const t of ts) {
    stats[t.propertyType] = stats[t.propertyType] ?? { lists: 0, taxonomy: 0, mandate: 0, cond: 0, canonical: 0 };
    walk(t.fields as unknown as TemplateField[], t.propertyType);
  }

  console.log('propertyType'.padEnd(24) + 'lists  taxonomy  mandate  |  conditions  canonical');
  for (const [k, v] of Object.entries(stats)) {
    console.log(
      k.padEnd(24) +
        String(v.lists).padStart(5) +
        String(v.taxonomy).padStart(10) +
        String(v.mandate).padStart(9) +
        '  |' +
        String(v.cond).padStart(12) +
        String(v.canonical).padStart(11),
    );
  }
  await prisma.$disconnect();
}

void main();
