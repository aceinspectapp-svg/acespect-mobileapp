// Seeds QC reference data — property types, severities, and the 11-stage
// defect-status lifecycle — from the exact same values already hardcoded in
// acespect-mobile/src/constants/qcData.ts, so nothing about the lifecycle
// business rules changes, only where they live. Also seeds a handful of
// sample clients/projects/properties matching the mobile prototype's demo
// data, so Phase 3 (wiring mobile to this API) has matching records to test
// against. Idempotent — safe to re-run. Run: npx tsx scripts/seedQc.ts
import { prisma } from '../src/lib/prisma';

const PROPERTY_TYPES = [
  { key: 'house', label: 'House', icon: 'home-outline', order: 0 },
  { key: 'apartment', label: 'Apartment', icon: 'business-outline', order: 1 },
  { key: 'townhouse', label: 'Townhouse', icon: 'grid-outline', order: 2 },
  { key: 'duplex', label: 'Duplex', icon: 'copy-outline', order: 3 },
];

const SEVERITIES = [
  { key: 'major', label: 'Major', color: '#DC2626', order: 0 },
  { key: 'moderate', label: 'Moderate', color: '#EA580C', order: 1 },
  { key: 'minor', label: 'Minor', color: '#D97706', order: 2 },
  { key: 'observation', label: 'Observation', color: '#2563EB', order: 3 },
];

// Keys are the stable identifiers other code references (e.g.
// qc.service.ts's PENDING_REINSPECTION_KEY = 'pending_re_inspection') —
// change labels/colors/meaning freely, but keep these keys stable.
const STATUSES = [
  { key: 'open', label: 'Open', color: '#2563EB', meaning: 'Logged by the Inspector, not yet routed to the Builder', order: 0 },
  { key: 'assigned', label: 'Assigned', color: '#EA580C', meaning: 'Routed to the Builder, awaiting sub-allocation to a trade', order: 1 },
  { key: 'allocated', label: 'Allocated', color: '#D97706', meaning: 'Builder has assigned a specific trade', order: 2 },
  { key: 'acknowledged', label: 'Acknowledged', color: '#0891B2', meaning: 'Trade has confirmed receipt and a scheduled date', order: 3 },
  { key: 'in_progress', label: 'In Progress', color: '#059669', meaning: 'Rectification work underway', order: 4 },
  { key: 'pending_re_inspection', label: 'Pending Re-inspection', color: '#7C3AED', meaning: 'Builder submitted as complete, awaiting Inspector verification', order: 5 },
  { key: 'verified_closed', label: 'Verified / Closed', color: '#065F46', meaning: 'Inspector confirmed the fix meets the standard; record locked', order: 6 },
  { key: 'rejected_reopened', label: 'Rejected / Reopened', color: '#DC2626', meaning: 'Verification failed; item returns to allocation', order: 7 },
  { key: 'overdue', label: 'Overdue', color: '#B91C1C', meaning: 'SLA clock for the current stage has lapsed (auto-flag)', order: 8 },
  { key: 'escalated', label: 'Escalated', color: '#C2410C', meaning: 'SLA breach or repeat rejection has triggered a notification beyond the Builder', order: 9 },
  { key: 'on_hold_disputed', label: 'On Hold / Disputed', color: '#475569', meaning: 'Rectification paused pending a scope, liability, or cost dispute', order: 10 },
];

const SAMPLE_HIERARCHY: Record<string, Record<string, string[]>> = {
  'Development Victoria': { 'LUMA Sunshine North': ['Lot 4677', 'Lot 4678', 'Lot 4679', 'Lot 4680'] },
  Stockland: { 'The Boulevard': ['Lot 301', 'Lot 302', 'Lot 303'] },
};

async function main() {
  for (const row of PROPERTY_TYPES) {
    await prisma.qcPropertyType.upsert({ where: { key: row.key }, update: row, create: row });
  }
  for (const row of SEVERITIES) {
    await prisma.qcSeverity.upsert({ where: { key: row.key }, update: row, create: row });
  }
  for (const row of STATUSES) {
    await prisma.qcStatus.upsert({ where: { key: row.key }, update: row, create: row });
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
    severities: SEVERITIES.length,
    statuses: STATUSES.length,
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
