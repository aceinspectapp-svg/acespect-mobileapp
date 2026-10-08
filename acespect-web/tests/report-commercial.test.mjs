// Dilapidation / Commercial Properties wording, run against the real published template.
// Sentences follow the Houspect Industrial-Commercial template: one short line per item, what obscured it,
// then -- only if something was recorded -- "There is significant cracking / damage. The most significant items are:".
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

const COMMERCIAL = { inspectionType: "dilapidation", propertyType: "commercial_properties" };
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const fieldsOf = (key) => snapshot.find((t) => t.inspectionType === COMMERCIAL.inspectionType && t.propertyType === COMMERCIAL.propertyType && t.sectionKey === key).fields;

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
const draft = (key, answers) => flattenSectionToDraft(fieldsOf(key), convert(fieldsOf(key), answers), key, COMMERCIAL);
const paras = (d) => d.reportText.split("\n\n");
const crack = (location, extra = {}) => ({ location, damageType: "Cracking", sub_cracking: "Fine", direction: "Vertical", widthMm: 3, lengthMm: 500, ...extra });
const SAT = "Satisfactory with typical wear and tear";

describe("Commercial: Description and Overview", () => {
  it("words the property as the template does", () => {
    const d = draft("description", {
      constructionIs: ["Warehouse"], constructedYear: "1990", streetFrontage: "North", blockSlope: "Mostly flat",
      wallCladdingGround: ["Concrete panels"], foundations: "Concrete slab", roofDesign: "Pitched", roofCovering: ["Colorbond"], windows: "Aluminium",
    });
    assert.equal(
      d.reportText,
      "The property is a warehouse, facing north on a mostly flat block of land and estimated to have been constructed around 1990. It is constructed of concrete panels walls on concrete slab with a pitched roof and a covering of colorbond. Windows are constructed of aluminium.",
    );
  });
});

describe("Commercial: driveway and paving", () => {
  it("gives the driveway one overview line, then what obscured it, then the defects", () => {
    const d = draft("driveway", { present: "yes", locatedAt: "Front left", material: "Concrete", condition: "Fair", crackingSummary: "Several minor cracks", obscuredBy: ["Vegetation"], damages: [crack("near the gate")] });
    const p = paras(d);
    assert.ok(p.includes("Driveway: Several minor cracks. Sections were obscured by vegetation."));
    assert.ok(p.includes("There are significant cracks. The most significant items are:"));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::Near the gate, there is a fine crack")));
    assert.equal(draft("driveway", { present: "no" }).reportText, "There is no driveway.");
    assert.ok(draft("driveway", { present: "yes", locatedAt: "Rear", material: "Asphalt", condition: SAT, crackingSummary: "No visible significant cracking", obscuredBy: [] }).reportText.includes("Driveway: No visible significant cracking."));
  });

  it("also says where the driveway is, what it is made of and its condition -- the form records them", () => {
    const p = paras(draft("driveway", { present: "yes", locatedAt: "Front left", material: "Concrete", condition: "Fair", crackingSummary: "Several minor cracks", obscuredBy: [] }));
    assert.ok(p.includes("The driveway is to the front left of the block and is constructed of concrete. It is in fair condition with typical wear and tear."));
    assert.ok(p.includes("Driveway: Several minor cracks."));
  });

  it("names each paving side, says when there is none, and states a defect instead of 'no cracking'", () => {
    const d = draft("paving_paths", {
      areas: {
        front: { present: "yes", material: ["Concrete"], condition: SAT, obscuredBy: ["Vegetation", "Stored goods"] },
        left: { present: "no" },
        rear: { present: "yes", material: ["Pavers"], condition: "Poor", damages: [crack("the loading apron")] },
      },
    });
    const p = paras(d);
    assert.ok(p.includes("Front Paving: No visible significant cracking. Sections were obscured by vegetation and stored goods."));
    assert.ok(p.includes("There is no paving to the left-hand side of property."));
    assert.ok(p.includes("Rear Paving: Poor."));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::At the loading apron, there is a fine crack")), "no doubled 'the'");
  });
});

