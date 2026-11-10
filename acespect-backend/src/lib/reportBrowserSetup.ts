import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Chrome for the PDF and Word reports on Azure App Service.
 *
 * The App Service runs this backend as plain Node code (not the Dockerfile, which installs Alpine's chromium), and its Node image has
 * neither Chrome nor the Linux libraries Chrome needs. Anything outside /home is also wiped whenever the container restarts. So on
 * App Service, at start-up and in the background:
 *   - Chrome itself (the build this puppeteer version expects) is downloaded once into /home, which persists, and re-used after that;
 *   - its system libraries are installed with apt (Chrome's own list of Debian packages), again on every start.
 * Report printing then uses that Chrome. Anywhere else -- local development, the Docker image (PUPPETEER_EXECUTABLE_PATH) -- nothing
 * changes and puppeteer finds its browser as before.
 */

/** App Service sets WEBSITE_SITE_NAME; an explicit PUPPETEER_EXECUTABLE_PATH (the Docker image) always wins. */
const onAppService = () => !!process.env.WEBSITE_SITE_NAME && !process.env.PUPPETEER_EXECUTABLE_PATH;

/** Kept under /home so the ~150 MB download survives restarts. */
const CACHE_DIR = process.env.REPORT_BROWSER_CACHE_DIR || '/home/.cache/puppeteer';

function run(cmd: string, args: string[], extraEnv: Record<string, string> = {}, timeoutMs = 10 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}: ${(err || out).trim().slice(-2000)}`));
    });
  });
}

async function setUp(): Promise<string> {
  const started = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[report] browser setup: installing Chrome and its system libraries (cache ${CACHE_DIR})`);
  // Chrome's installer below uses `apt-get satisfy`, which needs apt's package index; the image ships without one.
  if (process.platform === 'linux') await run('apt-get', ['update', '-qq']);
  const cli = require.resolve('puppeteer/lib/puppeteer/node/cli.js');
  const out = await run(process.execPath, [cli, 'browsers', 'install', 'chrome', '--install-deps', '--format', '{{path}}'], { PUPPETEER_CACHE_DIR: CACHE_DIR });
  const path = out.trim().split('\n').pop()?.trim() ?? '';
  if (!path || !existsSync(path)) throw new Error(`Chrome was installed but its program was not found (installer said: ${out.trim().slice(-500)})`);
  // eslint-disable-next-line no-console
  console.log(`[report] browser setup: ready in ${Math.round((Date.now() - started) / 1000)}s (${path})`);
  return path;
}

let ready: Promise<string | null> | null = null;

/**
 * The Chrome to print reports with: its path on App Service (waiting for the set-up if it is still running), or null elsewhere, meaning
 * "puppeteer's default". A failed set-up is logged and tried again on the next report.
 */
export function reportBrowserPath(): Promise<string | null> {
  if (!onAppService()) return Promise.resolve(null);
  ready ??= setUp().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[report] browser setup failed:', e);
    ready = null;
    return null;
  });
  return ready;
}
