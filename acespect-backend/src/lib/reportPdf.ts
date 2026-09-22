import puppeteer from 'puppeteer';
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

const BRAND_NAVY = '#1a2a4a';
const BRAND_RED = '#dc2626';
const FOOTER_META_COLOR = '#5b6472';

// Acespect Pty Ltd trades AS Houspect Victoria -- this is this business's
// own real identity on the report, not a third party's. Real details taken
// straight off Houspect Victoria's own master report template's footer.
const COMPANY_NAME = 'Acespect Pty Ltd trading as Houspect Victoria';
const COMPANY_ADDRESS = 'PA PO Box 2521 Mt Waverley VIC 3149';
const COMPANY_PHONE = 'P (03) 9808 4000';
const COMPANY_EMAIL = 'E info@houspectvic.com.au';
const COMPANY_WEB = 'W www.houspect.com.au/victoria';
const COMPANY_ABN_ACN = 'ABN 24 237 148 557 ACN 688 819 712';

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
// rather than referenced by URL.
const HEADER_TEMPLATE = `
  <div style="width:100%; font-family: Arial, Helvetica, sans-serif; padding: 0 18mm; box-sizing: border-box;">
    <div style="display:flex; justify-content:flex-end;">
      <img src="${HOUSPECT_LOGO_DATA_URI}" style="height:30px; width:auto; display:block;" />
    </div>
  </div>
`;

// Matches Houspect Victoria's own master template footer: Client Name, then
// a Date/Job No/Page No line with red pipe separators, a red bar, a navy
// bar, then the two company-details lines. "Date" here is the day the PDF
// was generated (not the inspection date, which already has its own row on
// the cover) -- same as the reference template, where it differs from the
// inspection date for the same reason.
function buildFooterTemplate(clientName: string, jobNo: string): string {
  const today = new Date();
  const dateStr = [today.getDate(), today.getMonth() + 1, today.getFullYear()]
    .map((n, i) => (i < 2 ? String(n).padStart(2, '0') : String(n)))
    .join('.');
  const pipe = `<span style="color:${BRAND_RED};">|</span>`;
  const client = escapeHtml(clientName || '—');
  const job = escapeHtml(jobNo || '—');

  return `
    <div style="width:100%; font-family: Arial, Helvetica, sans-serif; padding: 0 18mm; box-sizing: border-box; color:${FOOTER_META_COLOR}; font-size:9px;">
      <div style="text-align:center;">
        <span style="font-weight:700;">Client Name:</span>&nbsp; ${client}
      </div>
      <div style="text-align:center; margin-top:3px;">
        ${pipe} <span style="font-weight:700;">Date:</span> ${dateStr}
        &nbsp;${pipe} <span style="font-weight:700;">Job No:</span> ${job}
        &nbsp;${pipe} <span style="font-weight:700;">Page No:</span> <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>
      <div style="height:1.5mm; background:${BRAND_RED}; margin-top:5px; -webkit-print-color-adjust:exact; print-color-adjust:exact;"></div>
      <div style="height:4mm; background:${BRAND_NAVY}; -webkit-print-color-adjust:exact; print-color-adjust:exact;"></div>
      <div style="font-size:8px; text-align:center; margin-top:5px;">
        ${COMPANY_ADDRESS} &nbsp;|&nbsp; ${COMPANY_PHONE} &nbsp;|&nbsp; ${COMPANY_EMAIL}
      </div>
      <div style="font-size:8px; text-align:center; margin-top:2px;">
        ${COMPANY_WEB} &nbsp;|&nbsp; ${COMPANY_NAME} ${COMPANY_ABN_ACN}
      </div>
    </div>
  `;
}

export async function generateInspectionReportPdf(
  inspectionId: string,
  authToken: string,
  meta: { clientName: string; jobNo: string },
): Promise<Buffer> {
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
      footerTemplate: buildFooterTemplate(meta.clientName, meta.jobNo),
      margin: { top: '24mm', bottom: '34mm', left: '18mm', right: '18mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
