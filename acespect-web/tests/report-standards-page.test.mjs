// The "References and Guide to Standards and Tolerances" page of the Pre-pour Construction Stage report, as in the Nov 2026 office template
// ("ACESPECT Pre-pour_Office Template Nov 2026.dotm"): its own page after Client Concerns and before the Conditions, with both links.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { buildConstructionReport } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { ConstructionReportBody } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { CONSTRUCTION_AGREEMENT_TITLE } = await server.ssrLoadModule("/src/web/construction/agreementText.ts");
const { STANDARDS_TITLE, STANDARDS_PARAGRAPHS, STANDARDS_GUIDE_URL, NCC_PORTAL_URL } = await server.ssrLoadModule("/src/web/construction/standardsText.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const templateOf = (key, prop = "residential_house") => SNAP.filter((t) => t.sectionKey === key && t.propertyType === prop).sort((a, b) => b.version - a.version)[0];
const PROFILE = { inspectionType: "construction_stage", propertyType: "residential_house" };

/** Every answer OK (the first green choice), so a test changes only what it is about. */
function okAnswers(fields) {
  const a = {};
  for (const f of fields) {
    if (f.type === "pill-select") a[f.key] = (f.options.find((o) => o.color === "#1FA463") ?? f.options[0]).value;
    if (f.type === "yesno") a[f.key] = "yes";
  }
  return a;
}
const PP = ["pp_description", "pp_site_facilities", "pp_measurements", "pp_formwork", "pp_general", "pp_defects", "pp_summary", "pp_client_issues"];

function build(patch = {}, keys = PP) {
  const sections = keys.map((key) => {
    const t = templateOf(key);
    const answers = { ...okAnswers(t.fields), ...(patch[key] ?? {}) };
    const d = flattenSectionToDraft(t.fields, answers, key, PROFILE);
    return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
  });
  return buildConstructionReport(sections, null);
}

const HEADER = { reportDate: "1 Nov 2026", clientName: "C", yourReference: "", ourReference: "V1", property: "P", inspectionDate: "1 Nov 2026", weather: "Dry", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
const INSPECTION = { id: "i", jobNo: "V1", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const render = (model, header = HEADER) => renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("Pre-pour: References and Guide to Standards and Tolerances", () => {
  const model = build();
  const html = render(model);
  const page = html.slice(html.indexOf('id="standards"'));

  it("is printed once, on its own page, after Client Concerns and before the Conditions", () => {
    assert.equal(model.stage, "pre_pour");
    assert.equal(html.split(STANDARDS_TITLE).length - 1, 1);
    const concerns = html.indexOf("Client Concerns");
    const standards = html.indexOf(STANDARDS_TITLE);
    const conditions = html.indexOf(CONSTRUCTION_AGREEMENT_TITLE);
    assert.ok(concerns > 0 && standards > concerns && conditions > standards, "Client Concerns -> Standards -> Conditions");
    assert.match(html, /<div class="report-page-break" id="standards">/);
  });

  it("carries every paragraph of the template, in order", () => {
    const t = text(page.replace(/<\/?(a|strong)\b[^>]*>/g, "")); // inline tags joined as the reader sees them
    let at = t.indexOf(STANDARDS_TITLE);
    for (const runs of STANDARDS_PARAGRAPHS) {
      const p = runs.map((r) => r.text).join("").trim();
      const next = t.indexOf(p, at);
      assert.ok(next > at, `in order: ${p.slice(0, 60)}`);
      at = next;
    }
    assert.match(t, /Please note: The applicable version of the NCC depends entirely on the specific building's age/);
  });

  it("links the whole Standards and Tolerances sentence and ncc.abcb.gov.au", () => {
    assert.equal(STANDARDS_GUIDE_URL, "https://houspect.egnyte.com/dl/8vb6WbJQqK3k");
    assert.equal(NCC_PORTAL_URL, "https://ncc.abcb.gov.au/");
    assert.match(page, /<a href="https:\/\/houspect\.egnyte\.com\/dl\/8vb6WbJQqK3k"[^>]*>Click the Link here to view and download the Standards and Tolerances 2026<\/a>/);
    assert.match(page, /Portal at <a href="https:\/\/ncc\.abcb\.gov\.au\/"[^>]*>ncc\.abcb\.gov\.au<\/a>\. Compliance/);
  });

  it("prints the template's bold headings in bold", () => {
    for (const b of ["The Guide to Standards and Tolerances is only an advisory document.", "The Normal Viewing Position", "National Construction Code (NCC) Compliance", "Please note: "]) {
      assert.match(page, new RegExp(`<strong>${b.replace(/[.()]/g, "\\$&")}`), b);
    }
  });

  it("is left out of stages whose office template does not have it", () => {
    assert.doesNotMatch(render({ ...model, stage: "framework" }), /GUIDE TO STANDARDS AND TOLERANCES/);
  });
});
