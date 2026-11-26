// Pre-Purchase / Commercial only (inspectionType=pre_purchase, propertyType=commercial_properties): the form's areas.
//
// The Commercial form was published with the house form's rooms and with the house Pool / Spa questions in the section the app shows
// as "Offices & Staff Facilities". This script:
//   1. Warehouse & Production (section internal_areas): the areas are Warehouse, Production Area, Loading Dock, Hardstand/Parking,
//      Mezzanine, Stairs/Stairwell and Other Area. The house rooms (Front Entry & Hallway, Living Room, Dining Area, Kitchen, Bedroom,
//      Bathroom, Laundry, Toilet) leave the list; Stairwell and Other keep their keys, so answers saved under them stay with them.
//   2. Offices & Staff Facilities (section pool_spa, the slot the app shows under that name): the areas Reception/Foyer, Offices,
//      Meeting/Board Room, Staff Room/Kitchen, Toilets/Amenities, Showers, First-aid/Lunch Room, Stairs/Landing, Storerooms and Other
//      Area, each with the same questions as a Warehouse & Production area.
//   3. Pool / Spa moves into External (section elevations, after Alfresco / Pergola), with the same keys. Its first question reads
//      "Is there a pool or spa?" Yes / No (the saved values stay "applicable" / "na"), and No hides the rest -- as the House form asks it.
//   4. "Available for Inspection?" / "Present?" = No hides the rest of an elevation tab or an area (as
//      align-pre-purchase-apartment-available-gates.ts does for Apartment). A question already gated on another answer keeps its gate.
//
// Nothing saved is renamed or deleted: an inspection's answers stay as they were saved. An inspection already started keeps the form it
// was started on (the app pins it) until a new inspection is begun. House, Apartment and every other inspection type are not read or
// written. Run it twice and the second run reports "already aligned".
//
//   npx tsx src/scripts/align-ppi-commercial-areas.ts            # dry run against the database (writes nothing)
//   npx tsx src/scripts/align-ppi-commercial-areas.ts --apply    # publish the new template versions
import type { Field } from './lib/align-helpers';

export const PROFILE = { inspectionType: 'pre_purchase', propertyType: 'commercial_properties' } as const;
export const SECTIONS = ['internal_areas', 'pool_spa', 'elevations'] as const;
export type SectionKey = (typeof SECTIONS)[number];

export const WAREHOUSE_AREAS = [
  { key: 'warehouse', label: 'Warehouse' },
  { key: 'production_area', label: 'Production Area' },
  { key: 'loading_dock', label: 'Loading Dock' },
  { key: 'hardstand_parking', label: 'Hardstand/Parking' },
  { key: 'mezzanine', label: 'Mezzanine' },
  { key: 'stairwell', label: 'Stairs/Stairwell' },
  { key: 'other', label: 'Other Area' },
];
export const OFFICE_AREAS = [
  { key: 'reception_foyer', label: 'Reception/Foyer' },
  { key: 'offices', label: 'Offices' },
  { key: 'meeting_board_room', label: 'Meeting/Board Room' },
  { key: 'staff_room_kitchen', label: 'Staff Room/Kitchen' },
  { key: 'toilets_amenities', label: 'Toilets/Amenities' },
  { key: 'showers', label: 'Showers' },
  { key: 'first_aid_lunch_room', label: 'First-aid/Lunch Room' },
  { key: 'stairs_landing', label: 'Stairs/Landing' },
  { key: 'storerooms', label: 'Storerooms' },
  { key: 'other', label: 'Other Area' },
];
export const NAMES: Record<SectionKey, string> = {
  internal_areas: 'Warehouse & Production',
  pool_spa: 'Offices & Staff Facilities',
  elevations: 'Elevations',
};
const GROUP = 'rooms';
const AVAILABLE = 'available';
const POOL_QUESTION = 'pool_applicability';
const POOL_AFTER = 'alfresco_';
const isPool = (f: Field) => f.key.startsWith('pool_');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const labels = (xs: { label: string }[]) => xs.map((x) => x.label).join(', ');

/** Every question of a tab group other than its "available" one shows only on Yes (a question already gated keeps its gate). */
function gateOnAvailable(group: Field | undefined, where: string, log: string[]): boolean {
  if (!group?.itemFields?.some((f) => f.key === AVAILABLE)) return false;
  const gated: string[] = [];
  for (const f of group.itemFields) {
    if (f.key === AVAILABLE || f.gate) continue;
    f.gate = { fieldKey: AVAILABLE, equals: 'yes' };
    gated.push(f.key);
  }
  if (gated.length) log.push(`${where}: shown only when "${group.itemFields.find((f) => f.key === AVAILABLE)!.label}" is Yes: ${gated.join(', ')}`);
  return gated.length > 0;
}

