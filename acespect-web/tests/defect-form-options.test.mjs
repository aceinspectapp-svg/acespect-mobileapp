// The defect form (Location, Category, Severity, Photographs, Comments, Construction code) that opens under a row answered "Defect".
// Category offers only the three Houspect categories and Severity only Major / Minor / Cosmetic / Structural, from one shared list,
// in every Construction stage; a defect saved earlier with a choice no longer offered still opens and prints.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { DEFECT_DETAIL_FIELDS, isDefectAnswer } = await server.ssrLoadModule("/src/web/construction/defectDetail.ts");
const { CATEGORY_LABELS, SEVERITY_LABELS } = await server.ssrLoadModule("/src/web/construction/words.ts");
const { buildConstructionReport } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const CATEGORIES = ["non_compliant_plans_specs", "non_compliant_ncc_as", "workmanship_outside_tolerance"];
const SEVERITIES = ["major", "minor", "cosmetic", "structural"];
const optionValues = (key) => DEFECT_DETAIL_FIELDS.find((f) => f.key === key).options.map((o) => o.value);

// The real templates, newest version of each section.
const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const latest = new Map();
for (const t of SNAP) {
  const k = `${t.inspectionType}|${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}
const templates = [...latest.values()];
/** Rows that open the defect form (a `defectOn` answer, or a red answer), at any depth. */
function defectRows(fields, out = []) {
  for (const f of fields ?? []) {
    if (f.type === "pill-select" && (f.options ?? []).some((o) => isDefectAnswer(f, o.value))) out.push(f);
    defectRows(f.itemFields, out);
  }
  return out;
}
const firstDefectAnswer = (f) => f.options.find((o) => isDefectAnswer(f, o.value)).value;
const profile = (t) => ({ inspectionType: t.inspectionType, propertyType: t.propertyType });

describe("Defect form: Category and Severity choices", () => {
  it("offers only the three categories and the four severities", () => {
    assert.deepEqual(optionValues("category"), CATEGORIES);
    assert.deepEqual(optionValues("category").map((v) => CATEGORY_LABELS[v]), ["Non-compliant with approved plans/specs", "Non-compliant with NCC/AS", "Workmanship outside tolerance"]);
    assert.deepEqual(optionValues("severity"), SEVERITIES);
    assert.deepEqual(optionValues("severity").map((v) => SEVERITY_LABELS[v]), ["Major", "Minor", "Cosmetic", "Structural"]);
  });

  it("keeps the rest of the form as it was", () => {
    assert.deepEqual(DEFECT_DETAIL_FIELDS.map((f) => [f.key, !!f.required]), [
      ["location", true], ["category", true], ["severity", true], ["photos", true], ["comments", false], ["constructionCode", false],
    ]);
  });

  it("comes from one shared list: no other web source file defines these choices", () => {
    const files = [];
    const walk = (d) => { for (const n of readdirSync(d)) { const p = resolve(d, n); statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && files.push(p); } };
    walk(resolve(webRoot, "src"));
    const defining = files.filter((p) => /workmanship_outside_tolerance|non_compliant_ncc_as/.test(readFileSync(p, "utf8"))).map((p) => p.slice(webRoot.length + 1));
    assert.deepEqual(defining, ["src/web/construction/words.ts"]);
    const editor = readFileSync(resolve(webRoot, "src/web/components/SectionFieldEditor.tsx"), "utf8");
    assert.match(editor, /fields=\{DEFECT_DETAIL_FIELDS\}/);
  });
});

describe("Defect form: where it is used", () => {
  const byType = new Map();
  for (const t of templates) {
    const n = defectRows(t.fields).length;
    const k = `${t.inspectionType} / ${t.propertyType}`;
    byType.set(k, (byType.get(k) ?? 0) + n);
  }

  it("opens only in Construction Stage sections, every stage and property type", () => {
    for (const [k, n] of byType) {
      if (k.startsWith("construction_stage")) assert.ok(n > 0, `${k} has defect rows`);
      else assert.equal(n, 0, `${k} has no defect rows`);
    }
    const stages = new Set(templates.filter((t) => t.inspectionType === "construction_stage" && defectRows(t.fields).length).map((t) => t.sectionKey.split("_")[0]));
    assert.deepEqual([...stages].sort(), ["fr", "fx", "lf", "lu", "pci", "pp", "sd", "sf"]);
  });

  it("prints the chosen category and severity for a defect row in every Construction section", () => {
    let checked = 0;
    for (const t of templates.filter((x) => x.inspectionType === "construction_stage")) {
      const rows = defectRows(t.fields).filter((f) => !f.gate && t.fields.includes(f));
      if (!rows.length) continue;
      const f = rows[0];
      const answers = { [f.key]: firstDefectAnswer(f), [`${f.key}__defect`]: { location: "Garage", category: ["non_compliant_ncc_as"], severity: ["minor", "cosmetic"], photos: ["/a.jpg"] } };
      const d = flattenSectionToDraft(t.fields, answers, t.sectionKey, profile(t));
      assert.match(d.reportText, /Severity: Minor, Cosmetic\./, `${t.propertyType} ${t.sectionKey}`);
      assert.match(d.reportText, /Category: Non-compliant with NCC\/AS\./, `${t.propertyType} ${t.sectionKey}`);
      checked++;
    }
    assert.ok(checked >= 16, `checked ${checked} sections`);
  });
});

describe("Defect form: a defect saved with a choice no longer offered", () => {
  it("still composes and builds a report, with the defect numbered", () => {
    const t = latest.get("construction_stage|residential_house|pp_general");
    const old = { siteDrainage: "yes_defect", siteDrainage__defect: { location: "Right side", category: ["damage", "incomplete_work"], severity: ["safety", "major"], photos: ["/a.jpg"], comments: "Water ponding." } };
    const d = flattenSectionToDraft(t.fields, old, t.sectionKey, profile(t));
    const job = latest.get("construction_stage|residential_house|job-info");
    const jobDraft = flattenSectionToDraft(job.fields, { constructionStage: "pre_pour" }, "job-info", profile(t));
    const model = buildConstructionReport(
      [
        { key: "job-info", name: "Job Information", fields: job.fields, answers: { constructionStage: "pre_pour" }, approved: true, reportText: jobDraft.reportText, damages: [] },
        { key: "pp_general", name: t.name, fields: t.fields, answers: old, approved: true, reportText: d.reportText, damages: d.damages },
      ],
      { constructionStage: "pre_pour" },
    );
    assert.ok(model);
    const defects = model.defectGroups.flatMap((g) => g.defects);
    assert.equal(defects.length, 1);
    assert.equal(defects[0].no, 1);
    assert.match(defects[0].severity, /Major/);
    assert.ok(defects[0].category.length > 0);
  });
});
