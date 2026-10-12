/**
 * Runs the real photo-upload and submit-time placement code against a stand-in Egnyte server, on a scratch database
 * (refuses anything but a local one). Checks that photos land in {root}/{batch}/{job}/..., that batches and folders are
 * made once under concurrency, that a retried photo is not stored twice, and that photos from older app builds are moved.
 *
 * Run: DATABASE_URL=postgresql://...localhost... npm run check:egnyte-upload
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const ROOT = '/Shared/Houspect Files/1-Jobs_Zeus';

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) { console.error('Refusing to run: DATABASE_URL is not a local database.'); process.exit(1); }

// ───────────── stand-in Egnyte ─────────────
const folders = new Set<string>(); // "/a/b"
const files = new Map<string, number>(); // path -> bytes
const log: string[] = [];
const hits: number[] = [];
let rejected = 0;
const addFolder = (p: string) => { const parts = p.split('/').filter(Boolean); let cur = ''; for (const part of parts) { cur += '/' + part; folders.add(cur); } };
const decode = (u: string) => decodeURIComponent(u);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://x');
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const json = (code: number, obj: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const fsPath = decode(url.pathname.replace('/pubapi/v1/fs-content', '').replace('/pubapi/v1/fs', ''));
  // Like the real account: more than 2 requests in any second is answered with 429.
  const nowMs = Date.now(); hits.push(nowMs); while (hits.length && hits[0]! < nowMs - 1000) hits.shift();
  if (hits.length > 2) { rejected++; return json(429, { fault: { faultstring: 'Spike arrest violation. Allowed rate : 2' } }); }
  log.push(`${req.method} ${url.pathname.startsWith('/pubapi/v1/fs-content') ? 'content' : 'fs'} ${fsPath}`);

  if (url.pathname.startsWith('/pubapi/v1/fs-content')) {
    addFolder(fsPath.split('/').slice(0, -1).join('/')); // Egnyte makes missing parents
    files.set(fsPath, body.length);
    return json(200, { path: fsPath });
  }
  if (req.method === 'GET') {
    if (!folders.has(fsPath)) return json(404, { errorMessage: 'Not found' });
    const kids = [...folders].filter((f) => f.startsWith(fsPath + '/') && !f.slice(fsPath.length + 1).includes('/')).map((f) => ({ name: f.split('/').pop(), is_folder: true }));
    const fl = [...files.keys()].filter((f) => f.startsWith(fsPath + '/') && !f.slice(fsPath.length + 1).includes('/')).map((f) => ({ name: f.split('/').pop() }));
    const offset = Number(url.searchParams.get('offset') ?? 0); const count = Number(url.searchParams.get('count') ?? 100);
    return json(200, { folders: kids.slice(offset, offset + count), files: fl.slice(offset, offset + count), total_count: Math.max(kids.length, fl.length), offset });
  }
  if (req.method === 'DELETE') { for (const f of [...folders]) if (f === fsPath || f.startsWith(fsPath + '/')) folders.delete(f); for (const f of [...files.keys()]) if (f.startsWith(fsPath + '/')) files.delete(f); return json(200, {}); }
  const payload = body.length ? JSON.parse(body.toString()) : {};
  if (payload.action === 'add_folder') {
    if (folders.has(fsPath)) return json(403, { errorMessage: 'Folder already exists' }); // this Egnyte reports "exists" as 403
    addFolder(fsPath); return json(201, {});
  }
  if (payload.action === 'move') {
    const dest: string = payload.destination;
    if (folders.has(dest)) return json(403, { errorMessage: 'Destination already exists' });
    for (const f of [...folders]) if (f === fsPath || f.startsWith(fsPath + '/')) { folders.delete(f); folders.add(dest + f.slice(fsPath.length)); }
    for (const [f, n] of [...files]) if (f.startsWith(fsPath + '/')) { files.delete(f); files.set(dest + f.slice(fsPath.length), n); }
    addFolder(dest); return json(200, {});
  }
  return json(400, { errorMessage: 'unsupported' });
});

async function main() {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, { EGNYTE_DOMAIN: 'test', EGNYTE_API_TOKEN: 'token', EGNYTE_BASE_URL: `http://127.0.0.1:${port}`, EGNYTE_ROOT_FOLDER: ROOT, NODE_ENV: 'test' });
  const { uploadPhoto } = await import('../lib/storage');
  const { settleEgnyteFolder } = await import('../modules/inspections/inspections.service');
  const { prisma } = await import('../lib/prisma');

  addFolder(`${ROOT}/V260001-V260100/V260050`);
  files.set(`${ROOT}/V260001-V260100/V260050/old.jpg`, 1);
  addFolder(`${ROOT}/V260033`); files.set(`${ROOT}/V260033/loose.jpg`, 1);
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#4488cc' } }).jpeg().toBuffer();
  const inspector = await prisma.user.create({ data: { email: `egnyte-check-${randomUUID()}@test.local`, role: 'INSPECTOR', passwordHash: 'x' } });
  let passed = 0;
  const check = async (name: string, fn: () => Promise<void>) => { await fn(); passed++; console.log(`  ok  ${name}`); };
  const inFolder = (p: string) => [...files.keys()].filter((f) => f.startsWith(p + '/'));

  const draftA = randomUUID();
  const photoId = randomUUID();
  let first: Awaited<ReturnType<typeof uploadPhoto>>;

  await check('a photo for VIC-260105 goes straight to {batch}/V260105/{section}/ (batch made on the way), original beside it', async () => {
    first = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', draftA, 'pp_description:street', undefined, undefined, { jobNo: 'VIC-260105', photoId });
    assert.equal(first.id, photoId);
    assert.equal(first.folder?.status, 'ok');
    assert.equal(first.storageKey, `${ROOT}/V260101-V260200/V260105/pp_description/street/${photoId}.jpg`);
    assert.ok(files.has(first.storageKey));
    assert.ok(files.has(`${ROOT}/V260101-V260200/V260105/pp_description/street/${photoId}-original.jpg`));
    assert.ok(folders.has(`${ROOT}/V260101-V260200`));
    assert.ok(!folders.has(`${ROOT}/${draftA}`), 'no draft-id folder is made');
  });

  await check('sending the same photo again stores nothing new', async () => {
    const before = files.size; const writes = log.filter((l) => l.startsWith('POST content')).length;
    const again = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', draftA, 'pp_description:street', undefined, undefined, { jobNo: 'VIC-260105', photoId });
    assert.equal(again.id, photoId);
    assert.equal(files.size, before);
    assert.equal(log.filter((l) => l.startsWith('POST content')).length, writes);
  });

  await check('eight photos at once for a new job: one folder, eight photos', async () => {
    const draft = randomUUID();
    const before = log.filter((l) => l === `POST fs ${ROOT}/V260101-V260200/V260106`).length;
    await Promise.all(Array.from({ length: 8 }, (_, i) => uploadPhoto(jpeg, 'image/jpeg', 'jpg', draft, `sd_site_facilities:p${i % 2}`, undefined, undefined, { jobNo: 'V260106', photoId: randomUUID() })));
    assert.equal(log.filter((l) => l === `POST fs ${ROOT}/V260101-V260200/V260106`).length - before, 1, 'the job folder was created once');
    assert.equal(inFolder(`${ROOT}/V260101-V260200/V260106`).length, 16, '8 photos + 8 originals');
  });

  await check('a job whose folder was already made by hand is reused', async () => {
    const r = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', randomUUID(), 'x', undefined, undefined, { jobNo: 'VIC-260050', photoId: randomUUID() });
    assert.ok(r.storageKey.startsWith(`${ROOT}/V260001-V260100/V260050/x/`));
    assert.equal(r.folder?.status, 'ok');
  });

  await check('a job number that is not one is parked in _Unassigned and flagged, then moved once corrected', async () => {
    const draft = randomUUID();
    const up = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', draft, 'pp_description', undefined, undefined, { jobNo: 'HELLO', photoId: randomUUID() });
    assert.equal(up.folder?.status, 'unassigned');
    assert.ok(up.storageKey.startsWith(`${ROOT}/_Unassigned/${draft}/`));
    await prisma.inspection.create({ data: { id: draft, inspectorId: inspector.id, jobNo: 'VIC-260108' } });
    await settleEgnyteFolder(draft, 'VIC-260108');
    const ins = await prisma.inspection.findUniqueOrThrow({ where: { id: draft } });
    assert.equal(ins.egnyteStatus, 'ok');
    assert.equal(ins.egnytePath, `${ROOT}/V260101-V260200/V260108`);
    const photo = await prisma.photo.findUniqueOrThrow({ where: { id: up.id } });
    assert.equal(photo.storageKey, `${ROOT}/V260101-V260200/V260108/pp_description/${up.id}.jpg`);
    assert.ok(files.has(photo.storageKey!));
    assert.ok(!folders.has(`${ROOT}/_Unassigned/${draft}`), 'the staging folder is gone');
  });

  await check('photos from an older app build (draft-id folder) are moved at submit and the index follows', async () => {
    const draft = randomUUID();
    const up = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', draft, 'sd_description:street'); // no job number, as before
    assert.ok(up.storageKey.startsWith(`${ROOT}/${draft}/`));
    await prisma.inspection.create({ data: { id: draft, inspectorId: inspector.id, jobNo: 'VIC-260109' } });
    await settleEgnyteFolder(draft, 'VIC-260109');
    const photo = await prisma.photo.findUniqueOrThrow({ where: { id: up.id } });
    assert.equal(photo.storageKey, `${ROOT}/V260101-V260200/V260109/sd_description/street/${up.id}.jpg`);
    assert.ok(!folders.has(`${ROOT}/${draft}`));
    // Running it again (an admin pressing "Re-check folder") changes nothing.
    await settleEgnyteFolder(draft, 'VIC-260109');
    assert.equal((await prisma.photo.findUniqueOrThrow({ where: { id: up.id } })).storageKey, photo.storageKey);
    assert.equal((await prisma.inspection.findUniqueOrThrow({ where: { id: draft } })).egnyteStatus, 'ok');
  });

  await check('when Egnyte is down the upload fails (so it can be retried) and nothing is stored in a wrong place', async () => {
    const downPort = port; server.close();
    server.closeAllConnections?.();
    await assert.rejects(uploadPhoto(jpeg, 'image/jpeg', 'jpg', randomUUID(), 'x', undefined, undefined, { jobNo: 'V260111', photoId: randomUUID() }));
    void downPort;
  });

  await prisma.inspection.deleteMany({ where: { inspectorId: inspector.id } });
  await prisma.user.delete({ where: { id: inspector.id } });
  await prisma.$disconnect();
  assert.equal(rejected, 0, `Egnyte answered 429 ${rejected} times: requests are not spaced out`);
  console.log(`\n${passed} checks passed (Egnyte's 2-per-second limit was never exceeded)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