/** A group's areas, exactly `areas` in this order. */
function setAreas(group: Field, areas: { key: string; label: string }[], where: string, log: string[]): boolean {
  const current = group.repeat?.fixedInstances ?? [];
  if (JSON.stringify(current) === JSON.stringify(areas)) return false;
  const gone = current.filter((c) => !areas.some((a) => a.key === c.key));
  log.push(`${where}: areas ${labels(current) || '(none)'} -> ${labels(areas)}${gone.length ? ` (out of the list: ${labels(gone)}; their saved answers are kept)` : ''}`);
  group.repeat = { ...(group.repeat ?? {}), fixedInstances: clone(areas) };
  return true;
}

function setLabel(f: Field, label: string, where: string, log: string[]): boolean {
  if (f.label === label) return false;
  log.push(`${where}: label "${f.label}" -> "${label}"`);
  f.label = label;
  return true;
}

export interface Section { name: string; fields: Field[] }
export interface AlignResult { changed: Set<SectionKey>; log: Record<SectionKey, string[]> }

/**
 * Aligns the three sections in place. `sections` holds the Commercial profile's published internal_areas, pool_spa and elevations.
 * Throws -- before changing anything -- when the pool questions are in neither pool_spa nor elevations.
 */
export function alignCommercialAreas(sections: Record<SectionKey, Section>): AlignResult {
  const log: Record<SectionKey, string[]> = { internal_areas: [], pool_spa: [], elevations: [] };
  const changed = new Set<SectionKey>();
  const mark = (k: SectionKey, c: boolean) => c && changed.add(k);
  const internal = sections.internal_areas, offices = sections.pool_spa, external = sections.elevations;

  const rooms = internal.fields.find((f) => f.key === GROUP && f.type === 'repeating-group');
  if (!rooms) throw new Error(`internal_areas has no "${GROUP}" group: not the form this script was written for`);
  const poolInOffices = offices.fields.filter(isPool);
  if (!poolInOffices.length && !external.fields.some((f) => f.key === POOL_QUESTION)) {
    throw new Error('the Pool / Spa questions are in neither pool_spa nor elevations: not the form this script was written for');
  }

  // 1. Warehouse & Production.
  mark('internal_areas', setAreas(rooms, WAREHOUSE_AREAS, 'internal_areas.rooms', log.internal_areas));
  mark('internal_areas', setLabel(rooms, 'Warehouse & Production Areas', 'internal_areas.rooms', log.internal_areas));
  mark('internal_areas', gateOnAvailable(rooms, 'internal_areas.rooms', log.internal_areas));

  // 3. Pool / Spa into External (taken from pool_spa before that section is given the offices).
  if (!external.fields.some((f) => f.key === POOL_QUESTION)) {
    const pool = clone(poolInOffices);
    let at = external.fields.length;
    for (let i = external.fields.length - 1; i >= 0; i--) if (external.fields[i]!.key.startsWith(POOL_AFTER)) { at = i + 1; break; }
    external.fields.splice(at, 0, ...pool);
    external.fields.forEach((f, i) => (f.order = i));
    log.elevations.push(`elevations: Pool / Spa added after Alfresco / Pergola: ${pool.map((f) => f.key).join(', ')}`);
    changed.add('elevations');
  }
  const question = external.fields.find((f) => f.key === POOL_QUESTION)!;
  mark('elevations', setLabel(question, 'Is there a pool or spa?', `elevations.${POOL_QUESTION}`, log.elevations));
  const yesNo = (question.options ?? []).map((o) => ({ ...o, label: o.value === 'applicable' ? 'Yes' : o.value === 'na' ? 'No' : o.label }));
  if (JSON.stringify(yesNo) !== JSON.stringify(question.options ?? [])) {
    log.elevations.push(`elevations.${POOL_QUESTION}: options ${labels(question.options ?? [])} -> ${labels(yesNo)} (saved values applicable / na unchanged)`);
    question.options = yesNo;
    changed.add('elevations');
  }
  const onPool = (f: Field) => { const g = f.gate as { fieldKey?: string; equals?: unknown } | undefined; return g?.fieldKey === POOL_QUESTION && g?.equals === 'applicable'; };
  const ungated = external.fields.filter((f) => isPool(f) && f.key !== POOL_QUESTION && !onPool(f));
  for (const f of ungated) f.gate = { fieldKey: POOL_QUESTION, equals: 'applicable' };
  if (ungated.length) { log.elevations.push(`elevations: shown only when there is a pool or spa: ${ungated.map((f) => f.key).join(', ')}`); changed.add('elevations'); }
  mark('elevations', gateOnAvailable(external.fields.find((f) => f.key === 'sides'), 'elevations.sides', log.elevations));

  // 2. Offices & Staff Facilities: the same questions as a Warehouse & Production area.
  let officeRooms = offices.fields.find((f) => f.key === GROUP && f.type === 'repeating-group');
  if (!officeRooms) {
    officeRooms = { ...clone(rooms), label: 'Offices & Staff Facilities Areas', order: 0 };
    officeRooms.repeat = { ...(officeRooms.repeat ?? {}), fixedInstances: [] };
    log.pool_spa.push(`pool_spa: Pool / Spa questions moved to External (${poolInOffices.map((f) => f.key).join(', ')}); the section now holds the office areas`);
    offices.fields = [officeRooms];
    changed.add('pool_spa');
  }
  mark('pool_spa', setAreas(officeRooms, OFFICE_AREAS, 'pool_spa.rooms', log.pool_spa));
  mark('pool_spa', setLabel(officeRooms, 'Offices & Staff Facilities Areas', 'pool_spa.rooms', log.pool_spa));
  mark('pool_spa', gateOnAvailable(officeRooms, 'pool_spa.rooms', log.pool_spa));

  for (const k of SECTIONS) {
    if (sections[k].name !== NAMES[k]) {
      log[k].push(`${k}: name "${sections[k].name}" -> "${NAMES[k]}"`);
      sections[k].name = NAMES[k];
      changed.add(k);
    }
  }
  return { changed, log };
}

