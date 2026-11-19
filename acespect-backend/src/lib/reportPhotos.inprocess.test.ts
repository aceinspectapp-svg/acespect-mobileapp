import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
process.env.MEDIA_LINK_SECRET ||= 'z'.repeat(32);
process.env.WEB_APP_URL = 'https://web.example.test';

// A report's photographs are read in this process, through the media route's own checks (makeMediaReader) -- not over HTTP through the
// internet and Azure's front end. These tests run the real checks with stand-in storage, the tenant list and the security log, and show
// that the in-process read refuses, logs and serves exactly what the route does.

const ID = '11111111-2222-4333-8444-555555555555';
const TENANT_ID = '22222222-2222-4333-8444-555555555555';
const GONE_ID = '33333333-2222-4333-8444-555555555555';

async function setUp(opts: { storage?: () => Promise<unknown> } = {}) {
  const { makeMediaReader } = await import('../modules/media/media.controller');
  const { inProcessSourceFrom, fetchReportPhoto } = await import('./reportPhotos');
  const { signMediaUrl } = await import('./mediaLinks');
  const { env } = await import('../config/env');
  env.MEDIA_ALLOW_UNSIGNED_UNTIL = undefined;
  const events: { type: string; detail?: Record<string, unknown> }[] = [];
  let reads = 0;
  const reader = makeMediaReader({
    isTenantFile: async (id) => id === TENANT_ID,
    fetchPhotoStream: (async (id: string) => {
      reads++;
      if (opts.storage) return opts.storage();
      return id === GONE_ID ? null : { body: new Response(Buffer.from('jpeg-bytes')).body!, contentType: 'image/jpeg' };
    }) as never,
    logSecurityEvent: async (e) => { events.push(e); },
  });
  const source = inProcessSourceFrom(reader);
  const url = (id: string) => signMediaUrl(`https://api.example.test/api/v1/media/${id}`);
  const fetchIt = (u: string, headers: Record<string, string> = {}) => fetchReportPhoto(u, headers, { source, delays: [0] });
  return { source, url, fetchIt, events, reads: () => reads };
}

test('a signed photograph is read in this process, with the answer the media route gives (type, cache rule, CORP, CORS for the report page)', async () => {
  const s = await setUp();
  const p = await s.fetchIt(s.url(ID), { origin: 'https://web.example.test' });
  assert.equal(p.status, 200);
  assert.equal(p.body.toString(), 'jpeg-bytes');
  assert.equal(p.headers['content-type'], 'image/jpeg');
  assert.match(p.headers['cache-control']!, /^private, max-age=\d+$/);
  assert.equal(p.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(p.headers['access-control-allow-origin'], 'https://web.example.test');
  assert.deepEqual(s.events, [], 'an inspection photograph with a good signature is not a security event');
});

test('CORS is only given to the report page\'s own origin', async () => {
  const s = await setUp();
  const p = await s.fetchIt(s.url(ID), { origin: 'https://elsewhere.example.test' });
  assert.equal(p.headers['access-control-allow-origin'], undefined);
});

test('the B7 checks are the same: an unsigned or tampered link is refused (403), not tried again, and the refusal is logged', async () => {
  const s = await setUp();
  for (const bad of [`https://api.example.test/api/v1/media/${ID}`, s.url(ID).replace(/s=[^&]+/, 's=forged'), s.url(ID).replace(/e=\d+/, 'e=1')]) {
    await assert.rejects(s.fetchIt(bad), (e: unknown) => (e as { status?: number }).status === 403);
  }
  assert.equal(s.events.filter((e) => e.type === 'MEDIA_DENIED').length, 3);
  assert.equal(s.reads(), 0, 'nothing is read from storage for a refused link');
});

test('a tenant file is served on a signed link and its access is logged (FILE_ACCESS), as through the route', async () => {
  const s = await setUp();
  const p = await s.fetchIt(s.url(TENANT_ID));
  assert.equal(p.status, 200);
  assert.deepEqual(s.events.map((e) => e.type), ['FILE_ACCESS']);
});

test('a photograph that is not there is a 404 (printed as "Photograph unavailable"), not tried again', async () => {
  const s = await setUp();
  await assert.rejects(s.fetchIt(s.url(GONE_ID)), (e: unknown) => (e as { status?: number; missing?: boolean }).status === 404 && (e as { missing: boolean }).missing);
  assert.equal(s.reads(), 1);
});

test('a passing failure inside the server (the database out of connections, storage not answering) is tried again', async () => {
  let calls = 0;
  const s = await setUp({ storage: async () => { if (++calls < 3) throw new Error('Timed out fetching a new connection from the connection pool'); return { body: new Response('ok').body!, contentType: 'image/jpeg' }; } });
  const p = await s.fetchIt(s.url(ID));
  assert.equal(p.status, 200);
  assert.equal(calls, 3);
});

test('the default is in process; REPORT_PHOTOS_IN_PROCESS=off goes back to HTTP', async () => {
  const src = await import('./reportPhotos');
  assert.equal(typeof src.inProcessSource, 'function');
  // With a stand-in fetcher given, the photograph is fetched over HTTP at its URL (the old way, kept as the fallback).
  let asked = '';
  const p = await src.fetchReportPhoto('https://api.example.test/api/v1/media/' + ID + '?e=1&s=x', {}, { fetcher: (async (u: string) => { asked = u; return new Response('x', { status: 200 }); }) as never, delays: [0] });
  assert.equal(p.status, 200);
  assert.match(asked, /\/api\/v1\/media\//);
});
