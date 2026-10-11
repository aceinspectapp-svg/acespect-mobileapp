// Builds the Dilapidation / Apartment form from the REAL inspector template
// ("HOUSPECT VIC Dilapidation Multi Level Offices - Inspector Template At 1 May 2024").
//
// That template is the Commercial / Industrial one without the warehouse and production areas, with the office-building
// choices (commercial offices / hotel-motel, upper levels, metal decking, levels Grnd / 1 / 2 / 3, a Consulting room, ...). So
// each section's fields are the aligned Commercial section's, adjusted for those differences, and replace what Apartment had.
// Run align-commercial-form-to-inspector-template.ts first. Idempotent: run twice and the second run changes nothing.
//
// THIS REPLACES the Apartment form: the old unit / building checklist (ceilings, party walls, lifts, common areas, ...) is no
// longer part of the newest published version. Inspections already started keep the template version they were started on
// until the inspector accepts the update.
//
//   npx tsx src/scripts/align-apartment-form-to-inspector-template.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-apartment-form-to-inspector-template.ts              # dry run against the database
//   npx tsx src/scripts/align-apartment-form-to-inspector-template.ts --apply      # publish new template versions
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { addOptions, find, slug, type Field } from './lib/align-helpers';

const BASE = { inspectionType: 'dilapidation', propertyType: 'commercial_properties' };
const PROFILE = { inspectionType: 'dilapidation', propertyType: 'apartment' };
const SECTIONS = ['job-info', 'description', 'driveway', 'paving_paths', 'fences', 'retaining_walls', 'garage_carport_sheds', 'elevations', 'roof_chimneys', 'pool_spa', 'internal_areas', 'notes'] as const;

const options = (labels: string[]) => labels.map((label) => ({ label, value: slug(label) }));
const setOptions = (f: Field | undefined, labels: string[]): void => {
  if (f) f.options = options(labels);
};

/** The Multi Level Offices rooms: the Commercial list with one meeting room and a Consulting room; "Area?" tables are added with "Add area". */
const OFFICE_AREAS = [
  { key: 'reception_foyer', label: 'Reception / Foyer' },
  { key: 'offices', label: 'Offices' },
  { key: 'board_room', label: 'Board room' },
  { key: 'meeting_room', label: 'Meeting room' },
  { key: 'consulting_room', label: 'Consulting room' },
  { key: 'staff_rooms_kitchens', label: 'Staff rooms / kitchens' },
  { key: 'wc_male_female', label: 'WC Male / Female' },
  { key: 'stairs_landing', label: 'Stairs / stairwell / Landing' },
  { key: 'storerooms', label: 'Storerooms' },
  { key: 'other_area', label: 'Other area' },
];

/** The Apartment section built from the (deep-copied) aligned Commercial section. */
export function buildApartmentSection(sectionKey: string, base: Field[]): Field[] {
  const fields: Field[] = JSON.parse(JSON.stringify(base));
  switch (sectionKey) {
    case 'description': {
      setOptions(find(fields, 'constructionIs'), ['Commercial offices', 'Hotel/motel']);
      setOptions(find(fields, 'wallCladdingGround'), ['Tilt concrete panels', 'Hebel', 'Metal', 'Brick', 'Combo of']);
      const upper = find(fields, 'wallCladdingFirst');
      if (upper) upper.label = 'Wall cladding — Upper levels';
      setOptions(upper, ['Not applicable', 'Tilt concrete panels', 'Hebel', 'Metal', 'Brick', 'Cement sheet', 'Combo of']);
      setOptions(find(fields, 'foundations'), ['Concrete slab', 'Brick piers']);
      setOptions(find(fields, 'roofDesign'), ['Flat', 'Pitched', 'Combo pitched and flat']);
      setOptions(find(fields, 'roofCovering'), ['Metal decking', 'Zincalume', 'Mix of']);
      break;
    }
    case 'roof_chimneys': {
      // "[ ] Satisfactory to fair with typical weathering [ ] some surface rust [ ] cracked tiles [ ] gaps at flashings ..."
      addOptions(find(fields, 'generalObservations'), ['Cracked tiles'], 'Gaps at flashings');
      break;
    }
    case 'pool_spa': {
      // "Offices and staff facilities": Level Grnd / 1 / 2 / 3
      const areas = find(fields, 'areas');
      if (areas?.repeat) areas.repeat.fixedInstances = OFFICE_AREAS;
      setOptions(find(fields, 'floorLevel'), ['Ground floor', '1st floor', '2nd floor', '3rd floor']);
      break;
    }
    case 'internal_areas': {
      // No warehouse, production, hardstand or roof-underside areas in an office building: only the general internal questions.
      return fields.filter((f) => !/^(wh|prod|hard|roofin)_/.test(f.key));
    }
    case 'notes': {
      // The office template's notes have no "loose bricks" / "leaning fences" lines.
      const movement = find(fields, 'movement');
      if (movement?.repeat?.fixedInstances) movement.repeat.fixedInstances = movement.repeat.fixedInstances.filter((i) => !['loose_bricks', 'leaning_fences'].includes(i.key));
      break;
    }
  }
  return fields;
}

