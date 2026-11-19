import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryPeak, memoryText, processTreeRss, treeSum } from './reportMemory';

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
