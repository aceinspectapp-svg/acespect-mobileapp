// align-ppi-commercial-areas.ts against the published templates as the repo's snapshot has them (prisma/templates-snapshot.json),
// through an in-memory store holding every Pre-Purchase row (House, Apartment and Commercial).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { OFFICE_AREAS, PROFILE, WAREHOUSE_AREAS, run, type SectionKey, type TemplateStore } from './align-ppi-commercial-areas';
import type { Field } from './lib/align-helpers';

interface Row { inspectionType: string; propertyType: string; sectionKey: string; name: string; version: number; status: string; fields: Field[] }
const SNAP: Omit<Row, 'status'>[] = JSON.parse(readFileSync(join(__dirname, '..', '..', 'prisma', 'templates-snapshot.json'), 'utf8'));

/** The snapshot's latest version of every Pre-Purchase section, as the database would hold it. */
function memoryStore() {
  const rows: Row[] = [];
  for (const t of SNAP) {
    if (t.inspectionType !== 'pre_purchase') continue;
    const i = rows.findIndex((r) => r.propertyType === t.propertyType && r.sectionKey === t.sectionKey);
    if (i < 0) rows.push({ ...JSON.parse(JSON.stringify(t)), status: 'PUBLISHED' });
    else if (rows[i]!.version < t.version) rows[i] = { ...JSON.parse(JSON.stringify(t)), status: 'PUBLISHED' };
  }
  let writes = 0;
  const latest = (pt: string, sk: string) => rows.filter((r) => r.propertyType === pt && r.sectionKey === sk && r.status === 'PUBLISHED').sort((a, b) => b.version - a.version)[0];
  const store: TemplateStore = {
    async published(sk) {
      const r = latest(PROFILE.propertyType, sk);
      return r ? { name: r.name, version: r.version, fields: JSON.parse(JSON.stringify(r.fields)) } : null;
    },
    async publish(list) {
      for (const r of list) {
        writes++;
        for (const o of rows) if (o.propertyType === PROFILE.propertyType && o.sectionKey === r.sectionKey) o.status = 'ARCHIVED';
        rows.push({ ...PROFILE, sectionKey: r.sectionKey, name: r.name, version: r.version, status: 'PUBLISHED', fields: r.fields });
      }
    },
  };
  return { store, rows, latest, writes: () => writes };
}
const quiet = () => {};
const others = (rows: Row[]) => JSON.stringify(rows.filter((r) => r.propertyType !== PROFILE.propertyType));
const find = (fs: Field[], key: string) => fs.find((f) => f.key === key);

