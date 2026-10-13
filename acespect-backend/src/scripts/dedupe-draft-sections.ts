/**
 * Removes the duplicate copies of sections that overlapping saves left in draft inspections (every section listed twice, or three
 * times), and nothing else.
 *
 *   npm run inspections:dedupe-sections                          -> dry run: lists every draft that has a section twice; changes nothing
 *   npm run inspections:dedupe-sections -- --job-no VIC-87,VIC-65 -> only those jobs
 *   npm run inspections:dedupe-sections -- --ids <id>,<id>        -> only those inspections
 *   ... add --apply to remove the extra copies the dry run listed
 *
 * On Railway:
 *   railway ssh --service acespect-mobileapp -- node dist/scripts/dedupe-draft-sections.js
 *   railway ssh --service acespect-mobileapp -- node dist/scripts/dedupe-draft-sections.js --apply
 *
 * Safety:
 *  - Only DRAFT inspections are looked at. A submitted, in-review, approved or rejected one is never touched.
 *  - Only the EXTRA copies of a section (same key, same inspection) are removed. One copy of every section always stays, so no
 *    section, and no inspection, is ever removed. Sections that appear once are not touched.
 *  - The copy that stays is the one holding the most of the inspector's work (answers, photographs, damage records, report text);
 *    when copies are equal, the one saved last. Copies that differ in content are reported so you can see what is dropped.
 *  - Each inspection is cleaned in its own transaction, with the row locked (as saving does), and checked to still be a draft.
 */
import { prisma } from '../lib/prisma';

const arg = (name: string): string[] => {
  const at = process.argv.indexOf(name);
  const v = at >= 0 ? process.argv[at + 1] : undefined;
  return v && !v.startsWith('--') ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
};

interface Row {
  id: string;
  key: string;
  name: string;
  order: number;
  updatedAt: Date;
  createdAt: Date;
  answers: unknown;
  photos: unknown;
  reportText: string;
  damages: number;
}

/** How much of the inspector's work a copy holds: filled answers, photographs, damage records and report text. */
function weight(r: Row): number {
  const answers = r.answers && typeof r.answers === 'object' ? Object.values(r.answers as Record<string, unknown>).filter((v) => !(v === '' || v == null || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0))).length : 0;
  const photos = Array.isArray(r.photos) ? r.photos.length : 0;
  return answers * 10 + photos * 5 + r.damages * 5 + (r.reportText.trim() ? 1 : 0);
}

const fingerprint = (r: Row): string => JSON.stringify([r.answers ?? null, r.photos ?? null, r.reportText, r.damages]);

async function main() {
  const apply = process.argv.includes('--apply');
  const jobNos = arg('--job-no');
  const ids = arg('--ids');

  const inspections = await prisma.inspection.findMany({
    where: {
      status: 'DRAFT',
      ...(jobNos.length || ids.length ? { OR: [...(jobNos.length ? [{ jobNo: { in: jobNos } }] : []), ...(ids.length ? [{ id: { in: ids } }] : [])] } : {}),
    },
    select: {
      id: true, jobNo: true, inspectionType: true, propertyType: true, createdAt: true,
      sections: { select: { id: true, key: true, name: true, order: true, updatedAt: true, createdAt: true, answers: true, photos: true, reportText: true, _count: { select: { damages: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const plan: { inspectionId: string; label: string; remove: string[]; keys: number; differing: string[] }[] = [];
  let scanned = 0;
  for (const i of inspections) {
    scanned++;
    const byKey = new Map<string, Row[]>();
    for (const s of i.sections) {
      const row: Row = { id: s.id, key: s.key, name: s.name, order: s.order, updatedAt: s.updatedAt, createdAt: s.createdAt, answers: s.answers, photos: s.photos, reportText: s.reportText, damages: s._count.damages };
      byKey.set(s.key, [...(byKey.get(s.key) ?? []), row]);
    }
    const remove: string[] = [];
    const differing: string[] = [];
    let keys = 0;
    for (const [key, copies] of byKey) {
      if (copies.length < 2) continue;
      keys++;
      const sorted = [...copies].sort((a, b) => weight(b) - weight(a) || b.updatedAt.getTime() - a.updatedAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
      const [, ...extras] = sorted;
      remove.push(...extras.map((e) => e.id));
      if (new Set(copies.map(fingerprint)).size > 1) differing.push(`${key} (kept the copy with ${weight(sorted[0]!)} points of work; dropped ${extras.map((e) => weight(e)).join(', ')})`);
    }
    if (remove.length) plan.push({ inspectionId: i.id, label: `${i.jobNo ?? '(no job no)'}  ${i.id}  ${i.inspectionType} / ${i.propertyType}  ${i.sections.length} sections`, remove, keys, differing });
  }

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} -- ${scanned} draft inspection(s) checked, ${plan.length} with duplicated sections\n`);
  for (const p of plan) {
    console.log(`  ${p.label}\n    ${p.keys} section(s) listed more than once; ${p.remove.length} extra cop${p.remove.length === 1 ? 'y' : 'ies'} to remove -> ${p.label.match(/(\d+) sections/)![1]} becomes ${Number(p.label.match(/(\d+) sections/)![1]) - p.remove.length}`);
    for (const d of p.differing) console.log(`    NOTE the copies differ: ${d}`);
  }
  if (plan.length === 0) console.log('  Nothing to remove.');
  if (!apply) { console.log('\nNothing was changed. Run again with --apply to remove the extra copies listed above.'); return; }

  let removed = 0;
  for (const p of plan) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM inspections WHERE id = ${p.inspectionId} FOR UPDATE`;
      const now = await tx.inspection.findUnique({ where: { id: p.inspectionId }, select: { status: true } });
      if (now?.status !== 'DRAFT') throw new Error(`${p.inspectionId} is no longer a draft (${now?.status ?? 'gone'}); stopped`);
      const r = await tx.section.deleteMany({ where: { id: { in: p.remove }, inspectionId: p.inspectionId } });
      removed += r.count;
    });
    console.log(`  cleaned ${p.label.split('  ')[0]}  ${p.inspectionId}`);
  }
  console.log(`\nDone: ${removed} duplicate section cop${removed === 1 ? 'y' : 'ies'} removed from ${plan.length} draft(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
