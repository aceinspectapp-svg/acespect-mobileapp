// Dilapidation / Apartment wording, run against the Apartment form (the checklist of the unit and the building). The sentences follow
// Houspect's "Residential Apartment / Infrastructure Project" report template (May 2025) where it has them -- the property description,
// "No visible significant cracking.", "There is significant cracking / damage. The most significant items are:", "This elevation is on
// the boundary and could not be inspected." -- and every other answer on the form is a sentence in the same style, never "Label: value".
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
    buildingType: "Apartment Block", constructedYear: "2010", storeys: "1", slope: "Flat", cladding: "Brick veneer", foundations: "Concrete slab",
    roofDesign: "Flat", roofCovering: "Membrane", windows: "Aluminium frame", worksType: "Excavation", projectAddr: "5 Test Street", direction: "Left",
    scopeType: "External & Internal (full)", limitations: "yes", limitationsNotes: "Roof space not accessible", safetyIssues: "yes", safetyIssuesNotes: "Loose balustrade on level 2",
  };

  it("words the apartment as the template does, from the form's answers", () => {
    const p = paras(draft("description", answers));
    assert.equal(p[0], "The property is a single-storey apartment in a multi-level complex, on a flat block of land and estimated to have been constructed around 2010. The complex is an apartment block. It is constructed of brick veneer walls on concrete slab with a flat roof and a covering of membrane. Windows are constructed of aluminium frame.");
    assert.ok(p.includes("The proposed works are excavation."));
    assert.ok(p.includes("There were limitations to the scope of the inspection. Roof space not accessible."));
    assert.ok(p.includes("There were safety issues at the property. Loose balustrade on level 2."));
  });

  it("says the storeys and a sloping block as the form gives them", () => {
    assert.ok(draft("description", { storeys: "2" }).reportText.startsWith("The property is a double-storey apartment in a multi-level complex."));
    assert.ok(draft("description", { storeys: "4", slope: "Steep fall" }).reportText.includes("The property is a 4-storey apartment in a multi-level complex, on a block of land with a steep fall."));
    assert.ok(draft("description", { buildingType: "High-rise Apartments" }).reportText.includes("The complex is a high-rise apartment building."));
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
    assert.ok(p.includes("The driveway is to the front of the block and is constructed of concrete. It is in fair condition. Sections of the driveway were obscured by parked vehicle."));
    assert.ok(p.includes("Notable damage was observed."));
    assert.ok(p.includes("A safety hazard was identified."));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::Near the ramp there is a vertical fine crack")));
  });

  it("says both the type and the material of a fence, and of a retaining wall, and 'typical weathering' only for a satisfactory one", () => {
    const fence = paras(draft("fences", { items: [{ location: "Front", structureType: "Timber Paling", material: "Timber", condition: "Fair", notableCracking: "yes" }] }));
    assert.ok(fence.includes("The front fence is a timber paling fence constructed of timber and is in fair condition."));
    assert.ok(fence.includes("Notable cracking was observed."));
    const good = paras(draft("fences", { items: [{ location: "Rear", structureType: "Timber Paling", material: "Timber", condition: "Satisfactory with typical wear and tear" }] }));
    assert.ok(good.includes("The rear fence is a timber paling fence constructed of timber and is in satisfactory condition with typical weathering."));
    const wall = paras(draft("retaining_walls", { items: [{ location: "Left", structureType: "Besser Block", material: "Brick", condition: "Fair", notableDamage: "yes" }] }));
    assert.ok(wall.includes("There is a besser block retaining wall to the left, constructed of brick. It is in fair condition."));
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
    assert.ok(p.some((x) => x.includes("This elevation is on the boundary and could not be inspected.")));
    assert.ok(p.includes("There is significant cracking. The most significant items are:"));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::At the east wall there is a vertical fine crack")));
  });

  it("reads each answer as a sentence, never as 'Label: value'", () => {
    assert.ok(p.some((x) => x.includes("The external walls are constructed of brick.")));
    assert.ok(p.some((x) => x.includes("The external walls are rendered.")));
    assert.ok(p.some((x) => x.includes("The external walls are in fair condition.")));
    assert.ok(p.some((x) => x.includes("The front door requires re-painting.")));
    assert.ok(p.some((x) => x.includes("Deadlocks are fitted to the front door.")));
    assert.ok(p.some((x) => x.includes("The front door is constructed of timber.")));
    assert.ok(p.some((x) => x.includes("The front door is in satisfactory condition with typical wear and tear.")));
    assert.ok(p.some((x) => x.includes("The cladding is fair.")));
    assert.ok(p.includes("Access from balconies only."));
  });

  it("says 'no visible significant cracking' for a part with no defects, and nothing of the kind for one with defects", () => {
    assert.ok(!p.some((x) => /No visible significant cracking/.test(x)), "the external walls have a recorded defect");
    const q = paras(draft("elevations", { ext_walls_material: "Brick", ext_walls_condition: "Satisfactory with typical wear and tear" }));
    assert.ok(q.some((x) => x.includes("No visible significant cracking.")));
    const rooms = paras(draft("internal_areas", { ceilings_material: "Plasterboard", ceilings_condition: "Fair", int_walls_material: "Plasterboard", int_walls_damages: [crack("hallway wall")] }));
    assert.ok(rooms.some((x) => x.includes("No visible significant cracks.")), "ceilings");
    assert.equal(rooms.filter((x) => x.includes("No visible significant cracks.")).length, 1, "not the internal walls, which have a defect");
  });

  it("says a part is not applicable, and why, instead of skipping it", () => {
    const d = draft("internal_areas", { int_roof_applicable: "no", int_roof_naReason: "Roof cavity not accessible", int_roof_comments: "Roof space is common property" });
    assert.ok(paras(d).includes("The roof space is not applicable (roof cavity not accessible – no manhole)."));
    assert.ok(paras(d).includes("Roof space is common property."));
  });

  it("words the building's services and safety items as sentences", () => {
    const p2 = paras(draft("internal_areas", {
      plumbing_waterSupplyOn: "yes", plumbing_tapsNormal: "no", plumbing_waterLeaks: "yes",
      electrical_powerOn: "yes", electrical_rcdCount: "Nil", electrical_batteryAlarms: "yes", electrical_batteryAlarmsCount: "2", electrical_alarmsLocated: "no",
      int_windows_flywire: "Some windows", int_doors_style: "Several styles",
    })).join(" ");
    assert.ok(p2.includes("The water supply was on. Not all taps, showers and toilets operated normally. There are water leaks to taps, waste pipes or showers."));
    assert.ok(p2.includes("The power supply was on. There are no RCDs installed. Battery smoke alarms are installed. There are 2 battery smoke alarms. Smoke alarms are not within 1.5 metres of each sleeping area."));
    assert.ok(p2.includes("Flywire screens are fitted to some windows."));
    assert.ok(p2.includes("The internal doors are of several styles."));
  });

  it("says each observation the inspector ticked as its own sentence", () => {
    const p2 = paras(draft("roof_chimneys", { eaves_applicable: "yes", eaves_material: "Timber", eaves_condition: "Poor", eaves_comments: "Water staining at the north end" })).join(" ");
    assert.ok(p2.includes("The eaves are constructed of timber. The eaves are in poor condition."));
    assert.ok(p2.includes("Water staining at the north end."));
  });

  it("has one Condition Summary row per graded part", () => {
    assert.deepEqual(external.fields.conditionSummary.map((r) => [r.subLabel, r.conditionLabel]), [["External walls", "Fair"], ["Front door", "Satisfactory"]]);
  });

  it("prints the notes and the structural answers", () => {
    const n = paras(draft("notes", { structural_structurallySound: "no", structural_describe: "Differential settlement at the north wall", post_project_describe: "No access to the plant room" }));
    assert.ok(n.includes("The unit is not considered structurally sound."));
    assert.ok(n.includes("Differential settlement at the north wall."));
    assert.ok(n.includes("No access to the plant room."));
    // Notes prints as a plain numbered list: no headings or tags may appear in it.
    assert.ok(!n.some((x) => /^(ROOMHEAD|COND|DEFECT)::/.test(x)));
  });
});

