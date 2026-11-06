import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);

const SECTION = 'aaaaaaaa-2222-4333-8444-555555555555';
const OTHER_SECTION = 'bbbbbbbb-2222-4333-8444-555555555555';
const PHOTO = '11111111-2222-4333-8444-555555555555';

/** The real zip handlers and access check; sign-in, the database, storage and audit log are fakes. "x-user: <id>:<role>" stands in for a valid login. */
async function start() {
  const express = (await import('express')).default;
  const { makeSectionPhotosZip } = await import('./photosZip');
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
    // Only the inspector "owner" may open SECTION, as for the real inspection rules.
    assertCanViewSection: async (_sectionId: string, user: { id: string; role: string }) => { if (user.id !== 'owner' && user.role !== 'ADMIN') throw new ApiError(404, 'Section not found', 'NOT_FOUND'); },
    getSectionPhotos: async () => ({ name: 'Driveway', photos: [`/api/v1/media/${PHOTO}`] }),
    fetchPhotoStream: async () => ({ body: new Response('jpeg-bytes').body!, contentType: 'image/jpeg' }),
    audit: async (e: Record<string, unknown>) => { audits.push(e); },
    logSecurityEvent: async (e: { type: string }) => { events.push(e); },
  };
  const zip = makeSectionPhotosZip(deps as never);
  const app = express();
  app.get('/sections/:sectionId/photos-link', deps.requireAuth, zip.link);
  app.get('/sections/:sectionId/photos.zip', zip.access, zip.download);
  app.use(notFound);
  app.use((err: { statusCode?: number; message: string }, _req: Request, res: Response, _next: NextFunction) => { res.status(err.statusCode ?? 500).json({ error: { message: err.message } }); });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, events, audits, close: () => server.close() };
}

test('photos.zip without signing in or a link is rejected (401) and logged', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/sections/${SECTION}/photos.zip`);
    assert.equal(r.status, 401);
    assert.equal(s.events[0]?.type, 'MEDIA_DENIED');
    assert.equal(s.audits.length, 0);
  } finally { s.close(); }
});

test('photos.zip with a bad, expired or other-section link is rejected', async () => {
  const { signSectionZipQuery } = await import('../../lib/mediaLinks');
  const s = await start();
  try {
    const q = signSectionZipQuery(SECTION);
    assert.equal((await fetch(`${s.base}/sections/${SECTION}/photos.zip?${q.slice(0, -2)}xx`)).status, 401);
    assert.equal((await fetch(`${s.base}/sections/${OTHER_SECTION}/photos.zip?${q}`)).status, 401);
    assert.equal((await fetch(`${s.base}/sections/${SECTION}/photos.zip?${signSectionZipQuery(SECTION, -5)}`)).status, 401);
  } finally { s.close(); }
});

test('a signed-in user who may open the inspection gets the zip, privately cached', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/sections/${SECTION}/photos.zip`, { headers: { authorization: 'Bearer test', 'x-user': 'owner:INSPECTOR' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/zip');
    assert.match(r.headers.get('cache-control') ?? '', /^private/);
    assert.doesNotMatch(r.headers.get('cache-control') ?? '', /public|immutable/);
    assert.equal(String.fromCharCode(...new Uint8Array(await r.arrayBuffer()).slice(0, 2)), 'PK');
    assert.equal(s.audits.length, 1);
  } finally { s.close(); }
});

test('a signed-in user who may NOT see the inspection is refused, even with a Bearer token', async () => {
  const s = await start();
  try {
    const r = await fetch(`${s.base}/sections/${SECTION}/photos.zip`, { headers: { authorization: 'Bearer test', 'x-user': 'stranger:INSPECTOR' } });
    assert.equal(r.status, 404);
    assert.equal(s.audits.length, 0);
  } finally { s.close(); }
});

test('the link endpoint: allowed user gets a short-lived working link, others are refused', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/sections/${SECTION}/photos-link`)).status, 401);
    assert.equal((await fetch(`${s.base}/sections/${SECTION}/photos-link`, { headers: { authorization: 'Bearer test', 'x-user': 'stranger:INSPECTOR' } })).status, 404);
    const r = await fetch(`${s.base}/sections/${SECTION}/photos-link`, { headers: { authorization: 'Bearer test', 'x-user': 'owner:INSPECTOR' } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control') ?? '', /^private/);
    const { url, expiresInSeconds } = (await r.json()) as { url: string; expiresInSeconds: number };
    assert.equal(expiresInSeconds, 120);
    const z = await fetch(`${s.base}${url.replace('/api/v1/inspections', '')}`); // no login: the link alone opens it
    assert.equal(z.status, 200);
    assert.equal(z.headers.get('content-type'), 'application/zip');
  } finally { s.close(); }
});

test('a photo link cannot open a zip, and a zip link cannot open a photo', async () => {
  const { signMediaUrl, verifyMediaSignature, signSectionZipQuery } = await import('../../lib/mediaLinks');
  const s = await start();
  try {
    const m = /e=(\d+)&s=(.+)$/.exec(signMediaUrl(`/api/v1/media/${SECTION}`))!;
    assert.equal((await fetch(`${s.base}/sections/${SECTION}/photos.zip?e=${m[1]}&s=${m[2]}`)).status, 401);
    const z = /e=(\d+)&s=(.+)$/.exec(signSectionZipQuery(SECTION))!;
    assert.equal(verifyMediaSignature(SECTION, z[1], z[2]), false);
  } finally { s.close(); }
});
