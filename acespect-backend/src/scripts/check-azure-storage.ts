/**
 * Runs the real photo-store and photo-serve code (lib/storage.ts, STORAGE_PROVIDER=azure) against the Azurite emulator, on a scratch
 * database (refuses anything but a local one). Checks the blob layout, that a photo comes back through fetchPhotoStream, that a retried
 * photo is stored once, that a non-image file round-trips, and that the container is private.
 *
 * Run: start Azurite (npx azurite --silent --location /tmp/azurite), then
 *   DATABASE_URL=postgresql://...localhost... npm run check:azure-storage
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) { console.error('Refusing to run: DATABASE_URL is not a local database.'); process.exit(1); }
Object.assign(process.env, {
  STORAGE_PROVIDER: 'azure',
  AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING || 'UseDevelopmentStorage=true',
  AZURE_STORAGE_CONTAINER: 'inspection-photos-check',
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || 'check-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'check-refresh-secret-0123456789abcdef',
});

async function readAll(body: ReadableStream): Promise<Buffer> {
  return Buffer.from(await new Response(body).arrayBuffer());
}

async function main() {
  const { uploadPhoto, uploadDocument, fetchPhotoStream, ensureBucket, isStorageEnabled, storageProvider, inspectionFolderUrl, settleInspectionFolder, clearPhotoCache } = await import('../lib/storage');
  const { BlobServiceClient } = await import('@azure/storage-blob');
  const { prisma } = await import('../lib/prisma');
  const { settleEgnyteFolder } = await import('../modules/inspections/inspections.service');
  let passed = 0;
  const check = async (name: string, fn: () => Promise<void>) => { await fn(); passed++; console.log(`  ok  ${name}`); };

  assert.equal(storageProvider(), 'azure');
  assert.ok(isStorageEnabled());
  await ensureBucket();
  const container = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING!).getContainerClient(process.env.AZURE_STORAGE_CONTAINER!);
  const names = async () => { const out: string[] = []; for await (const b of container.listBlobsFlat()) out.push(b.name); return out; };
  const jpeg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#4488cc' } }).jpeg().toBuffer();
  const draft = randomUUID();
  const photoId = randomUUID();

  const job = `V${String(Date.now()).slice(-6)}`;

  await check('a photo is stored as {job number}/{section}/{number}.jpg with the original beside it, no Egnyte root or leading slash', async () => {
    const r = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', draft, 'pp_description:street', undefined, undefined, { jobNo: job, photoId, photoNumber: 1 });
    assert.equal(r.id, photoId);
    assert.equal(r.storageKey, `${job}/pp_description/street/1.jpg`);
    assert.equal(r.url, `/api/v1/media/${photoId}`);
    assert.equal(r.folder, undefined, 'no Egnyte batch folder is made');
    const all = await names();
    assert.ok(all.includes(`${job}/pp_description/street/1.jpg`));
    assert.ok(all.includes(`${job}/pp_description/street/1-original.jpg`));
    assert.ok(!all.some((n) => n.startsWith(`${draft}/`)), 'nothing under the inspection id');
  });

  await check('the photo is served back resized (max 1366x768) as image/jpeg', async () => {
    clearPhotoCache();
    const got = await fetchPhotoStream(photoId);
    assert.ok(got);
    assert.equal(got.contentType, 'image/jpeg');
    const meta = await sharp(await readAll(got.body)).metadata();
    assert.ok(meta.width! <= 1366 && meta.height! <= 768);
  });

  await check('sending the same photo again (or three at once) stores nothing new', async () => {
    const before = (await names()).length;
    await uploadPhoto(jpeg, 'image/jpeg', 'jpg', draft, 'pp_description:street', undefined, undefined, { jobNo: job, photoId, photoNumber: 1 });
    const id = randomUUID();
    await Promise.all([1, 2, 3].map(() => uploadPhoto(jpeg, 'image/jpeg', 'jpg', draft, 'pp_description:street', undefined, undefined, { jobNo: job, photoId: id, photoNumber: 2 })));
    assert.equal((await names()).length - before, 2, 'one new photo = compressed + original');
    assert.equal(await prisma.photo.count({ where: { id } }), 1);
  });

  await check('a second photo with the same number in the same folder gets the id added instead of overwriting', async () => {
    const again = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', draft, 'pp_description:street', undefined, undefined, { jobNo: job, photoId: randomUUID(), photoNumber: 1 });
    assert.match(again.storageKey, /\/street\/1-[0-9a-f]{8}\.jpg$/);
  });

  await check('a HEIC-style unreadable file is refused with 422 PHOTO_UNREADABLE', async () => {
    await assert.rejects(uploadPhoto(Buffer.from('not an image'), 'image/jpeg', 'jpg', draft, 'x', undefined, undefined, { photoId: randomUUID() }), (e: { statusCode?: number; status?: number }) => (e.statusCode ?? e.status) === 422);
  });

  await check('a document (PDF) is stored under documents/ and served unchanged with its content type', async () => {
    const pdf = Buffer.from('%PDF-1.4 azure check');
    const r = await uploadDocument(pdf, 'application/pdf', 'pdf', 'documents/proj1', 'tenant1');
    assert.equal(r.storageKey, `tenants/tenant1/documents/proj1/${r.id}.pdf`);
    const got = await fetchPhotoStream(r.id);
    assert.equal(got?.contentType, 'application/pdf');
    assert.deepEqual(await readAll(got!.body), pdf);
  });

  await check('a large file (over the cache limit) is streamed through intact', async () => {
    const big = Buffer.alloc(5 * 1024 * 1024, 7);
    const r = await uploadDocument(big, 'application/octet-stream', 'bin', 'documents/big');
    const got = await fetchPhotoStream(r.id);
    assert.ok((await readAll(got!.body)).equals(big));
  });

  await check('an unknown photo id answers null (the media route turns that into 404)', async () => {
    assert.equal(await fetchPhotoStream(randomUUID()), null);
  });

  await check('there is no Egnyte folder link with Azure', async () => {
    assert.equal(inspectionFolderUrl(job, draft, null), null);
  });

  const inspector = await prisma.user.create({ data: { email: `blob-${randomUUID()}@example.com`, role: 'INSPECTOR' } });
  const mkInspection = (id: string, jobNo: string | null, photoIds: string[]) =>
    prisma.inspection.create({ data: { id, inspectorId: inspector.id, jobNo, inspectionType: 'Dilapidation', propertyType: 'Commercial Properties', sections: { create: [{ key: 'driveway', name: 'Driveway', icon: 'x', order: 1, photos: photoIds.map((p) => `/api/v1/media/${p}`) }] } } as never });
  const keyOf = async (id: string) => (await prisma.photo.findUniqueOrThrow({ where: { id } })).storageKey!;

  await check('a job number in lower case or with spaces lands in the same folder', async () => {
    const r = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', randomUUID(), 'driveway', undefined, undefined, { jobNo: `  ${job.toLowerCase()} `, photoId: randomUUID(), photoNumber: 50 });
    assert.ok(r.storageKey.startsWith(`${job}/`), r.storageKey);
  });

  const late = randomUUID();
  const lateId = randomUUID();
  const lateJob = `${job}L`;

  await check('a photo taken before the job number is known waits under the inspection id', async () => {
    const r = await uploadPhoto(jpeg, 'image/jpeg', 'jpg', late, 'driveway', undefined, undefined, { photoId: lateId, photoNumber: 1 });
    assert.equal(r.storageKey, `${late}/driveway/1.jpg`);
    assert.equal(await settleInspectionFolder(late, null), null);
    assert.equal(await keyOf(lateId), `${late}/driveway/1.jpg`);
  });

  await check('when the job number is saved the photo and its original move to the job folder and still open', async () => {
    await mkInspection(late, lateJob, [lateId]);
    await settleEgnyteFolder(late, lateJob);
    assert.equal(await keyOf(lateId), `${lateJob}/driveway/1.jpg`);
    const all = await names();
    assert.ok(all.includes(`${lateJob}/driveway/1.jpg`) && all.includes(`${lateJob}/driveway/1-original.jpg`), 'moved');
    assert.ok(!all.some((n) => n.startsWith(`${late}/`)), 'nothing left under the inspection id');
    clearPhotoCache();
    assert.ok(await fetchPhotoStream(lateId));
    assert.equal((await prisma.inspection.findUniqueOrThrow({ where: { id: late } })).egnytePath, lateJob);
  });

  await check('settling again changes nothing', async () => {
    await settleEgnyteFolder(late, lateJob);
    assert.equal(await keyOf(lateId), `${lateJob}/driveway/1.jpg`);
  });

  await check('correcting the job number moves only this inspection out of a folder it shares with another', async () => {
    const other = randomUUID();
    const otherId = randomUUID();
    await uploadPhoto(jpeg, 'image/jpeg', 'jpg', other, 'driveway', undefined, undefined, { jobNo: lateJob, photoId: otherId, photoNumber: 2 });
    await mkInspection(other, lateJob, [otherId]);
    const fixed = `${job}F`;
    await settleEgnyteFolder(late, fixed);
    assert.equal(await keyOf(lateId), `${fixed}/driveway/1.jpg`);
    assert.equal(await keyOf(otherId), `${lateJob}/driveway/2.jpg`, 'the other inspection stayed');
    clearPhotoCache();
    assert.ok(await fetchPhotoStream(lateId));
    assert.ok(await fetchPhotoStream(otherId));
    await prisma.inspection.delete({ where: { id: other } });
  });

  await check('moving into a job folder never overwrites a photo with the same number', async () => {
    const a = randomUUID(); const aId = randomUUID();
    const clashJob = `${job}C`;
    await uploadPhoto(jpeg, 'image/jpeg', 'jpg', randomUUID(), 'driveway', undefined, undefined, { jobNo: clashJob, photoId: aId, photoNumber: 7 });
    const bId = randomUUID();
    await uploadPhoto(jpeg, 'image/jpeg', 'jpg', a, 'driveway', undefined, undefined, { photoId: bId, photoNumber: 7 });
    await mkInspection(a, clashJob, [bId]);
    await settleEgnyteFolder(a, clashJob);
    assert.equal(await keyOf(aId), `${clashJob}/driveway/7.jpg`);
    assert.equal(await keyOf(bId), `${clashJob}/driveway/7-${bId.slice(0, 8)}.jpg`);
    assert.ok((await names()).includes(`${clashJob}/driveway/7-${bId.slice(0, 8)}-original.jpg`), 'the original kept its pair');
    await prisma.inspection.delete({ where: { id: a } });
  });

  await prisma.inspection.delete({ where: { id: late } });
  await prisma.user.delete({ where: { id: inspector.id } });

  await check('the container is private (no anonymous access)', async () => {
    assert.equal((await container.getAccessPolicy()).blobPublicAccess ?? 'none', 'none');
  });

  await container.delete().catch(() => undefined);
  console.log(`\n${passed} checks passed`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
