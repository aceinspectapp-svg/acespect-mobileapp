/**
 * Checks how photographs are served back (fetchPhotoStream in lib/storage.ts) against a fake Egnyte that behaves like the real one:
 * about two requests a second, then "429 Spike arrest violation". Run it with a scratch database:
 *
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public npm run check:photo-serving
 *
 * Proves that a burst of photograph requests (what a report page, and so a PDF or Word build, makes) all succeed instead of failing
 * with a 500, that a photograph already fetched is not fetched again, and that requests arriving together share one call.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = 5897;
process.env.EGNYTE_DOMAIN = 'fake';
process.env.EGNYTE_API_TOKEN = 'fake-token';
process.env.EGNYTE_BASE_URL = `http://127.0.0.1:${PORT}`;
process.env.JWT_ACCESS_SECRET ??= 'check-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'check-refresh-secret-0123456789abcdef';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (a scratch database) is required');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7), Buffer.from([0xff, 0xd9])]);
const BIG = Buffer.alloc(5 * 1024 * 1024, 9); // over the size kept in memory

// ---- the fake Egnyte ----------------------------------------------------------------------------------------------------------------
const stamps: number[] = [];
const hits = new Map<string, number>();
let tooMany = 0;
const flakyFirst = new Set<string>();

function egnyte(req: IncomingMessage, res: ServerResponse): void {
  const path = decodeURIComponent((req.url ?? '').split('?')[0]!);
  const name = path.split('/').pop()!.replace(/\.jpg$/, '');
  hits.set(name, (hits.get(name) ?? 0) + 1);
  const now = Date.now();
  while (stamps.length && now - stamps[0]! > 1000) stamps.shift();
  stamps.push(now);
  if (stamps.length > 2) {
    tooMany++;
    res.writeHead(429, { 'Content-Type': 'application/json' }).end('{"errorMessage":"Spike arrest violation"}');
    return;
  }
  if (name.startsWith('missing')) return void res.writeHead(404).end();
  if (name.startsWith('flaky') && !flakyFirst.has(name)) {
    flakyFirst.add(name);
    tooMany++;
    return void res.writeHead(429, { 'Content-Type': 'application/json' }).end('{"errorMessage":"Spike arrest violation"}');
  }
  const body = name.startsWith('big') ? BIG : JPEG;
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': body.length }).end(body);
}

let failures = 0;
const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
};
const read = async (body: ReadableStream): Promise<number> => Buffer.from(await new Response(body).arrayBuffer()).length;

async function main() {
  const server = createServer(egnyte);
  await new Promise<void>((ok) => server.listen(PORT, ok));
  const { fetchPhotoStream, clearPhotoCache } = await import('../lib/storage');
  const { prisma } = await import('../lib/prisma');
  try {
    // 1. a burst of 16 different photographs, all at once (a report page's photographs)
    clearPhotoCache();
    const ids = Array.from({ length: 16 }, (_, i) => `ok-${i}`);
    const t0 = Date.now();
    const settled = await Promise.allSettled(ids.map((id) => fetchPhotoStream(id)));
    const okCount = settled.filter((r) => r.status === 'fulfilled' && r.value && r.value.contentType === 'image/jpeg').length;
    const sizes = await Promise.all(settled.map((r) => (r.status === 'fulfilled' && r.value ? read(r.value.body) : 0)));
    check(okCount === 16, '16 photographs requested at once are all served', `${okCount}/16 in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    check(sizes.every((n) => n === JPEG.length), 'each is the full picture', `${sizes.filter((n) => n === JPEG.length).length}/16`);
    check(tooMany === 0, 'Egnyte is never sent more than its limit (no 429 from the fake)', `${tooMany} rejections`);

    // 2. the same photographs again: from memory, Egnyte is not asked again
    const before = [...hits.values()].reduce((a, b) => a + b, 0);
    const t1 = Date.now();
    const again = await Promise.all(ids.map((id) => fetchPhotoStream(id)));
    const sizes2 = await Promise.all(again.map((r) => (r ? read(r.body) : 0)));
    const after = [...hits.values()].reduce((a, b) => a + b, 0);
    check(again.every((r) => r) && sizes2.every((n) => n === JPEG.length), 'the same 16 photographs again are all served');
    check(after === before, 'a photograph already fetched is not fetched from Egnyte again', `${after - before} new Egnyte calls`);
    check(Date.now() - t1 < 1000, 'and they come back at once', `${Date.now() - t1} ms`);

    // 3. eight requests for one new photograph at the same moment share one Egnyte call
    const sharedBefore = hits.get('ok-shared') ?? 0;
    const shared = await Promise.all(Array.from({ length: 8 }, () => fetchPhotoStream('ok-shared')));
    const sharedSizes = await Promise.all(shared.map((r) => (r ? read(r.body) : 0)));
    check(shared.every((r) => r) && sharedSizes.every((n) => n === JPEG.length), '8 simultaneous requests for one photograph are all served');
    check((hits.get('ok-shared') ?? 0) - sharedBefore === 1, 'they share a single Egnyte call', `${(hits.get('ok-shared') ?? 0) - sharedBefore} calls`);

    // 4. a photograph that is not there: null (404 for the caller), and not remembered
    check((await fetchPhotoStream('missing-1')) === null, 'a missing photograph returns null');
    const missingBefore = hits.get('missing-1') ?? 0;
    await fetchPhotoStream('missing-1');
    check((hits.get('missing-1') ?? 0) - missingBefore === 1, 'a missing photograph is not remembered (asked again next time)');

    // 5. Egnyte says "too many requests" once: it is waited out and retried, not turned into a failure
    const flaky = await fetchPhotoStream('flaky-1');
    check(!!flaky && (await read(flaky.body)) === JPEG.length, 'a "429 Spike arrest" from Egnyte is waited out and the photograph is served', `${hits.get('flaky-1')} calls`);

    // 6. a large file is streamed through and not kept in memory
    const big1 = await fetchPhotoStream('big-1');
    check(!!big1 && (await read(big1.body)) === BIG.length, 'a large file is served whole');
    const bigBefore = hits.get('big-1') ?? 0;
    const big2 = await fetchPhotoStream('big-1');
    check(!!big2 && (await read(big2.body)) === BIG.length && (hits.get('big-1') ?? 0) - bigBefore === 1, 'a large file is not kept in memory (fetched again)');
  } finally {
    server.close();
    await prisma.$disconnect();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
