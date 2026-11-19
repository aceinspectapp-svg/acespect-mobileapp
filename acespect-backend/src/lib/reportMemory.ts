import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { freemem, getPriority, setPriority, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * How much memory a report takes while it is made: this server (Node) and its headless browser (Chromium and all its child processes),
 * sampled once a second, with the highest combined figure kept. It goes on the report's timing line in the log, e.g.
 *   … · memory peak 1180 MB (server 410 MB + browser 770 MB) of 1750 MB
 * so a small App Service plan (B1: 1.75 GB) can be checked for how close a large report comes to running out.
 */

const MB = 1024 * 1024;

type Proc = { pid: number; ppid: number; rss: number };

/** Resident memory of a process and every process under it, in bytes (Linux: /proc; macOS: ps). 0 when it cannot be read. */
export function processTreeRss(rootPid: number | undefined, platform: NodeJS.Platform = process.platform): number {
  if (!rootPid) return 0;
  const procs = processList(platform);
  return procs ? treeSum(procs, rootPid) : 0;
}

/** The ids of a process and every process under it (the browser and its renderers). Empty when they cannot be read. */
export function processTreePids(rootPid: number | undefined, platform: NodeJS.Platform = process.platform): number[] {
  if (!rootPid) return [];
  const procs = processList(platform);
  return procs ? treePids(procs, rootPid) : [];
}

/** Every process on this machine with its parent and resident memory (Linux: /proc; macOS: ps), or null when they cannot be read. */
function processList(platform: NodeJS.Platform): Proc[] | null {
  try {
    const procs: Proc[] = [];
    if (platform === 'linux') {
      const page = 4096;
      for (const name of readdirSync('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        try {
          // /proc/<pid>/stat: "pid (comm) state ppid …" -- comm can contain spaces, so read after its closing bracket.
          const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
          const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
          const rssPages = Number(readFileSync(`/proc/${name}/statm`, 'utf8').split(' ')[1]);
          procs.push({ pid: Number(name), ppid, rss: rssPages * page });
        } catch {
          /* the process ended while being read */
        }
      }
    } else if (platform === 'darwin') {
      for (const line of execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).split('\n')) {
        const [pid, ppid, rssKb] = line.trim().split(/\s+/).map(Number);
        if (pid) procs.push({ pid, ppid: ppid ?? 0, rss: (rssKb ?? 0) * 1024 });
      }
    } else {
      return null;
    }
    return procs;
  } catch {
    return null;
  }
}

/** `rootPid` and all its descendants, from a process list. */
export function treePids(procs: { pid: number; ppid: number }[], rootPid: number): number[] {
  const children = new Map<number, number[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    stack.push(...(children.get(pid) ?? []));
  }
  return out;
}

/**
 * Gives the report browser (and every process it has started) a lower CPU priority than this server, so on a 1-CPU plan the API -- phone
 * uploads, syncs, web pages -- is served first and the report takes the CPU time that is left. `nice` 0..19 (higher = lower priority);
 * a process is only ever lowered, never raised. Returns how many processes were changed. Linux and macOS; elsewhere it does nothing.
 */
export function lowerPriority(
  rootPid: number | undefined,
  nice: number,
  os: { pids: (root: number) => number[]; get: (pid: number) => number; set: (pid: number, nice: number) => void } = { pids: (r) => processTreePids(r), get: getPriority, set: setPriority },
): number {
  if (!rootPid || nice <= 0) return 0;
  let changed = 0;
  for (const pid of os.pids(rootPid)) {
    try {
      if (os.get(pid) < nice) { os.set(pid, nice); changed++; }
    } catch {
      /* the process ended meanwhile, or this platform does not allow it */
    }
  }
  return changed;
}

/**
 * Memory this machine (or its container's limit) still has free, in MB: Linux's MemAvailable, and the container's own limit when it has one
 * (cgroup v2 memory.max / v1 memory.limit_in_bytes), whichever is less. Null where it cannot be told reliably (macOS, Windows): the memory
 * guard then stays off.
 */
