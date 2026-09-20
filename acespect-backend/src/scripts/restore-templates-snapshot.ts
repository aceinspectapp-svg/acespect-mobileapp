// Restores every published template from prisma/templates-snapshot.json --
// the single-file recovery path this repo didn't have before the 2026-09-18
// full DB reset, which took 27 historical seed scripts (run in the exact
// right order, one of which had an ordering dependency on another) to
// recover from. Re-run scripts/export-templates-snapshot.ts after any real
// admin template edit to keep this file current.
//
// Idempotent per lineage: archives whatever's currently PUBLISHED for a
// (inspectionType, propertyType, sectionKey) and republishes the snapshot's
// content as the next version -- never deletes existing rows, so a restore
// run against a DB that already has content just adds one version on top
// (harmless, but if you only want to run this against a genuinely empty/
// wiped DB, check first with `prisma studio` or a quick count query).
import { readFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../lib/prisma';

interface SnapshotRow {
  inspectionType: string;
  propertyType: string;
  sectionKey: string;
  name: string;
  version: number;
  fields: unknown;
}

async function main() {
  const path = join(__dirname, '..', '..', 'prisma', 'templates-snapshot.json');
  const rows: SnapshotRow[] = JSON.parse(readFileSync(path, 'utf-8'));

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found -- seed one first');

  let restored = 0;
  for (const row of rows) {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.inspectionTemplate.findFirst({
        where: { inspectionType: row.inspectionType, propertyType: row.propertyType, sectionKey: row.sectionKey },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.inspectionTemplate.updateMany({
        where: { inspectionType: row.inspectionType, propertyType: row.propertyType, sectionKey: row.sectionKey, status: 'PUBLISHED' },
        data: { status: 'ARCHIVED' },
      });
      await tx.inspectionTemplate.create({
        data: {
          inspectionType: row.inspectionType,
          propertyType: row.propertyType,
          sectionKey: row.sectionKey,
          name: row.name,
          version: (latest?.version ?? 0) + 1,
          status: 'PUBLISHED',
          publishedAt: new Date(),
          fields: row.fields as object,
          createdById: admin.id,
        },
      });
    });
    restored++;
  }

  // eslint-disable-next-line no-console
  console.log(`Restored ${restored} templates from snapshot (${path}).`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
