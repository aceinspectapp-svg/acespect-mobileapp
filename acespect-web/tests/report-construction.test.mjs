// The Construction Report: a submitted Construction Stage inspection becomes the report content laid out by Houspect's
// office templates (description, checklist sentences, numbered defects with photos, notes, references).
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { buildConstructionReport, stageOfSectionKeys, referencedCodes } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { wordingFor } = await server.ssrLoadModule("/src/web/wording/registry.ts");

const OK = "#1FA463", BAD = "#E63329", WARN = "#E8A33D", NA = "#94A1B2";
const row = (key, label, order, extra = {}) => ({
  key, label, order, type: "pill-select", sectionLetter: "Roof", defectOn: ["defect"],
  options: [{ value: "ok", label: "OK", color: OK }, { value: "n_a", label: "N/A", color: NA }, { value: "defect", label: "Defect", color: BAD }],
  ...extra,
});
const photos = (n) => Array.from({ length: n }, (_, i) => `/p${i}.jpg`);
const defect = (over = {}) => ({ location: "Front left roof", category: ["workmanship_outside_tolerance"], severity: ["major", "safety"], photos: photos(2), comments: "Needs repair.", constructionCode: "2.04", ...over });

/** A section as the reviewer portal shows it: the report text and defects the Construction Stage wording writes from its answers. */
const section = (key, name, fields, answers, approved = true) => {
  const derived = flattenSectionToDraft(fields, answers, key, { inspectionType: "construction_stage", propertyType: "residential_house" });
  return { key, name, fields, answers, approved, reportText: derived.reportText, damages: derived.damages };
};

const description = section("pci_description", "Description & Overview",
  [
    { key: "constructedBy", label: "Constructed by", type: "pill-select", order: 0, options: [{ value: "metricon", label: "Metricon" }] },
    { key: "design", label: "Design", type: "pill-select", order: 1, options: [{ value: "single", label: "Single storey" }] },
    { key: "foundations", label: "Foundations are", type: "pill-select", order: 2, options: [{ value: "slab", label: "Concrete slab" }] },
    { key: "supervisorOnSite", label: "Supervisor on site", type: "yesno", order: 3 },
    { key: "ownersOnSite", label: "Owners on site", type: "yesno", order: 4 },
    { key: "streetPhotos", label: "Street", type: "photos", order: 5 },
  ],
  { constructedBy: "metricon", design: "single", foundations: "slab", supervisorOnSite: "yes", ownersOnSite: "no", streetPhotos: photos(1) });

const roof = section("pci_roof", "PCI Checklist: External — Roof",
  [
    row("covering", "Covering; cracked tiles", 0),
    row("gutters", "Gutters; clipped", 1),
    row("guttersDebris", "Gutters; debris", 2),
    row("skylights", "Skylights; damaged, flashed", 3),
  ],
  { covering: "ok", gutters: "ok", guttersDebris: "defect", guttersDebris__defect: defect(), skylights: "n_a" });

const internal = section("pci_internal", "PCI Checklist: Internal — Rooms",
  [row("bed1", "Bedroom 1 and Ensuite", 0, { sectionLetter: "Internal" })],
  { bed1: "defect", bed1__defect: defect({ location: "Bed 1 wall", constructionCode: "", photos: [] }) });

const summary = section("pci_summary", "Statement & Notes",
  [{ key: "workmanshipSatisfactory", label: "Workmanship", type: "yesno", order: 0 }],
  { workmanshipSatisfactory: "yes" });

const jobInfo = { stageOptionPci: "handover_appliances_installed_or_some_installed" };