describe("Commercial: fences and retaining walls", () => {
  it("states the grade for each fence side and 'There is no front fence.' for an absent one", () => {
    const d = draft("fences", { items: { front: { present: "no" }, left: { present: "yes", material: ["Brick"], condition: SAT, obscuredBy: ["Vegetation"] }, rear: { present: "yes", material: ["Metal sheets"], condition: "Poor", worstItem: "Rusted posts and leaning panels" } } });
    const p = paras(d);
    assert.equal(p[0], "There is no front fence.");
    assert.ok(p.includes("Left Fence: Satisfactory. Sections were obscured by vegetation."));
    assert.ok(p.includes("Rear Fence: Poor."));
    assert.ok(p.includes("There is significant cracking / damage. The most significant items are:"));
    assert.ok(p.includes("Rusted posts and leaning panels."));
    assert.equal(draft("fences", { items: { front: { present: "no" }, left: { present: "no" } } }).reportText, "There are no fences surrounding this property.");
  });

  it("states the grade for a retaining wall and its worst item", () => {
    const p = paras(draft("retaining_walls", { present: "yes", items: [{ location: "Left", materials: ["Brick"], condition: "Fair", obscuredBy: ["Vegetation"], worstItem: "Bowing near the corner" }] }));
    assert.ok(p.includes("Left retaining wall: Fair. Sections were obscured by vegetation."));
    assert.ok(p.includes("Bowing near the corner."));
  });
});

describe("Commercial: garage, sheds and loading dock", () => {
  it("heads each structure and says what obscured its walls and hardstand", () => {
    const d = draft("garage_carport_sheds", {
      structures: {
        garage: { present: "yes", attachment: "Separate to building", position: "Front", walls: ["Brick"], wallsCondition: SAT, roof: ["Metal"], floor: ["Concrete hardstand"], obscuredBy: ["Shelving", "Stored goods", "Parked car/s"] },
        sheds: { present: "yes", attachment: "Separate to building", position: "Rear", walls: ["Metal"], wallsCondition: "Fair", roof: ["Metal"], floor: ["Gravel"], obscuredBy: ["Stored goods"], damages: [crack("slab near the door")] },
        loading_dock: { present: "no" },
      },
    });
    const p = paras(d);
    assert.ok(p.includes("ROOMHEAD::Garage"));
    assert.ok(p.includes("No visible significant cracking. Sections of the walls and hardstand were obscured by shelving, stored goods and parked car/s."));
    assert.ok(p.includes("ROOMHEAD::Sheds"));
    assert.ok(p.includes("Fair. Sections were obscured by stored goods."));
    assert.ok(p.includes("There is significant cracking. The most significant items are:"));
    assert.ok(!p.some((x) => /loading dock/i.test(x)));
  });
});

describe("Commercial: main structure", () => {
  it("heads each elevation with its direction and says the boundary elevation could not be inspected", () => {
    const d = draft("elevations", {
      sides: {
        front: { orientation: "North", condition: SAT, damageSummary: "No visible significant damage", obscuredBy: ["Vegetation"] },
        left: { orientation: "West", partyWall: "yes", partyWallNumber: "12", condition: "Fair", damageSummary: "Several minor gaps and cracks", damages: [crack("above the window")] },
      },
    });
    const p = paras(d);
    assert.ok(p.includes("ROOMHEAD::Front Elevation (north)"));
    assert.ok(p.includes("No visible significant damage. Sections were obscured by vegetation."));
    assert.ok(p.includes("ROOMHEAD::Left Elevation (west)"));
    assert.ok(p.includes("This elevation is on the boundary and could not be inspected. The abutting property is No. 12."));
    assert.ok(p.includes("There is significant cracking. The most significant items are:"));
  });
});

