import puppeteer, { type Browser, type BrowserContext } from 'puppeteer';
import { reportBrowserPath } from './reportBrowserSetup';
import { freeMemoryMb, lowerPriority } from './reportMemory';

/**
 * The headless browser the PDF and Word reports are printed with, shared by every report this server makes.
 *
 * Each report used to start a browser of its own: 12-24 s of a 1-CPU plan's only CPU before the report even began (Azure timing logs), the
 * same again for the Word file after the PDF. Now one browser is started when a report needs it and kept for REPORT_BROWSER_IDLE_SECONDS
 * (default 120) after the last report, then closed so its memory goes back to the API. Each report gets a browser context of its own
 * (separate storage, its own sign-in, nothing shared with another report) that is closed when the report is done.
 *
 * The browser and everything it starts run at a lower CPU priority (REPORT_BROWSER_NICE, default 10; 0 = as the server), so the API's own
 * requests -- phone uploads and syncs, web pages -- are served first and the report gets the CPU time that is left. The browser is started
 * afresh after REPORT_BROWSER_MAX_REPORTS reports (default 25), and at once if it crashes, so nothing it leaks lasts.
 */

const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
export const BROWSER_IDLE_MS = Math.max(0, num(process.env.REPORT_BROWSER_IDLE_SECONDS, 120)) * 1000;
export const BROWSER_NICE = Math.min(19, Math.max(0, num(process.env.REPORT_BROWSER_NICE, 10)));
const MAX_REPORTS = Math.max(1, num(process.env.REPORT_BROWSER_MAX_REPORTS, 25));
/** When the machine has less free than this after a report, the browser is closed at once instead of being kept. */
const KEEP_ONLY_ABOVE_FREE_MB = Math.max(0, num(process.env.REPORT_BROWSER_KEEP_FREE_MB, 400));

/** The browser's start-up flags: no sandbox (containers), /tmp instead of a 64 MB /dev/shm, and nothing a report does not use. */
export const BROWSER_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter', '--no-zygote',
  // Nothing in the background: no GPU process, extensions, sync, component updates, field trials or audio.
  '--disable-gpu', '--disable-extensions', '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
  '--disable-sync', '--no-first-run', '--mute-audio', '--metrics-recording-only', '--disable-field-trial-config',
];

export type Launch = () => Promise<Browser>;

/** Starts the browser as the reports always have (the Chrome set up on App Service, the Docker image's, or puppeteer's own). */
export const launchReportBrowser: Launch = async () =>
  puppeteer.launch({
    headless: true,
    // Chromium writes its profile and crash-reporter database under HOME / XDG folders. On a cloud container (Azure App Service)
    // those can be unset or read-only, and Chromium then exits at once ("chrome_crashpad_handler: --database is required"), so it is
    // pointed at /tmp, which is always writable. Locally (Windows, macOS) the defaults are left alone.
    env: process.platform === 'linux'
      ? { ...process.env, HOME: process.env.HOME || '/tmp', XDG_CONFIG_HOME: '/tmp/.chromium', XDG_CACHE_HOME: '/tmp/.chromium' }
      : process.env,
    // --disable-dev-shm-usage: containers (Azure App Service included) give /dev/shm only 64 MB, which a long report with many photos
    // overruns, crashing the page part-way ("Target closed"); Chromium then uses /tmp instead.
    args: BROWSER_ARGS,
    // The Docker image's own chromium (PUPPETEER_EXECUTABLE_PATH), the Chrome set up at start-up on App Service (reportBrowserSetup.ts),
    // or, locally, the one `npm install` downloaded.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (await reportBrowserPath()) || undefined,
  });

interface Shared { browser: Browser; reports: number; inUse: number; idle?: NodeJS.Timeout; warm: boolean }
let shared: Shared | null = null;
let starting: Promise<Shared> | null = null;

/** A report's own part of the shared browser: its context, whether the browser was already running, and its process id (for the log). */
export interface ReportBrowserLease {
  context: BrowserContext;
  /** True when the browser was already running (no start-up cost for this report). */
  warm: boolean;
  pid: number | undefined;
  /** Closes the report's context and hands the browser back (closed now, or after the idle time). */
  release(): Promise<void>;
}

async function start(launch: Launch): Promise<Shared> {
  const browser = await launch();
  const s: Shared = { browser, reports: 0, inUse: 0, warm: false };
  browser.on('disconnected', () => { if (shared === s) shared = null; });
  lowerPriority(browser.process()?.pid, BROWSER_NICE);
  return s;
}

async function closeShared(s: Shared): Promise<void> {
  if (shared === s) shared = null;
  if (s.idle) clearTimeout(s.idle);
  await s.browser.close().catch(() => undefined);
}

/** A browser context for one report, on the shared browser (started if it is not running). `launch` is for tests. */
export async function leaseReportBrowser(launch: Launch = launchReportBrowser): Promise<ReportBrowserLease> {
  let s = shared && shared.browser.connected && shared.reports < MAX_REPORTS ? shared : null;
  if (!s) {
    // A browser that has done its share (or crashed) is closed once the reports using it are done; a new one is started for this report.
    const old = shared;
    shared = null;
    if (old && old.inUse === 0) void closeShared(old);
    starting ??= start(launch).finally(() => { starting = null; });
    s = await starting;
    shared ??= s;
  } else {
    s.warm = true;
  }
  const warm = s.warm;
  if (s.idle) { clearTimeout(s.idle); s.idle = undefined; }
  s.inUse++;
  s.reports++;
  let context: BrowserContext;
  try {
    context = await s.browser.createBrowserContext();
  } catch (e) {
    s.inUse--;
    await closeShared(s);
    throw e;
  }
  // Renderers started since launch inherit the browser's priority; anything that did not is lowered now.
  lowerPriority(s.browser.process()?.pid, BROWSER_NICE);
  let released = false;
  return {
    context,
    warm,
    pid: s.browser.process()?.pid,
    async release() {
      if (released) return;
      released = true;
      await context.close().catch(() => undefined);
      s.inUse--;
      if (s.inUse > 0) return;
      const free = freeMemoryMb();
      const lowOnMemory = free !== null && free < KEEP_ONLY_ABOVE_FREE_MB;
      if (shared !== s || BROWSER_IDLE_MS === 0 || lowOnMemory || s.reports >= MAX_REPORTS || !s.browser.connected) {
        await closeShared(s);
        return;
      }
      s.idle = setTimeout(() => { if (s.inUse === 0) void closeShared(s); }, BROWSER_IDLE_MS);
      s.idle.unref();
    },
  };
}

/** Whether a shared browser is running, and how many reports are using it (tests and the health check). */
export function reportBrowserState(): { running: boolean; inUse: number; reports: number } {
  return { running: !!shared, inUse: shared?.inUse ?? 0, reports: shared?.reports ?? 0 };
}

/** Closes the shared browser now (server shut-down, tests). */
export async function closeReportBrowser(): Promise<void> {
  if (shared) await closeShared(shared);
}
