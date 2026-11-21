// Pre-pour and Slab Down (house and apartment): the setback and step-down number boxes print the inspector's numbers in their office
// templates' sentences ("ACESPECT Pre-pour_Office Template Nov 2026"; Slab Down: the Slab Down part of "ACESPECT Slab Down & Frame_Office
// Template Nov 2026"), never as a status. The rest of these reports is checked unchanged in report-other-stages-unchanged.test.mjs.
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
const { buildConstructionReport, SETBACK_NOTE } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { ConstructionReportBody } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const latest = new Map();
for (const t of JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"))) {
  if (t.inspectionType !== "construction_stage") continue;
  const k = `${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}
const HEADER = { reportDate: "1 Nov 2026", clientName: "C", yourReference: "", ourReference: "R", property: "P", inspectionDate: "1 Nov 2026", weather: "Fine", inspector: "I", inspectorRegistration: "", purpose: "" };
const INSP = { id: "i", jobNo: "R", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "x", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const count = (hay, needle) => hay.split(needle).length - 1;

/** The Measurements section alone, with these answers. */
function report(prop, key, answers) {
  const t = latest.get(`${prop}|${key}`);
  const d = flattenSectionToDraft(t.fields, answers, key, { inspectionType: "construction_stage", propertyType: prop });
  const model = buildConstructionReport([{ key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages }], null, { apartment: prop === "apartment" });
  return { t, model, text: text(renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSP, model, header: HEADER }))) };
}
const SETBACKS = {
  frontDatum: "estimated_from_pegs", frontPlan: 6000, frontSite: 6010, frontResult: "ok",
  rightDatum: "permanent_fence", rightPlan: 1500, rightSite: 1490, rightResult: "variation_okay",
  rearDatum: "brick_wall", rearPlan: 4200, rearSite: "", rearResult: "ok",
  leftDatum: "retaining_wall", leftPlan: "1200", leftSite: "1215", leftResult: "builder_to_recheck",
};
const STEPS = {
  porchSlab: "ok", porchSlabStepPlan: 150, porchSlabStepSite: 155, porchSlabStepResult: "ok",
  alfrescoSlab: "ok", alfrescoSlabStepPlan: 85, alfrescoSlabStepSite: "",
  garageSlab: "ok", garageSlabStepPlan: 100, garageSlabStepSite: 95, garageSlabStepResult: "builder_to_recheck",
};

for (const prop of ["residential_house", "apartment"]) {
  describe(`Pre-pour (${prop}): setbacks in the template's words`, () => {
    const r = report(prop, "pp_measurements", { ...SETBACKS });
    it("each side: As estimated using <datum>. Setbacks on plan are … millimetres and on site are approximately … millimetres.", () => {
      assert.match(r.text, /As estimated from pegs\. Setbacks on plan are 6000 millimetres and on site are approximately 6010 millimetres\./);
      assert.match(r.text, /As estimated using permanent fence\. Setbacks on plan are 1500 millimetres and on site are approximately 1490 millimetres\. Variation appears to be okay\./);
      assert.match(r.text, /As estimated using retaining wall\. Setbacks on plan are 1200 millimetres and on site are approximately 1215 millimetres\. Builder to re-check\./);
    });
    it("an empty number leaves its sentence out; no number box prints as a status", () => {
      assert.match(r.text, /As estimated using brick wall\. (?!Setbacks)/);
      assert.ok(!/on plan are\s+millimetres|approximately\s+millimetres/.test(r.text));
      for (const f of r.t.fields.filter((x) => x.type === "numeric")) assert.ok(!new RegExp(`${f.label}\\s*CHECKED`, "i").test(r.text), f.key);
    });
    it("the land surveying note once, as before", () => assert.equal(count(r.text, SETBACK_NOTE), 1));
  });

  describe(`Slab Down (${prop}): setbacks and step downs in the template's words`, () => {
    const r = report(prop, "sd_measurements", { ...SETBACKS, ...STEPS });
    it("setbacks: Estimated using <datum>. Setbacks on plan are … millimetres and on site are approximately … millimetres.", () => {
      assert.match(r.text, /Estimated from pegs\. Setbacks on plan are 6000 millimetres and on site are approximately 6010 millimetres\./);
      assert.match(r.text, /Estimated using permanent fence\. Setbacks on plan are 1500 millimetres and on site are approximately 1490 millimetres\. Variation appears to be okay\./);
      assert.ok(!/As estimated using (permanent|brick|retaining)/.test(r.text.split("NOTES")[0]));
    });
    it("step downs: Garage step down on plan is … millimetres and on site is … millimetres.", () => {
      assert.match(r.text, /Porch step down on plan is 150 millimetres and on site is 155 millimetres\./);
      assert.match(r.text, /Garage step down on plan is 100 millimetres and on site is 95 millimetres\. Builder to re-check\./);
      assert.ok(!/Alfresco step down on plan/.test(r.text));
    });
    it("no number box prints as a status", () => {
      for (const f of r.t.fields.filter((x) => x.type === "numeric")) assert.ok(!new RegExp(`${f.label.replace(/[()]/g, "\\$&")}\\s*CHECKED`, "i").test(r.text), f.key);
      assert.ok(!/Step Down on Plan|Setback on Plan/.test(r.text)); // the old rows, title case
    });
    it("the land surveying note once, after the setbacks", () => {
      assert.equal(count(r.text, SETBACK_NOTE), 1);
      assert.ok(r.text.indexOf(SETBACK_NOTE) > r.text.indexOf("Left Side Setback") && r.text.indexOf(SETBACK_NOTE) < r.text.indexOf("Porch step down"));
    });
  });
}
