// Dilapidation / Apartment wording, run against the real published template.
// The Word template covers the description, elevations and rooms; the website form is a longer checklist of the unit and
// the building. The template's own sentences are used where it has them, and every other answer is a plain sentence under a
// heading for the part of the building it is about.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { wordingFor } = await server.ssrLoadModule("/src/web/wording/registry.ts");

const APT = { inspectionType: "dilapidation", propertyType: "apartment" };
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const fieldsOf = (key) => snapshot.find((t) => t.inspectionType === APT.inspectionType && t.propertyType === APT.propertyType && t.sectionKey === key).fields;

const OTHER = "__other__:";
function valueOf(f, label) {
  if (label.startsWith(OTHER)) return label;
  const l = label.toLowerCase();
  const o = f.options.find((x) => x.label.toLowerCase() === l) ?? f.options.find((x) => x.label.toLowerCase().startsWith(l));
  if (!o) throw new Error(`no option "${label}" in ${f.key}`);
  return o.value;
}
function convert(fields, a) {
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    const f = fields.find((x) => x.key === k);
    if (!f) throw new Error(`unknown field ${k}`);
    if (f.options && typeof v === "string") out[k] = valueOf(f, v);
    else if (f.options && Array.isArray(v)) out[k] = v.map((x) => valueOf(f, x));
    else if (f.type === "damage-list") out[k] = v.map((d) => convert(f.itemFields, d));
    else if (f.type === "repeating-group") out[k] = Array.isArray(v) ? v.map((d) => convert(f.itemFields, d)) : Object.fromEntries(Object.entries(v).map(([kk, d]) => [kk, convert(f.itemFields, d)]));
    else out[k] = v;
  }
  return out;
}
const draft = (key, answers) => flattenSectionToDraft(fieldsOf(key), convert(fieldsOf(key), answers), key, APT);
const paras = (d) => d.reportText.split("\n\n");
const crack = (location, extra = {}) => ({ location, damageType: "Cracking", sub_cracking: "Fine", direction: "Vertical", widthMm: 3, lengthMm: 500, ...extra });

describe("Apartment: Description and Overview", () => {
  const answers = {
    buildingType: "Apartment Block", constructedYear: "2010", storeys: "4", slope: "Flat", cladding: "Brick veneer", foundations: "Concrete slab",
    roofDesign: "Flat", roofCovering: "Membrane", windows: "Aluminium frame", worksType: "Excavation", projectAddr: "5 Test Street", direction: "Left",
    scopeType: "External & Internal (full)", limitations: "yes", limitationsNotes: "Roof space not accessible", safetyIssues: "yes", safetyIssuesNotes: "Loose balustrade on level 2",
  };

  it("words the property as the template does, from the form's answers", () => {
    const p = paras(draft("description", answers));
    assert.equal(p[0], "The property is an apartment block, with 4 storeys on a flat block of land and estimated to have been constructed around 2010. It is constructed of brick veneer walls on concrete slab with a flat roof and a covering of membrane. Windows are constructed of aluminium frame.");
    assert.ok(p.includes("The proposed works are excavation."));
    assert.ok(p.includes("Limitations to the scope of the inspection: Roof space not accessible."));
    assert.ok(p.includes("Safety issues: Loose balustrade on level 2."));
  });

  it("says a sloping block as the form gives it", () => {
    assert.ok(draft("description", { buildingType: "Walk-up Apartments", slope: "Steep fall" }).reportText.includes("on a block of land with a steep fall"));
  });

  it("words the project works and the scope on the Description page", () => {
    const fields = draft("description", answers).fields;
    const blocks = wordingFor(APT).descriptionBlocks({ fields, areaCount: 0 });
    assert.equal(blocks.works, "The project works are to the property at 5 Test Street, which is at the left of the site of this inspection.");
    assert.equal(blocks.scope, "The scope for inspection is external and internal to all structures.");
    assert.equal(wordingFor(APT).descriptionBlocks({ fields: { ...fields, scopeType: "External only" }, areaCount: 0 }).scope, "The scope for inspection is external only to all areas.");
  });
});

