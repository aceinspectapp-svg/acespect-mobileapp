import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
process.env.REPORT_BROWSER_IDLE_SECONDS = '0.05';
process.env.REPORT_BROWSER_MAX_REPORTS = '3';

/** A stand-in for puppeteer's Browser: counts launches, contexts opened and closed. */
function fakeBrowsers() {
  const made: { closed: boolean; contexts: number; open: number }[] = [];
  const launch = async () => {
    const rec = { closed: false, contexts: 0, open: 0 };
    made.push(rec);
    const b = Object.assign(new EventEmitter(), {
      get connected() { return !rec.closed; },
      process: () => ({ pid: undefined }),
      createBrowserContext: async () => {
        rec.contexts++; rec.open++;
        return { close: async () => { rec.open--; }, newPage: async () => ({}) };
      },
      close: async () => { rec.closed = true; b.emit('disconnected'); },
    });
    return b as never;
  };
  return { made, launch };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('one browser serves report after report (no start-up cost), each in a context of its own that is closed after', async () => {
  const { leaseReportBrowser, closeReportBrowser } = await import('./reportBrowser');
  const f = fakeBrowsers();
  const a = await leaseReportBrowser(f.launch);
  assert.equal(a.warm, false, 'the first report starts the browser');
  await a.release();
  const b = await leaseReportBrowser(f.launch);
  assert.equal(b.warm, true, 'the next one finds it running');
  await b.release();
  assert.equal(f.made.length, 1);
  assert.equal(f.made[0]!.contexts, 2);
  assert.equal(f.made[0]!.open, 0, 'every report\'s context is closed');
  await closeReportBrowser();
});

test('two reports at once share the browser, each with its own context', async () => {
  const { leaseReportBrowser, closeReportBrowser } = await import('./reportBrowser');
  const f = fakeBrowsers();
  const [a, b] = await Promise.all([leaseReportBrowser(f.launch), leaseReportBrowser(f.launch)]);
  assert.equal(f.made.length, 1, 'started once, not twice');
  assert.notEqual(a.context, b.context);
  await a.release();
  assert.equal(f.made[0]!.closed, false, 'kept while the other report still uses it');
  await b.release();
  await closeReportBrowser();
});

test('the browser is closed after the idle time, so its memory goes back to the server', async () => {
  const { leaseReportBrowser, reportBrowserState } = await import('./reportBrowser');
  const f = fakeBrowsers();
  const a = await leaseReportBrowser(f.launch);
  await a.release();
  assert.equal(reportBrowserState().running, true);
  await sleep(120);
  assert.equal(f.made[0]!.closed, true);
  assert.equal(reportBrowserState().running, false);
});

test('after REPORT_BROWSER_MAX_REPORTS reports, and after a crash, a fresh browser is started', async () => {
  const { leaseReportBrowser, closeReportBrowser } = await import('./reportBrowser');
  const f = fakeBrowsers();
  for (let i = 0; i < 3; i++) await (await leaseReportBrowser(f.launch)).release();
  assert.equal(f.made.length, 1);
  assert.equal(f.made[0]!.closed, true, 'closed once it has done its share');
  const next = await leaseReportBrowser(f.launch);
  assert.equal(f.made.length, 2);
  await next.release();
  // A crash (the browser goes away): the next report starts a new one.
  await closeReportBrowser();
  const after = await leaseReportBrowser(f.launch);
  assert.equal(after.warm, false);
  assert.equal(f.made.length, 3);
  await after.release();
  await closeReportBrowser();
});

test('a browser that cannot open a context is closed and the error reaches the report', async () => {
  const { leaseReportBrowser, reportBrowserState } = await import('./reportBrowser');
  const f = fakeBrowsers();
  const broken = async () => {
    const b = await f.launch();
    (b as unknown as { createBrowserContext: () => Promise<never> }).createBrowserContext = async () => { throw new Error('Target closed'); };
    return b;
  };
  await assert.rejects(leaseReportBrowser(broken), /Target closed/);
  assert.equal(reportBrowserState().running, false);
});

test('a real browser (when this machine has one): the second report reuses it, and a context does not see another\'s sign-in', async (t) => {
  const { leaseReportBrowser, closeReportBrowser } = await import('./reportBrowser');
  let a;
  try {
    a = await leaseReportBrowser();
  } catch {
    t.skip('no Chrome on this machine');
    return;
  }
  // A small page on this machine, as the report page is: what one report's page keeps (its sign-in in localStorage) must not reach the next.
  const http = await import('node:http');
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<p>report</p>'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const page = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/`;
  try {
    const p1 = await a.context.newPage();
    await p1.goto(page);
    await p1.evaluate(() => { localStorage.setItem('acespect_token', 'first-report'); });
    await a.release();
    const b = await leaseReportBrowser();
    assert.equal(b.warm, true);
    const p2 = await b.context.newPage();
    await p2.goto(page);
    assert.equal(await p2.evaluate(() => localStorage.getItem('acespect_token')), null);
    await b.release();
  } finally {
    server.close();
    await closeReportBrowser();
  }
});