/** Where the published templates come from and go to: the database, or (in the test) a list of rows. */
export interface TemplateStore {
  published(sectionKey: SectionKey): Promise<{ name: string; version: number; fields: Field[] } | null>;
  /** Publishes the changed sections as new versions, all or none. */
  publish(rows: { sectionKey: SectionKey; name: string; version: number; fields: Field[] }[]): Promise<void>;
}

/** Dry run unless `apply`. Returns what it printed. */
export async function run(store: TemplateStore, apply: boolean, print: (line: string) => void = console.log): Promise<{ changed: SectionKey[] }> {
  const current: Partial<Record<SectionKey, { name: string; version: number; fields: Field[] }>> = {};
  for (const k of SECTIONS) {
    const row = await store.published(k);
    if (!row) throw new Error(`${PROFILE.inspectionType} / ${PROFILE.propertyType} / ${k}: nothing published`);
    current[k] = row;
  }
  const work = Object.fromEntries(SECTIONS.map((k) => [k, { name: current[k]!.name, fields: clone(current[k]!.fields) }])) as Record<SectionKey, Section>;
  const { changed, log } = alignCommercialAreas(work);
  print(`${PROFILE.inspectionType} / ${PROFILE.propertyType}${apply ? '' : ' (dry run)'}:`);
  for (const k of SECTIONS) {
    if (!changed.has(k)) { print(`  ${k}: already aligned`); continue; }
    print(`  ${k}: ${apply ? 'publishing' : 'would publish'} v${current[k]!.version + 1}`);
    for (const line of log[k]) print(`    - ${line}`);
  }
  const keys = SECTIONS.filter((k) => changed.has(k));
  if (apply && keys.length) await store.publish(keys.map((k) => ({ sectionKey: k, name: work[k].name, version: current[k]!.version + 1, fields: work[k].fields })));
  print(keys.length ? `${keys.length} section(s) ${apply ? 'published' : 'would change (dry run - add --apply)'}.` : 'already aligned: nothing to do.');
  return { changed: keys };
}

async function main() {
  const { prisma } = await import('../lib/prisma');
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');
  const store: TemplateStore = {
    async published(sectionKey) {
      const t = await prisma.inspectionTemplate.findFirst({ where: { ...PROFILE, sectionKey, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
      return t ? { name: t.name, version: t.version, fields: t.fields as unknown as Field[] } : null;
    },
    async publish(rows) {
      await prisma.$transaction(async (tx) => {
        for (const r of rows) {
          await tx.inspectionTemplate.updateMany({ where: { ...PROFILE, sectionKey: r.sectionKey, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
          await tx.inspectionTemplate.create({
            data: { ...PROFILE, sectionKey: r.sectionKey, name: r.name, version: r.version, status: 'PUBLISHED', publishedAt: new Date(), fields: r.fields as object, createdById: admin.id },
          });
        }
      });
    },
  };
  try {
    await run(store, process.argv.includes('--apply'));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