describe('align-ppi-commercial-areas', () => {
  it('a dry run writes nothing and lists each section and field it would change', async () => {
    const m = memoryStore();
    const before = JSON.stringify(m.rows);
    const out: string[] = [];
    const { changed } = await run(m.store, false, (l) => out.push(l));
    assert.deepEqual(changed, ['internal_areas', 'pool_spa', 'elevations']);
    assert.equal(m.writes(), 0);
    assert.equal(JSON.stringify(m.rows), before);
    const text = out.join('\n');
    for (const s of ['internal_areas: would publish', 'pool_spa: would publish', 'elevations: would publish', 'Front Entry & Hallway', 'Pool / Spa added after Alfresco / Pergola', 'would change (dry run - add --apply)']) assert.ok(text.includes(s), s);
  });

  it('--apply publishes the new areas, the pool in External and the gates', async () => {
    const m = memoryStore();
    const v = (sk: SectionKey) => m.latest(PROFILE.propertyType, sk)!.version;
    const was = { internal_areas: v('internal_areas'), pool_spa: v('pool_spa'), elevations: v('elevations') };
    await run(m.store, true, quiet);
    const get = (sk: SectionKey) => m.latest(PROFILE.propertyType, sk)!;
    for (const sk of ['internal_areas', 'pool_spa', 'elevations'] as const) assert.equal(get(sk).version, was[sk] + 1, sk);

    const internal = get('internal_areas'), offices = get('pool_spa'), external = get('elevations');
    assert.equal(internal.name, 'Warehouse & Production');
    assert.equal(offices.name, 'Offices & Staff Facilities');
    const rooms = find(internal.fields, 'rooms')!;
    assert.deepEqual(rooms.repeat!.fixedInstances, WAREHOUSE_AREAS);
    assert.deepEqual(WAREHOUSE_AREAS.map((a) => a.label), ['Warehouse', 'Production Area', 'Loading Dock', 'Hardstand/Parking', 'Mezzanine', 'Stairs/Stairwell', 'Other Area']);
    const officeRooms = find(offices.fields, 'rooms')!;
    assert.deepEqual(officeRooms.repeat!.fixedInstances, OFFICE_AREAS);
    assert.deepEqual(OFFICE_AREAS.map((a) => a.label), ['Reception/Foyer', 'Offices', 'Meeting/Board Room', 'Staff Room/Kitchen', 'Toilets/Amenities', 'Showers', 'First-aid/Lunch Room', 'Stairs/Landing', 'Storerooms', 'Other Area']);
    // Each area keeps the questions it had (only the gates are new).
    const keys = (g: Field) => g.itemFields!.map((f) => f.key);
    const old = m.rows.filter((r) => r.propertyType === PROFILE.propertyType && r.sectionKey === 'internal_areas' && r.status === 'ARCHIVED').sort((a, b) => b.version - a.version)[0]!;
    assert.deepEqual(keys(rooms), keys(find(old.fields, 'rooms')!));
    assert.deepEqual(keys(officeRooms), keys(rooms));
    // Present? = No hides the rest (a question already gated on another answer keeps its gate).
    for (const g of [rooms, officeRooms, find(external.fields, 'sides')!]) {
      for (const f of g.itemFields!) {
        if (f.key === 'available') assert.equal(f.gate, undefined);
        else if (f.key === 'damages') assert.deepEqual(f.gate, { equals: 'yes', fieldKey: 'hasDamage' });
        else assert.deepEqual(f.gate, { fieldKey: 'available', equals: 'yes' }, f.key);
      }
    }
    // Pool / Spa: out of pool_spa, into External after Alfresco / Pergola, asked only when there is one.
    assert.ok(!offices.fields.some((f) => f.key.startsWith('pool_')));
    const ek = external.fields.map((f) => f.key);
    const firstPool = ek.indexOf('pool_applicability');
    assert.ok(firstPool > ek.lastIndexOf('alfresco_photos'));
    assert.deepEqual(ek.slice(firstPool), ['pool_applicability', 'pool_type', 'pool_material', 'pool_installation', 'pool_signsOfSubsidence', 'pool_fencingAdequate', 'pool_checks0', 'pool_comments', 'pool_photos']);
    const q = find(external.fields, 'pool_applicability')!;
    assert.equal(q.label, 'Is there a pool or spa?');
    assert.deepEqual(q.options!.map((o) => [o.value, o.label]), [['applicable', 'Yes'], ['na', 'No']]);
    for (const f of external.fields.filter((x) => x.key.startsWith('pool_') && x.key !== 'pool_applicability')) {
      const g = f.gate as { fieldKey: string; equals: string };
      assert.deepEqual([g.fieldKey, g.equals], ['pool_applicability', 'applicable'], f.key);
    }
    external.fields.forEach((f, i) => assert.equal(f.order, i));
  });

  it('a second run reports "already aligned" and writes nothing', async () => {
    const m = memoryStore();
    await run(m.store, true, quiet);
    const writes = m.writes(), before = JSON.stringify(m.rows);
    const out: string[] = [];
    for (const apply of [false, true]) {
      const { changed } = await run(m.store, apply, (l) => out.push(l));
      assert.deepEqual(changed, []);
    }
    assert.equal(m.writes(), writes);
    assert.equal(JSON.stringify(m.rows), before);
    assert.equal(out.filter((l) => /: already aligned$/.test(l)).length, 6);
    assert.ok(out.includes('already aligned: nothing to do.'));
  });

  it('House, Apartment and the other Commercial sections are not touched', async () => {
    const m = memoryStore();
    const before = others(m.rows);
    const rest = JSON.stringify(m.rows.filter((r) => r.propertyType === PROFILE.propertyType && !['internal_areas', 'pool_spa', 'elevations'].includes(r.sectionKey)));
    await run(m.store, true, quiet);
    assert.equal(others(m.rows), before);
    assert.equal(JSON.stringify(m.rows.filter((r) => r.propertyType === PROFILE.propertyType && !['internal_areas', 'pool_spa', 'elevations'].includes(r.sectionKey))), rest);
  });

  it('stops, changing nothing, on a form it was not written for', async () => {
    const m = memoryStore();
    const store: TemplateStore = { ...m.store, published: async (sk) => { const r = await m.store.published(sk); return r && sk === 'pool_spa' ? { ...r, fields: [] } : r; } };
    await assert.rejects(run(store, true, quiet), /neither pool_spa nor elevations/);
    assert.equal(m.writes(), 0);
  });
});