describe("Apartment: every checklist question has a sentence", () => {
  it("covers every question on the Apartment form", async () => {
    const { apartmentSaysField } = await server.ssrLoadModule("/src/web/wording/dilapidation.apartment.ts");
    const missing = [];
    const walk = (fields) => {
      for (const f of fields) {
        if (f.itemFields && f.type !== "damage-list") continue; // the one-by-one items are worded by their own composers
        if (!apartmentSaysField(f.key, f.type)) missing.push(f.key);
      }
    };
    for (const t of snapshot.filter((x) => x.inspectionType === "dilapidation" && x.propertyType === "apartment" && ["elevations", "garage_carport_sheds", "roof_chimneys", "internal_areas", "paving_paths", "notes"].includes(x.sectionKey))) walk(t.fields);
    assert.deepEqual(missing, []);
  });
});

describe("Apartment: the form is as it was", () => {
  it("still has every section of the Apartment inspection, with the same questions", () => {
    const keys = snapshot.filter((x) => x.inspectionType === "dilapidation" && x.propertyType === "apartment").map((x) => x.sectionKey).sort();
    assert.deepEqual(keys, ["custom_structure", "description", "driveway", "elevations", "fences", "garage_carport_sheds", "internal_areas", "job-info", "notes", "paving_paths", "pool_spa", "retaining_walls", "roof_chimneys"]);
    const count = (k) => fieldsOf(k).length;
    assert.deepEqual([count("description"), count("elevations"), count("internal_areas"), count("paving_paths"), count("roof_chimneys"), count("notes")], [25, 66, 102, 56, 41, 15]);
  });
});

describe("Apartment: wording registry", () => {
  it("is a final report type of its own, with the project-works sentence on the Description page", () => {
    const w = wordingFor(APT);
    assert.equal(w.status, "final");
    assert.deepEqual(w.profile, APT);
    assert.equal(typeof w.descriptionBlocks, "function");
  });
});
