// Run with: npm test
// The review page's Report button (reviewer and admin) opens the report page in a new tab again -- not the PDF straight away (PR #63) --
// so the report can be read there and downloaded as a PDF or a Word file. The rest of PR #63 (Additional Photos' remove button) stays.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { openReportPage, reportPagePath, reportBackAction, reviewPagePath } = await server.ssrLoadModule("/src/web/reportPage.ts");

const src = (p) => readFileSync(resolve(webRoot, p), "utf8");
const review = src("src/web/pages/reviewer/ReviewerFormView.tsx");
const reportView = src("src/web/pages/ReportView.tsx");
const app = src("src/App.tsx");
/** The Report button's source, from its <button to its </button>. */
const reportButton = (() => {
  const end = review.indexOf("Report\n        </button>");
  assert.ok(end > 0, "the Report button is on the review page");
  return review.slice(review.lastIndexOf("<button", end), end);
})();

describe("Report button opens the report page in a new tab", () => {
  it("opens /report/:id in a new tab, inside the click", () => {
    const calls = [];
    const opened = openReportPage("abc-123", (url, target) => { calls.push([url, target]); return {}; });
    assert.equal(opened, true);
    assert.deepEqual(calls, [["/report/abc-123", "_blank"]]);
    assert.equal(reportPagePath("a b/c"), "/report/a%20b%2Fc");
  });

  it("says so when the browser blocks the new tab, so the button can show the page in this tab", () => {
    assert.equal(openReportPage("abc-123", () => null), false);
    assert.match(reportButton, /if \(!openReportPage\(inspection\.id\)\) navigate\(reportPagePath\(inspection\.id\)\)/);
  });

  it("no longer opens or downloads the PDF itself", () => {
    assert.doesNotMatch(reportButton, /openReportFile|"pdf"|"docx"|Opening…/);
    assert.doesNotMatch(review, /openReportFile|openingReport/);
  });

  it("is the one Report button for both the reviewer and the admin (the same review page)", () => {
    assert.match(app, /path="\/reviewer\/review\/:id" element={<ReviewerFormView \/>}/);
    assert.match(app, /path="\/admin\/inspections\/:id" element={<ReviewerFormView \/>}/);
    assert.match(app, /path="\/report\/:id" element={<ReportView \/>}/);
  });
});

describe("the report page in its new tab", () => {
  it("still has Download PDF and Download Word, made by the server", () => {
    assert.match(reportView, /onClick=\{\(\) => handleDownload\("pdf"\)\}/);
    assert.match(reportView, /onClick=\{\(\) => handleDownload\("docx"\)\}/);
    assert.match(reportView, /Download PDF/);
    assert.match(reportView, /Download Word/);
    assert.match(reportView, /await openReportFile\(id, format, reportFileName\(/);
  });

  it("shows Edit text on screen only, never in the PDF or Word file", () => {
    // The server makes both files from this page in a headless browser (navigator.webdriver), and printing hides .screen-only.
    assert.match(reportView, /const canEditText = !!currentUser && !\(typeof navigator !== "undefined" && navigator\.webdriver\);/);
    const edit = reportView.slice(reportView.indexOf("{canEditText && inspection"), reportView.indexOf("✏ Edit text"));
    assert.match(edit, /className="screen-only"/);
    assert.match(src("src/index.css"), /@media print \{\s*\.report-toolbar,\s*\.screen-only \{\s*display: none !important;/);
  });

  it("Back closes the tab when there is nothing to go back to, and goes back otherwise", () => {
    assert.equal(reportBackAction(1), "close");
    assert.equal(reportBackAction(2), "back");
    assert.match(reportView, /reportBackAction\(window\.history\.length\)/);
    assert.equal(reviewPagePath("reviewer", "x1"), "/reviewer/review/x1");
    assert.equal(reviewPagePath("admin", "x1"), "/admin/inspections/x1");
    assert.equal(reviewPagePath("inspector", "x1"), "/inspector/dashboard");
  });
});

describe("the rest of PR #63 stays", () => {
  it("Additional Photos keep their remove / Add back buttons", () => {
    assert.match(review, /<PhotosGrid photos=\{selectedSection\.photos\} excluded=\{selectedSection\.excludedPhotoUrls \?\? \[\]\} onToggle=/);
    assert.match(review, /title="Remove from the report"/);
    assert.match(review, /Add back/);
  });
});
