// Dilapidation / Commercial Properties wording, run against the real published template.
// Sentences follow the Houspect inspector template (Industrial / Commercial Structures) in the style of Houspect's real reports:
// what the part is and its condition (satisfactory: "with typical wear and tear"; any other grade is just stated), what obscured
// it, the cracking / damage overview only when it records an issue, then each recorded defect.
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
      "The property is a warehouse, facing north on a mostly flat block of land and estimated to have been constructed around 1990. It is constructed of concrete panel walls on concrete slab with a pitched roof and a covering of colorbond. Windows are constructed of aluminium.",
    );
  });
});

describe("Commercial: driveway and paving", () => {
  it("says a good driveway is good, and a bad one what is wrong with it", () => {
    const bad = paras(draft("driveway", { present: "yes", locatedAt: "Front left", material: "Concrete", condition: "Fair", crackingSummary: "Several minor cracks", obscuredBy: ["Vegetation"], damages: [crack("near the gate")] }));
    assert.ok(bad.includes("The driveway is to the front left of the block and is constructed of concrete. It is in fair condition. Several minor cracks observed. Sections of the driveway were obscured by vegetation."));
    assert.ok(bad.includes("DEFECT::0::Near the gate there is a vertical fine crack approximately 3 millimetres wide and approximately 500 millimetres long."));
    const good = draft("driveway", { present: "yes", locatedAt: "Rear", material: "Asphalt", condition: SAT, crackingSummary: "No visible significant cracking", obscuredBy: [] }).reportText;
    assert.ok(good.includes("The driveway is to the rear of the block and is constructed of asphalt. It is in satisfactory condition with typical wear and tear."));
    assert.ok(!/crack|observed/i.test(good), "nothing about cracking when none was recorded");
    assert.equal(draft("driveway", { present: "no" }).reportText, "There is no driveway.");
  });

  it("splits the real form's obstructions: parked cars, trailer, caravan", () => {
    const p = paras(draft("driveway", { present: "yes", locatedAt: "Side", material: "Gravel", condition: SAT, obscuredBy: ["Parked cars", "Trailer", "Caravan"] }));
    assert.ok(p.join(" ").includes("Sections of the driveway were obscured by parked cars, trailer and caravan."));
  });

  it("names each paving side, says when there is none, and states a defect", () => {
    const d = draft("paving_paths", {
      areas: {
        front: { present: "yes", material: ["Concrete"], condition: SAT, obscuredBy: ["Vegetation", "Stored goods"] },
        left: { present: "no" },
        rear: { present: "yes", material: ["Pavers"], condition: "Poor", damages: [crack("the loading apron")] },
      },
    });
    const p = paras(d);
    assert.ok(p.includes("There is paving to the front of the block, constructed of concrete. It is in satisfactory condition with typical wear and tear. Sections of the paving were obscured by vegetation and stored goods."));
    assert.ok(p.includes("There is no paving to the left-hand side of property."));
    assert.ok(p.includes("There is paving to the rear of the block, constructed of pavers. It is in poor condition."));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::At the loading apron there is a vertical fine crack")), "no doubled 'the'");
  });
});

