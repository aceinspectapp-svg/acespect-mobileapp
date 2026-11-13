// Construction Stage reports print item names and chosen options with the office templates' capitals -- at print time only
// (construction/printCase.ts): the stored answers, option values and report text are not changed.
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
const { itemName, optionText, withItemName } = await server.ssrLoadModule("/src/web/construction/printCase.ts");
const { buildConstructionReport } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { ConstructionReportBody, Cover } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const templateOf = (key) => SNAP.filter((t) => t.sectionKey === key && t.propertyType === "residential_house").sort((a, b) => b.version - a.version)[0];
const PROFILE = { inspectionType: "construction_stage", propertyType: "residential_house" };
function okAnswers(fields) {
  const a = {};
  for (const f of fields) {
    if (f.type === "pill-select") a[f.key] = (f.options.find((o) => o.color === "#1FA463") ?? f.options[0]).value;
    if (f.type === "yesno") a[f.key] = "yes";
  }
  return a;
}
const PP = ["pp_description", "pp_site_facilities", "pp_measurements", "pp_formwork", "pp_general", "pp_defects", "pp_summary", "pp_client_issues"];
function build(patch = {}) {
  const sections = PP.map((key) => {
    const t = templateOf(key);
    const answers = { ...okAnswers(t.fields), ...(patch[key] ?? {}) };
    const d = flattenSectionToDraft(t.fields, answers, key, PROFILE);
    return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
  });
  return buildConstructionReport(sections, null);
}
const HEADER = { reportDate: "1 Nov 2026", clientName: "C", yourReference: "", ourReference: "V1", property: "P", inspectionDate: "1 Nov 2026", weather: "sunny", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
const INSPECTION = { id: "i", jobNo: "V1", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

describe("item names in the templates' Title Case", () => {
  it("matches the Pre-pour template's names", () => {
    const expected = {
      "Water supply to site": "Water Supply to Site", "Site toilet in position": "Site Toilet in Position", "Slab formwork dimensions": "Slab Formwork Dimensions",
      "Garage slab formed": "Garage Slab Formed", "Porch slab formed": "Porch Slab Formed", "Alfresco slab formed": "Alfresco Slab Formed",
      "Inground pool formed": "Inground Pool Formed", "Formwork bowed": "Formwork Bowed", "Footing depths": "Footing Depths",
      "Excess water to footings": "Excess Water to Footings", "Reinforcing in position": "Reinforcing in Position", "Reinforcing clearances": "Reinforcing Clearances",
      "Reinforcing damaged": "Reinforcing Damaged", "Security fencing in place": "Security Fencing in Place", "Rubbish dangerous on site": "Rubbish Dangerous on Site",
      "Waffle pods positioned": "Waffle Pods Positioned", "Retaining walls as per plan / waterproofed": "Retaining Walls as per Plan / Waterproofed",
    };
    for (const [from, to] of Object.entries(expected)) assert.equal(itemName(from), to);
  });

  it("keeps abbreviations, units, plurals and hyphenated words as written, and only changes capitals", () => {
    assert.equal(itemName("Termite Part A (collars at penetrations)"), "Termite Part A (Collars at Penetrations)");
    assert.equal(itemName("Roof framing per AS1684"), "Roof Framing per AS1684");
    assert.equal(itemName("Plaster at door frames > 25 mm spacing"), "Plaster at Door Frames > 25 mm Spacing");
    assert.equal(itemName("Recommend agi drain/s"), "Recommend Agi Drain/s");
    assert.equal(itemName("Shower set-downs apparent"), "Shower Set-downs Apparent");
    assert.equal(itemName("Gas supply on"), "Gas Supply On");
    assert.equal(itemName("Front setback — result"), "Front Setback — Result");
    for (const n of ["Builder's sign displayed", "Bath hob WP height, junctions, air-pockets", "Light fittings OK/clear re fire risk (eg; 200mm clearance for halogen globes)"]) {
      assert.equal(itemName(n).toLowerCase(), n.toLowerCase(), "only the capitals change");
    }
  });

  it("only re-cases a line that opens with the item's name", () => {
    assert.equal(withItemName("Slab formwork dimensions. Please refer", "Slab formwork dimensions"), "Slab Formwork Dimensions. Please refer");
    assert.equal(withItemName("Typed by the inspector.", "Slab formwork dimensions"), "Typed by the inspector.");
    assert.equal(withItemName("Anything", ""), "Anything");
  });

  it("the Pre-pour report prints them in the checklist, defect lines and photo captions, without changing the model's stored text", () => {
    const model = build({ pp_formwork: { slabDimensions: "defect", slabDimensions__defect: { location: "", photos: ["/a.jpg"] } } });
    const html = renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header: HEADER }));
    const t = text(html);
    assert.match(t, /Water Supply to Site/);
    assert.match(t, /Site Toilet in Position/);
    assert.match(t, /Slab Formwork Dimensions\. Please refer to Photograph/);
    assert.doesNotMatch(t, /Water supply to site/);
    // the model (what the reviewer portal's text and the comparisons use) keeps the form's own wording
    assert.ok(model.tables.some((tb) => tb.groups.some((g) => g.items.some((i) => i.heading === "Water supply to site"))));
    const d = model.defectGroups.flatMap((g) => g.defects)[0];
    assert.equal(d.item, "Slab formwork dimensions");
  });
});

describe("chosen options as the template prints them", () => {
  it("Weather: the stored value prints as the template's text", () => {
    assert.equal(optionText("weather", "sunny"), "Sunny");
    assert.equal(optionText("weather", "dry"), "Dry");
    assert.equal(optionText("weather", "rain"), "Rain");
    assert.equal(optionText("weather", "intermittent_showers"), "Intermittent Showers");
    assert.equal(optionText("weather", "Intermittent showers"), "Intermittent Showers");
    assert.equal(optionText("weather", "Sunny"), "Sunny");
    assert.equal(optionText("weather", "__other__:light drizzle"), "light drizzle", "a typed answer prints as typed");
  });

  it("the cover prints Weather Conditions: Sunny for a stored \"sunny\"", () => {
    const html = renderToStaticMarkup(createElement(Cover, { r: HEADER, model: build(), inspection: INSPECTION }));
    assert.match(text(html), /Weather Conditions:? Sunny/);
    assert.doesNotMatch(text(html), /\bsunny\b/);
  });
});
