// Seeds QC property types plus a handful of sample clients/projects/lots for
// local development. The lifecycle statuses, severity tiers and trade
// categories come from the 20261002060000_qc_spec_foundation migration, so
// they exist everywhere the migrations have run. Idempotent. Run:
// npx tsx scripts/seedQc.ts
import { prisma } from '../src/lib/prisma';

const PROPERTY_TYPES = [
  { key: 'house', label: 'House', icon: 'home-outline', order: 0 },
  { key: 'apartment', label: 'Apartment', icon: 'business-outline', order: 1 },
  { key: 'townhouse', label: 'Townhouse', icon: 'grid-outline', order: 2 },
  { key: 'duplex', label: 'Duplex', icon: 'copy-outline', order: 3 },
];

const SAMPLE_HIERARCHY: Record<string, Record<string, string[]>> = {
  'Development Victoria': { 'LUMA Sunshine North': ['Lot 4677', 'Lot 4678', 'Lot 4679', 'Lot 4680'] },
  Stockland: { 'The Boulevard': ['Lot 301', 'Lot 302', 'Lot 303'] },
};

async function main() {
  for (const row of PROPERTY_TYPES) {
    await prisma.qcPropertyType.upsert({ where: { key: row.key }, update: row, create: row });
  }

  const apartmentType = await prisma.qcPropertyType.findUniqueOrThrow({ where: { key: 'apartment' } });

  for (const [clientName, projects] of Object.entries(SAMPLE_HIERARCHY)) {
    const existingClient = await prisma.qcClient.findFirst({ where: { name: clientName } });
    const client = existingClient ?? (await prisma.qcClient.create({ data: { name: clientName } }));
    for (const [projectName, properties] of Object.entries(projects)) {
      const existingProject = await prisma.qcProject.findFirst({ where: { name: projectName, clientId: client.id } });
      const project = existingProject ?? (await prisma.qcProject.create({ data: { name: projectName, clientId: client.id } }));
      for (const propertyName of properties) {
        const existingProperty = await prisma.qcProperty.findFirst({ where: { name: propertyName, projectId: project.id } });
        if (!existingProperty) {
          await prisma.qcProperty.create({
            data: { name: propertyName, projectId: project.id, propertyTypeId: apartmentType.id },
          });
        }
      }
    }
  }

  console.log('QC seed data ready:', {
    propertyTypes: PROPERTY_TYPES.length,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
