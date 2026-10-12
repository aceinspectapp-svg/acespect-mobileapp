/**
 * One-off tidy-up of the Egnyte root: put job folders that sit loose at the root (and the draft-id folders left behind by
 * submissions that never finished their rename) into their batch folders.
 *
 *   npm run egnyte:reconcile            -> dry run: prints what would move, changes nothing
 *   npm run egnyte:reconcile -- --apply -> does it
 *
 * Needs the production environment (EGNYTE_*, DATABASE_URL); on Railway:
 *   railway ssh --service acespect-mobileapp -- node dist/scripts/egnyte-reconcile.js
 *   railway ssh --service acespect-mobileapp -- node dist/scripts/egnyte-reconcile.js --apply
 *
 * Never deletes anything the folder rules cannot place: those are listed under "left alone" for the office to decide.
 */
import { prisma } from '../lib/prisma';
import { egnyteFs, egnyteRootFolder, isStorageEnabled, moveFolderAndRepoint, resolveInspectionDestination } from '../lib/storage';
import { normalizeJobNumber, parseBatchName } from '../lib/egnyteJobFolders';
import { settleEgnyteFolder } from '../modules/inspections/inspections.service';

const KNOWN = new Set(['_Unassigned', 'tenants', 'inspections']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const apply = process.argv.includes('--apply');
  if (!isStorageEnabled()) throw new Error('Egnyte is not configured here (EGNYTE_DOMAIN / EGNYTE_API_TOKEN).');
  const root = egnyteRootFolder();
  const listing = await egnyteFs.list(root);
  if (!listing) throw new Error(`${root} does not exist`);

  const plan: { kind: 'job' | 'draft'; from: string; to?: string; note: string }[] = [];
  const leftAlone: string[] = [];

  for (const name of listing.folders) {
    if (parseBatchName(name) || KNOWN.has(name)) continue;
    const from = `${root}/${name}`;
    const job = normalizeJobNumber(name);
    if (job.ok && job.folder.toLowerCase() === name.toLowerCase()) {
      const r = await resolveInspectionDestination(name, undefined, { createJobFolder: false, fresh: true });
      if (r.status === 'unassigned') leftAlone.push(`${name}: ${r.message}`);
      else plan.push({ kind: 'job', from, to: r.path, note: r.message ?? '' });
    } else if (UUID.test(name)) {
      const ins = await prisma.inspection.findUnique({ where: { id: name }, select: { id: true, jobNo: true } });
      if (!ins) leftAlone.push(`${name}: no inspection with this id (photos from a submission that never completed)`);
      else if (!normalizeJobNumber(ins.jobNo).ok) leftAlone.push(`${name}: its inspection has no usable job number (${ins.jobNo ?? 'none'})`);
      else plan.push({ kind: 'draft', from, note: `inspection ${ins.id}, job ${ins.jobNo}` });
    } else {
      leftAlone.push(`${name}: not a batch, a job number or a draft id`);
    }
  }

  console.log(`${apply ? 'APPLYING' : 'DRY RUN'} -- root ${root}: ${listing.folders.length} folders\n`);
  console.log(`Would move (${plan.length}):`);
  for (const p of plan) console.log(`  ${p.kind === 'job' ? p.from.split('/').pop() : p.from.split('/').pop()}  ->  ${p.to ?? '(its job folder, by the inspection record)'}${p.note ? `   [${p.note}]` : ''}`);
  console.log(`\nLeft alone (${leftAlone.length}):`);
  for (const l of leftAlone) console.log(`  ${l}`);
  if (!apply) { console.log('\nNothing was changed. Run again with --apply to do the moves above.'); return; }

  for (const p of plan) {
    try {
      if (p.kind === 'job') await moveFolderAndRepoint(p.from, p.to!);
      else {
        const ins = await prisma.inspection.findUnique({ where: { id: p.from.split('/').pop()! }, select: { id: true, jobNo: true } });
        await settleEgnyteFolder(ins!.id, ins!.jobNo);
      }
      console.log(`moved ${p.from}`);
    } catch (e) {
      console.error(`FAILED ${p.from}:`, e instanceof Error ? e.message : e);
    }
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
