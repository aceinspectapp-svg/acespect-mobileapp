/**
 * Checks the Egnyte folder rules (src/lib/egnyteJobFolders.ts) against an in-memory stand-in for Egnyte. Touches no network.
 * Run: npm run check:egnyte-folders
 */
import assert from 'node:assert/strict';
import { batchesCovering, mergeFolder, normalizeJobNumber, parseBatchName, resolveInspectionFolder, standardBatchFor, type EgnyteFs } from '../lib/egnyteJobFolders';

const ROOT = '/Shared/Houspect Files/1-Jobs_Zeus';

/** A tiny file tree: folders are keys ending in "/", files are plain keys. */
function fakeEgnyte(initial: string[]) {
  const tree = new Set<string>();
  const add = (p: string) => { const parts = p.split('/').filter(Boolean); let cur = ''; for (let i = 0; i < parts.length; i++) { cur += '/' + parts[i]; tree.add(i < parts.length - 1 || p.endsWith('/') ? cur + '/' : cur); } };
  initial.forEach(add);
  const calls = { create: [] as string[], move: [] as string[], list: 0 };
  const lag = () => new Promise((r) => setTimeout(r, 2));
  const fs: EgnyteFs = {
    async list(path) {
      calls.list++; await lag();
      if (!tree.has(path + '/')) return null;
      const folders: string[] = []; const files: string[] = [];
      for (const k of tree) {
        if (!k.startsWith(path + '/') || k === path + '/') continue;
        const rest = k.slice(path.length + 1);
        if (rest.slice(0, -1).includes('/') || (!k.endsWith('/') && rest.includes('/'))) continue;
        (k.endsWith('/') ? folders : files).push(k.endsWith('/') ? rest.slice(0, -1) : rest);
      }
      return { folders, files };
    },
    async createFolder(path) { calls.create.push(path); await lag(); add(path + '/'); },
    async move(from, to) {
      calls.move.push(`${from} -> ${to}`); await lag();
      for (const k of [...tree]) if (k === from || k === from + '/' || k.startsWith(from + '/')) { tree.delete(k); add(to + k.slice(from.length)); }
    },
    async deleteFolder(path) { for (const k of [...tree]) if (k === path + '/' || k.startsWith(path + '/')) tree.delete(k); },
  };
  return { fs, tree, calls };
}

const chains = new Map<string, Promise<unknown>>();
async function lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  chains.set(key, prev.then(() => mine));
  await prev;
  try { return await fn(); } finally { release(); }
}

let passed = 0;
const check = async (name: string, fn: () => Promise<void> | void) => { await fn(); passed++; console.log(`  ok  ${name}`); };