describe("construction report", () => {
  it("knows the stage from the section keys", () => {
    assert.equal(stageOfSectionKeys(["pp_description"]), "pre_pour");
    assert.equal(stageOfSectionKeys(["sf_roof_frame"]), "slab_frame");
    assert.equal(stageOfSectionKeys(["lf_services"]), "lock_fix");
    assert.equal(stageOfSectionKeys(["pci_roof"]), "pci");
    assert.equal(stageOfSectionKeys(["driveway"]), null);
  });

  const model = buildConstructionReport([description, roof, internal, summary], jobInfo);

  it("writes the General Description sentences", () => {
    assert.ok(model.description.includes("The property is being constructed by Metricon."));
    assert.ok(model.description.includes("The construction is a single storey on a concrete slab."));
    assert.ok(model.description.includes("The owner was not onsite at the time of inspection."));
    assert.ok(model.description.some((l) => /approaching|handover/i.test(l)));
    assert.equal(model.stageLabel, "Handover");
  });

  it("gives every checklist row a status and one sentence, keeps N/A rows, and tells repeated names apart", () => {
    const items = model.tables.flatMap((b) => b.groups.flatMap((g) => g.items));
    assert.equal(items.find((i) => /skylights/i.test(i.heading)).status, "na", "N/A rows stay, as Not applicable");
    assert.equal(items.find((i) => /skylights/i.test(i.heading)).text, "Not applicable.");
    const gutters = items.filter((i) => /^gutters/i.test(i.heading));
    assert.equal(gutters.length, 2);
    assert.notEqual(gutters[0].heading, gutters[1].heading);
    assert.equal(items.find((i) => /^covering/i.test(i.heading)).text, "Checked and okay.");
    assert.equal(items.find((i) => /^covering/i.test(i.heading)).status, "ok");
  });

  it("numbers defects in checklist order under their topic, with photos, details and the code, and ties each row to its defect", () => {
    const defects = model.defectGroups.flatMap((g) => g.defects);
    assert.equal(model.defectCount, 2);
    assert.deepEqual(defects.map((d) => d.no), [1, 2]);
    assert.deepEqual(model.defectGroups.map((g) => g.heading), ["Roof", "Internal"]);
    const d1 = defects[0];
    assert.match(d1.text, /Gutters/);
    assert.match(d1.text, /Front left roof/);
    assert.equal(d1.severity, "Major, Safety");
    assert.equal(d1.category, "Workmanship outside tolerance");
    assert.equal(d1.code, "2.04");
    assert.match(d1.codeTitle, /^2\.04 External building dimensions/);
    assert.equal(d1.photos.length, 2);
    const row = model.tables.flatMap((b) => b.groups.flatMap((g) => g.items)).find((i) => /debris/i.test(i.heading));
    assert.equal(row.text, "Refer defects.");
    assert.equal(row.status, "defect");
    assert.equal(row.defectNo, 1);
  });

  it("reads construction codes against the library, and has no standards appendix", () => {
    assert.deepEqual(referencedCodes("see 2.04 and 8.01, also 99.99").sort(), ["2.04", "8.01"]);
    assert.equal(model.references, undefined);
  });

  it("writes the Notes: the workmanship statement, the PCI appliances note for the chosen status and the standing notes", () => {
    assert.ok(model.notes.includes("The workmanship is generally to a satisfactory industry standard, except for the defects noted above."));
    assert.ok(model.notes.some((n) => /^Appliances are installed, except for/.test(n)));
    assert.ok(model.notes.some((n) => /Certificate of Occupancy/.test(n)));
    const practical = buildConstructionReport([description, summary], { stageOptionPci: "practical_completion_appliances_not_yet_installed" });
    assert.ok(practical.notes.some((n) => /not yet installed/.test(n)));
  });

  it("prints only approved sections and says which are waiting", () => {
    const waiting = buildConstructionReport([description, { ...roof, approved: false }, summary], jobInfo);
    assert.equal(waiting.tables.length, 0);
    assert.deepEqual(waiting.waitingSections, ["PCI Checklist: External — Roof"]);
  });

  it("writes a measurement row from its plan / site / result answers", () => {
    const fields = [
      { key: "frontDatum", label: "Datum point you used", type: "pill-select", order: 0, sectionLetter: "Front setback", options: [{ value: "pegs", label: "Estimated from pegs" }] },
      { key: "frontPlan", label: "Front setback on plan", type: "numeric", unit: "mm", order: 1, sectionLetter: "Front setback" },
      { key: "frontSite", label: "Front setback on site (approx)", type: "numeric", unit: "mm", order: 2, sectionLetter: "Front setback" },
      { key: "frontResult", label: "Front setback — result", type: "pill-select", order: 3, sectionLetter: "Front setback", options: [{ value: "ok", label: "OK", color: OK }] },
    ];
    const m = buildConstructionReport([section("sd_measurements", "Slab Down: Site & Slab Measurements", fields, { frontDatum: "pegs", frontPlan: "4500", frontSite: "4510", frontResult: "ok" })], null);
    const item = m.tables[0].groups[0].items[0];
    assert.equal(m.tables[0].title, "SITE & SLAB MEASUREMENTS");
    assert.match(item.text, /As estimated from pegs\. Setbacks on plan are 4500 millimetres and on site are approximately 4510 millimetres\. Checked and okay\./);
  });

  it("numbers defects in order across stages and groups them by topic", () => {
    const early = buildConstructionReport([section("fr_defects", "Defects", [], { defects: [{ location: "Roof frame", description: "Truss not strapped", photos: photos(1) }, { location: "Bedroom 2", description: "Stud bowed", photos: [] }] })], null);
    assert.deepEqual(early.defectGroups.flatMap((g) => g.defects).map((d) => d.no), [1, 2]);
    assert.equal(early.defectGroups[0].heading, "General");
    assert.match(early.defectGroups[0].defects[0].text, /Roof frame/);
  });

  it("describes the construction the way the design sample words it", () => {
    assert.ok(model.description.includes("The construction is a single storey on a concrete slab."));
    assert.ok(model.description.includes("The owner was not onsite at the time of inspection."));
  });

  it("leaves the form's instructions out of sub-headings and drops a sub-heading that repeats the table title", () => {
    const fields = [
      { ...row("brickClean", "Brickwork clean", 0), sectionLetter: "External walls — use a digital level and measuring devices and show them in the photos" },
      { ...row("brickPlumb", "Brickwork plumb", 1), sectionLetter: "Masonry / brick work" },
      { ...row("planCheck", "Plaster complete", 2), sectionLetter: "Plaster — rough ins done but plaster not? Check the brief and office" },
    ];
    const m = buildConstructionReport([section("lu_external_walls", "Lock Up Stage: External Walls", fields, { brickClean: "ok", brickPlumb: "ok", planCheck: "ok" })], null);
    assert.deepEqual(m.tables[0].groups.map((g) => g.heading), [undefined, "Masonry / brick work", "Plaster"]);
    assert.equal(m.tables[0].title, "EXTERNAL WALLS");
  });
});
