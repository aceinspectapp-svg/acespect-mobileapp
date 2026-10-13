/**
 * Removes test DRAFT inspections so testing can start fresh. Nothing else in the system is touched.
 *
 *   npm run inspections:delete-drafts -- --job-no V261100,V261101          -> dry run: lists those drafts, deletes nothing
 *   npm run inspections:delete-drafts -- --stale-construction              -> dry run: lists Construction Stage drafts that have no stage section
 *   npm run inspections:delete-drafts -- --ids <id>,<id> --job-no V261100  -> any mix of the above
 *   ... add --apply to delete what the dry run listed
 *
 * Needs a choice of what to remove (--job-no, --ids and/or --stale-construction); with none it does nothing.
 * On Railway:
 *   railway ssh --service acespect-mobileapp -- node dist/scripts/delete-draft-inspections.js --job-no V261100
 *   railway ssh --service acespect-mobileapp -- node dist/scripts/delete-draft-inspections.js --job-no V261100 --apply
 *
 * Safety:
 *  - Only inspections whose status is DRAFT are ever listed or deleted. A submitted, in-review, approved or rejected one is
 *    reported as "skipped" and left exactly as it is.
 *  - A draft that another inspection uses as its Post-Dilapidation baseline is skipped.
 *  - Deleting an inspection removes its own sections, damages, review runs and summary (the database does that through the
 *    relations). Users, templates, other inspections and the QC data are not touched.
 *  - Photograph files in Egnyte / storage are NOT deleted; the listing shows each draft's Egnyte folder so the office can
 *    decide about them. The submission log keeps its history rows.
 *  - Each draft is deleted in its own transaction; the run stops at the first error.
 */
import { prisma } from '../lib/prisma';
import { CONSTRUCTION_STAGE_SECTIONS } from '../modules/templates/templates.sections';

const arg = (name: string): string[] => {
  const at = process.argv.indexOf(name);
  const v = at >= 0 ? process.argv[at + 1] : undefined;
  return v && !v.startsWith('--') ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
};

const STAGE_KEYS = new Set(CONSTRUCTION_STAGE_SECTIONS.map((s) => s.key));
const isConstruction = (type: string | null | undefined): boolean => /construction/i.test(type ?? '');

async function main() {
  const apply = process.argv.includes('--apply');
  const jobNos = arg('--job-no');
  const ids = arg('--ids');
  const stale = process.argv.includes('--stale-construction');
  if (jobNos.length === 0 && ids.length === 0 && !stale) {
    console.log('Nothing chosen. Use --job-no, --ids and/or --stale-construction (see the top of this file). Nothing was changed.');
    return;
  }

  const found = await prisma.inspection.findMany({
    where: {
      OR: [
        ...(jobNos.length ? [{ jobNo: { in: jobNos } }] : []),
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(stale ? [{ inspectionType: { contains: 'construction', mode: 'insensitive' as const }, status: 'DRAFT' as const }] : []),
      ],
    },
    select: {
      id: true, jobNo: true, address: true, client: true, inspectionType: true, status: true, createdAt: true, egnytePath: true,
      inspector: { select: { email: true } },
      sections: { select: { key: true } },
      _count: { select: { postDilapidationJobs: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const toDelete: typeof found = [];
  const skipped: string[] = [];
  for (const i of found) {
    const label = `${i.jobNo ?? '(no job no)'}  ${i.id}`;
    const onlyStaleWanted = stale && !jobNos.includes(i.jobNo ?? '\u0000') && !ids.includes(i.id);
    if (i.status !== 'DRAFT') { skipped.push(`${label}: status is ${i.status}, not DRAFT -- left alone`); continue; }
    if (i._count.postDilapidationJobs > 0) { skipped.push(`${label}: another inspection uses it as its baseline -- left alone`); continue; }
    // With --stale-construction a draft qualifies only if it never got a stage section (it is just Job Information, or empty).
    if (onlyStaleWanted && i.sections.some((s) => STAGE_KEYS.has(s.key))) { skipped.push(`${label}: has stage sections -- not stale, left alone`); continue; }
    toDelete.push(i);
  }

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} -- ${found.length} matched, ${toDelete.length} would be deleted, ${skipped.length} skipped\n`);
  console.log(`To delete (${toDelete.length}):`);
  for (const i of toDelete) {
    console.log(
      `  ${i.jobNo ?? '(no job no)'}  ${i.id}\n    ${i.inspectionType} | client: ${i.client ?? '-'} | ${i.address ?? '-'} | inspector: ${i.inspector.email} | created ${i.createdAt.toISOString().slice(0, 10)}\n` +
        `    sections: ${i.sections.length ? i.sections.map((s) => s.key).join(', ') : '(none)'}${i.egnytePath ? `\n    Egnyte folder (not deleted): ${i.egnytePath}` : ''}`,
    );
  }
  console.log(`\nSkipped (${skipped.length}):`);
  for (const s of skipped) console.log(`  ${s}`);
  if (!apply) { console.log('\nNothing was changed. Run again with --apply to delete the list above.'); return; }

  for (const i of toDelete) {
    await prisma.$transaction(async (tx) => {
      // Re-check inside the transaction: still a draft, so something submitted a moment ago is never removed.
      const now = await tx.inspection.findUnique({ where: { id: i.id }, select: { status: true } });
      if (now?.status !== 'DRAFT') throw new Error(`${i.id} is no longer a draft (${now?.status ?? 'gone'}); stopped`);
      await tx.inspection.delete({ where: { id: i.id } });
    });
    console.log(`  deleted ${i.jobNo ?? '(no job no)'}  ${i.id}`);
  }
  console.log(`\nDone: ${toDelete.length} draft${toDelete.length === 1 ? '' : 's'} deleted.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