describe("Apartment: items listed one by one", () => {
  it("prints the driveway's flags as well as its sentences", () => {
    const p = paras(draft("driveway", { items: [{ location: "Front", material: "Concrete", condition: "Fair", obstructions: ["Parked Vehicle"], notableDamage: "yes", safetyHazard: "yes", damages: [crack("near the ramp")] }] }));
    assert.ok(p.includes("The driveway is to the front of the block and is constructed of concrete. It is in fair condition with typical wear and tear. Sections of the driveway were obscured by parked vehicle."));
    assert.ok(p.includes("Notable damage was observed."));
    assert.ok(p.includes("A safety hazard was identified."));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::Near the ramp, there is a fine crack")));
  });

  it("says both the type and the material of a fence, and of a retaining wall", () => {
    const fence = paras(draft("fences", { items: [{ location: "Front", structureType: "Timber Paling", material: "Timber", condition: "Fair", notableCracking: "yes" }] }));
    assert.ok(fence.includes("The front fence is a timber paling fence constructed of timber and is in fair condition with typical weathering."));
    assert.ok(fence.includes("Notable cracking was observed."));
    const wall = paras(draft("retaining_walls", { items: [{ location: "Left", structureType: "Besser Block", material: "Brick", condition: "Fair", notableDamage: "yes" }] }));
    assert.ok(wall.includes("There is a besser block retaining wall to the left, constructed of brick. It is in fair condition with typical weathering."));
    assert.ok(wall.includes("Notable damage was observed."));
  });
});

describe("Apartment: the checklist sections", () => {
  const external = draft("elevations", {
    elev_overview_elevations: "All accessible faces", elev_overview_partyWall: "yes", elev_overview_claddingCond: "Fair", elev_overview_comments: "Access from balconies only",
    ext_walls_material: "Brick", ext_walls_rendered: "yes", ext_walls_condition: "Fair", ext_walls_majorCracking: "no", ext_walls_damages: [crack("east wall")],
    front_door_material: "Timber", front_door_condition: "Satisfactory with typical wear and tear", front_door_requires: "Re-painting", front_door_deadlocks: "yes",
  });
  const p = paras(external);

  it("puts each part of the building under its own heading, with its grade", () => {
    assert.ok(p.includes("ROOMHEAD::External walls"));
    const i = p.indexOf("ROOMHEAD::External walls");
    assert.equal(p[i + 1], "COND::#d97706::Fair");
    assert.ok(p.includes("ROOMHEAD::Front door"));
  });

  it("uses the template's sentences where it has them", () => {
    assert.ok(p.includes("This elevation is on the boundary and could not be inspected."));
    assert.ok(p.includes("There is significant cracking. The most significant items are:"));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::At the east wall, there is a fine crack")));
  });

  it("reads each answer as a sentence", () => {
    assert.ok(p.includes("External walls constructed of brick."));
    assert.ok(p.includes("The front door requires re-painting."));
    assert.ok(p.includes("Deadlocks fitted: yes."));
    assert.ok(p.includes("Access from balconies only."));
  });

  it("says a part is not applicable, and why, instead of skipping it", () => {
    const d = draft("internal_areas", { int_roof_applicable: "no", int_roof_naReason: "Roof cavity not accessible", int_roof_comments: "Roof space is common property" });
    assert.ok(paras(d).includes("Roof space: not applicable (roof cavity not accessible – no manhole)."));
    assert.ok(paras(d).includes("Roof space is common property."));
  });

  it("has one Condition Summary row per graded part", () => {
    assert.deepEqual(external.fields.conditionSummary.map((r) => [r.subLabel, r.conditionLabel]), [["External walls", "Fair"], ["Front door", "Satisfactory"]]);
  });

  it("prints the notes and the structural answers", () => {
    const n = paras(draft("notes", { structural_structurallySound: "no", structural_describe: "Differential settlement at the north wall", post_project_describe: "No access to the plant room" }));
    assert.ok(n.includes("Describe the structural defects identified: Differential settlement at the north wall."));
    assert.ok(n.includes("No access to the plant room."));
    // Notes prints as a plain numbered list: no headings or tags may appear in it.
    assert.ok(!n.some((x) => /^(ROOMHEAD|COND|DEFECT)::/.test(x)));
  });
});
