import { writeFileSync } from 'fs';
import { join } from 'path';
import { prisma } from '../lib/prisma';

async function main() {
  const rows = await prisma.inspectionTemplate.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: [{ inspectionType: 'asc' }, { propertyType: 'asc' }, { sectionKey: 'asc' }],
    select: {
      inspectionType: true, propertyType: true, sectionKey: true,
      name: true, version: true, fields: true,
    },
  });
  const path = join(__dirname, '..', '..', 'prisma', 'templates-snapshot.json');
  writeFileSync(path, JSON.stringify(rows, null, 2) + '\n', 'utf-8');
  console.log(`Wrote ${rows.length} published templates to ${path}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
