import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);

const ID = '11111111-2222-4333-8444-555555555555';
const OTHER_ID = '99999999-2222-4333-8444-555555555555';
const BYTES = 'jpeg-bytes';

/** The real media route and handler, with the database, storage and security log replaced by fakes. */
async function start(opts: { tenantIds?: string[] } = {}) {
  const express = (await import('express')).default;
  const { createMediaRouter } = await import('./media.routes');
  const { makeMediaGet } = await import('./media.controller');
  const { notFound } = await import('../../middleware/errorHandler');
  const events: { type: string; detail?: Record<string, unknown> }[] = [];
  const get = makeMediaGet({
    isTenantFile: async (id) => (opts.tenantIds ?? []).includes(id),
    fetchPhotoStream: (async () => ({ body: new Response(BYTES).body!, contentType: 'image/jpeg' })) as never,
    logSecurityEvent: async (e) => { events.push(e); },
  });
  const app = express();
  app.use('/api/v1/media', createMediaRouter(get));
  app.use(notFound);
  app.use((err: { statusCode?: number; message: string }, _req: Request, res: Response, _next: NextFunction) => { res.status(err.statusCode ?? 500).json({ error: { message: err.message } }); });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/media`;
  return { base, events, close: () => server.close() };
}

test('a request without a signature is refused, and the refusal is logged', async () => {
  const { env } = await import('../../config/env');
  env.MEDIA_ALLOW_UNSIGNED_UNTIL = undefined;
  const s = await start();
  try {
    const res = await fetch(`${s.base}/${ID}`);
    assert.equal(res.status, 403);
    assert.notEqual(await res.text(), BYTES);
    assert.deepEqual(s.events.map((e) => e.type), ['MEDIA_DENIED']);
  } finally { s.close(); }
});

test('an expired signature is refused', async () => {
  const { signMediaUrl } = await import('../../lib/mediaLinks');
  const s = await start();
  try {
    const expired = signMediaUrl(`/api/v1/media/${ID}`, -1); // signed correctly, but the expiry is already past
    const res = await fetch(`${s.base.replace('/api/v1/media', '')}${expired}`);
    assert.equal(res.status, 403);
  } finally { s.close(); }
});

test('a tampered signature, expiry or photo id is refused', async () => {
  const { signMediaUrl } = await import('../../lib/mediaLinks');
  const s = await start();
  try {
    const root = s.base.replace('/api/v1/media', '');
    const good = new URL(root + signMediaUrl(`/api/v1/media/${ID}`));
    const e = good.searchParams.get('e')!;
    const sig = good.searchParams.get('s')!;
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    for (const [name, url] of [
      ['changed signature', `${s.base}/${ID}?e=${e}&s=${flipped}`],
      ['longer expiry, same signature', `${s.base}/${ID}?e=${Number(e) + 86_400}&s=${sig}`],
      ['signature of another photo', `${s.base}/${OTHER_ID}?e=${e}&s=${sig}`],
      ['no expiry', `${s.base}/${ID}?s=${sig}`],
      ['no signature', `${s.base}/${ID}?e=${e}`],
    ] as const) {
      assert.equal((await fetch(url)).status, 403, name);
    }
  } finally { s.close(); }
});

test('a valid signed link serves the photo with private caching only', async () => {
  const { signMediaUrl } = await import('../../lib/mediaLinks');
  const s = await start();
  try {
    const url = s.base.replace('/api/v1/media', '') + signMediaUrl(`/api/v1/media/${ID}`);
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), BYTES);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    const cache = res.headers.get('cache-control') ?? '';
    assert.match(cache, /^private, max-age=\d+$/);
    assert.ok(Number(/max-age=(\d+)/.exec(cache)![1]) <= 60, 'never longer than the link lives');
    assert.doesNotMatch(cache, /public|immutable/);
    assert.deepEqual(s.events, [], 'an inspection photo view is not a security event');
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200, 'HEAD works');
  } finally { s.close(); }
});

test('only GET (and HEAD) reach a photo: POST, PUT, PATCH and DELETE are 404', async () => {
  const { signMediaUrl } = await import('../../lib/mediaLinks');
  const s = await start();
  try {
    const url = s.base.replace('/api/v1/media', '') + signMediaUrl(`/api/v1/media/${ID}`);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await fetch(url, { method })).status, 404, method);
      assert.equal((await fetch(`${s.base}/${ID}`, { method })).status, 404, `${method} without a signature`);
    }
  } finally { s.close(); }
});

test('grace period: unsigned links work (privately, logged) until MEDIA_ALLOW_UNSIGNED_UNTIL, then stop', async () => {
  const { env } = await import('../../config/env');
  const s = await start({ tenantIds: [OTHER_ID] });
  try {
    env.MEDIA_ALLOW_UNSIGNED_UNTIL = new Date(Date.now() + 3_600_000).toISOString();
    const open = await fetch(`${s.base}/${ID}`);
    assert.equal(open.status, 200);
    assert.equal(await open.text(), BYTES);
    assert.equal(open.headers.get('cache-control'), 'private, max-age=0');
    assert.deepEqual(s.events.map((e) => e.type), ['MEDIA_UNSIGNED']);
    assert.equal((await fetch(`${s.base}/${OTHER_ID}`)).status, 403, 'a tenant file always needs its signature');

    env.MEDIA_ALLOW_UNSIGNED_UNTIL = new Date(Date.now() - 1000).toISOString();
    assert.equal((await fetch(`${s.base}/${ID}`)).status, 403, 'after the date unsigned links fail');
    env.MEDIA_ALLOW_UNSIGNED_UNTIL = undefined;
    assert.equal((await fetch(`${s.base}/${ID}`)).status, 403, 'not set = off');
  } finally { env.MEDIA_ALLOW_UNSIGNED_UNTIL = undefined; s.close(); }
});

test('signMediaLinks signs every photo link at any depth and stripMediaSignatures undoes it', async () => {
  const { signMediaLinks, stripMediaSignatures } = await import('../../lib/mediaLinks');
  const plain = {
    photos: [`/api/v1/media/${ID}`],
    excludedPhotoUrls: [`/api/v1/media/${ID}`],
    answers: { a: { urls: [`/api/v1/media/${OTHER_ID}`, 'not a photo'], n: 3, ok: true, none: null } },
    old: `https://old-tunnel.example.com/api/v1/media/${ID}`,
  };
  const signed = signMediaLinks(plain);
  assert.match(signed.photos[0]!, new RegExp(`^/api/v1/media/${ID}\\?e=\\d+&s=[\\w-]+$`));
  assert.equal(signed.photos[0], signed.excludedPhotoUrls[0], 'the same photo carries the same link everywhere in one call');
  assert.match(signed.old, /^https:\/\/old-tunnel\.example\.com\/api\/v1\/media\/.+\?e=\d+&s=/, 'an old host is kept');
  assert.equal(signed.answers.a.urls[1], 'not a photo');
  assert.equal(signed.answers.a.n, 3);
  assert.deepEqual(stripMediaSignatures(signed), plain);
  assert.deepEqual(stripMediaSignatures(plain), plain, 'unsigned values are unchanged');
});

test('a section sent to the apps carries signed photo links', async () => {
  const { serializeSection } = await import('../web/web.serializers');
  const row = { id: 's1', key: 'driveway', name: 'Driveway', icon: null, status: 'COMPLETE', reviewStatus: 'PENDING', reviewComment: null, reportText: '', fields: { shots: [`/api/v1/media/${ID}`] }, answers: null, photos: [`/api/v1/media/${ID}`], excludedPhotoUrls: [], damages: [{ id: 'd1', type: 'crack', location: null, direction: null, widthMm: null, lengthMm: null, notes: null, photos: [`/api/v1/media/${OTHER_ID}`], excludedPhotoUrls: [] }] };
  const out = serializeSection(row as never) as unknown as { photos: string[]; fields: { shots: string[] }; damages: { photos: string[] }[] };
  for (const u of [out.photos[0]!, out.fields.shots[0]!, out.damages[0]!.photos[0]!]) assert.match(u, /^\/api\/v1\/media\/[0-9a-f-]{36}\?e=\d+&s=[\w-]+$/);
});