interface SnapshotRow {
  inspectionType: string;
  propertyType: string;
  sectionKey: string;
  name: string;
  version: number;
  fields: Field[];
}

async function main() {
  const mode = process.argv.includes('--snapshot') ? 'snapshot' : process.argv.includes('--apply') ? 'apply' : 'dry-run';

  if (mode === 'snapshot') {
    const path = join(__dirname, '..', '..', 'prisma', 'templates-snapshot.json');
    const rows: SnapshotRow[] = JSON.parse(readFileSync(path, 'utf-8'));
    let n = 0;
    for (const sectionKey of SECTIONS) {
      const base = rows.find((r) => r.inspectionType === BASE.inspectionType && r.propertyType === BASE.propertyType && r.sectionKey === sectionKey);
      const row = rows.find((r) => r.inspectionType === PROFILE.inspectionType && r.propertyType === PROFILE.propertyType && r.sectionKey === sectionKey);
      if (!base || !row) {
        console.log(`  ${sectionKey}: no Commercial or Apartment row in the snapshot, skipped`);
        continue;
      }
      const next = buildApartmentSection(sectionKey, base.fields);
      if (JSON.stringify(next) === JSON.stringify(row.fields)) continue;
      row.fields = next;
      row.version += 1;
      n += 1;
      console.log(`  changed ${sectionKey} -> v${row.version}`);
    }
    if (n > 0) writeFileSync(path, JSON.stringify(rows, null, 2) + '\n');
    console.log(`${n} section(s) updated in ${path}`);
    return;
  }

  // database: built from the Commercial templates PUBLISHED now
  const { prisma } = await import('../lib/prisma');
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');
  let changedCount = 0;
  for (const sectionKey of SECTIONS) {
    const base = await prisma.inspectionTemplate.findFirst({ where: { ...BASE, sectionKey, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    const published = await prisma.inspectionTemplate.findFirst({ where: { ...PROFILE, sectionKey, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    if (!base || !published) {
      console.log(`  ${sectionKey}: nothing published (Commercial or Apartment), skipped`);
      continue;
    }
    const next = buildApartmentSection(sectionKey, base.fields as unknown as Field[]);
    if (JSON.stringify(next) === JSON.stringify(published.fields)) {
      console.log(`  ${sectionKey}: already aligned`);
      continue;
    }
    changedCount += 1;
    console.log(`  ${sectionKey}: ${mode === 'apply' ? 'publishing' : 'would publish'} v${published.version + 1}`);
    if (mode !== 'apply') continue;
    await prisma.$transaction(async (tx) => {
      await tx.inspectionTemplate.updateMany({ where: { ...PROFILE, sectionKey, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
      await tx.inspectionTemplate.create({
        data: { ...PROFILE, sectionKey, name: published.name, version: published.version + 1, status: 'PUBLISHED', publishedAt: new Date(), fields: next as object, createdById: admin.id },
      });
    });
  }
  console.log(`${changedCount} section(s) ${mode === 'apply' ? 'published' : 'would change (dry run - add --apply)'}.`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
