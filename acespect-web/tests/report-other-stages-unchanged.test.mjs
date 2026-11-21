// Every stage except Slab Down & Frame prints exactly as it did on main before the SF wording fix: each construction stage (house and
// apartment, 3 sets of answers that walk through every option, defects with and without a description, numbers and text present and
// empty) is printed and compared with the report main printed before (tests/fixtures/other-stages-report-hashes.json). Pre-pour and Slab
// Down are compared without their Measurements section, whose setbacks and step downs now print the inspector's numbers.
// If another stage's wording is changed on purpose later, regenerate the fixture from that change's base.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { hashes } = JSON.parse(readFileSync(resolve(webRoot, "tests/fixtures/other-stages-report-hashes.json"), "utf8"));
const latest = new Map();
for (const t of JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"))) {
  if (t.inspectionType !== "construction_stage") continue;
  const k = `${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}
const HEADER = { reportDate: "1 Nov 2026", clientName: "C", yourReference: "", ourReference: "R", property: "P", inspectionDate: "1 Nov 2026", weather: "Fine", inspector: "I", inspectorRegistration: "", purpose: "" };
const INSP = { id: "i", jobNo: "R", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "x", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
function answersFor(fields, v) {
  const a = {};
  fields.forEach((f, i) => {
    const opts = (f.options ?? []).map((o) => o.value);
    switch (f.type) {
      case "pill-select": case "color-select": case "select-tiles":
        if (opts.length) { const val = opts[(i + v) % opts.length]; a[f.key] = val;
          if (/defect/.test(val)) a[`${f.key}__defect`] = { location: `Loc ${i}`, category: ["workmanship_outside_tolerance"], severity: ["minor"], comments: v === 1 ? "" : `Comment ${f.key}`, constructionCode: v === 2 ? "AS 1684" : "", photos: [] }; }
        break;
      case "chip-multiselect": case "tile-multiselect": if (opts.length) a[f.key] = opts.slice(v % opts.length, (v % opts.length) + 2); break;
      case "yesno": a[f.key] = (i + v) % 2 ? "yes" : "no"; break;
      case "text": case "textarea": a[f.key] = v === 1 ? "" : `Text ${f.key}`; break;
      case "numeric": a[f.key] = v === 1 ? "" : 100 + i * 7 + v * 40; break;
      case "date": a[f.key] = "2026-11-01"; break;
    }
  });
  return a;
}
const out = {};
for (const prop of ["residential_house", "apartment"]) {
  const keys = [...latest.keys()].filter((k) => k.startsWith(prop + "|")).map((k) => k.split("|")[1]);
  const stages = [...new Set(keys.filter((k) => k !== "job-info").map((k) => k.split("_")[0]))];
  for (const st of stages) for (const v of [0, 1, 2]) for (const part of ["all", "no-measurements"]) {
    if (st === "sf") continue; // Slab Down & Frame's own wording fix
    // Pre-pour and Slab Down: their setbacks and step downs print the numbers now (fix/measurements-prepour-slabdown); every other
    // section of theirs is checked without the Measurements section. Every other stage is checked whole.
    const measured = st === "pp" || st === "sd";
    if ((part === "all") === measured) continue;
    const sections = keys.filter((k) => k.startsWith(st + "_") && (part === "all" || !k.endsWith("_measurements"))).map((key) => {
      const t = latest.get(`${prop}|${key}`); const answers = answersFor(t.fields, v);
      const d = flattenSectionToDraft(t.fields, answers, key, { inspectionType: "construction_stage", propertyType: prop });
      return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
    });
    const model = buildConstructionReport(sections, null, { apartment: prop === "apartment" });
    out[`${prop}|${st}|v${v}${part === "all" ? "" : "|" + part}`] = renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSP, model, header: HEADER }));
  }
}

describe("Other stages print exactly as before the Slab Down & Frame fix", () => {
  it("covers every other stage, house and apartment", () => {
    assert.deepEqual(Object.keys(out).sort(), Object.keys(hashes).sort());
  });
  for (const [k, html] of Object.entries(out)) {
    it(k, () => assert.equal(createHash("sha256").update(html).digest("hex"), hashes[k]));
  }
});
