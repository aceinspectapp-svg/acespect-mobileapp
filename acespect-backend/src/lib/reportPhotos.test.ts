import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { fetchReportPhoto, photoQueueState, photosFailedMessage, REPORT_PHOTO_CONCURRENCY, ReportPhotoError, routeReportPhotos, isMediaUrl, mediaIdOf } from './reportPhotos';

const id = (n: number) => `${String(n).padStart(8, '0')}-2222-4333-8444-555555555555`;
const media = (n: number) => `http://api.test/api/v1/media/${id(n)}?e=1&s=abc`;
const ok = () => new Response(Buffer.from('jpeg'), { status: 200, headers: { 'content-type': 'image/jpeg' } });
const noDelay = { delays: [0] };

test('photographs are fetched at most REPORT_PHOTO_CONCURRENCY at a time, however many are asked for together', async () => {
  let now = 0;
  let most = 0;
  const fetcher = (async () => {
    now++;
    most = Math.max(most, now);
    await new Promise((r) => setTimeout(r, 5));
    now--;
    return ok();
  }) as typeof fetch;
  const got = await Promise.all(Array.from({ length: 200 }, (_, i) => fetchReportPhoto(media(i), {}, { fetcher, ...noDelay })));
  assert.equal(got.length, 200);
  assert.equal(most, REPORT_PHOTO_CONCURRENCY);
  assert.deepEqual(photoQueueState(), { active: 0, queued: 0 });
});

test('a passing failure (no connection free: 400 DB_REQUEST_ERROR, a 503, no answer) is tried again', async () => {
  for (const fail of [
    () => new Response(JSON.stringify({ error: { code: 'DB_REQUEST_ERROR' } }), { status: 400 }),
    () => new Response('busy', { status: 503 }),
    () => { throw new TypeError('fetch failed'); },
  ]) {
    let calls = 0;
    const fetcher = (async () => (++calls < 3 ? fail() : ok())) as typeof fetch;
    const p = await fetchReportPhoto(media(1), {}, { fetcher, ...noDelay });
    assert.equal(p.status, 200);
    assert.equal(p.body.toString(), 'jpeg');
    assert.equal(p.headers['content-type'], 'image/jpeg');
    assert.equal(calls, 3);
  }
});

test('a refused link (403) or a missing photograph (404) is not retried; one that keeps failing gives a clear error', async () => {
  for (const status of [403, 404]) {
    let calls = 0;
    const fetcher = (async () => { calls++; return new Response('', { status }); }) as typeof fetch;
    await assert.rejects(
      fetchReportPhoto(media(2), {}, { fetcher, ...noDelay }),
      (e: unknown) => e instanceof ReportPhotoError && e.reason === `the server answered ${status}` && e.status === status && e.missing === (status === 404),
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const always = (async () => { calls++; return new Response('', { status: 500 }); }) as typeof fetch;
  const err = (await fetchReportPhoto(media(3), {}, { fetcher: always, ...noDelay }).catch((e: unknown) => e)) as ReportPhotoError;
  assert.equal(calls, 4);
  assert.equal(err.missing, false);
  const msg = photosFailedMessage({ failed: [err], missing: [], pending: () => 0 })!;
  assert.match(msg, /1 photograph could not be loaded \(the server answered 500\), so the report was not made/);
  assert.ok(msg.includes(id(3)));
  assert.ok(!msg.includes('s=abc'), 'the signature is never shown');
  assert.equal(photosFailedMessage({ failed: [], missing: [], pending: () => 0 }), null);
  // A missing photograph alone never stops the report.
  assert.equal(photosFailedMessage({ failed: [], missing: [id(2)], pending: () => 0 }), null);
  assert.match(photosFailedMessage({ failed: [], missing: [], pending: () => 2 })!, /2 photographs were still loading/);
});

test('only media links go through the queue', () => {
  assert.ok(isMediaUrl(media(1)));
  assert.ok(isMediaUrl(`/api/v1/media/${id(1)}`));
  assert.ok(!isMediaUrl('http://api.test/api/v1/inspections/abc'));
  assert.ok(!isMediaUrl(`http://api.test/api/v1/media/${id(1)}x`));
});

/** A real headless browser opening a page of photographs: some fail once, one never loads. Skipped where no browser can start. */
test('in the report browser: photographs load through the queue, a passing failure is retried, a missing one prints as unavailable with a warning, and one that keeps failing stops the report', async (t) => {
  const puppeteer = (await import('puppeteer')).default;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  } catch {
    t.skip('no headless browser here');
    return;
  }
  const seen = new Map<string, number>();
  let now = 0;
  let most = 0;
  const app = express();
  app.get('/api/v1/media/:id', async (req, res) => {
    const n = (seen.get(req.params.id) ?? 0) + 1;
    seen.set(req.params.id, n);
    now++;
    most = Math.max(most, now);
    await new Promise((r) => setTimeout(r, 10));
    now--;
    if (req.query.s !== 'good') return res.status(403).end(); // the signed link is passed on as it was
    if (req.params.id === id(7)) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    if (req.params.id === id(11)) return res.status(503).end(); // never recovers
    if (Number(req.params.id.slice(0, 8)) % 3 === 0 && n === 1) return res.status(400).json({ error: { code: 'DB_REQUEST_ERROR' } });
    res.type('image/png').send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  });
  const ids = Array.from({ length: 40 }, (_, i) => id(i + 1));
  app.get('/page', (_req, res) => res.type('html').send(`<html><body>${ids.map((x) => `<img src="/api/v1/media/${x}?e=1&s=good">`).join('')}</body></html>`));
  const server = await new Promise<import('node:http').Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  try {
    const page = await browser.newPage();
    const warnings: string[] = [];
    const warn = t.mock.method(console, 'warn', (m: string) => { warnings.push(String(m)); });
    const log = await routeReportPhotos(page, 'insp-1');
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/page`, { waitUntil: 'networkidle0', timeout: 60_000 });
    const loaded = (await page.evaluate("[...document.images].map((i) => i.naturalWidth > 0)")) as boolean[];
    warn.mock.restore();
    assert.equal(loaded.filter(Boolean).length, 38);
    assert.equal(loaded[6], false, 'the missing photograph shows as unavailable');
    assert.equal(loaded[10], false);
    assert.ok(most <= REPORT_PHOTO_CONCURRENCY, `at most ${REPORT_PHOTO_CONCURRENCY} at once (saw ${most})`);
    assert.equal(seen.get(id(3)), 2, 'a DB_REQUEST_ERROR was tried again');
    assert.equal(seen.get(id(7)), 1, 'a 404 was not');
    assert.equal(seen.get(id(11)), 4, 'a 503 was tried 4 times');
    // The missing one: listed, warned about with its id, and not a reason to stop the report.
    assert.deepEqual(log.missing, [id(7)]);
    assert.equal(warnings.filter((w) => w.includes(id(7)) && /missing \(404\)/.test(w) && w.includes('insp-1')).length, 1);
    // The one that kept failing: the only failure, and it stops the report.
    assert.deepEqual(log.failed.map((f) => [mediaIdOf(f.url), f.reason]), [[id(11), 'the server answered 503']]);
    assert.equal(log.pending(), 0);
    const msg = photosFailedMessage(log)!;
    assert.match(msg, new RegExp(`1 photograph could not be loaded \\(the server answered 503\\).*${id(11)}`));
    assert.ok(!msg.includes(id(7)));
  } finally {
    server.close();
    await browser.close();
  }
});
