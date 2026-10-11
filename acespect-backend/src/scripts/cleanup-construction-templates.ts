/**
 * One-off clean-up for the Construction Stage profile.
 *
 * Construction Stage started out with twelve templates copied from the dilapidation survey (driveway, roof and chimneys,
 * internal areas and so on). A stage inspection never opens them, and the Pre-Pour form was rebuilt several times while it
 * was being matched to the paper form. This removes:
 *   - the eleven copied house-survey sections (everything except Job Information), and
 *   - every saved version of the Pre-Pour sections (pp_*), so the seed can publish them again as a clean version 1.
 * Job Information is shared by every stage and the other stages' sections (sd_* ...) are not touched.
 * The earlier versions are also in prisma/templates-snapshot.json if anything ever has to be put back.
 *
 *   npx tsx src/scripts/cleanup-construction-templates.ts && npx tsx src/scripts/seed-construction-stages.ts
 */
import { prisma } from '../lib/prisma';

const LEGACY = ['description', 'driveway', 'paving_paths', 'fences', 'retaining_walls', 'garage_carport_sheds', 'pool_spa', 'elevations', 'roof_chimneys', 'internal_areas', 'notes', 'custom_structure'];
const PRE_POUR = ['pp_description', 'pp_site_facilities', 'pp_measurements', 'pp_formwork', 'pp_general', 'pp_defects', 'pp_summary', 'pp_client_issues'];

async function main() {
  const sectionKey = { in: [...LEGACY, ...PRE_POUR] };
  const where = { inspectionType: 'construction_stage', sectionKey };
  const acc = await prisma.templateAcceptance.deleteMany({ where });
  const tpl = await prisma.inspectionTemplate.deleteMany({ where });
  console.log(`removed ${tpl.count} templates and ${acc.count} inspector acceptances from the Construction Stage profile`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => undefined); process.exit(1); });
