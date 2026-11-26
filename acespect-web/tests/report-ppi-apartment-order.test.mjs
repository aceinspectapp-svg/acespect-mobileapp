// Pre-Purchase / Apartment: the sections in the template's order, the template's own SCOPE / DEFECTS / Condition Definitions text, the
// Site Access Conditions a field decides, no sentence without a field, and the download named after the report type.
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
const T = await server.ssrLoadModule("/src/web/prepurchase/scopeText.ts");
const { reportFileName } = await server.ssrLoadModule("/src/web/reportFile.ts");

const PPI = { inspectionType: "pre_purchase", propertyType: "apartment" };
const latest = new Map();
for (const t of JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"))) {
  if (t.inspectionType !== PPI.inspectionType || t.propertyType !== PPI.propertyType) continue;
  if (!latest.has(t.sectionKey) || latest.get(t.sectionKey).version < t.version) latest.set(t.sectionKey, t);
}
// The Apartment form's order (the report prints its own).
const KEYS = ["job-info", "description", "elevations", "roof_chimneys", "internal_areas", "paving_paths", "notes"];

const ANSWERS = {
  description: { front_elevation: ["/api/v1/media/front"] },
  elevations: { subfloor_applicability: "na-apt", extwalls_material: "Rendered concrete", extwalls_condition: "fair" },
  roof_chimneys: { roofcov_applicability: "na-apt", eaves_applicability: "applicable", eaves_condition: "fair" },
  internal_areas: { partywalls_applicability: "na" },
  paving_paths: { areas: [{ location: "Common driveway", material: "concrete", condition: "fair" }] },
  notes: { structural_structurallySound: "yes", structural_comments: "Sound." },
};

