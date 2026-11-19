import test from 'node:test';
import assert from 'node:assert/strict';
import { LoopDelay, MemoryPeak, freeMemoryMb, lowerPriority, memoryText, processTreePids, processTreeRss, treePids, treeSum } from './reportMemory';

// The memory guard test loads reportPdf.ts, which reads the server's settings.
process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);

const MB = 1024 * 1024;

test('the browser is counted with all its child processes, and nothing else', () => {
  const procs = [
    { pid: 1, ppid: 0, rss: 999 * MB }, // not part of the browser
    { pid: 10, ppid: 1, rss: 100 * MB }, // the browser
    { pid: 11, ppid: 10, rss: 200 * MB }, // its renderer
    { pid: 12, ppid: 10, rss: 50 * MB }, // its GPU / utility process
    { pid: 13, ppid: 11, rss: 5 * MB }, // a grandchild
  ];
  assert.equal(treeSum(procs, 10), 355 * MB);
  assert.equal(treeSum(procs, 42), 0, 'a browser that has gone counts as nothing');
});

test('the peak is the sample with the highest server + browser total', () => {
  const samples = [
    { server: 300, browser: 200 },
    { server: 420, browser: 760 }, // the peak (1180)
    { server: 500, browser: 300 },
  ];
  let i = 0;
  const peak = new MemoryPeak(123, 60_000, { server: () => samples[Math.min(i, 2)]!.server * MB, browser: () => samples[Math.min(i, 2)]!.browser * MB });
  i = 1; peak.sample();
  i = 2; peak.sample();
  const r = peak.stop();
  assert.equal(r.serverMb, 420);
  assert.equal(r.browserMb, 760);
  assert.equal(r.totalMb, 1180);
  assert.ok(r.machineMb > 0);
  assert.match(memoryText(r), /^memory peak 1180 MB \(server 420 MB \+ browser 760 MB\) of \d+ MB$/);
});

test('this process can be measured on this machine (Linux and macOS)', () => {
  if (process.platform !== 'linux' && process.platform !== 'darwin') return;
  assert.ok(processTreeRss(process.pid) > 10 * MB);
  assert.equal(processTreeRss(undefined), 0);
});

test('the browser\'s whole process tree is found (to lower its priority)', () => {
  const procs = [{ pid: 1, ppid: 0 }, { pid: 10, ppid: 1 }, { pid: 11, ppid: 10 }, { pid: 12, ppid: 11 }, { pid: 20, ppid: 1 }];
  assert.deepEqual(treePids(procs, 10).sort(), [10, 11, 12]);
  if (process.platform === 'linux' || process.platform === 'darwin') assert.ok(processTreePids(process.pid).includes(process.pid));
});

test('the report browser and its children are lowered to the given priority, never raised', () => {
  const nice = new Map([[10, 0], [11, 0], [12, 15]]);
  const changed = lowerPriority(10, 10, { pids: () => [10, 11, 12], get: (p) => nice.get(p)!, set: (p, n) => { nice.set(p, n); } });
  assert.equal(changed, 2);
  assert.deepEqual([...nice.values()], [10, 10, 15], 'the one already lower stays as it is');
  assert.equal(lowerPriority(10, 0, { pids: () => [10], get: () => 0, set: () => { throw new Error('not called'); } }), 0, '0 = off');
  assert.equal(lowerPriority(10, 10, { pids: () => [10, 11], get: () => 0, set: (p) => { if (p === 10) throw new Error('gone'); } }), 1, 'a process that ended is skipped');
});

test('free memory: MemAvailable, or the container\'s own limit when that leaves less; null where it cannot be told', () => {
  const files = (f: Record<string, string>) => (p: string) => f[p] ?? null;
  const meminfo = 'MemTotal:        1835008 kB\nMemFree:          100000 kB\nMemAvailable:     512000 kB\n';
  assert.equal(freeMemoryMb(files({ '/proc/meminfo': meminfo }), 'linux'), 500);
  // cgroup v2: a 1.75 GB limit with 1.6 GB used leaves 150 MB, less than MemAvailable.
  assert.equal(freeMemoryMb(files({ '/proc/meminfo': meminfo, '/sys/fs/cgroup/memory.max': String(1792 * 1048576), '/sys/fs/cgroup/memory.current': String(1642 * 1048576) }), 'linux'), 150);
  // cgroup v2 with no limit ("max"): MemAvailable.
  assert.equal(freeMemoryMb(files({ '/proc/meminfo': meminfo, '/sys/fs/cgroup/memory.max': 'max', '/sys/fs/cgroup/memory.current': '1' }), 'linux'), 500);
  // cgroup v1.
  assert.equal(freeMemoryMb(files({ '/proc/meminfo': meminfo, '/sys/fs/cgroup/memory/memory.limit_in_bytes': String(1000 * 1048576), '/sys/fs/cgroup/memory/memory.usage_in_bytes': String(900 * 1048576) }), 'linux'), 100);
  assert.equal(freeMemoryMb(files({}), 'darwin'), null);
});

test('the event loop delay is measured while a report is made', async () => {
  const d = new LoopDelay();
  await new Promise((r) => setTimeout(r, 50)); // the sampling timer is running
  const until = Date.now() + 120;
  while (Date.now() < until) { /* hold the thread, as a blocking step would */ }
  await new Promise((r) => setTimeout(r, 30));
  const r = d.stop();
  assert.ok(r.maxMs >= 80, `max ${r.maxMs} ms`);
});

test('the memory guard stops a report when free memory falls below the floor, once; off where memory cannot be told', async () => {
  const { MemoryGuard, reportMemoryError } = await import('./reportPdf');
  let free = 600;
  const low: number[] = [];
  const g = new MemoryGuard((mb) => low.push(mb), 150, () => free, 5);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(low, []);
  free = 120;
  await new Promise((r) => setTimeout(r, 20));
  free = 90;
  await new Promise((r) => setTimeout(r, 20));
  g.stop();
  assert.deepEqual(low, [120], 'called once, with what was left');
  assert.equal(g.tripped, 120);
  const offCalls: number[] = [];
  const off = new MemoryGuard((mb) => offCalls.push(mb), 150, () => null, 5);
  await new Promise((r) => setTimeout(r, 20));
  off.stop();
  assert.equal(off.tripped, null);
  assert.equal(offCalls.length, 0);
  const e = reportMemoryError(120);
  assert.equal(e.statusCode, 503);
  assert.equal(e.code, 'REPORT_MEMORY');
  assert.match(e.message, /running out of memory \(120 MB left\).*keeps answering everyone else/);
});