describe("Commercial: fences and retaining walls", () => {
  it("states each fence side, and 'There is no front fence.' for an absent one", () => {
    const d = draft("fences", { items: { front: { present: "no" }, left: { present: "yes", material: ["Brick"], condition: SAT, obscuredBy: ["Vegetation"] }, rear: { present: "yes", material: ["Metal sheets"], condition: "Poor", worstItem: "Rusted posts and leaning panels" } } });
    const p = paras(d);
    assert.equal(p[0], "There is no front fence.");
    assert.ok(p.includes("The left-hand fence is constructed of brick and is in satisfactory condition with typical weathering. Sections of the fence were obscured by vegetation."));
    assert.ok(p.includes("The rear fence is constructed of metal sheets and is in poor condition."));
    assert.ok(p.includes("Rusted posts and leaning panels."));
    assert.equal(draft("fences", { items: { front: { present: "no" }, left: { present: "no" } } }).reportText, "There are no fences surrounding this property.");
  });

  it("words what was noted on a fence and a retaining wall, and a fence ticked only 'typical weathering and some gaps'", () => {
    const only = paras(draft("fences", { items: { left: { present: "yes", material: ["Timber palings"], conditionDetails: ["Typical weathering and some gaps"] } } })).join(" ");
    assert.ok(only.includes("The left-hand fence is constructed of timber palings and is in satisfactory condition with typical weathering and some gaps."));
    const noted = paras(draft("fences", { items: { rear: { present: "yes", material: ["Timber palings"], condition: "Fair", conditionDetails: ["Decayed", "Loose or missing palings", "Leaning"] } } })).join(" ");
    assert.ok(noted.includes("is in fair condition."));
    assert.ok(noted.includes("Decayed, loose or missing palings and leaning noted."));
    const wall = paras(draft("retaining_walls", { present: "yes", items: [{ location: "Rear", materials: ["Timber sleepers"], condition: SAT, conditionDetails: ["Typical weathering and some gaps", "Leaning"] }] })).join(" ");
    assert.ok(wall.includes("There is a retaining wall to the rear, constructed of timber sleepers. It is in satisfactory condition with typical weathering and some gaps. Leaning noted."));
  });

  it("states a retaining wall and its worst item", () => {
    const p = paras(draft("retaining_walls", { present: "yes", items: [{ location: "Left", materials: ["Brick"], condition: "Fair", obscuredBy: ["Vegetation"], worstItem: "Bowing near the corner" }] }));
    assert.ok(p.includes("There is a retaining wall to the left, constructed of brick. It is in fair condition. Sections of the wall were obscured by vegetation."));
    assert.ok(p.includes("Bowing near the corner."));
  });
});

describe("Commercial: garage, sheds and loading dock", () => {
  it("heads each structure and says what obscured its walls and floor", () => {
    const d = draft("garage_carport_sheds", {
      structures: {
        garage: { present: "yes", attachment: "Separate to building", position: "Front", walls: ["Brick"], wallsCondition: SAT, roof: ["Metal"], floor: ["Concrete hardstand"], obscuredBy: ["Shelving", "Stored goods", "Parked car/s"] },
        sheds: { present: "yes", attachment: "Separate to building", position: "Rear", walls: ["Metal"], wallsCondition: "Fair", roof: ["Metal"], floor: ["Gravel"], obscuredBy: ["Stored goods"], damages: [crack("slab near the door")] },
        loading_dock: { present: "no" },
      },
    });
    const p = paras(d);
    assert.ok(p.includes("ROOMHEAD::Garage"));
    assert.ok(p.includes("There is a garage located at the front of the property, constructed of brick with a metal roof and concrete hardstand, and is generally in satisfactory state of repair. Sections of the walls and floor were obscured by shelving, stored goods and parked cars."));
    assert.ok(p.includes("ROOMHEAD::Sheds"));
    assert.ok(p.includes("There is a shed located at the rear of the property, constructed of metal with a metal roof and a gravel floor, and is generally in fair state of repair. Sections of the walls and floor were obscured by stored goods."));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::At the slab near the door there is a vertical fine crack")));
    assert.ok(!p.some((x) => /loading dock/i.test(x)));
  });

  it("words a basement garage without repeating 'basement' as its wall material", () => {
    const p = paras(draft("garage_carport_sheds", { structures: { garage: { present: "yes", attachment: "Basement", position: "Rear", walls: ["Basement"], wallsCondition: SAT, roof: ["Not applicable as basement"], floor: ["Concrete hardstand"] } } }));
    assert.ok(p.some((x) => x.startsWith("There is a garage in the basement, with concrete hardstand, and is generally in satisfactory state of repair.")));
    assert.ok(!p.some((x) => /constructed of basement/.test(x)));
  });

  it("says a new structure is new, and does not call it a state of repair", () => {
    const p = paras(draft("garage_carport_sheds", { structures: { loading_dock: { present: "yes", attachment: "Separate to building", position: "Rear", walls: ["Concrete panel"], wallsCondition: "New" } } })).join(" ");
    assert.ok(p.includes("There is a loading dock located at the rear of the property, constructed of concrete panel, and is new."));
  });
});

