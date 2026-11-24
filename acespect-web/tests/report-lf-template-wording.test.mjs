// The Lock-up & Fixing report against its office template ("ACESPECT Lock-up and Fixing Combined_Office Template Nov 2026"), on a FULL
// report made from real data: Yasiru-Test-6-LF's own answers (tests/fixtures/lf-test-6-answers.json) through the real templates
// (templates-snapshot.json), compose.ts, reportModel.ts and the printed page (ConstructionReport.tsx). The other stages are checked to
// print exactly as before.
//
//   1. Site management: one sentence for the answer.         6. The upper guttering OH&S sentence once, under its row.
//   2. General Description in the template's order.          7. No group name in front of an "Other" box's note ("Painting: …").
//   3. A defect reads as the inspector described it.         8. Kerb damage: the template's sentence once, then the inspector's note.
//   4. No "Severity / Category" line on the report.          9. An answer the form no longer offers prints as words, not its code.
//   5. Defects under EXTERNAL and INTERNAL.
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
const { composeConstructionSection, TAGS, WELL_MANAGED, CLEAN_UP, KERB, OHS } = await server.ssrLoadModule("/src/web/construction/compose.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const latest = new Map();
for (const t of SNAP) {
  if (t.inspectionType !== "construction_stage") continue;
  const k = `${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}
const FIXTURE = JSON.parse(readFileSync(resolve(webRoot, "tests/fixtures/lf-test-6-answers.json"), "utf8"));
const HEADER = { reportDate: "20 Nov 2026", clientName: "C", yourReference: "", ourReference: "Yasiru-Test-6-LF", property: "P", inspectionDate: "19 Nov 2026", weather: "Overcast", inspector: "I", inspectorRegistration: "", purpose: "" };
const INSPECTION = { id: "i", jobNo: "Yasiru-Test-6-LF", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
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
const LF6 = Object.fromEntries(FIXTURE.sections.map((s) => [s.key, s.answers]));
const full = report("residential_house", LF6);
const allDefects = full.model.defectGroups.flatMap((g) => g.defects);

// ───────────────────────── The whole report, from real data ─────────────────────────

describe("Yasiru-Test-6-LF: the full Lock-up & Fixing report from its real answers", () => {
  it("prints the General Description, every checklist table with its counts, the defects, the notes and the photos", () => {
    assert.equal(full.model.stage, "lock_fix");
    assert.equal(full.model.description.length, 11, full.model.description.join(" | "));
    assert.ok(full.model.tables.length >= 9, `${full.model.tables.length} checklist tables`);
    assert.deepEqual(full.model.totals, { ok: 165, progress: 5, defect: 19, note: 9, notcomplete: 9, na: 7 });
    assert.equal(full.model.defectCount, 22);
    assert.ok(full.model.notes.length >= 10, full.model.notes.join(" | "));
    assert.equal((full.html.match(/<img/g) ?? []).length, 174, "every photograph is on the page");
    assert.doesNotMatch(full.text, /No defects were identified/);
    assert.equal(full.model.waitingSections.length, 0);
  });
  it("the same report with its sections still waiting for the reviewer prints none of them -- what an 'empty report' is", () => {
    // The report prints approved sections only (ConstructionReport.tsx, useConstructionReport): before a reviewer approves them, the
    // PDF has no description, every count 0, "No defects were identified", no photos -- and names the waiting sections.
    const waiting = report("residential_house", LF6, { approved: false });
    assert.deepEqual(waiting.model.description, []);
    assert.equal(waiting.model.defectCount, 0);
    assert.equal(Object.values(waiting.model.totals).reduce((x, y) => x + y, 0), 0);
    assert.match(waiting.text, /No defects were identified/);
    assert.match(waiting.text, /Not printed yet — awaiting reviewer approval: /);
    assert.equal(waiting.model.waitingSections.length, FIXTURE.sections.length - 1);
  });
  it("keeps the foundation wording: '… double storey on stumps.' (never 'on a stumps')", () => {
    assert.ok(full.model.description.includes("The construction is a double storey on stumps."), full.model.description.join(" | "));
    assert.doesNotMatch(full.text, /on a stumps/);
  });
});

// ───────────────────────── 1. Site management ─────────────────────────

const site = (patch) => {
  const t = latest.get("residential_house|lf_site_facilities");
  const a = { ...LF6.lf_site_facilities, ...patch };
  return composeConstructionSection("lf_site_facilities", t.fields, a, false).text.split(/\n+/).filter((l) => l.startsWith(TAGS.note)).map((l) => l.slice(TAGS.note.length));
};
describe("1. 'Is the site well managed?': only the sentence that matches the answer", () => {
  it("'Can be improved by cleaning up rubbish …' -> only the clean-up sentence, once; never 'Site appears to be well managed.'", () => {
    assert.ok(!full.model.notes.includes(WELL_MANAGED), full.model.notes.join(" | "));
    assert.equal(full.model.notes.filter((n) => n === CLEAN_UP).length, 1);
  });
  it("'Yes' (no rubbish) -> 'Site appears to be well managed.', and no clean-up sentence", () => {
    const n = site({ siteManaged: "yes", rubbishDangerous: "no" });
    assert.ok(n.includes(WELL_MANAGED), n.join(" | "));
    assert.ok(!n.includes(CLEAN_UP), n.join(" | "));
  });
  it("'Yes' but rubbish is dangerous -> the clean-up sentence once (it is about the rubbish)", () => {
    const n = site({ siteManaged: "yes", rubbishDangerous: "yes" });
    assert.equal(n.filter((x) => x === CLEAN_UP).length, 1);
  });
});

// ───────────────────────── 2. General Description order ─────────────────────────

describe("2. the General Description in the template's order", () => {
  it("builder, construction, wall cladding, roof, windows, frontage, block, supervisor, owner, safety, progress", () => {
    const order = [/^The property is being constructed by/, /^The construction is a/, /^Wall cladding is/, /^The roof design is/, /^Windows are/, /^The street frontage/, /^The block is/, /^The site supervisor/, /^The owner/, /^Safety issues/, /^The progress of the works/];
    assert.deepEqual(full.model.description.map((d) => order.findIndex((re) => re.test(d))), order.map((_, i) => i), full.model.description.join(" | "));
  });
});

// ───────────────────────── 3 & 4. The defect line ─────────────────────────

describe("3. a defect reads as the inspector described it; 4. no Severity / Category line", () => {
  it("each line is the inspector's description, not the row's name in front, then 'Please refer to Photograph(s) …'", () => {
    for (const d of allDefects.filter((x) => x.item)) assert.ok(!d.description.startsWith(d.item), `${d.no}: ${d.description}`);
    assert.match(full.text, /Plasterboard offcuts and packaging with protruding staples across the access path; trip hazard\. Please refer to Photograph/);
    assert.doesNotMatch(full.text, /Rubbish Dangerous on Site\. Plasterboard/);
    assert.doesNotMatch(full.text, /Plaster Finish Okay\. |Upper Roof — Generally Appears to Be\. |Finish to Doors Okay \(Sealed Top & Bottom\)\. /);
  });
  it("a defect with no description falls back to the row's name", () => {
    const t = latest.get("residential_house|lf_external_walls");
    const a = { ...LF6.lf_external_walls, weepHoles__defect: { ...LF6.lf_external_walls.weepHoles__defect, comments: "" } };
    const { damages } = composeConstructionSection("lf_external_walls", t.fields, a, false);
    assert.ok(damages.some((d) => d.description === "Weep holes."), damages.map((d) => d.description).join(" | "));
  });
  it("prints no 'Severity:' / 'Category:' line (the data is kept: the reviewer's section text still has it)", () => {
    assert.doesNotMatch(full.text, /Severity:|Category:/);
    assert.ok(allDefects.some((d) => d.severity && d.category), "kept in the model (web review screen)");
    const t = latest.get("residential_house|lf_external_walls");
    assert.match(composeConstructionSection("lf_external_walls", t.fields, LF6.lf_external_walls, false).text, /Severity: /);
  });
});

// ───────────────────────── 5. EXTERNAL / INTERNAL ─────────────────────────

describe("5. defects under the template's EXTERNAL and INTERNAL headings", () => {
  const where = Object.fromEntries(full.model.defectGroups.filter((g) => g.defects.length).map((g) => [`${g.area}>${g.heading}`, g.defects.map((d) => d.no)]));
  it("EXTERNAL then INTERNAL, each printed once, numbered in that order", () => {
    assert.deepEqual((full.html.match(/data-defect-area=""[^>]*>(EXTERNAL|INTERNAL)</g) ?? []).map((x) => x.replace(/.*>|</g, "")), ["EXTERNAL", "INTERNAL"]);
    const areas = full.model.defectGroups.filter((g) => g.defects.length).map((g) => g.area);
    assert.equal(areas.lastIndexOf("EXTERNAL") < areas.indexOf("INTERNAL"), true, areas.join(","));
    assert.deepEqual(allDefects.map((d) => d.no), allDefects.map((_, i) => i + 1));
  });
  it("the sub-headings sit under the right one (site, walls, roof, external doors and windows outside; the rest inside)", () => {
    for (const k of ["EXTERNAL>Site and facilities", "EXTERNAL>Masonry / brick work", "EXTERNAL>Hebel", "EXTERNAL>Roof covering, flashings", "EXTERNAL>Gutters and downpipes", "EXTERNAL>Doors",
      "INTERNAL>Walls and ceilings", "INTERNAL>Stairwell/s", "INTERNAL>Floors", "INTERNAL>Internal doors", "INTERNAL>Archs & skirtings", "INTERNAL>Laundry", "INTERNAL>Balcony waterproofing"]) {
      assert.ok(where[k], `${k} in ${Object.keys(where).join(" | ")}`);
    }
  });
  it("the general Defects list prints last under the heading its rows belong to (here the garage and the porch: EXTERNAL)", () => {
    assert.deepEqual(where["EXTERNAL>General"], [12, 13]);
    const ext = full.model.defectGroups.filter((g) => g.area === "EXTERNAL" && g.defects.length);
    assert.equal(ext[ext.length - 1].heading, "General");
  });
  it("a heading with no defects is not printed", () => {
    assert.ok(full.model.defectGroups.every((g) => g.defects.length > 0 || !full.text.includes(` ${g.heading} `)));
  });
});

// ───────────────────────── 6, 7, 8. Notes ─────────────────────────

describe("6. the upper guttering OH&S sentence is printed once, under the Roof gutters row", () => {
  it("in the row, not again in Notes", () => {
    assert.equal(full.text.split(OHS.gutters).length - 1, 1);
    assert.ok(!full.model.notes.some((n) => n.startsWith(OHS.gutters)), full.model.notes.join(" | "));
    const rows = full.model.tables.flatMap((t) => t.groups.flatMap((g) => g.items));
    assert.ok(rows.find((r) => r.heading === "Roof gutters").after.startsWith(OHS.gutters));
  });
});
describe("7. an 'Other' box's note: the row's own name, or none -- never a group's name that reads wrong", () => {
  it("the fit-out's 'Other?' -> the inspector's words alone (not 'Painting: Kitchen island end panel …')", () => {
    assert.ok(full.model.notes.includes("Kitchen island end panel is not yet fixed; waiting on the stone benchtop."), full.model.notes.join(" | "));
    assert.ok(!full.model.notes.some((n) => /^Painting: /.test(n)));
  });
  it("rows whose own name says what it is keep it: 'Hebel: …', 'Stairwell/s: …'", () => {
    assert.ok(full.model.notes.some((n) => /^Hebel: Hebel panel joints/.test(n)));
    assert.ok(full.model.notes.some((n) => /^Stairwell\/s: Temporary stair treads/.test(n)));
  });
});
describe("8. kerb damage: the template's sentence once, then the inspector's own note (no 'Site and facilities:')", () => {
  it("one note", () => {
    const kerb = full.model.notes.filter((n) => n.startsWith("Damage was noted to the footpath"));
    assert.deepEqual(kerb, [`${KERB} Concrete crossover has a corner broken off at the kerb; the builder should repair it before handover.`]);
    assert.ok(!full.model.notes.some((n) => /^Site and facilities: /.test(n)), full.model.notes.join(" | "));
  });
  it("no kerb note typed -> the template's sentence alone", () => {
    const n = site({ kerbOther: "" });
    assert.ok(n.includes(KERB), n.join(" | "));
  });
});

// ───────────────────────── 9. Old option values ─────────────────────────

describe("9. an answer the form no longer offers (an older inspection) prints as words, never as its code", () => {
  it("a checklist row, a description answer and a defect's old category / severity", () => {
    const walls = { ...LF6.lf_external_walls, weepHoles__defect: { ...LF6.lf_external_walls.weepHoles__defect, category: ["material_product_defect"], severity: ["weatherproofing"] } };
    const r = report("residential_house", { ...LF6, lf_description: { ...LF6.lf_description, windowsAre: "powder_coated_steel" }, lf_site_facilities: { ...LF6.lf_site_facilities, builderSign: "removed_by_builder" }, lf_external_walls: walls });
    assert.ok(r.model.description.includes("Windows are constructed of powder coated steel."), r.model.description.join(" | "));
    const sign = r.model.tables.flatMap((t) => t.groups.flatMap((g) => g.items)).find((i) => /builder's sign/i.test(i.heading));
    assert.equal(sign.text, "Removed by builder.", "the row's sentence (shown in the reviewer portal; an OK row prints its status)");
    assert.doesNotMatch(r.text, /powder_coated_steel|removed_by_builder|material_product_defect|weatherproofing\b/);
    const t = latest.get("residential_house|lf_external_walls");
    assert.match(composeConstructionSection("lf_external_walls", t.fields, walls, false).text, /Category: [^.]*Material product defect/);
  });
});

// ───────────────────────── The other stages print as before ─────────────────────────

describe("the other stages are unchanged (Pre-pour, Slab, Frame, Lock-up, Fixing, PCI; House and Apartment)", () => {
  // Slab + Frame has its own template wording now (report-sf-template-wording.test.mjs).
  const OTHERS = ["pp_", "sd_", "fr_", "lu_", "fx_", "pci_"];
  const answerFor = (f) => {
    if (f.type === "pill-select" && f.options?.length) return (f.defectOn?.length ? f.options.find((o) => f.defectOn.includes(o.value)) : f.options[0]).value;
    if (f.type === "yesno") return "yes";
    return undefined;
  };
  for (const prop of ["residential_house", "apartment"]) for (const prefix of OTHERS) {
    const keys = [...latest.keys()].filter((k) => k.startsWith(`${prop}|${prefix}`)).map((k) => k.split("|")[1]);
    if (!keys.length) continue;
    it(`${prefix} (${prop}): Severity / Category still printed, no EXTERNAL / INTERNAL headings, defects keep the row's name, Windows before Roof`, () => {
      const answers = {};
      for (const key of keys) {
        const t = latest.get(`${prop}|${key}`);
        const a = {};
        for (const f of t.fields) {
          const v = answerFor(f);
          if (v === undefined) continue;
          a[f.key] = v;
          if (f.defectOn?.includes(v)) a[`${f.key}__defect`] = { location: "Front", comments: "Needs fixing.", category: ["non_compliant_ncc_as"], severity: ["minor"] };
        }
        if (key.endsWith("_description")) Object.assign(a, { windowsAre: t.fields.find((x) => x.key === "windowsAre")?.options?.[0]?.value, roofDesign: t.fields.find((x) => x.key === "roofDesign")?.options?.[0]?.value });
        answers[key] = a;
      }
      const r = report(prop, answers);
      if (!r.model) return;
      if (r.model.defectCount > 0) {
        assert.match(r.text, /Severity:/);
        assert.match(r.text, /Category:/);
        assert.doesNotMatch(r.html, /data-defect-area=/);
        assert.ok(r.model.defectGroups.every((g) => g.area === undefined));
        const withItem = r.model.defectGroups.flatMap((g) => g.defects).filter((d) => d.item && d.heading === "Front");
        if (withItem.length) assert.ok(withItem.some((d) => d.description.startsWith(d.item)), withItem.map((d) => d.description).join(" | "));
      }
      const w = r.model.description.findIndex((d) => /^Windows are/.test(d)), roof = r.model.description.findIndex((d) => /^The roof design/.test(d));
      if (w !== -1 && roof !== -1) assert.ok(w < roof, r.model.description.join(" | "));
    });
  }
});
