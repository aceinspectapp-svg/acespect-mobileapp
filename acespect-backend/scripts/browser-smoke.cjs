// Starts the report printer (headless Chromium) exactly the way src/lib/reportPdf.ts does and prints a tiny page to PDF.
// Run inside the production image:  docker run -i --rm <image> node - < scripts/browser-smoke.cjs
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  });
  const version = await browser.version();
  const page = await browser.newPage();
  await page.setContent('<h1 class="report-page">Report printer works</h1>');
  const pdf = await page.pdf({ format: 'A4' });
  await browser.close();
  if (Buffer.from(pdf).subarray(0, 4).toString() !== '%PDF') throw new Error('not a PDF');
  console.log(`OK: ${version}, puppeteer ${require('puppeteer/package.json').version}, ${pdf.length} bytes`);
})().catch((e) => { console.error('BROWSER SMOKE FAILED:', e); process.exit(1); });
