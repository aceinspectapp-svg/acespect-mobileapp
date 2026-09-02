// Read-only: final coverage check across every published template.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const CANONICAL = ['satisfactory_with_typical_wear_and_tear', 'fair', 'average', 'poor', 'new'];

interface Stat { conditions: number; canonical: number; otherOpts: number; otherBoxed: number; lists: number; taxonomy: number; mandate: number }

function isConditionField(f: TemplateField) {
  return f.key.toLowerCase().includes('condition') && f.options?.length;
}
function hasOther(f: TemplateField) {
  return (f.options ?? []).some((o) => o.value === 'other');
}
function hasCompanion(key: string, siblings: TemplateField[]) {
  return siblings.some((s) => s.gate?.fieldKey === key && (s.gate.equals === 'other' || s.gate.equalsAny?.includes('other')));
}

function walk(fields: TemplateField[], key: string, stats: Record<string, Stat>) {
  for (const f of fields) {
    if (isConditionField(f)) {
      stats[key]!.conditions += 1;
      if (f.type === 'color-select' && f.options!.length === 5 && f.options!.every((o, i) => o.value === CANONICAL[i])) {
        stats[key]!.canonical += 1;
      }
    }
    if (hasOther(f)) {
      stats[key]!.otherOpts += 1;
      if (hasCompanion(f.key, fields)) stats[key]!.otherBoxed += 1;
    }
    if (f.type === 'damage-list') {
      stats[key]!.lists += 1;
      if ((f.itemFields ?? []).some((x) => x.key === 'sub_cracking')) stats[key]!.taxonomy += 1;
      if (f.repeat?.requireWhen) stats[key]!.mandate += 1;
    }
    if (f.itemFields) walk(f.itemFields, key, stats);
  }
}

async function main() {
  const ts = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED', inspectionType: 'dilapidation' } });
  const stats: Record<string, Stat> = {};
  for (const t of ts) {
    stats[t.propertyType] = stats[t.propertyType] ?? { conditions: 0, canonical: 0, otherOpts: 0, otherBoxed: 0, lists: 0, taxonomy: 0, mandate: 0 };
    walk(t.fields as unknown as TemplateField[], t.propertyType, stats);
  }
  console.log('propertyType'.padEnd(24) + 'cond  canonical  |  otherOpts  boxed  |  lists  taxonomy  mandate');
  for (const [k, v] of Object.entries(stats)) {
    console.log(
      k.padEnd(24) +
        String(v.conditions).padStart(4) + String(v.canonical).padStart(11) +
        '  |' + String(v.otherOpts).padStart(10) + String(v.otherBoxed).padStart(7) +
        '  |' + String(v.lists).padStart(7) + String(v.taxonomy).padStart(10) + String(v.mandate).padStart(9),
    );
  }
  await prisma.$disconnect();
}
void main();
