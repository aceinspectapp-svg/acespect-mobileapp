import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);

const INSPECTION = 'aaaaaaaa-2222-4333-8444-555555555555';
const OTHER = 'bbbbbbbb-2222-4333-8444-555555555555';
const P1 = '11111111-2222-4333-8444-555555555555';
const P2 = '22222222-2222-4333-8444-555555555555';
const GONE = '33333333-2222-4333-8444-555555555555';

/** The real handlers and access check for "download all original photos"; sign-in, the database, storage and audit log are fakes. */
async function start(photos: { name: string; photoIds: string[] }[] = [{ name: 'Driveway', photoIds: [P1] }, { name: 'Formwork & Measurements', photoIds: [P2, GONE] }]) {
  const express = (await import('express')).default;
  const { makeOriginalPhotosZip } = await import('./photosZip');
  const { ApiError } = await import('../../utils/ApiError');
  const { notFound } = await import('../../middleware/errorHandler');
  const events: { type: string }[] = [];
  const audits: Record<string, unknown>[] = [];
  const deps = {
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
      const [id, role] = String(req.headers['x-user'] ?? '').split(':');
      if (!id || !role) return next(ApiError.unauthorized('not signed in', 'NO_TOKEN'));
      req.user = { id, role };
      next();
    },
    assertCanViewInspection: async (_id: string, user: { id: string; role: string }) => { if (user.id !== 'owner' && user.role !== 'ADMIN') throw new ApiError(404, 'Inspection not found', 'NOT_FOUND'); },
    getInspectionPhotos: async () => ({ jobNo: 'V111111', sections: photos }),
    fetchOriginalPhoto: async (id: string) =>
      id === GONE ? null : { body: Readable.from([Buffer.from(`original-bytes-${id}`)]), fileName: id === P1 ? '1.heic' : '161.jpg', original: true },
    audit: async (e: Record<string, unknown>) => { audits.push(e); },
    logSecurityEvent: async (e: { type: string }) => { events.push(e); },
  };
  const zip = makeOriginalPhotosZip(deps as never);
  const app = express();
  app.get('/:id/original-photos-link', deps.requireAuth, zip.link);
  app.get('/:id/original-photos.zip', zip.access, zip.download);
  app.use(notFound);
  app.use((err: { statusCode?: number; message: string }, _req: Request, res: Response, _next: NextFunction) => { res.status(err.statusCode ?? 500).json({ error: { message: err.message } }); });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, events, audits, close: () => server.close() };
}

const owner = { authorization: 'Bearer test', 'x-user': 'owner:INSPECTOR' };

test('the report link: made only for someone who may open the inspection, lasts a year, and opens the zip without signing in', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/${INSPECTION}/original-photos-link`)).status, 401);
    assert.equal((await fetch(`${s.base}/${INSPECTION}/original-photos-link`, { headers: { ...owner, 'x-user': 'stranger:INSPECTOR' } })).status, 404);
    const r = await fetch(`${s.base}/${INSPECTION}/original-photos-link`, { headers: owner });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') ?? '', /^private/);
    const { url, count, expiresAt } = (await r.json()) as { url: string; count: number; expiresAt: string };
    assert.equal(count, 3);
    const days = (Date.parse(expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 364 && days <= 365, `link lasts about a year (${days} days)`);
    const z = await fetch(`${s.base}${url.replace('/api/v1/inspections', '')}`);
    assert.equal(z.status, 200);
    assert.equal(z.headers.get('content-type'), 'application/zip');
    assert.match(z.headers.get('content-disposition') ?? '', /V111111-original-photos\.zip/);
  } finally { s.close(); }
});

test('the zip holds every original, a folder per section in report order, stored as-is, and says which photos are missing', async () => {
  const s = await start();
  try {
    const z = await fetch(`${s.base}/${INSPECTION}/original-photos.zip`, { headers: owner });
    assert.equal(z.status, 200);
    const bytes = Buffer.from(await z.arrayBuffer());
    const text = bytes.toString('latin1');
    assert.equal(text.slice(0, 2), 'PK');
    assert.ok(text.includes('01 Driveway/1.heic'));
    assert.ok(text.includes('02 Formwork & Measurements/161.jpg'));
    assert.ok(text.includes('MISSING PHOTOS.txt'));
    // Stored, not recompressed: the photo bytes appear verbatim in the file.
    assert.ok(text.includes(`original-bytes-${P1}`));
    assert.ok(text.includes(`original-bytes-${P2}`));
    assert.equal(s.audits.length, 1);
    assert.equal(s.audits[0]!.action, 'photos.download_originals');
  } finally { s.close(); }
});

test('a bad, expired or other-inspection link shows a plain "no longer available" page and is logged', async () => {
  const { signOriginalPhotosQuery } = await import('../../lib/mediaLinks');
  const s = await start();
  try {
    const { query } = signOriginalPhotosQuery(INSPECTION);
    for (const url of [
      `${s.base}/${INSPECTION}/original-photos.zip`,
      `${s.base}/${INSPECTION}/original-photos.zip?${query.slice(0, -2)}xx`,
      `${s.base}/${OTHER}/original-photos.zip?${query}`,
      `${s.base}/${INSPECTION}/original-photos.zip?${signOriginalPhotosQuery(INSPECTION, -7200).query}`,
    ]) {
      const r = await fetch(url);
      assert.equal(r.status, 401, url);
      assert.match(r.headers.get('content-type') ?? '', /text\/html/);
      assert.match(await r.text(), /no longer available/);
    }
    assert.equal(s.events.length, 4);
    assert.equal(s.audits.length, 0);
  } finally { s.close(); }
});

test('a signed-in user who may not open the inspection is refused, and an inspection without photos has nothing to download', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/${INSPECTION}/original-photos.zip`, { headers: { ...owner, 'x-user': 'stranger:INSPECTOR' } })).status, 404);
  } finally { s.close(); }
  const empty = await start([]);
  try {
    const r = await fetch(`${empty.base}/${INSPECTION}/original-photos-link`, { headers: owner });
    assert.equal(((await r.json()) as { count: number }).count, 0);
    assert.equal((await fetch(`${empty.base}/${INSPECTION}/original-photos.zip`, { headers: owner })).status, 404);
  } finally { empty.close(); }
});

test('the report link cannot open a section zip or a photo, and theirs cannot open it', async () => {
  const { signOriginalPhotosQuery, verifyOriginalPhotosSignature, signSectionZipQuery, verifySectionZipSignature, signMediaUrl, verifyMediaSignature } = await import('../../lib/mediaLinks');
  const o = /e=(\d+)&s=(.+)$/.exec(signOriginalPhotosQuery(INSPECTION).query)!;
  assert.equal(verifySectionZipSignature(INSPECTION, o[1], o[2]), false);
  assert.equal(verifyMediaSignature(INSPECTION, o[1], o[2]), false);
  const z = /e=(\d+)&s=(.+)$/.exec(signSectionZipQuery(INSPECTION))!;
  assert.equal(verifyOriginalPhotosSignature(INSPECTION, z[1], z[2]), false);
  const m = /e=(\d+)&s=(.+)$/.exec(signMediaUrl(`/api/v1/media/${INSPECTION}`))!;
  assert.equal(verifyOriginalPhotosSignature(INSPECTION, m[1], m[2]), false);
});