describe("Commercial: offices and staff facilities", () => {
  it("groups areas under the floor they are on, with their own overview line", () => {
    const d = draft("pool_spa", {
      areas: {
        reception_foyer: { present: "yes", floorLevel: "Ground floor", generalCondition: SAT, damageSummary: "No visible significant damage" },
        offices: { present: "yes", floorLevel: "Ground floor", generalCondition: "Fair", damageSummary: "Several minor cracks and gaps", damages: [crack("ceiling cornice")] },
        board_room: { present: "yes", floorLevel: "1st floor", generalCondition: SAT, damageSummary: "No visible significant damage" },
      },
    });
    const p = paras(d);
    assert.deepEqual(p.filter((x) => /^(GROUND|FIRST) FLOOR$/.test(x)), ["GROUND FLOOR", "FIRST FLOOR"]);
    assert.ok(p.includes("ROOMHEAD::Reception / Foyer"));
    assert.ok(p.includes("Several minor cracks and gaps."));
    assert.ok(!/pool|spa/i.test(d.reportText), "an office never reads as a pool or spa");
  });
});

describe("Commercial: warehouse and production", () => {
  const answers = {
    gen_renovationsInProgress: "no", gen_safetyAdvisories: "no", gen_roomsNotAccessed: "Plant room (locked)", gen_movementObserved: "no",
    wh_floorLevel: "Ground floor", wh_obscuredBy: ["Shelving", "Pallets"], wh_generalCondition: "Fair", wh_damageSummary: "Several minor gaps and cracks", wh_damages: [crack("north wall, grid C")],
    prod_floorLevel: "Ground floor", prod_generalCondition: SAT, prod_damageSummary: "No visible significant damage",
    hard_floorLevel: "Ground floor", hard_generalCondition: "Poor", hard_damageSummary: "Multiple items of damage throughout", hard_damages: [crack("slab", { widthMm: 8, lengthMm: 2000 })],
    roofin_generalCondition: SAT, roofin_damageSummary: ["Water stains"], roofin_sarking: "yes",
  };
  const d = draft("internal_areas", answers);
  const p = paras(d);

  it("heads each area under the template's own headings", () => {
    assert.ok(p.includes("ROOMHEAD::Warehouse and Production Areas – Walls, Windows and Doors"));
    for (const h of ["Warehouse", "Production", "Hardstand / floors", "Underside Roof Covering & Frame"]) assert.ok(p.includes(`ROOMHEAD::${h}`), h);
  });

  it("gives each area its overview, obscured-by and defects", () => {
    assert.ok(p.includes("Several minor gaps and cracks. Sections were obscured by shelving and pallets."));
    assert.ok(p.includes("Satisfactory and typical condition. Water stains observed. Sections were obscured by sarking."));
    assert.equal(p.filter((x) => x.startsWith("DEFECT::")).length, 2);
    assert.deepEqual(p.filter((x) => x.startsWith("DEFECT::")).map((x) => Number(x.split("::")[1])), [0, 1]);
    assert.equal(d.damages.length, 2);
  });

  it("keeps what was recorded about the whole building", () => {
    assert.ok(p.includes("Rooms not accessed: Plant room (locked)."));
  });

  it("has one Condition Summary row per area", () => {
    assert.deepEqual(d.fields.conditionSummary.map((r) => [r.subLabel, r.conditionLabel]), [
      ["Warehouse", "Fair"], ["Production", "Satisfactory"], ["Hardstand / floors", "Poor"], ["Underside Roof Covering & Frame", "Satisfactory"],
    ]);
  });
});