describe("Commercial: main structure", () => {
  it("heads each elevation with its direction and words a party wall as the real form does", () => {
    const d = draft("elevations", {
      sides: {
        front: { orientation: "North", condition: SAT, damageSummary: "No visible significant damage", obscuredBy: ["Vegetation"] },
        left: { orientation: "West", partyWall: "yes", partyWallNumber: "12", condition: "Fair", damageSummary: "Several minor gaps and cracks", damages: [crack("above the window")] },
        right: { orientation: "East", partyWall: "yes", partyWallNumber: "14", partialInspection: ["Rear"], condition: SAT },
      },
    });
    const p = paras(d);
    assert.ok(p.includes("ROOMHEAD::Front Elevation (north)"));
    assert.ok(p.includes("Satisfactory and in typical condition. Sections were obscured by vegetation."), "good: just says so, nothing about damage");
    assert.ok(p.includes("ROOMHEAD::Left Elevation (west)"));
    assert.ok(p.includes("The left elevation is a party wall abutting the next property at No. 12 and could not be inspected. Several minor gaps and cracks observed."));
    assert.ok(p.includes("DEFECT::0::Above the window there is a vertical fine crack approximately 3 millimetres wide and approximately 500 millimetres long."));
    assert.ok(p.includes("The right elevation is a party wall abutting the next property at No. 14 and could only be partly inspected to the rear which is in satisfactory and in typical condition."));
  });
});

describe("Commercial: roof", () => {
  it("words the roof from the checklist the real form has", () => {
    const sat = paras(draft("roof_chimneys", { inspectionStatus: ["Limited observations from ground level using camera zoom", "No chimney/s"], coveringType: ["Kliplock decking"], generalCondition: SAT, generalObservations: ["Satisfactory to fair with typical weathering", "Some surface rust"] })).join(" ");
    assert.ok(sat.includes("The roof covering appears to be in satisfactory to fair condition with typical weathering, constructed of kliplock decking. Comments are based on limited observations from the ground only and using a camera zoom. There are no chimneys visible. Some surface rust noted."));
    const poor = paras(draft("roof_chimneys", { inspectionStatus: ["Could not observe due to flat roof"], generalCondition: "Poor", generalObservations: ["Chimney appears unstable"] })).join(" ");
    assert.ok(poor.includes("The roof covering appears to be in poor condition. Could not observe due to flat roof. Chimney appears unstable."));
  });
});

describe("Commercial: offices and staff facilities", () => {
  it("groups areas under the floor they are on, each worded by its own condition", () => {
    const d = draft("pool_spa", {
      areas: {
        reception_foyer: { present: "yes", floorLevel: "Ground floor", generalCondition: SAT, damageSummary: "No visible significant damage" },
        offices: { present: "yes", floorLevel: "Ground floor", generalCondition: "Fair", damageSummary: "Several minor cracks and gaps", damages: [crack("ceiling cornice")] },
        board_room: { present: "yes", floorLevel: "1st floor", generalCondition: SAT },
        wc_male_female: { present: "yes", floorLevel: "1st floor", generalCondition: "Poor" },
        storerooms: { present: "yes", floorLevel: "Ground floor", generalCondition: SAT },
      },
    });
    const p = paras(d);
    assert.deepEqual(p.filter((x) => /^(GROUND|FIRST) FLOOR$/.test(x)), ["GROUND FLOOR", "FIRST FLOOR"]);
    assert.ok(p.includes("ROOMHEAD::Reception / Foyer"));
    assert.ok(p.includes("The reception and foyer are in satisfactory and typical condition."), "good: nothing about damage");
    assert.ok(p.includes("The offices are in fair condition. Several minor cracks and gaps observed."));
    assert.ok(p.includes("The storerooms are in satisfactory and typical condition."));
    assert.ok(p.includes("The board room is in satisfactory and typical condition."));
    assert.ok(p.includes("The toilets are in poor condition."));
    assert.ok(!/pool|spa/i.test(d.reportText), "an office never reads as a pool or spa");
  });
});

