// Pre-Purchase: the cover's title is the property type and the signature is always on page 1 (details that do not fit carry on to page 2);
// the Condition Summary is laid out as the Construction checklist summary; every main title starts a new page.
//
// The page-1 fit itself is measured in the browser at the PDF's page size; it was checked by printing a normal and a long cover with the
// report server's PDF settings (the signature on page 1 both times). These tests check the rules around it.
//
// Run with: npm test
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
const R = await server.ssrLoadModule("/src/web/prepurchase/PrePurchaseReport.tsx");
const Cv = await server.ssrLoadModule("/src/web/prepurchase/PrePurchaseCover.tsx");
const Sm = await server.ssrLoadModule("/src/web/prepurchase/PrePurchaseSummary.tsx");

const PPI = { inspectionType: "pre_purchase", propertyType: "apartment" };
const latest = new Map();
for (const t of JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"))) {
  if (t.inspectionType !== PPI.inspectionType || t.propertyType !== PPI.propertyType) continue;
  if (!latest.has(t.sectionKey) || latest.get(t.sectionKey).version < t.version) latest.set(t.sectionKey, t);
}
const KEYS = ["job-info", "description", "elevations", "roof_chimneys", "internal_areas", "paving_paths", "notes"];
const ANSWERS = {
  "job-info": { occupied: "yes" },
  description: { front_elevation: ["/api/v1/media/front"] },
  elevations: { subfloor_applicability: "na-apt", sides: { front: { condition: "fair" }, rear: { condition: "poor" } } },
  roof_chimneys: { roofcov_applicability: "na-apt", eaves_applicability: "applicable", eaves_condition: "fair" },
  internal_areas: { partywalls_applicability: "na" },
  paving_paths: { areas: [{ location: "Common driveway", material: "concrete", condition: "average" }] },
  notes: { structural_structurallySound: "yes", structural_comments: "Sound." },
};
const HEADER = { reportDate: "Monday, 23 November 2026", clientName: "C", yourReference: "", ourReference: "Yasiru-Test-8-PPI-AP", property: "Unit 12", inspectionDate: "Monday, 23 November 2026", weather: "Overcast", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
function report(propertyType = "Apartment") {
  const sections = KEYS.map((key, i) => ({ id: `s${i}`, key, name: latest.get(key).name, reviewStatus: "approved", reportText: "", answers: ANSWERS[key] ?? {}, fields: {}, photos: [], damages: [] }));
  const insp = { id: "i", jobNo: "Yasiru-Test-8-PPI-AP", address: "Unit 12", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "2026-11-23", submittedAt: null, type: "Pre-Purchase", propertyType, status: "submitted", overallProgress: 0, sections, notes: "", photoArchiveUrl: null };
  const printed = sections.map((s) => (s.key === "job-info" ? s : R.prePurchaseSectionText(s, latest.get(s.key).fields, PPI)));
  return renderToStaticMarkup(createElement(R.PrePurchaseReportBody, { inspection: insp, sections: printed, header: HEADER }));
}

describe("Pre-Purchase cover", () => {
  it("small line PRE-PURCHASE REPORT, big title the property type", () => {
    const html = report();
    assert.match(html, /data-cover="kicker"[^>]*>Pre-Purchase Report</);
    assert.match(html, /data-cover="title"[^>]*>Apartment</);
    assert.ok(!html.includes("Building Report"));
  });
  it("the same rule for the other property types", () => {
    assert.equal(Cv.prePurchaseCoverTitle({ type: "Pre-Purchase", propertyType: "Residential House" }), "Residential House");
    assert.equal(Cv.prePurchaseCoverTitle({ type: "pre_purchase", propertyType: "commercial_properties" }), "Commercial Property");
    assert.equal(Cv.prePurchaseCoverTitle({ type: "Pre-Purchase", propertyType: "Apartment" }), "Apartment");
  });
  it("prints the signature on the cover page", () => {
    const html = report();
    const cover = html.slice(html.indexOf('data-cover="page"'), html.indexOf('data-ppi-title="SCOPE"'));
    assert.match(cover, /data-cover="sig-name"[^>]*>Dinuke De Coonghe</);
    assert.match(cover, /data-cover="sig-title"[^>]*>Director – Houspect Victoria</);
  });
  it("details that do not fit on page 1 carry on at the top of page 2, word for word", () => {
    const rows = [["Property", "P"], ["Weather Conditions", "one two three four"], ["General", "five six"]];
    assert.deepEqual(Cv.splitRows(rows, null), { first: rows, rest: [] });
    assert.deepEqual(Cv.splitRows(rows, { row: 1, words: 2 }), {
      first: [["Property", "P"], ["Weather Conditions", "one two"]],
      rest: [["Weather Conditions (continued)", "three four"], ["General", "five six"]],
    });
    assert.deepEqual(Cv.splitRows(rows, { row: 2, words: 0 }), { first: rows.slice(0, 2), rest: [["General", "five six"]] });
  });
  it("is measured at the PDF's page: A4 less the report server's margins", () => {
    const pdf = readFileSync(resolve(webRoot, "../acespect-backend/src/lib/reportPdf.ts"), "utf8");
    assert.match(pdf, /MARGIN_H = '22mm'/);
    assert.match(pdf, /margin: \{ top: '30mm', bottom: '42mm', left: MARGIN_H, right: MARGIN_H \}/);
    assert.deepEqual(Cv.PDF_PAGE_MM, { width: 210 - 44, height: 297 - 72 });
  });
});

describe("Pre-Purchase Condition Summary, as the Construction checklist summary", () => {
  const html = report();
  it("a total card per grade, with this inspection's counts", () => {
    const totals = [...html.matchAll(/data-summary-total="([^"]+)"[^>]*><div[^>]*>(\d+)</g)].map((m) => [m[1], Number(m[2])]);
    assert.deepEqual(totals, [["New", 0], ["Satisfactory", 0], ["Fair", 1], ["Average", 1], ["Poor", 1]]);
  });
  it("section title bars with their counts", () => {
    assert.equal(Sm.sectionCounts([
      { conditionLabel: "Poor", conditionColor: "#dc2626", defectNote: "Crack" },
      { conditionLabel: "Satisfactory with typical wear and tear", conditionColor: "#65a30d" },
      { conditionLabel: "Average", conditionColor: "#ea580c", defectNote: "Rot" },
    ]), "2 defects · 1 Poor · 1 Average · 1 Satisfactory");
    assert.match(html, /data-summary="section"[\s\S]*?>External<[\s\S]*?1 Poor · 1 Fair</);
  });
  it("rows with the grade as a coloured status on the right, linking to the section, which links back", () => {
    assert.match(html, /data-summary="status"[^>]*><a href="#section-s2"[^>]*>Fair ›<\/a>/);
    assert.match(html, /id="section-s2"[\s\S]*?↑ Back to summary/);
    assert.match(html, /id="summary"/);
  });
  it("a row never splits across pages, and a title bar prints with its first row", () => {
    for (const m of html.matchAll(/<div data-summary="row" style="([^"]*)"/g)) assert.match(m[1], /break-inside:avoid/);
    assert.match(html, /<div style="break-inside:avoid"><div data-summary="section"/);
  });
});

describe("Pre-Purchase: every main title starts a new page", () => {
  const html = report();
  const titles = [...html.matchAll(/<div ([^>]*)data-ppi-title="([^"]+)"/g)].map((m) => [m[2], /class="([^"]*)"/.exec(m[1])?.[1] ?? ""]);
  it("in the template's order", () =>
    assert.deepEqual(titles.map((t) => t[0]), ["SCOPE", "DEFECTS", "Condition Definitions", "Condition Summary", "Site Access Conditions", "General Description", "Photographs", "Roof", "External", "Internal", "Structural &amp; Safety", "Common Areas", "Glossary", "Maintenance", "Terms and Conditions"]));
  it("each on a new page (the PDF and the Word file both break there)", () => {
    for (const [t, cls] of titles) assert.ok(cls.split(" ").includes("report-page-break"), t);
  });
  it("sub-headings inside a section do not start a new page", () => {
    // The ROOMHEAD / sub-headings are printed by ReportSection, which has no page breaks of its own.
    const breaks = (html.match(/report-page-break/g) ?? []).length;
    assert.equal(breaks, titles.length);
  });
});