describe("Commercial: every answer on the website form is printed", () => {
  it("says what paving, fences and retaining walls are made of, beside the template's own line", () => {
    const paving = paras(draft("paving_paths", { areas: { front: { present: "yes", material: ["Concrete", "Pavers"], condition: SAT } } }));
    assert.ok(paving.includes("There is paving to the front of the block, constructed of concrete and pavers. It is in satisfactory condition with typical wear and tear."));
    const fence = paras(draft("fences", { items: { left: { present: "yes", material: ["Brick", `${OTHER}Mesh panels`], condition: SAT } } }));
    assert.ok(fence.includes("The left fence is constructed of brick and mesh panels."));
    assert.ok(fence.includes("Left Fence: Satisfactory."));
    const wall = paras(draft("retaining_walls", { present: "yes", items: [{ location: "Rear", materials: ["Timber sleepers"], condition: "Fair" }] }));
    assert.ok(wall.includes("There is a retaining wall to the rear, constructed of timber sleepers."));
  });

  it("describes a garage, shed or loading dock: attachment, position, walls, roof, floor and state of repair", () => {
    const p = paras(draft("garage_carport_sheds", { structures: { garage: { present: "yes", attachment: "Separate to building", position: "Front", walls: ["Brick"], wallsCondition: SAT, roof: ["Metal"], floor: ["Concrete hardstand"] } } }));
    assert.ok(p.includes("There is a garage separate to the building at the front, constructed of brick with a metal roof and a concrete hardstand floor, and is generally in satisfactory state of repair."));
    const basement = paras(draft("garage_carport_sheds", { structures: { garage: { present: "yes", attachment: "Basement", position: "Rear", walls: ["Basement"], wallsCondition: SAT, roof: ["Not applicable as basement"], floor: ["Concrete hardstand"] } } }));
    assert.ok(basement.some((x) => x.startsWith("There is a garage in the basement at the rear, constructed of basement with a concrete hardstand floor")));
  });

  it("says which level each warehouse area is on, and what the roof underside is covered and framed in", () => {
    const p = paras(draft("internal_areas", {
      wh_floorLevel: "Mezzanine", wh_generalCondition: SAT, wh_damageSummary: "No visible significant damage",
      roofin_coveringOf: ["Kliplock", "Corrugated metal"], roofin_frameOf: "Steel", roofin_generalCondition: SAT, roofin_damageSummary: [],
    }));
    assert.ok(p.includes("It is located on the mezzanine."));
    assert.ok(p.includes("The roof is covered with kliplock and corrugated metal, on a steel frame."));
  });
});

describe("Commercial: the Description's scope and safety answers", () => {
  it("prints scope changes, limitations and safety issues, and nothing for a plain 'No'", () => {
    const base = { constructionIs: ["Warehouse"], streetFrontage: "North" };
    const full = paras(draft("description", { ...base, scopeChanges: "Rear yard added on the day", scopeLimitations: "yes", scopeLimitationsNotes: "Roof space not accessible", safetyIssues: "yes", safetyIssuesNotes: "Loose sheeting near the entry" }));
    assert.ok(full.includes("Changes to the scope: Rear yard added on the day."));
    assert.ok(full.includes("Limitations to the scope of the inspection: Roof space not accessible."));
    assert.ok(full.includes("Safety issues: Loose sheeting near the entry."));
    const none = draft("description", { ...base, scopeLimitations: "no", safetyIssues: "no" }).reportText;
    assert.ok(!/limitations|safety/i.test(none));
  });
});

describe("Notes: additional damage records are printed", () => {
  it("writes each additional damage record as a plain sentence", () => {
    const out = draft("notes", { additionalNotes: "", damages: [{ location: "rear loading bay", damageType: "Cracking", sub_cracking: "Moderate", direction: "Horizontal", widthMm: 6, lengthMm: 900 }] });
    const defect = paras(out).find((x) => x.includes("rear loading bay"));
    assert.ok(defect && !defect.includes("DEFECT::") && defect.includes("approximately 6mm wide and approximately 900mm long"), "plain text, no marker: Notes is a plain list");
  });
});

describe("Commercial: renamed elevations and post-project reports", () => {
  it("keeps the direction in the heading when an elevation is renamed", () => {
    const p = paras(draft("elevations", { sides: { front: { elevationName: "Main building", orientation: "North", condition: SAT, damageSummary: "No visible significant damage" } } }));
    assert.ok(p.includes("ROOMHEAD::Main building (north)"));
  });

  it("says when the report is a post-project inspection", () => {
    assert.ok(paras(draft("notes", { postProject: "yes", additionalNotes: "" })).includes("This is a post-project inspection."));
    assert.ok(!draft("notes", { postProject: "no", additionalNotes: "" }).reportText.includes("post-project"));
  });
});