describe("Commercial: warehouse and production", () => {
  const answers = {
    gen_renovationsInProgress: "yes", gen_renovationsRooms: "Kitchen", gen_safetyAdvisories: "no", gen_roomsNotAccessed: "Plant room (locked)", gen_movementObserved: "no",
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

  it("words each area by its condition, says the overview only when it records an issue, then the defects", () => {
    assert.ok(p.includes("The warehouse is in fair condition. It is located on the ground floor. Several minor gaps and cracks observed. Sections were obscured by shelving and pallets."));
    assert.ok(p.includes("The production area is in satisfactory condition with typical wear and tear. It is located on the ground floor."), "good: nothing about damage");
    assert.ok(p.includes("The hardstand and floors are in poor condition. They are located on the ground floor. Multiple items of damage observed throughout."));
    assert.ok(p.includes("The underside of the roof covering and frame is in satisfactory and typical condition. Water stains observed. Sections were obscured by sarking."));
    assert.equal(p.filter((x) => x.startsWith("DEFECT::")).length, 2);
    assert.deepEqual(p.filter((x) => x.startsWith("DEFECT::")).map((x) => Number(x.split("::")[1])), [0, 1]);
    assert.equal(d.damages.length, 2);
  });

  it("keeps what was recorded about the whole building", () => {
    assert.ok(p.includes("Renovations in progress to kitchen."));
    assert.ok(p.includes("No access granted to Plant room (locked)."));
  });

  it("has one Condition Summary row per area", () => {
    assert.deepEqual(d.fields.conditionSummary.map((r) => [r.subLabel, r.conditionLabel]), [
      ["Warehouse", "Fair"], ["Production", "Satisfactory"], ["Hardstand / floors", "Poor"], ["Underside Roof Covering & Frame", "Satisfactory"],
    ]);
  });

  it("says which level each warehouse area is on, and what the roof underside is covered and framed in", () => {
    const q = paras(draft("internal_areas", {
      wh_floorLevel: "Mezzanine", wh_generalCondition: SAT, wh_damageSummary: "No visible significant damage",
      roofin_coveringOf: ["Kliplock", "Corrugated metal"], roofin_frameOf: "Steel", roofin_generalCondition: SAT, roofin_damageSummary: [],
    }));
    assert.ok(q.includes("The warehouse is in satisfactory condition with typical wear and tear. It is located on the mezzanine."));
    assert.ok(q.some((x) => x.startsWith("The roof is covered with kliplock and corrugated metal, on a steel frame.")));
  });
});

describe("Commercial: the Description's scope and safety answers", () => {
  it("words the property as the template does", () => {
    const d = draft("description", {
      constructionIs: ["Warehouse"], constructedYear: "1990", streetFrontage: "North", blockSlope: "Mostly flat",
      wallCladdingGround: ["Concrete panels"], foundations: "Concrete slab", roofDesign: "Pitched", roofCovering: ["Colorbond"], windows: "Aluminium",
    });
    assert.equal(
      d.reportText,
      "The property is a warehouse, facing north on a mostly flat block of land and estimated to have been constructed around 1990. It is constructed of concrete panel walls on concrete slab with a pitched roof and a covering of colorbond. Windows are constructed of aluminium.",
    );
  });

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
    assert.ok(defect && !defect.includes("DEFECT::") && defect.includes("approximately 6 millimetres wide and approximately 900 millimetres long"), "plain text, no marker: Notes is a plain list");
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