export function freeMemoryMb(
  read: (path: string) => string | null = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } },
  platform: NodeJS.Platform = process.platform,
): number | null {
  if (platform !== 'linux') return null;
  const meminfo = read('/proc/meminfo');
  const avail = meminfo ? /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo) : null;
  let free = avail ? Number(avail[1]) / 1024 : null;
  const limits: [string, string][] = [['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory.current'], ['/sys/fs/cgroup/memory/memory.limit_in_bytes', '/sys/fs/cgroup/memory/memory.usage_in_bytes']];
  for (const [limitPath, usedPath] of limits) {
    const limit = Number((read(limitPath) ?? '').trim());
    const used = Number((read(usedPath) ?? '').trim());
    // "max" (no limit) or a v1 "unlimited" of ~2^63 reads as no limit.
    if (Number.isFinite(limit) && limit > 0 && limit < 2 ** 50 && Number.isFinite(used) && used > 0) {
      const left = (limit - used) / MB;
      free = free === null ? left : Math.min(free, left);
      break;
    }
  }
  return free === null ? null : Math.round(free);
}

/** How much the event loop (this server's one thread, which answers every request) was held up while a report was made. */
export class LoopDelay {
  private readonly h = monitorEventLoopDelay({ resolution: 20 });
  constructor() { this.h.enable(); }
  stop(): { p99Ms: number; maxMs: number } {
    this.h.disable();
    return { p99Ms: Math.round(this.h.percentile(99) / 1e6), maxMs: Math.round(this.h.max / 1e6) };
  }
}

/** The memory of `rootPid` and all its descendants, from a process list. */
export function treeSum(procs: { pid: number; ppid: number; rss: number }[], rootPid: number): number {
  const children = new Map<number, number[]>();
  for (const p of procs) children.set(p.ppid, [...(children.get(p.ppid) ?? []), p.pid]);
  const rss = new Map(procs.map((p) => [p.pid, p.rss]));
  let total = 0;
  const seen = new Set<number>();
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    total += rss.get(pid) ?? 0;
    stack.push(...(children.get(pid) ?? []));
  }
  return total;
}

export interface MemoryPeakResult { serverMb: number; browserMb: number; totalMb: number; machineMb: number }

/** Samples this server's and the browser's memory every `everyMs` until stopped; keeps the sample with the highest total. */
export class MemoryPeak {
  private peak = { server: 0, browser: 0 };
  private readonly timer: NodeJS.Timeout;
  constructor(
    private readonly browserPid: number | undefined,
    everyMs = 1000,
    private readonly read: { server: () => number; browser: (pid: number | undefined) => number } = { server: () => process.memoryUsage().rss, browser: (pid) => processTreeRss(pid) },
  ) {
    this.sample();
    this.timer = setInterval(() => this.sample(), everyMs);
    this.timer.unref();
  }
  sample(): void {
    const server = this.read.server(), browser = this.read.browser(this.browserPid);
    if (server + browser > this.peak.server + this.peak.browser) this.peak = { server, browser };
  }
  stop(): MemoryPeakResult {
    this.sample();
    clearInterval(this.timer);
    const serverMb = Math.round(this.peak.server / MB), browserMb = Math.round(this.peak.browser / MB);
    return { serverMb, browserMb, totalMb: serverMb + browserMb, machineMb: Math.round(totalmem() / MB) };
  }
}

/** The machine's memory, in MB (for the log). */
export const machineMb = (): { totalMb: number; freeMb: number } => ({ totalMb: Math.round(totalmem() / MB), freeMb: Math.round(freemem() / MB) });

/** The timing line's memory part. */
export const memoryText = (m: MemoryPeakResult): string =>
  `memory peak ${m.totalMb} MB (server ${m.serverMb} MB + browser ${m.browserMb} MB) of ${m.machineMb} MB`;