function report(answers = ANSWERS) {
  const sections = KEYS.map((key, i) => ({ id: `s${i}`, key, name: latest.get(key).name, reviewStatus: "approved", reportText: "", answers: answers[key] ?? {}, fields: {}, photos: [], damages: [] }));
  const insp = { id: "i", jobNo: "Yasiru-Test-8-PPI-AP", address: "Unit 12", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "2026-11-23", submittedAt: null, type: "Pre-Purchase", propertyType: "Apartment", status: "submitted", overallProgress: 0, sections, notes: "", photoArchiveUrl: null };
  const printed = sections.map((s) => (s.key === "job-info" ? s : R.prePurchaseSectionText(s, latest.get(s.key).fields, PPI)));
  const header = { reportDate: "Monday, 23 November 2026", clientName: "C", yourReference: "", ourReference: "Yasiru-Test-8-PPI-AP", property: "Unit 12", inspectionDate: "Monday, 23 November 2026", weather: "Overcast", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
  const html = renderToStaticMarkup(createElement(R.PrePurchaseReportBody, { inspection: insp, sections: printed, header }));
  const text = html.replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return { html, text };
}
const headings = (html) => [...html.matchAll(/<h([23])[^>]*>(.*?)<\/h\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, ""));

describe("PPI Apartment: the template's section order", () => {
  it("Scope, Defects, Condition Definitions, Condition Summary, Site Access, General Description, Photographs, Roof, External, Internal, Structural & Safety, Common Areas, Glossary, Maintenance, Terms", () => {
    const h = headings(report().html);
    assert.deepEqual(h, ["SCOPE", "Condition Definitions", "Condition Summary", "Site Access Conditions", "General Description", "Photographs", "Roof", "External", "Internal", "Structural &amp; Safety", "Common Areas", "GLOSSARY", "MAINTENANCE", "Terms and Conditions – Pre-Purchase Building Inspection"]);
    const { text } = report();
    const at = (s) => { const i = text.indexOf(s); assert.ok(i >= 0, s); return i; };
    assert.ok(at("PURPOSE OF INSPECTION") < at("SCOPE OF INSPECTION") && at("SCOPE OF INSPECTION") < at("DEFECTS\n") && at("DEFECTS\n") < at("Condition Definitions"));
  });
  it("prints no heading with nothing under it", () => {
    const answers = { ...ANSWERS, paving_paths: {}, notes: {} };
    const h = headings(report(answers).html);
    assert.ok(!h.includes("Common Areas") && !h.includes("Structural &amp; Safety"), h.join(", "));
  });
  it("prints no sentence that has no field (General Description)", () => {
    const { text } = report();
    assert.ok(!text.includes("The building is a"));
    assert.ok(!text.includes("The front of the building is facing"));
  });
});

describe("PPI Apartment: the template's own Scope, Defects and Condition Definitions (Nov 2026)", () => {
  const { text } = report();
  it("1 Purpose of inspection", () => assert.ok(text.includes("1\nPURPOSE OF INSPECTION\n1.1\nThe purpose of the inspection is to provide general advice to a prospective purchaser or other interested party regarding the condition of the structure of the Property at the time of the inspection inline with the terms and conditions of this report.")));
  it("2 Scope of inspection, clauses 2.1 to 2.24 with their lettered items", () => {
    const clauses = T.PPI_SCOPE_BLOCKS.filter((b) => b.kind === "clause").map((b) => b.n);
    assert.deepEqual(clauses, ["1.1", ...Array.from({ length: 24 }, (_, i) => `2.${i + 1}`)]);
    assert.ok(text.includes("2.2\nThe Inspection will be undertaken generally in accordance with AS 4349.0 – 2007 and AS 4349.1 – 2007 as applicable. Where there exists any conflict between the Australian Standards and this Agreement, the Agreement prevails."));
    assert.ok(text.includes("(u)\nfurniture and accessories."));
    for (const sub of ["Structural Defect Inspections", "Standards and Guide", "Pre-Purchase Inspection", "Access and Site Conditions", "Inspection Limits and Exclusions"]) assert.ok(text.includes(`\n${sub}\n`), sub);
  });
  it("3 Defects: Major, Structural and Minor defect", () => {
    assert.ok(text.includes("3\nDEFECTS\nThe presence or otherwise of defects shall only be relevant when such defects relate to the structural condition of the building."));
    assert.ok(text.includes("3.2\nMajor defect\nA defect of sufficient magnitude where rectification has to be carried out in order to avoid unsafe conditions, loss of utility or further deterioration of the property."));
    assert.ok(text.includes("3.3\nStructural defect\nFault or deviation from the intended structural performance of a load bearing element defect that requires immediate intervention to avert further deterioration."));
    assert.ok(text.includes("3.4\nMinor defect\nA defect other than a major defect that requires immediate intervention to avert further deterioration.\nThe report shall describe the overall extent of minor defects."));
  });
  it("Condition Definitions, as the template words them", () => {
    assert.ok(text.includes("Condition Definitions\n3.5\nHouspect utilises the following terms to categorise our gradings of materials conditions;\n•\nNew: Self-explanatory/newly built or constructed with none to minimal use.\n•\nSatisfactory: Generally good condition.\n•\nFair: Starting to look like it needs maintenance.\n•\nAverage: Working but needs maintenance within 6 months.\n•\nPoor: Needs replacement."));
  });
  it("not the old text: no old Scope page, no second grading legend under the Condition Summary", () => {
    assert.ok(!text.includes("Self explanatory."));
    assert.ok(!text.includes("Needs repair or replacement now."));
    assert.ok(!text.includes("Functioning but needs maintenance"));
    assert.equal(text.split("\nSCOPE\n").length, 2);
  });
});

describe("PPI Apartment: Site Access Conditions, only the sentences a field decides", () => {
  const sentences = (answers) => { const { text } = report(answers); return Object.values(T.SITE_ACCESS).filter((s) => text.includes(s)); };
  it("roof covering 'Apartment complex – not applicable' and sub-floor 'Apartment complex – not assessable'", () =>
    assert.deepEqual(sentences(ANSWERS), [T.SITE_ACCESS.roofNotAccessed, T.SITE_ACCESS.subfloorNotInspected]));
  it("sub-floor 'constructed on concrete slab'", () =>
    assert.deepEqual(sentences({ ...ANSWERS, roof_chimneys: { roofcov_applicability: "applicable" }, elevations: { subfloor_applicability: "na-slab" } }), [T.SITE_ACCESS.subfloorSlab]));
  it("roof and sub-floor assessed: no Site Access Conditions at all", () => {
    const { html, text } = report({ ...ANSWERS, roof_chimneys: { roofcov_applicability: "applicable" }, elevations: { subfloor_applicability: "applicable" } });
    assert.ok(!headings(html).includes("Site Access Conditions"));
    assert.deepEqual(Object.values(T.SITE_ACCESS).filter((s) => text.includes(s)), []);
  });
  it("never the sentences no field decides (ladder, 3.6m, roof cavity)", () => {
    const { text } = report();
    for (const k of ["lowerRoofFromLadder", "upperRoofTooHigh", "roofCavityObstructed", "roofCavityRaked"]) assert.ok(!text.includes(T.SITE_ACCESS[k]), k);
  });
});

describe("Download file name", () => {
  const insp = { id: "i", jobNo: "Yasiru-Test-8-PPI-AP" };
  it("Pre-Purchase / Apartment: <job>-pre-purchase-report.pdf / .docx", () => {
    assert.equal(reportFileName(insp, "pre-purchase", "pdf"), "Yasiru-Test-8-PPI-AP-pre-purchase-report.pdf");
    assert.equal(reportFileName(insp, "pre-purchase", "docx"), "Yasiru-Test-8-PPI-AP-pre-purchase-report.docx");
  });
  it("every other report as before", () => {
    assert.equal(reportFileName(insp, true, "pdf"), "Yasiru-Test-8-PPI-AP-construction-report.pdf");
    assert.equal(reportFileName(insp, false, "docx"), "Yasiru-Test-8-PPI-AP-dilapidation-report.docx");
  });
});

describe("PPI Apartment: the report ends with the template's Glossary, Maintenance and Terms (termsText.ts)", () => {
  const { text } = report();
  it("GLOSSARY, MAINTENANCE, then 'Terms and Conditions – Pre-Purchase Building Inspection', last", () => {
    const at = (s) => { const i = text.indexOf(s); assert.ok(i >= 0, s); return i; };
    assert.ok(at("\nCommon Areas\n") < at("\nGLOSSARY\n") && at("\nGLOSSARY\n") < at("\nMAINTENANCE\n") && at("\nMAINTENANCE\n") < at("\nTerms and Conditions – Pre-Purchase Building Inspection\n"));
  });
  it("the Terms read 'WHEREAS:' (the template's 'HEREAS:' corrected)", () => {
    assert.match(text, /WHEREAS: The Client has requested the Inspector/);
    assert.ok(!/(^|[^W])HEREAS:/m.test(text));
  });
  it("no 'CONDITIONS FOR THE PROVISION OF THE REPORT'", () => assert.ok(!/CONDITIONS FOR THE PROVISION OF THE REPORT/i.test(text)));
});
