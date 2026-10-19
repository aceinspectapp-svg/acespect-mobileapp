// The Construction and Dilapidation covers are one component (components/CoverPage.tsx): the same banner, rows and sign-off, whichever report.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { Cover } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { ReportCover } = await server.ssrLoadModule("/src/web/components/ReportCover.tsx");

const header = {
  reportDate: "Monday, 12 October 2026", clientName: "CI Client", clientEmail: "client@example.com", yourReference: "PO 12", ourReference: "V26-0001", property: "1 Sample Street, Box Hill VIC 3128",
  inspectionDate: "Saturday, 3 October 2026", weather: "Dry", inspector: "Report Smoke", inspectorRegistration: "DBU 123", purpose: "The purpose text.",
  reportTitle: "Dilapidation Report", reportType: "Residential House", signatureName: "Dinuke De Coonghe", signatureTitle: "Director – Houspect Victoria",
};
const construction = renderToStaticMarkup(React.createElement(Cover, { r: header, model: { stageLabel: "Lock-up", purpose: "P", general: "G", coverTitle: "Lock-up Stage" }, inspection: { sections: [] } }));
const dilapidation = renderToStaticMarkup(React.createElement(ReportCover, { header }));

// the pieces that make the cover look the way it does
const BANNER = "background:#1b3a6b;border-right:9px solid #d1262b";
const ROW = "display:grid;grid-template-columns:166px 1fr;gap:14px;padding:9px 0;border-bottom:1px solid #e5e7eb";

describe("the cover page", () => {
  it("is the same banner, rows and sign-off in both reports", () => {
    for (const html of [construction, dilapidation]) {
      assert.ok(html.includes(BANNER), "the navy banner with the red edge");
      assert.ok(html.includes(ROW), "the ruled detail rows");
      assert.ok(html.includes("Dinuke De Coonghe") && html.includes("Director – Houspect Victoria"));
      assert.ok(html.includes("font-size:36px"), "the big title");
    }
  });

  it("says what kind of report it is in the banner", () => {
    assert.ok(construction.includes(">Construction Report<") && construction.includes(">Lock-up Stage<"));
    assert.ok(dilapidation.includes(">Dilapidation Report<") && dilapidation.includes(">Residential House<"));
  });

  it("keeps the Dilapidation details: both references, the owner and the purpose", () => {
    for (const text of ["Our Reference", "V26-0001", "Your Reference", "PO 12", "Property Owner", "Purpose", "The purpose text."]) assert.ok(dilapidation.includes(text), text);
  });

  it("is marked up so the Word export can rebuild the same first page", () => {
    // reportDocxExtract.ts finds each part of the cover by these data-cover marks; without them the Word file's first page would not match the PDF's
    const marks = ["page", "date", "client", "label", "value", "refs", "ref", "banner", "kicker", "title", "rows", "row", "row-label", "row-value", "signature", "sig-name", "sig-title"];
    for (const html of [construction, dilapidation]) for (const m of marks.filter((m) => !["label", "value", "refs", "ref"].includes(m) || html === dilapidation)) assert.ok(html.includes(`data-cover="${m}"`), m);
    assert.equal(construction.split('data-cover="page"').length - 1, 1, "one cover per report");
  });
});
