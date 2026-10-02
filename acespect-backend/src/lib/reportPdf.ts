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
const FOOTER_META_COLOR = '#7b93b5'; // light blue-grey, matching the reference's own meta-line color
const FOOTER_LABEL_COLOR = '#8a97a8'; // grey "PA / P / E / W" style labels
const MARGIN_H = '22mm'; // wider side margins than before, matching the reference

// Acespect Pty Ltd trades AS Houspect Victoria -- this is this business's
// own real identity on the report, not a third party's. Real details taken
// straight off Houspect Victoria's own master report template's footer.
const COMPANY_NAME = 'Acespect Pty Ltd trading as Houspect Victoria';
const COMPANY_ABN_ACN = 'ABN 24 237 148 557 ACN 688 819 712';
// Each address segment as its own {label, value} so the label can render
// grey and the value navy, matching the reference's own styling (a single
// plain string couldn't carry that split).
const ADDRESS_LINE_1: { label: string; value: string }[] = [
  { label: 'PA', value: 'PO BOX 2521 Mt Waverley VIC 3149' },
  { label: 'P', value: '(03) 9808 4000' },
  { label: 'E', value: 'info@houspectvic.com.au' },
];
const ADDRESS_LINE_2: { label: string; value: string }[] = [
  { label: 'W', value: 'www.houspect.com.au/victoria' },
  { label: '', value: `${COMPANY_NAME} ${COMPANY_ABN_ACN}` },
];

// Puppeteer's header/footer templates are their own isolated, unscripted
// document -- values from the page being printed (client name, job no) have
// to be baked into the template's own HTML string before it's handed to
// page.pdf(), so this escapes them the same way React would.
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function addressLine(parts: { label: string; value: string }[]): string {
  const pipe = `<span style="color:${BRAND_RED};">|</span>`;
  return parts
    .map(
      (p) =>
        (p.label ? `<span style="color:${FOOTER_LABEL_COLOR};">${p.label}</span> ` : '') +
        `<span style="color:${BRAND_NAVY};">${p.value}</span>`,
    )
    .join(` &nbsp;${pipe}&nbsp; `);
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

// Matches Houspect Victoria's own master template footer: Client Name, then
// a Date/Job No/Page No line with red pipe separators, a red bar, a navy
// bar, then the two company-details lines. "Date" here is the day the PDF
// was generated (not the inspection date, which already has its own row on
// the cover) -- same as the reference template, where it differs from the
// inspection date for the same reason.
//
// The reference's own footer actually varies its bar/line order across
// different page ranges (pages 1-2, 3-4, and 5+ each arrange the address
// lines and bars differently) -- Puppeteer's footerTemplate is one static
// HTML string applied to every page with no way to key off which page
// number it's currently rendering, so reproducing that exactly isn't
// possible here. This uses the one structure the reference itself settles
// into from page 5 onward (bar, then both address lines below) consistently
// on every page, rather than the apparently inconsistent early-page
// formatting, which reads as leftover manual Word editing rather than
// intentional design.
function buildFooterTemplate(clientName: string, jobNo: string): string {
  const today = new Date();
  const dateStr = [today.getDate(), today.getMonth() + 1, today.getFullYear()]
    .map((n, i) => (i < 2 ? String(n).padStart(2, '0') : String(n)))
    .join('.');
  const pipe = `<span style="color:${BRAND_RED};">|</span>`;
  const client = escapeHtml(clientName || '—');
  const job = escapeHtml(jobNo || '—');

  return `
    <div style="width:100%; font-family: Arial, Helvetica, sans-serif; box-sizing:border-box; color:${FOOTER_META_COLOR}; font-size:9px;">
      <div style="padding:0 ${MARGIN_H};">
        <div style="text-align:center;">
          <span style="font-weight:700;">Client Name:</span>&nbsp; ${client}
        </div>
        <div style="text-align:center; margin-top:3px;">
          ${pipe} <span style="font-weight:700;">Date:</span> ${dateStr}
          &nbsp;${pipe} <span style="font-weight:700;">Job No:</span> ${job}
          &nbsp;${pipe} <span style="font-weight:700;">Page No:</span> <span class="pageNumber"></span> of <span class="totalPages"></span>
        </div>
      </div>
      <!-- Full-bleed, edge-to-edge -- outside the ${MARGIN_H} side padding above/below, unlike the text lines. -->
      <div style="height:2mm; background:${BRAND_RED}; margin-top:7px; -webkit-print-color-adjust:exact; print-color-adjust:exact;"></div>
      <div style="height:8mm; background:${BRAND_NAVY}; -webkit-print-color-adjust:exact; print-color-adjust:exact;"></div>
      <div style="padding:0 ${MARGIN_H};">
        <div style="font-size:8px; text-align:center; margin-top:5px;">
          ${addressLine(ADDRESS_LINE_1)}
        </div>
        <div style="font-size:8px; text-align:center; margin-top:2px;">
          ${addressLine(ADDRESS_LINE_2)}
        </div>
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
    // In the production container this points at Alpine's own `chromium`
    // package (see Dockerfile) instead of Puppeteer's bundled download --
    // that download is a glibc build that doesn't run on Alpine's musl libc
    // anyway, and PUPPETEER_SKIP_DOWNLOAD skips fetching it at install time.
    // Unset locally, so `npm install`'s own downloaded Chrome is used as-is.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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

    // Switches the live page into print media before measuring/capturing it
    // -- ReportCover's signature-overflow check (see ReportCover.tsx) reads
    // the cover's print-width layout, which wraps its Purpose paragraph
    // differently (narrower) than the on-screen preview, so it has to
    // re-measure under the same media type page.pdf() itself will render
    // with. The component sets `data-cover-measured-for="print"` on <body>
    // once that re-measurement lands; a short timeout here just means that
    // one edge-case check ran with stale (screen-width) numbers, not that
    // PDF generation fails.
    await page.emulateMediaType('print');
    await page
      .waitForFunction("document.body.dataset.coverMeasuredFor === 'print'", { timeout: 5_000 })
      .catch(() => {});

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: HEADER_TEMPLATE,
      footerTemplate: buildFooterTemplate(meta.clientName, meta.jobNo),
      // Wider side margins and a taller bottom margin than before (the
      // previous 34mm let body text on several content-heavy pages run
      // into the footer bars) -- the top margin grew slightly too, to fit
      // the now-larger header logo without crowding the page content.
      margin: { top: '30mm', bottom: '42mm', left: MARGIN_H, right: MARGIN_H },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
