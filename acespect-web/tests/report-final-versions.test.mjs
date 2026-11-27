// Run with: npm test
// "Final Report Versions" on the report page: hand-edited Word reports uploaded per inspection, kept as versions (src/web/finalReports.ts,
// src/web/components/FinalReportVersions.tsx). Admin and reviewer only; Version 0 is the live report, downloaded with the page's existing
// Download Word (report-jobs) flow; "Save as a new version?" is asked only once something has been uploaded.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { FinalReportVersions } = await server.ssrLoadModule("/src/web/components/FinalReportVersions.tsx");
const fr = await server.ssrLoadModule("/src/web/finalReports.ts");

const src = (p) => readFileSync(resolve(webRoot, p), "utf8");
const component = src("src/web/components/FinalReportVersions.tsx");
const reportView = src("src/web/pages/ReportView.tsx");
const render = (role, extra = {}) =>
  renderToStaticMarkup(createElement(FinalReportVersions, { inspectionId: "i1", role, onDownloadLive: () => undefined, liveBusy: false, ...extra }));
const version = (n, current = false) => ({ id: `v${n}`, versionNumber: n, fileName: `v${n}.docx`, sizeBytes: 1000, note: null, uploadedAt: "2026-11-27T04:05:00.000Z", uploadedBy: { id: "u", name: "Ada", email: "ada@example.test" }, current });

describe("who sees Final Report Versions", () => {
  it("renders for admin and reviewer", () => {
    for (const role of ["admin", "reviewer"]) {
      const html = render(role);
      assert.match(html, /Final Report Versions/, role);
      assert.match(html, /data-final-upload/, role);
      assert.equal(fr.canSeeFinalVersions(role), true);
    }
  });

  it("renders nothing for an inspector, or any other role (the web app maps CLIENT and FIELD_USER to inspector)", () => {
    for (const role of ["inspector", "client", "field_user", "", null, undefined]) {
      assert.equal(render(role), "", String(role));
      assert.equal(fr.canSeeFinalVersions(role), false, String(role));
    }
  });

  it("is on the report page, beside the download buttons, and never in the PDF / Word file the server makes from that page", () => {
    assert.match(reportView, /<FinalReportVersions inspectionId=\{inspection\.id\} role=\{currentUser\.role\}/);
    assert.match(reportView, /\{currentUser && !\(typeof navigator !== "undefined" && navigator\.webdriver\) && \(\s*<FinalReportVersions/);
    assert.ok(reportView.indexOf("<FinalReportVersions") < reportView.indexOf('className="report-page"'), "above the document, under the toolbar");
    assert.match(component, /className="report-toolbar" data-final-report-versions=""/, "hidden when printing");
  });
});

describe("Version 0 uses the existing generate / download flow", () => {
  it("its Download is the page's own Download Word (report-jobs), not a stored file", () => {
    assert.match(reportView, /onDownloadLive=\{\(\) => handleDownload\("docx"\)\} liveBusy=\{downloading\}/);
    const html = render("admin");
    assert.match(html, /data-final-version="0"/);
    assert.match(html, /System generated \(live\)/);
    assert.match(component, /data-final-live="" onClick=\{onDownloadLive\}/);
  });

  it("the existing Download PDF / Download Word buttons are unchanged", () => {
    assert.match(reportView, /onClick=\{\(\) => handleDownload\("pdf"\)\}/);
    assert.match(reportView, /onClick=\{\(\) => handleDownload\("docx"\)\}/);
    assert.match(reportView, /await openReportFile\(id, format, reportFileName\(/);
  });
});

describe('"Save as a new version?"', () => {
  it("is not asked for the first upload, and is asked for every later one", () => {
    assert.equal(fr.asksNewVersion([]), false);
    assert.equal(fr.asksNewVersion([version(1, true)]), true);
    assert.equal(fr.asksNewVersion([version(2, true), version(1)]), true);
    // The upload button asks only when asksNewVersion says so; otherwise it sends straight away with no choice (the server saves Version 1).
    assert.match(component, /if \(asksNewVersion\(versions\)\) setQuestion\(\{ file, note, latest \}\);\s*else void send\(file, note, latest\);/);
  });

  it("Yes saves the next version, No replaces the latest", () => {
    assert.match(component, /data-final-answer="yes" onClick=\{\(\) => void send\(question\.file, question\.note, question\.latest, "new"\)\}/);
    assert.match(component, /data-final-answer="no" onClick=\{\(\) => void send\(question\.file, question\.note, question\.latest, "replace"\)\}/);
    assert.equal(fr.latestVersionNumber([version(2, true), version(1)]), 2);
    assert.equal(fr.latestVersionNumber([]), 0);
  });

  it("is not on the page until a later upload is started", () => {
    assert.doesNotMatch(render("admin"), /Save as a new version\?/);
  });
});

describe("file checks and display", () => {
  it("accepts .docx up to 50 MB only", () => {
    assert.equal(fr.fileProblem({ name: "Report.DOCX", size: 1000 }), null);
    assert.equal(fr.fileProblem({ name: "Report.docx", size: 50 * 1024 * 1024 }), null);
    assert.match(fr.fileProblem({ name: "Report.docx", size: 50 * 1024 * 1024 + 1 }), /larger than 50 MB/);
    for (const name of ["Report.pdf", "Report.doc", "Report.docm", "Report.docx.exe"]) assert.match(fr.fileProblem({ name, size: 10 }), /Only Word \(\.docx\)/, name);
  });

  it("shows Melbourne time whatever the viewer's time zone", () => {
    assert.match(fr.formatMelbourne("2026-11-27T04:05:00.000Z"), /27 Nov 2026,? 3:05\s?pm AEDT/i);
    assert.match(fr.formatMelbourne("2026-07-01T04:05:00.000Z"), /1 July? 2026,? 2:05\s?pm AEST/i);
  });

  it("sizes read naturally", () => {
    assert.equal(fr.formatSize(512), "512 B");
    assert.equal(fr.formatSize(2048), "2 KB");
    assert.equal(fr.formatSize(5.5 * 1024 * 1024), "5.5 MB");
  });

  it("the upload reports its progress and downloads go through the API, never a storage link", () => {
    const api = src("src/web/finalReports.ts");
    assert.match(api, /xhr\.upload\.onprogress/);
    assert.match(api, /\/final-versions`/);
    assert.doesNotMatch(api, /blob\.core\.windows\.net|sas|sig=/i);
  });
});
