import puppeteer from 'puppeteer';
import { env } from '../config/env';

/**
 * Renders the inspection report to a real PDF by pointing a headless browser
 * at the exact same `/report/:id` page a reviewer already sees on the web
 * app, then calling `page.pdf()` -- reusing the live React report instead of
 * re-building its layout a second time in a PDF-specific API, so a future
 * layout tweak never has two places to update.
 *
 * `page.pdf()` renders using the print CSS media type by default, which is
 * exactly why `src/index.css`'s `@media print` block (hiding the toolbar,
 * forcing page breaks between the cover/scope/crack-table/body) already
 * applies with no separate print-only route needed.
 */

const BRAND_NAVY = '#1a2a4a';
const BRAND_RED = '#e63329';

// Puppeteer's header/footer templates are plain, unscripted HTML -- no access
// to the report's own React components or design tokens, so the ACESPECT
// wordmark/colors are re-declared here by hand rather than imported. Keep
// this in sync with `AcespectLogo.tsx` if the brand colors ever change.
const HEADER_TEMPLATE = `
  <div style="width:100%; font-family: Arial, Helvetica, sans-serif; padding: 0 18mm; box-sizing: border-box;">
    <div style="display:flex; justify-content:flex-end; align-items:center; gap:6px;">
      <span style="width:14px; height:14px; border-radius:4px; background:${BRAND_RED}; display:inline-block;"></span>
      <span style="font-size:12px; font-weight:800; color:${BRAND_NAVY};">ACE<span style="color:${BRAND_RED};">SPECT</span></span>
    </div>
  </div>
`;

const FOOTER_TEMPLATE = `
  <div style="width:100%; font-family: Arial, Helvetica, sans-serif; padding: 0 18mm; box-sizing: border-box; color:#5b6472;">
    <div style="display:flex; justify-content:space-between; font-size:9px; border-top:1px solid #e2e6ec; padding-top:4px;">
      <span class="date"></span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
    <div style="font-size:8px; text-align:center; margin-top:3px;">
      Acespect Pty Ltd &nbsp;|&nbsp; P: (add phone) &nbsp;|&nbsp; ABN: (add ABN) &nbsp;|&nbsp; W: www.acespect.com.au
    </div>
    <div style="height:4mm; background:${BRAND_RED}; margin-top:3px;"></div>
  </div>
`;

export async function generateInspectionReportPdf(inspectionId: string, authToken: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();

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

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: '24mm', bottom: '26mm', left: '18mm', right: '18mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
