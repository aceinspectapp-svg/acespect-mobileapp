import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { totalmem } from 'node:os';

/**
 * How much memory a report takes while it is made: this server (Node) and its headless browser (Chromium and all its child processes),
 * sampled once a second, with the highest combined figure kept. It goes on the report's timing line in the log, e.g.
 *   … · memory peak 1180 MB (server 410 MB + browser 770 MB) of 1750 MB
 * so a small App Service plan (B1: 1.75 GB) can be checked for how close a large report comes to running out.
 */

const MB = 1024 * 1024;

/** Resident memory of a process and every process under it, in bytes (Linux: /proc; macOS: ps). 0 when it cannot be read. */
export function processTreeRss(rootPid: number | undefined, platform: NodeJS.Platform = process.platform): number {
  if (!rootPid) return 0;
  try {
    const procs: { pid: number; ppid: number; rss: number }[] = [];
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
      return 0;
    }
    return treeSum(procs, rootPid);
  } catch {
    return 0;
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

/** The timing line's memory part. */
export const memoryText = (m: MemoryPeakResult): string =>
  `memory peak ${m.totalMb} MB (server ${m.serverMb} MB + browser ${m.browserMb} MB) of ${m.machineMb} MB`;
