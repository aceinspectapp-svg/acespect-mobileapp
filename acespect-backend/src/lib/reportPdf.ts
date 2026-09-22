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
 * forcing page breaks between the cover/scope/body) already applies with no
 * separate print-only route needed.
 */

const BRAND_NAVY = '#1a2a4a';
const BRAND_RED = '#dc2626';

// Acespect Pty Ltd trades AS Houspect Victoria -- this is this business's
// own real identity on the report, not a third party's. Real details taken
// straight off Houspect Victoria's own master report template's footer.
const COMPANY_NAME = 'Acespect Pty Ltd trading as Houspect Victoria';
const COMPANY_ADDRESS = 'PA PO Box 2521 Mt Waverley VIC 3149';
const COMPANY_PHONE = 'P (03) 9808 4000';
const COMPANY_EMAIL = 'E info@houspectvic.com.au';
const COMPANY_WEB = 'W www.houspect.com.au/victoria';
const COMPANY_ABN_ACN = 'ABN 24 237 148 557 ACN 688 819 712';

// Puppeteer's header/footer templates are plain, unscripted HTML -- no access
// to the report's own React components, so the wordmark is re-declared here
// by hand as a placeholder. TODO: replace with the real Houspect Victoria
// logo image once supplied -- swap this <span> lockup for
// `<img src="..." style="height:20px;" />` pointing at that asset.
const HEADER_TEMPLATE = `
  <div style="width:100%; font-family: Arial, Helvetica, sans-serif; padding: 0 18mm; box-sizing: border-box;">
    <div style="display:flex; flex-direction:column; align-items:flex-end;">
      <span style="font-size:7px; color:#5b6472; letter-spacing:0.03em;">Building Inspections</span>
      <div style="display:flex; align-items:center; gap:5px;">
        <span style="width:12px; height:12px; border-radius:3px; background:${BRAND_RED}; display:inline-block;"></span>
        <span style="font-size:14px; font-weight:800; color:${BRAND_NAVY};">Houspect</span>
      </div>
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
      ${COMPANY_ADDRESS} &nbsp;|&nbsp; ${COMPANY_PHONE} &nbsp;|&nbsp; ${COMPANY_EMAIL}
    </div>
    <div style="font-size:8px; text-align:center; margin-top:2px;">
      ${COMPANY_WEB} &nbsp;|&nbsp; ${COMPANY_NAME} ${COMPANY_ABN_ACN}
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
      margin: { top: '24mm', bottom: '30mm', left: '18mm', right: '18mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
