import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

// The whole app (createApp), as it runs on Azure, with the web app on another origin. The database is unreachable on purpose (port 1),
// so a signed-in request fails inside the server: that is the 500 case.
const WEB = 'https://web.example.test';
process.env.NODE_ENV = 'test';
process.env.CORS_ORIGIN = WEB;
process.env.DATABASE_URL = 'postgresql://x:x@127.0.0.1:1/x?connect_timeout=2';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);

const INSP = '11111111-2222-4333-8444-555555555555';
const JOB = '99999999-2222-4333-8444-555555555555';
let server: Server, base = '';

// The server's own log lines (rejections, the unreachable database -- some written after the last test) are not what these tests look at;
// this file runs in its own process, so they are silenced for all of it.
before(async () => {
  console.log = console.warn = console.error = () => undefined;
  const { createApp } = await import('../../app');
  server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/inspections/${INSP}/report-jobs`;
});
after(() => server?.close());

/** A request from the web app's origin, as the browser sends it. */
const fromWeb = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { Origin: WEB, ...(init.headers as Record<string, string>) } });

/** The browser shows an error's message only if the reply allows the web app's origin. */
async function assertReadable(res: Response, status: number, code?: string) {
  assert.equal(res.status, status);
  assert.equal(res.headers.get('access-control-allow-origin'), WEB, 'the error reply carries the CORS header, so the page can read it');
  assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  const body = (await res.json()) as { error?: { message?: string; code?: string } };
  assert.ok(body?.error?.message, 'the reply says what went wrong');
  if (code) assert.equal(body.error.code, code);
}

test('starting a report without signing in: 401 that the web app can read', async () => {
  await assertReadable(await fromWeb(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"format":"docx"}' }), 401, 'NO_TOKEN');
});

test('asking how a job is going with an expired login: 401 TOKEN_EXPIRED that the web app can read (so it can renew and ask again)', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const expired = jwt.sign({ sub: 'u1', role: 'REVIEWER', tv: 0, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_ACCESS_SECRET!);
  await assertReadable(await fromWeb(`${base}/${JOB}`, { headers: { Authorization: `Bearer ${expired}` } }), 401, 'TOKEN_EXPIRED');
  await assertReadable(await fromWeb(`${base}/${JOB}/file`, { headers: { Authorization: `Bearer ${expired}` } }), 401, 'TOKEN_EXPIRED');
});

test('a server error on a report-jobs route (here: the database is down) is a 500 the web app can read', async () => {
  const { signAccessToken } = await import('../../utils/jwt');
  const token = signAccessToken({ sub: 'u1', role: 'REVIEWER', tv: 0 });
  await assertReadable(await fromWeb(`${base}/${JOB}`, { headers: { Authorization: `Bearer ${token}` } }), 500, 'INTERNAL_ERROR');
});

test('a report-jobs address that does not exist: 404 the web app can read', async () => {
  await assertReadable(await fromWeb(`${base}/${JOB}/nothing-here`), 404);
});

test('the browser\'s preflight for a report job is allowed, and Retry-After can be read by the page', async () => {
  const res = await fromWeb(base, { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), WEB);
  assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/);
  const got = await fromWeb(base, { method: 'POST' });
  assert.match(got.headers.get('access-control-expose-headers') ?? '', /Retry-After/);
});

test('another origin is not allowed (the header is not given to it)', async () => {
  const res = await fetch(base, { method: 'POST', headers: { Origin: 'https://elsewhere.example.test' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
