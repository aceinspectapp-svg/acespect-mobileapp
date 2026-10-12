import puppeteer, { type Page } from 'puppeteer';
import { env } from '../config/env';
import { HOUSPECT_LOGO_DATA_URI } from './assets/houspectLogoBase64';

/**
 * Renders the inspection report to a real PDF by pointing a headless browser
 * at the exact same `/report/:id` page a reviewer already sees on the web
 * app, then calling `page.pdf()` -- reusing the live React report instead of
 * re-building its layout a second time in a PDF-specific API, so a future
 * layout tweak never has two places to update.
 *
 * `page.pdf()` renders using the print CSS media type by default, which is
 * exactly why `src/index.css`'s `@media print` block (hiding the toolbar,
 * forcing page breaks between the cover/scope/body) already applies with no
 * separate print-only route needed.
 */

export const BRAND_NAVY = '#1b3a6b'; // the one navy of the whole report (its cover, bands, footer)
export const BRAND_RED = '#d1262b';
const MARGIN_H = '22mm'; // wider side margins than before, matching the reference

// Acespect Pty Ltd trades AS Houspect Victoria -- this is this business's
// own real identity on the report, not a third party's. Real details taken
// straight off Houspect Victoria's own master report template's footer.
export const COMPANY_NAME = 'Acespect Pty Ltd trading as Houspect Victoria';
export const COMPANY_ABN_ACN = 'ABN 24 237 148 557 ACN 688 819 712';
// Puppeteer's header/footer templates are their own isolated, unscripted
// document -- values from the page being printed (client name, job no) have
// to be baked into the template's own HTML string before it's handed to
// page.pdf(), so this escapes them the same way React would.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Puppeteer's header/footer templates are plain, unscripted HTML -- no access
// to the report's own React components or this server's filesystem paths, so
// the real logo is inlined as a data URI (see assets/houspectLogoBase64.ts)
// rather than referenced by URL. Sized and positioned to match the
// reference's own larger, lower-sitting logo (the previous size read as a
// visibly different, much smaller logo next to the reference).
const HEADER_TEMPLATE = `
  <div style="width:100%; font-family: Arial, Helvetica, sans-serif; padding: 4mm ${MARGIN_H} 0; box-sizing: border-box;">
    <div style="display:flex; justify-content:flex-end;">
      <img src="${HOUSPECT_LOGO_DATA_URI}" style="height:20mm; width:auto; display:block;" />
    </div>
  </div>
`;

// The footer of every report, as in the Houspect Lock-up Report design sample: a thin rule, then Client / Date (the
// inspection date) / Job No / Page, the company details, and a red and a navy bar along the bottom edge.
function buildFooterTemplate(clientName: string, jobNo: string, inspectionDate: string): string {
  const client = escapeHtml(clientName || '—');
  const job = escapeHtml(jobNo || '—');
  const date = escapeHtml(inspectionDate || '—');
  const label = (t: string) => `<span style="font-weight:700;">${t}</span>`;
  const sep = '&nbsp;&nbsp;|&nbsp;&nbsp;';
  return `
    <div style="width:100%; font-family: Arial, Helvetica, sans-serif; box-sizing:border-box; color:#6b7280; font-size:8.5px; padding:0 ${MARGIN_H};">
      <div style="border-top:1px solid #e5e7eb; padding-top:5px; text-align:center;">
        ${label('Client:')} ${client}${sep}${label('Date:')} ${date}${sep}${label('Job No:')} ${job}${sep}${label('Page')} <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>
      <div style="text-align:center; margin-top:3px; font-size:8px;">
        PO BOX 2521 Mt Waverley VIC 3149${sep}P (03) 9808 4000${sep}E info@houspectvic.com.au${sep}W www.houspect.com.au/victoria
      </div>
      <div style="text-align:center; margin-top:1px; font-size:8px;">${COMPANY_NAME}&nbsp; ${COMPANY_ABN_ACN}</div>
      <div style="height:1.2mm; background:${BRAND_RED}; margin-top:6px; -webkit-print-color-adjust:exact; print-color-adjust:exact;"></div>
      <div style="height:2.4mm; background:${BRAND_NAVY}; -webkit-print-color-adjust:exact; print-color-adjust:exact;"></div>
    </div>
  `;
}

/**
 * Opens the real `/report/:id` page in a headless browser, signed in as the caller, and waits until the report -- and the photo grids
 * that lay themselves out from each photo's real shape -- has finished drawing. `use` then does what it needs with the page (print it
 * to PDF, read it out for the Word file). `print`: lay the page out as it prints (the toolbar hidden, the page breaks in place).
 */
export async function withReportPage<T>(
  inspectionId: string,
  authToken: string,
  use: (page: Page) => Promise<T>,
  options: { print?: boolean; width?: number } = {},
): Promise<T> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    // In the production container this points at Alpine's own `chromium`
    // package (see Dockerfile) instead of Puppeteer's bundled download --
    // that download is a glibc build that doesn't run on Alpine's musl libc
    // anyway, and PUPPETEER_SKIP_DOWNLOAD skips fetching it at install time.
    // Unset locally, so `npm install`'s own downloaded Chrome is used as-is.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  try {
    const page = await browser.newPage();
    if (options.print) await page.emulateMediaType('print');
    // The width the page prints at (A4 less its side margins), so the page lays out the way the PDF does.
    if (options.width) await page.setViewport({ width: options.width, height: 1100, deviceScaleFactor: 2 });

    // Seed the SPA's own auth session before any of its scripts run, so its
    // client-side API calls (fetching the inspection, its photos, etc.) carry
    // the same Authorization the caller of this endpoint already has -- the
    // headless page authenticates exactly the way a signed-in reviewer's own
    // browser tab would, via the same localStorage key `api.ts` reads.
    await page.evaluateOnNewDocument((token: string) => {
      localStorage.setItem('acespect_token', token);
    }, authToken);

    await page.goto(`${env.WEB_APP_URL}/report/${inspectionId}`, {
      waitUntil: 'networkidle0',
      timeout: 30_000,
    });
    // Past the "Loading…" / "Inspection not found." placeholder -- the real
    // document only exists once this class mounts.
    await page.waitForSelector('.report-page', { timeout: 15_000 });
    // The photo grids lay themselves out from each photo's real shape, which is
    // only known once the images have loaded -- print after that has settled
    // (a grid marks itself data-photo-grid-pending until then). Bounded, so one
    // photo that never loads can't stop the report from being produced.
    await page
      .waitForFunction("!document.querySelector('[data-photo-grid-pending]')", { timeout: 15_000 })
      .catch(() => undefined);
    return await use(page);
  } finally {
    await browser.close();
  }
}

export async function generateInspectionReportPdf(
  inspectionId: string,
  authToken: string,
  meta: { clientName: string; jobNo: string; inspectionDate?: string },
): Promise<Buffer> {
  return withReportPage(inspectionId, authToken, async (page) => {
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: buildFooterTemplate(meta.clientName, meta.jobNo, meta.inspectionDate ?? ''),
      // Wider side margins and a taller bottom margin than before (the
      // previous 34mm let body text on several content-heavy pages run
      // into the footer bars) -- the top margin grew slightly too, to fit
      // the now-larger header logo without crowding the page content.
      margin: { top: '30mm', bottom: '42mm', left: MARGIN_H, right: MARGIN_H },
    });
    return Buffer.from(pdf);
  });
}
