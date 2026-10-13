/**
 * Checks that overlapping saves of one draft do not duplicate its sections. The web editor autosaves a second after typing stops and
 * also has a Save Draft button (and a draft can be open in two tabs), so two saves can be in flight together. Run it with a scratch
 * database:
 *
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public npm run check:draft-save
 */
import { prisma } from '../lib/prisma';
import { inspectionsService } from '../modules/inspections/inspections.service';

async function main() {
  const user = await prisma.user.findFirstOrThrow();
  const keys = ['job-info', 'description', 'driveway', 'paving_paths', 'fences', 'retaining_walls', 'garage_carport_sheds', 'elevations', 'roof_chimneys', 'internal_areas', 'pool_spa', 'notes'];
  const sections = keys.map((key, order) => ({ key, name: key, icon: '', order, status: 'pending' as const, reportText: '', fields: {}, photos: [], damages: [] }));
  const created = await inspectionsService.submit(user.id, { inspectionType: 'Dilapidation', propertyType: 'Commercial Properties', jobNo: 'CHECK-DRAFT-SAVE', address: 'x', suburb: 'y', client: 'z', date: new Date().toISOString(), sections } as never);
  const id = created.inspection.id;
  let failed = false;
  try {
    for (let round = 1; round <= 5; round++) {
      await Promise.all([1, 2, 3, 4].map(() => inspectionsService.update(id, user.id, { sections } as never)));
      const total = await prisma.section.count({ where: { inspectionId: id } });
      const distinct = (await prisma.section.findMany({ where: { inspectionId: id }, select: { key: true }, distinct: ['key'] })).length;
      const ok = total === keys.length && distinct === keys.length;
      if (!ok) failed = true;
      console.log(`${ok ? 'ok  ' : 'FAIL'} round ${round}: 4 overlapping saves leave ${total} sections (${distinct} different), expected ${keys.length}`);
    }
  } finally {
    await prisma.inspection.delete({ where: { id } });
  }
  console.log(failed ? '\nFAILED: overlapping saves duplicated sections' : '\nall checks passed');
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