async function main() {
  await check('job numbers: the VIC prefix becomes V, anything else is rejected', () => {
    for (const raw of ['VIC-260105', 'vic260105', 'V 260105', 'V260105', ' V-260105 ', 'VIC_260105']) {
      const j = normalizeJobNumber(raw);
      assert.ok(j.ok && j.folder === 'V260105', raw);
    }
    for (const raw of ['', null, undefined, 'ABC123', 'V2601', 'VIC-26A105', '260105', 'V26010512', 'VICTORIA-1']) assert.equal(normalizeJobNumber(raw as string).ok, false, String(raw));
    const legacy = normalizeJobNumber('VIC-22001');
    assert.ok(legacy.ok && legacy.folder === 'V22001' && legacy.seq === null);
  });

  await check('batch names: V260001-V260100 and the older irregular ones are read as ranges', () => {
    assert.deepEqual(parseBatchName('V260001-V260100'), { name: 'V260001-V260100', start: 260001, end: 260100 });
    assert.equal(parseBatchName('V260101-260200')?.end, 260200);
    assert.equal(parseBatchName('V23001-V231501')?.end, 231501);
    for (const n of ['_Unassigned', 'V260105', 'V260100-V260001', 'Houspect', 'c119ffdf-cfb3-4945-b923-c9b0dc691e94']) assert.equal(parseBatchName(n), null, n);
  });

  await check('standard batches: 100 job numbers each, by the job number', () => {
    const name = (raw: string) => { const j = normalizeJobNumber(raw); assert.ok(j.ok); return standardBatchFor(j as never)?.name; };
    assert.equal(name('V260001'), 'V260001-V260100');
    assert.equal(name('V260100'), 'V260001-V260100');
    assert.equal(name('V260101'), 'V260101-V260200');
    assert.equal(name('V260105'), 'V260101-V260200');
    assert.equal(name('V261234'), 'V261201-V261300');
    assert.equal(name('V269999'), 'V269901-V269999');
    assert.equal(name('V270001'), 'V270001-V270100');
    assert.equal(name('V22001'), undefined, '5-digit numbers never start a new batch');
  });

  await check('an existing batch is reused; the job folder is created inside it; repeating changes nothing', async () => {
    const { fs, tree, calls } = fakeEgnyte([`${ROOT}/V260001-V260100/V260050/x.jpg`, `${ROOT}/V260001-V260100/V260099/`]);
    const a = await resolveInspectionFolder(fs, ROOT, 'VIC-260077', { lock });
    assert.equal(a.status, 'ok');
    assert.equal(a.path, `${ROOT}/V260001-V260100/V260077`);
    assert.ok(tree.has(`${ROOT}/V260001-V260100/V260077/`));
    const before = calls.create.length;
    const b = await resolveInspectionFolder(fs, ROOT, 'V260077', { lock });
    assert.equal(b.path, a.path);
    assert.equal(calls.create.length, before, 'no second creation');
  });

  await check('a full batch is not skipped: the next number gets a new batch, and a number inside a full batch stays there (flagged)', async () => {
    const full = Array.from({ length: 100 }, (_, i) => `${ROOT}/V260001-V260100/V26${String(i + 1).padStart(4, '0')}/`);
    const { fs, tree } = fakeEgnyte(full);
    const next = await resolveInspectionFolder(fs, ROOT, 'V260101', { lock });
    assert.equal(next.path, `${ROOT}/V260101-V260200/V260101`);
    assert.equal(next.status, 'ok');
    assert.ok(tree.has(`${ROOT}/V260101-V260200/`));
    // A job whose number belongs in the full batch but has no folder yet (a gap, e.g. an unused number): stays in its own batch.
    const gapFull = fakeEgnyte([...full.slice(1), `${ROOT}/V260001-V260100/V260100x/`]);
    const inside = await resolveInspectionFolder(gapFull.fs, ROOT, 'V260001', { lock });
    assert.equal(inside.path, `${ROOT}/V260001-V260100/V260001`);
    assert.equal(inside.status, 'needs_review');
    assert.match(inside.message ?? '', /holds 100 folders/);
  });

  await check('older batches with other widths are used as they are', async () => {
    const { fs, calls } = fakeEgnyte([`${ROOT}/V250001-V251228/V250900/a.jpg`, `${ROOT}/V240001-V241400/V240005/`, `${ROOT}/V23001-V231501/V23999/`]);
    const r = await resolveInspectionFolder(fs, ROOT, 'VIC-250900', { lock });
    assert.equal(r.path, `${ROOT}/V250001-V251228/V250900`);
    assert.equal(r.status, 'ok');
    assert.equal(calls.create.length, 0, 'existing job folder reused, nothing created');
    const r2 = await resolveInspectionFolder(fs, ROOT, 'V231200', { lock });
    assert.equal(r2.batch, 'V23001-V231501');
  });

  await check('the office adds the client to a job folder name ("V260630 SGQ Cons"): that folder is reused, never duplicated', async () => {
    const { fs, calls } = fakeEgnyte([`${ROOT}/V260601-V260700/V260630 SGQ Cons/a.jpg`, `${ROOT}/V260601-V260700/V2606300 Other/`, `${ROOT}/V260601-V260700/V260631/`]);
    const r = await resolveInspectionFolder(fs, ROOT, 'VIC-260630', { lock });
    assert.equal(r.path, `${ROOT}/V260601-V260700/V260630 SGQ Cons`);
    assert.equal(r.status, 'ok');
    assert.equal(calls.create.length, 0, 'nothing created');
    const plain = await resolveInspectionFolder(fs, ROOT, 'V260631', { lock });
    assert.equal(plain.path, `${ROOT}/V260601-V260700/V260631`);
    const fresh = await resolveInspectionFolder(fs, ROOT, 'V260640', { lock });
    assert.equal(fresh.path, `${ROOT}/V260601-V260700/V260640`, 'no folder yet: the plain job number is made');
    assert.equal(calls.create.length, 1);
  });

  await check('two uploads for new jobs at the same moment make one batch and one folder each', async () => {
    const { fs, calls } = fakeEgnyte([`${ROOT}/V260001-V260100/V260001/`]);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => resolveInspectionFolder(fs, ROOT, i % 2 ? 'V260105' : 'V260150', { lock })));
    assert.equal(calls.create.filter((c) => c.endsWith('V260101-V260200')).length, 1, 'one batch');
    assert.equal(calls.create.filter((c) => c.endsWith('/V260105')).length, 1, 'one V260105 folder');
    assert.equal(calls.create.filter((c) => c.endsWith('/V260150')).length, 1, 'one V260150 folder');
    assert.ok(results.every((r) => r.status === 'ok'));
  });

  await check('anything unexpected is flagged, never stored in a guessed place', async () => {
    const bad = await resolveInspectionFolder(fakeEgnyte([ROOT + '/']).fs, ROOT, 'ABC-1', { draftId: 'dr-1', lock });
    assert.equal(bad.status, 'unassigned');
    assert.equal(bad.path, `${ROOT}/_Unassigned/dr-1`);
    const old = await resolveInspectionFolder(fakeEgnyte([ROOT + '/']).fs, ROOT, 'V22005', { draftId: 'dr-2', lock });
    assert.equal(old.status, 'unassigned');
    assert.match(old.message ?? '', /6-digit/);
    const clash = await resolveInspectionFolder(fakeEgnyte([`${ROOT}/V260001-V260150/V260001/`]).fs, ROOT, 'V260160', { draftId: 'dr-3', lock });
    assert.equal(clash.status, 'unassigned');
    assert.match(clash.message ?? '', /overlap/);
    const loose = await resolveInspectionFolder(fakeEgnyte([`${ROOT}/V260001-V260100/`, `${ROOT}/V260010/a.jpg`]).fs, ROOT, 'V260010', { lock });
    assert.equal(loose.path, `${ROOT}/V260001-V260100/V260010`);
    assert.equal(loose.status, 'needs_review');
    assert.match(loose.message ?? '', /directly under the root/);
    const dup = batchesCovering([parseBatchName('V260001-V260200')!, parseBatchName('V260101-V260200')!], 260150);
    assert.equal(dup[0]!.name, 'V260101-V260200', 'the narrower batch wins');
  });

  await check('photos waiting in a draft or _Unassigned folder are merged into the job folder', async () => {
    const { fs, tree, calls } = fakeEgnyte([`${ROOT}/draft-1/pp_description/street/a.jpg`, `${ROOT}/V260001-V260100/`]);
    const dest = await resolveInspectionFolder(fs, ROOT, 'V260020', { lock, createJobFolder: false });
    await mergeFolder(fs, `${ROOT}/draft-1`, dest.path);
    assert.ok(tree.has(`${dest.path}/pp_description/street/a.jpg`));
    assert.ok(![...tree].some((k) => k.startsWith(`${ROOT}/draft-1`)));
    assert.equal(calls.move.length, 1, 'one move when the job folder did not exist');
    // Job folder already there with the same section folder: merged file by file.
    const two = fakeEgnyte([`${ROOT}/draft-2/s/new.jpg`, `${ROOT}/V260001-V260100/V260030/s/old.jpg`]);
    await mergeFolder(two.fs, `${ROOT}/draft-2`, `${ROOT}/V260001-V260100/V260030`);
    assert.ok(two.tree.has(`${ROOT}/V260001-V260100/V260030/s/old.jpg`) && two.tree.has(`${ROOT}/V260001-V260100/V260030/s/new.jpg`));
    assert.ok(![...two.tree].some((k) => k.startsWith(`${ROOT}/draft-2`)));
    await mergeFolder(two.fs, `${ROOT}/draft-2`, `${ROOT}/V260001-V260100/V260030`); // nothing left: harmless
  });

  console.log(`\n${passed} checks passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
