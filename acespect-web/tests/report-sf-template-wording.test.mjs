// The Slab Down & Frame report against its office template ("ACESPECT_Slab_Down__Frame_Office_Template_Nov_2026"), on a FULL report made
// from real data: Yasiru-Test-7-SF's own answers (tests/fixtures/sf-test-7-answers.json) through the real templates, compose.ts,
// reportModel.ts and the printed page. The other stages are checked to print as before.
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
const { STEP_RISER, SELF_LEVELLER, SISALATION_NOT_YET, SF_DEFECT_TEXT } = await server.ssrLoadModule("/src/web/construction/compose.ts");
const { SETBACK_NOTE, SLAB_INTRO, SF_SERVICES_DISCLAIMER, SERVICES_DISCLAIMER } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const latest = new Map();
for (const t of SNAP) {
  if (t.inspectionType !== "construction_stage") continue;
  const k = `${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}
const FIXTURE = JSON.parse(readFileSync(resolve(webRoot, "tests/fixtures/sf-test-7-answers.json"), "utf8"));
const HEADER = { reportDate: "20 Nov 2026", clientName: "C", yourReference: "", ourReference: "Yasiru-Test-7-SF", property: "P", inspectionDate: "19 Nov 2026", weather: "Overcast", inspector: "I", inspectorRegistration: "", purpose: "" };
const INSPECTION = { id: "i", jobNo: "Yasiru-Test-7-SF", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

/** A report from section answers, as the report page makes it; `approved: false` is a section still waiting for the reviewer. */
function report(prop, answersByKey, { approved = true } = {}) {
  const profile = { inspectionType: "construction_stage", propertyType: prop };
  const sections = Object.entries(answersByKey).filter(([k]) => k !== "job-info").map(([key, answers]) => {
    const t = latest.get(`${prop}|${key}`);
    const d = flattenSectionToDraft(t.fields, answers, key, profile);
    return { key, name: t.name, fields: t.fields, answers, approved, reportText: d.reportText, damages: d.damages };
  });
  const model = buildConstructionReport(sections, answersByKey["job-info"] ?? null, { apartment: prop === "apartment" });
  const html = renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header: HEADER }));
  return { model, html, text: text(html) };
}
const SF7 = Object.fromEntries(FIXTURE.sections.map((s) => [s.key, s.answers]));
const full = report("residential_house", SF7);
const allDefects = full.model.defectGroups.flatMap((g) => g.defects);
const clone = (x) => JSON.parse(JSON.stringify(x));
/** SF-7's answers with some changed: { sectionKey: { field: value } } (undefined removes the answer). */
function withAnswers(changes, base = SF7) {
  const out = clone(base);
  for (const [k, ch] of Object.entries(changes)) for (const [f, v] of Object.entries(ch)) { if (v === undefined) delete out[k][f]; else out[k][f] = v; }
  return out;
}
const count = (hay, needle) => hay.split(needle).length - 1;
const tableOf = (m, key) => m.tables.find((t) => t.sectionKey === key);
const itemsOf = (m, key) => tableOf(m, key).groups.flatMap((g) => g.items);

describe("Yasiru-Test-7-SF: the full Slab Down & Frame report from its real answers", () => {
  it("prints the description, the checklist, 22 defects, the notes and the photographs", () => {
    assert.equal(full.model.stage, "slab_frame");
    assert.equal(full.model.defectCount, 22, "20 checklist defects and the 2 rows of the Defects table");
    assert.equal((full.html.match(/<img/g) ?? []).length, 174, "the photographs printed in the body (as before this change)");
    assert.equal(full.model.waitingSections.length, 0);
  });
});

describe("1. General Description: the owners line in the template's words", () => {
  it("not present / present", () => {
    assert.ok(full.model.description.includes("The owners were not present for the inspection."), full.model.description.join(" | "));
    assert.doesNotMatch(full.text, /The owner was not onsite/);
    const yes = report("residential_house", withAnswers({ sf_description: { ownersOnSite: "yes" } }));
    assert.ok(yes.model.description.includes("The owners were present for the inspection."));
    assert.ok(full.model.description.includes("The block is gently sloping."), "gently sloping as it is");
  });
});

describe("2. The SLAB sentence", () => {
  it("is printed once, under the slab heading, above the first slab checks", () => {
    assert.equal(tableOf(full.model, "sf_measurements").intro, SLAB_INTRO);
    assert.equal(SLAB_INTRO, "These items were checked for construction and workmanship.");
    assert.equal(count(full.text, SLAB_INTRO), 1);
    // Under the SITE & SLAB MEASUREMENTS title, not above it (where it would read as the end of Site & Facilities).
    const head = full.text.indexOf("SITE & SLAB MEASUREMENTS");
    const sentence = full.text.indexOf(SLAB_INTRO);
    assert.ok(head >= 0 && sentence > head && sentence < full.text.indexOf("Boundary Survey Pegs", head));
  });
});

describe("3. Measurements print the inspector's numbers, never only a status", () => {
  const after = (m) => itemsOf(m, "sf_measurements").map((it) => it.after ?? "");
  it("setbacks, per side, as the template", () => {
    const a = after(full.model);
    assert.ok(a.includes("Estimated from pegs. Setbacks on plan are 6000 millimetres and on site are approximately 6010 millimetres."), a.join(" | "));
    assert.ok(a.includes("Estimated using permanent fence. Setbacks on plan are 1500 millimetres and on site are approximately 1490 millimetres. Variation appears to be okay."));
    assert.ok(a.includes("Estimated using retaining wall. Setbacks on plan are 4200 millimetres and on site are approximately 4185 millimetres. Builder to re-check."));
    assert.ok(a.includes("Estimated using brick wall. Setbacks on plan are 1200 millimetres and on site are approximately 1215 millimetres."));
    for (const t of [6000, 6010, 1500, 1490, 4200, 4185, 1200, 1215]) assert.match(full.text, new RegExp(`${t} millimetres`));
  });
  it("step downs and slab dimensions", () => {
    const a = after(full.model);
    for (const s of ["Garage step down on plan is 100 millimetres and on site is 95 millimetres.", "Porch step down on plan is 150 millimetres and on site is 155 millimetres.",
      "Alfresco step down on plan is 85 millimetres and on site is 90 millimetres.", "Slab width on plan is 12400 millimetres and on site is 12395 millimetres.",
      "Slab length on plan is 21600 millimetres and on site is 21565 millimetres."]) assert.ok(a.includes(s), `${s}\n${a.join(" | ")}`);
  });
  it("no number box is its own row printed as a status", () => {
    const h = itemsOf(full.model, "sf_measurements").map((it) => it.heading);
    assert.ok(!h.some((x) => /on plan|on site|result|datum/i.test(x)), h.join(" | "));
  });
  it("a number the app kept as text prints the same; an empty number leaves its sentence out", () => {
    const asText = report("residential_house", withAnswers({ sf_measurements: { frontPlan: "6000", frontSite: "6010" } }));
    assert.ok(after(asText.model).includes("Estimated from pegs. Setbacks on plan are 6000 millimetres and on site are approximately 6010 millimetres."));
    const empty = report("residential_house", withAnswers({ sf_measurements: { frontSite: undefined, garageSlabStepSite: "" } }));
    assert.doesNotMatch(empty.text, /on plan are\s+millimetres|on site are approximately\s+millimetres|on site is\s+millimetres|—\s+millimetres/);
    assert.ok(after(empty.model).includes("Estimated from pegs."));
    assert.ok(!after(empty.model).some((x) => /Garage step down/.test(x)));
  });
});

describe("4. The land surveying note after the setbacks", () => {
  it("once, after the last setback", () => {
    const groups = tableOf(full.model, "sf_measurements").groups;
    const i = groups.findIndex((g) => g.closing === SETBACK_NOTE);
    assert.ok(i >= 0);
    assert.match(groups[i].items.map((x) => x.heading).join(), /Left Side Setback/i);
    assert.equal(count(full.text, SETBACK_NOTE), 1);
  });
});

describe("5. The services disclaimer after Services", () => {
  it("once, in the template's words; the services statuses as before", () => {
    assert.deepEqual(tableOf(full.model, "sf_services").closing, [SF_SERVICES_DISCLAIMER]);
    assert.equal(count(full.text, SF_SERVICES_DISCLAIMER), 1);
    assert.ok(!full.text.includes(SERVICES_DISCLAIMER));
    assert.deepEqual(tableOf(full.model, "sf_services").counts, { ok: 2, progress: 2, defect: 0, note: 1, notcomplete: 1, na: 0 });
  });
});

describe("6. Defects as the inspector wrote them, no Severity / Category, words not codes, no EXTERNAL / INTERNAL", () => {
  it("the description first; the row's name only when nothing was written", () => {
    const poly = allDefects.find((d) => /Vapour barrier torn/.test(d.description));
    assert.equal(poly.description, "Vapour barrier torn and not lapped up the slab edge.");
    const none = report("residential_house", withAnswers({ sf_roof_frame: { roofTrusses__defect: { ...SF7.sf_roof_frame.roofTrusses__defect, comments: "" } } }));
    assert.ok(none.model.defectGroups.flatMap((g) => g.defects).some((d) => /^Roof trusses/i.test(d.description)));
  });
  it("no Severity / Category line on the page; the data is kept", () => {
    assert.doesNotMatch(full.text, /Severity:|Category:/);
    assert.ok(allDefects.some((d) => d.severity && d.category));
  });
  it("an answer the form no longer offers prints in words", () => {
    const old = report("residential_house", withAnswers({ sf_site_facilities: { powerSupply: "temporary_pole_only" } }));
    assert.doesNotMatch(old.text, /temporary_pole_only/);
  });
  it("no EXTERNAL / INTERNAL headings", () => {
    assert.ok(full.model.defectGroups.every((g) => !g.area));
    assert.doesNotMatch(full.html, /data-defect-area/);
  });
});

describe("7. The template's reviewer notes, only when a field decides them, never twice", () => {
  const defects = (m) => m.defectGroups.flatMap((g) => g.defects);
  it("Slab Surface Levels defect -> the self-leveller sentence right after it", () => {
    const d = allDefects.find((x) => /12 mm out of level/.test(x.description));
    assert.ok(d.description.endsWith(SELF_LEVELLER));
    assert.equal(count(full.text, SELF_LEVELLER), 1);
  });
  it("a step down over 190 mm -> the riser note after its defect, or in Notes", () => {
    assert.ok(!full.text.includes(STEP_RISER), "no step over 190 mm in SF-7");
    const note = report("residential_house", withAnswers({ sf_measurements: { garageSlabStepSite: 200, porchSlabStepSite: "195" } }));
    assert.equal(count(note.text, STEP_RISER), 1);
    assert.ok(note.model.notes.includes(STEP_RISER));
    const def = report("residential_house", withAnswers({ sf_measurements: { garageSlabStepSite: 200, garageSlab: "defect", garageSlab__defect: { location: "Garage", category: [], severity: [], comments: "Step is too high.", constructionCode: "", photos: [] } } }));
    assert.equal(count(def.text, STEP_RISER), 1);
    assert.ok(defects(def.model).some((d) => d.description === `Step is too high. ${STEP_RISER}`));
  });
  it("polyethylene and builder's sign defects with no description -> the template's text", () => {
    const m = report("residential_house", withAnswers({
      sf_quality: { polythene__defect: { ...SF7.sf_quality.polythene__defect, comments: "" } },
      sf_site_facilities: { builderSign: "no_defect", builderSign__defect: { location: "", category: [], severity: [], comments: "", constructionCode: "", photos: [] } },
    })).model;
    assert.ok(defects(m).some((d) => d.description === SF_DEFECT_TEXT.polythene));
    assert.ok(defects(m).some((d) => d.description === SF_DEFECT_TEXT.builderSign));
  });
  it("security fence not OK -> its note once; sisalation not yet -> its note", () => {
    const m = report("residential_house", withAnswers({ sf_site_facilities: { securityFencing: "no_see_notes" }, sf_wall_floor: { sisalation: "not_yet" } }));
    assert.equal(count(m.text, "Sections of the security fence are not in position and need to be re-instated."), 1);
    assert.equal(count(m.text, SISALATION_NOT_YET), 1);
  });
});

describe("Other stages print as before", () => {
  // SF-7's answers as the Slab Down and Framework stages' own sections (the same questions).
  const as = (prefix, keys) => Object.fromEntries(Object.entries(SF7).filter(([k]) => k === "job-info" || keys.includes(k.slice(3))).map(([k, v]) => [k === "job-info" ? k : `${prefix}${k.slice(3)}`, v]));
  const sd = report("residential_house", as("sd_", ["description", "site_facilities", "measurements", "quality", "defects", "summary"]));
  const fr = report("residential_house", as("fr_", ["description", "site_facilities", "services", "roof_frame", "wall_floor", "windows_doors", "defects", "summary"]));
  it("Slab Down and Framework keep their wording", () => {
    for (const r of [sd, fr]) {
      assert.match(r.text, /The owner was not onsite at the time of inspection\./);
      assert.match(r.text, /Severity:/);
      assert.ok(!r.text.includes(SF_SERVICES_DISCLAIMER));
      assert.ok(!r.text.includes(SELF_LEVELLER));
      assert.ok(!r.model.tables.some((t) => t.intro === SLAB_INTRO));
    }
    assert.ok(!sd.text.includes(SETBACK_NOTE));
    assert.ok(!sd.model.tables.flatMap((t) => t.groups).flatMap((g) => g.items).some((it) => it.after && /millimetres/.test(it.after)));
  });
});
