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
      "The property is a warehouse, facing north on a mostly flat block of land and estimated to have been constructed around 1990. It is constructed of concrete panel walls on concrete slab with a pitched roof and a covering of Colorbond. Windows are constructed of aluminium.",
    );
  });
});

describe("Commercial: the template's design, decade and extension", () => {
  it("says the design and a decade as the template does", () => {
    const d = draft("description", {
      constructionIs: ["Warehouse"], buildingDesign: "Two storey", constructedYear: "1990s", streetFrontage: "North", blockSlope: "Mostly flat",
      wallCladdingGround: ["Brick"], foundations: "Concrete slab", roofDesign: "Flat", roofCovering: ["Colorbond"], windows: "Aluminium",
    });
    assert.ok(d.reportText.startsWith("The property is a warehouse, facing north on a mostly flat block of land. It is of a two storey design and estimated to have been constructed around the 1990s."));
  });

  it("words an extension", () => {
    const d = draft("description", {
      constructionIs: ["Warehouse"], constructedYear: "1990",
      extensionPresent: "yes", extensionLocation: "Rear", extensionYear: "2010", extensionWalls: ["Brick"], extensionFoundations: "Concrete slab", extensionRoofDesign: "Flat", extensionRoofCovering: ["Colorbond"],
    });
    assert.ok(d.reportText.includes("There is an extension to the rear built around 2010. It is constructed of brick walls on a concrete slab with a flat roof and a covering of Colorbond."));
  });

  it("does not take 'N/A' in the under-construction box as a stage", () => {
    const d = draft("description", { constructionIs: ["Warehouse"], underConstructionStage: "N/A" });
    assert.equal(d.reportText, "The property is a warehouse.");
  });
});

describe("Commercial: driveway and paving", () => {
  it("says a good driveway is good, and a bad one what is wrong with it", () => {
    const bad = paras(draft("driveway", { present: "yes", locatedAt: "Front left", material: "Concrete", condition: "Fair", crackingSummary: "Several minor cracks", obscuredBy: ["Vegetation"], damages: [crack("near the gate")] }));
    assert.ok(bad.includes("The driveway is to the front left of the block and is constructed of concrete. It is in fair condition. Several minor cracks observed. Sections of the driveway were obscured by vegetation."));
    assert.ok(bad.includes("DEFECT::0::Near the gate, there is a crack. The crack is 3 millimetres wide and 500 millimetres long."), "external: the size is stated plainly");
    const good = draft("driveway", { present: "yes", locatedAt: "Rear", material: "Asphalt", condition: SAT, crackingSummary: "No visible significant cracking", obscuredBy: [] }).reportText;
    assert.ok(good.includes("The driveway is to the rear of the block and is constructed of asphalt. It is in satisfactory condition with typical wear and tear."));
    assert.ok(!/crack|observed/i.test(good), "nothing about cracking when none was recorded");
    assert.equal(draft("driveway", { present: "no" }).reportText, "There is no driveway.");
  });

  it("splits the real form's obstructions: parked cars, trailer, caravan", () => {
    const p = paras(draft("driveway", { present: "yes", locatedAt: "Side", material: "Gravel", condition: SAT, obscuredBy: ["Parked cars", "Trailer", "Caravan"] }));
    assert.ok(p.join(" ").includes("Sections of the driveway were obscured by parked cars, a trailer and a caravan."));
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
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::At the loading apron, there is a crack")), "no doubled 'the'");
  });
});

describe("Commercial: fences and retaining walls", () => {
  it("states each fence side, and 'There is no front fence.' for an absent one", () => {
    const d = draft("fences", { items: { front: { present: "no" }, left: { present: "yes", material: ["Brick"], condition: SAT, obscuredBy: ["Vegetation"] }, rear: { present: "yes", material: ["Metal sheets"], condition: "Poor", worstItem: "Rusted posts and leaning panels" } } });
    const p = paras(d);
    assert.equal(p[0], "There is no front fence.");
    assert.ok(p.includes("The left-hand fence is constructed of brick and is in satisfactory condition with typical weathering. Sections of the fence are obscured by vegetation."));
    // The worst item ends the fence's paragraph, so the photo reference follows the whole description.
    assert.ok(p.includes("The rear fence is constructed of metal sheets and is in poor condition. Rusted posts and leaning panels."));
    assert.equal(draft("fences", { items: { front: { present: "no" }, left: { present: "no" } } }).reportText, "There are no fences surrounding this property.");
  });

  it("words what was noted on a fence and a retaining wall, and a fence ticked only 'typical weathering and some gaps'", () => {
    const only = paras(draft("fences", { items: { left: { present: "yes", material: ["Timber palings"], conditionDetails: ["Typical weathering and some gaps"] } } })).join(" ");
    assert.ok(only.includes("The left-hand fence is constructed of timber palings and is in satisfactory condition with typical weathering and some gaps."));
    const noted = paras(draft("fences", { items: { rear: { present: "yes", material: ["Timber palings"], condition: "Fair", conditionDetails: ["Decayed", "Loose or missing palings", "Leaning"] } } })).join(" ");
    assert.ok(noted.includes("is in fair condition."));
    assert.ok(noted.includes("There is some decay. There are loose or missing palings. The fence is leaning."));
    const wall = paras(draft("retaining_walls", { present: "yes", items: [{ location: "Rear", materials: ["Timber sleepers"], condition: SAT, conditionDetails: ["Typical weathering and some gaps", "Leaning"] }] })).join(" ");
    assert.ok(wall.includes("There is a retaining wall to the rear, constructed of timber sleepers. It is in satisfactory condition with typical weathering and some gaps. The wall is leaning."));
  });

  it("states a retaining wall and its worst item", () => {
    const p = paras(draft("retaining_walls", { present: "yes", items: [{ location: "Left", materials: ["Brick"], condition: "Fair", obscuredBy: ["Vegetation"], worstItem: "Bowing near the corner" }] }));
    assert.ok(p.includes("There is a retaining wall to the left, constructed of brick. It is in fair condition. Sections of the wall were obscured by vegetation. Bowing near the corner."));
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
    assert.ok(p.includes("PART::Garage/Carport/Loading Bay"));
    assert.ok(p.includes("There is a garage located at the front of the property, constructed of brick with a metal roof and concrete hardstand, and is generally in satisfactory state of repair. Sections of the walls and hardstand were obscured by shelving and stored goods. A parked car obscured part of the hardstand."));
    assert.ok(p.includes("PART::Sheds / Loading dock and any other structures"));
    assert.ok(p.includes("There is a shed located at the rear of the property, constructed of metal with a metal roof and a gravel floor, and is generally in fair state of repair. Sections of the walls and floor were obscured by stored goods."));
    assert.ok(p.some((x) => x.startsWith("DEFECT::0::At the slab near the door, there is a crack")));
    assert.ok(!p.some((x) => /There is a loading dock/i.test(x)), "the loading dock was not there");
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
    assert.ok(p.includes("The left elevation is a party wall abutting the next property at No. 12. It is in fair condition. Several minor gaps and cracks observed."));
    assert.ok(p.includes("DEFECT::0::Above the window, there is a crack. The crack is 3 millimetres wide and 500 millimetres long."));
    assert.ok(p.includes("The right elevation is a party wall abutting the next property at No. 14. Could only be partly inspected to the rear. Satisfactory and in typical condition."));
  });

  it("words a party wall as the Industrial-Commercial template does, with what it is constructed of", () => {
    const p = paras(draft("elevations", { sides: { rear: { orientation: "South", partyWall: "yes", partyWallNumber: "12", partyWallConstruction: ["Brick"], condition: "Fair", damageSummary: "Several minor gaps and cracks" } } }));
    assert.ok(p.includes("ROOMHEAD::Rear Elevation (south)"));
    assert.ok(p.includes("The rear elevation is a party wall abutting the next property at No. 12. It is constructed of brick which is in fair condition. Several minor gaps and cracks observed."));
  });

  it("keeps the template's heading when the required rename box holds the standard name", () => {
    const p = paras(draft("elevations", { sides: { front: { elevationName: "Front", orientation: "North", condition: SAT } } }));
    assert.ok(p.includes("ROOMHEAD::Front Elevation (north)"));
    const paving = paras(draft("paving_paths", { areas: { front: { areaName: "Front", present: "yes", material: ["Concrete"], condition: SAT } } })).join(" ");
    assert.ok(paving.includes("There is paving to the front of the block, constructed of concrete."));
    const offices = paras(draft("pool_spa", { areas: { wc_male_female: { areaName: "WC Male / Female", present: "yes", floorLevel: "Ground floor", generalCondition: SAT } } }));
    assert.ok(offices.includes("ROOMHEAD::Toilets"));
    const wall = paras(draft("retaining_walls", { present: "yes", items: [{ wallName: "Left retaining wall", location: "Left", materials: ["Brick"], condition: SAT }] })).join(" ");
    assert.ok(wall.includes("There is a retaining wall to the left, constructed of brick."));
  });
});

describe("Commercial: roof", () => {
  it("words the roof from the checklist the real form has", () => {
    const sat = paras(draft("roof_chimneys", { inspectionStatus: ["Limited observations from ground level using camera zoom", "No chimney/s"], coveringType: ["Kliplock decking"], generalCondition: SAT, generalObservations: ["Satisfactory to fair with typical weathering", "Some surface rust"] })).join(" ");
    assert.ok(sat.includes("The roof covering of Kliplock decking appears to be in satisfactory to fair condition with typical weathering and some surface rust. Comments are based on limited observations from the ground only and using a camera zoom. There are no chimneys visible."));
    const poor = paras(draft("roof_chimneys", { inspectionStatus: ["Could not observe due to flat roof"], generalCondition: "Poor", generalObservations: ["Chimney appears unstable"] })).join(" ");
    assert.ok(poor.includes("The roof covering appears to be in poor condition. The roof covering could not be observed as the roof is flat. Chimney appears unstable."));
    const ladder = paras(draft("roof_chimneys", { inspectionStatus: ["Inspected from ladder", "Not inspected - multi-level building complex (common property)"], coveringType: ["Colorbond"], generalCondition: "Poor" })).join(" ");
    assert.ok(ladder.includes("The roof covering of Colorbond appears to be in poor condition. Comments are based on limited observations standing on a ladder to the lower roof and from the ground using a camera zoom."));
    assert.ok(ladder.includes("The roof could not be inspected as the building is a multi-level building complex. Roof coverings in a building complex are common property and need to be maintained through the Owners Corporation."));
    assert.ok(paras(draft("roof_chimneys", { coveringType: ["Tile"], generalCondition: SAT })).join(" ").includes("The roof covering of tile appears to be in satisfactory condition with typical weathering."));
  });
});

describe("Commercial: offices and staff facilities", () => {
  it("heads each area and its floor as the template does, each worded by its own condition", () => {
    const d = draft("pool_spa", {
      areas: {
        reception_foyer: { present: "yes", floorLevel: "Ground floor", generalCondition: SAT, damageSummary: "No visible significant damage" },
        offices: { present: "yes", floorLevel: "Ground floor", generalCondition: "Fair", damageSummary: "Several minor cracks and gaps", damages: [crack("ceiling cornice")] },
        wc_male_female: { present: "yes", floorLevel: "1st floor", generalCondition: "Poor" },
        staff_rooms_kitchens: { present: "yes", floorLevel: "1st floor", generalCondition: SAT },
      },
    });
    const p = paras(d);
    assert.deepEqual(
      p.filter((x) => x.startsWith("ROOMHEAD::")).map((x) => x.slice(10)),
      ["Reception / Foyer", "Ground Floor", "Offices", "Ground Floor", "Staff Rooms / Kitchens", "First Floor", "Toilets", "First Floor"],
    );
    for (const h of ["Reception / Foyer", "Offices", "Staff Rooms / Kitchens", "Toilets", "Ground Floor", "First Floor"]) assert.ok(p.includes(`ROOMHEAD::${h}`), h);
    assert.ok(p.includes("Satisfactory and in typical condition."), "good: nothing about damage");
    assert.ok(p.includes("It is in fair condition. Several minor cracks and gaps observed."));
    assert.ok(p.includes("It is in poor condition."));
    assert.ok(!/pool|spa/i.test(d.reportText), "an office never reads as a pool or spa");
  });
});

describe("Commercial: warehouse and production", () => {
  const answers = {
    gen_renovationsInProgress: "yes", gen_renovationsRooms: "Kitchen", gen_safetyAdvisories: "no", gen_roomsNotAccessed: "Plant room (locked)", gen_movementObserved: "no",
    wh_floorLevel: "Ground floor", wh_obscuredBy: ["Shelving", "Pallets"], wh_generalCondition: "Fair", wh_damageSummary: "Several minor gaps and cracks", wh_damages: [crack("north wall, grid C")],
    prod_floorLevel: "Ground floor", prod_generalCondition: SAT, prod_damageSummary: "No visible significant damage",
    hard_floorLevel: "Ground floor", hard_generalCondition: "Poor", hard_damageSummary: "Multiple items of damage throughout", hard_damages: [crack("slab", { widthMm: 8, lengthMm: 2000 })],
    pfl_floorLevel: "1st floor", pfl_generalCondition: "Average", pfl_scuffMarks: "yes", pfl_lineMarkings: "Worn",
    roofin_generalCondition: SAT, roofin_damageSummary: ["Water stains"], roofin_sarking: "yes",
  };
  const d = draft("internal_areas", answers);
  const p = paras(d);

  it("heads each area under the template's own headings", () => {
    assert.deepEqual(
      p.filter((x) => /^(PART|ROOMHEAD)::/.test(x)),
      [
        "PART::WAREHOUSE AND PRODUCTION AREAS - WALLS, WINDOWS AND DOORS", "ROOMHEAD::Warehouse", "ROOMHEAD::Ground Floor", "ROOMHEAD::Production Area", "ROOMHEAD::Ground Floor",
        "PART::WAREHOUSE AND PRODUCTION AREAS - FLOORS", "ROOMHEAD::Warehouse", "ROOMHEAD::Ground Floor", "ROOMHEAD::Production Area", "ROOMHEAD::First Floor",
        "PART::WAREHOUSE ROOF UNDERSIDE AND FRAME",
      ],
    );
  });

  it("words each area by its condition, says the overview only when it records an issue, then the defects", () => {
    assert.ok(p.includes("It is in fair condition. Several minor gaps and cracks observed. Sections were obscured by shelving and pallets."));
    assert.ok(p.includes("Satisfactory and in typical condition."), "good: nothing about damage");
    assert.ok(p.includes("It is in poor condition. Multiple items of damage observed throughout."));
    assert.ok(p.includes("It is in average condition. There are scuff marks from forklifts. The painted line markings are worn."), "the production area's floors");
    assert.ok(p.includes("The roof is covered in sarking, obscuring inspection. From these limited observations, the roof underside appears to be in satisfactory and in typical condition. Water stains observed."));
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
      ["Warehouse", "Fair"], ["Production Area", "Satisfactory"], ["Warehouse Floors", "Poor"], ["Production Area Floors", "Average"], ["Roof Underside and Frame", "Satisfactory"],
    ]);
  });

  it("says which level each warehouse area is on, and what the roof underside is covered and framed in", () => {
    const q = paras(draft("internal_areas", {
      wh_floorLevel: "Mezzanine", wh_generalCondition: SAT, wh_damageSummary: "No visible significant damage",
      roofin_coveringOf: ["Kliplock", "Corrugated metal"], roofin_frameOf: "Steel", roofin_generalCondition: SAT, roofin_damageSummary: [],
    }));
    assert.ok(q.includes("ROOMHEAD::Mezzanine"));
    assert.ok(q.includes("Satisfactory and in typical condition."));
    assert.ok(q.some((x) => x.startsWith("The roof covering is Kliplock and corrugated metal, on a steel frame.")));
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
      "The property is a warehouse, facing north on a mostly flat block of land and estimated to have been constructed around 1990. It is constructed of concrete panel walls on concrete slab with a pitched roof and a covering of Colorbond. Windows are constructed of aluminium.",
    );
  });

  it("prints scope changes, limitations and safety issues, and nothing for a plain 'No'", () => {
    const base = { constructionIs: ["Warehouse"], streetFrontage: "North" };
    const full = paras(draft("description", { ...base, scopeChanges: "Rear yard added on the day", scopeLimitations: "yes", scopeLimitationsNotes: "Roof space not accessible", safetyIssues: "yes", safetyIssuesNotes: "Loose sheeting near the entry" }));
    assert.ok(full.includes("The scope of the inspection was changed. Rear yard added on the day."));
    assert.ok(full.includes("There were limitations to the scope of the inspection. Roof space not accessible."));
    assert.ok(full.includes("There were safety issues at the property. Loose sheeting near the entry."));
    const none = draft("description", { ...base, scopeLimitations: "no", safetyIssues: "no" }).reportText;
    assert.ok(!/limitations|safety/i.test(none));
  });
});

describe("Notes: additional damage records are printed", () => {
  it("writes each additional damage record as a plain sentence", () => {
    const out = draft("notes", { additionalNotes: "", damages: [{ location: "rear loading bay", damageType: "Cracking", sub_cracking: "Moderate", direction: "Horizontal", widthMm: 6, lengthMm: 900 }] });
    const defect = paras(out).find((x) => x.includes("rear loading bay"));
    assert.ok(defect && !defect.includes("DEFECT::") && defect.includes("The crack is 6 millimetres wide and 900 millimetres long"), "plain text, no marker: Notes is a plain list");
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

describe("Commercial: the Industrial-Commercial template's own rules", () => {
  it("states an external crack plainly and an internal one 'approximately', with where it starts and runs to", () => {
    const ext = paras(draft("driveway", { present: "yes", locatedAt: "Rear", material: "Asphalt", condition: SAT, damages: [crack("the gate", { crackStartLocation: "the kerb", crackEndLocation: "north", widthMm: 2, lengthMm: 800, direction: "Diagonal" })] }));
    assert.ok(ext.includes("DEFECT::0::At the gate, there is a crack starting at the kerb and running to the north. The crack is 2 millimetres wide and 800 millimetres long."));
    const inside = paras(draft("pool_spa", { areas: { offices: { present: "yes", floorLevel: "Ground floor", generalCondition: SAT, damages: [crack("the cornice", { crackStartLocation: "the door", crackEndLocation: "east", widthMm: 1, lengthMm: 70 })] } } }));
    assert.ok(inside.some((x) => x.endsWith("At the cornice, there is a crack starting at the door and running to the east. The crack is approximately 1 millimetre wide and approximately 70 millimetres long.")));
  });

  it("words a crack exactly as the template's line, with no severity, direction word, element or notes", () => {
    const p = paras(draft("paving_paths", { areas: { front: { present: "yes", material: ["Concrete"], condition: SAT, damages: [crack("front left corner", { element: "slab", crackStartLocation: "edge", crackEndLocation: "corner", direction: "Diagonal", widthMm: 1.5, lengthMm: 900, notes: "Owner advised on the day" })] } } }));
    assert.ok(p.includes("DEFECT::0::At the front left corner, there is a crack starting at the edge and running to the corner. The crack is 1.5 millimetres wide and 900 millimetres long."));
    assert.ok(!p.join(" ").includes("Owner advised"), "the template's line has no notes");
  });

  it("puts a part's own photos straight after its sentence, before its defects", () => {
    const photo = "https://example.test/p1.jpg";
    const p = paras(draft("paving_paths", { areas: { front: { present: "yes", material: ["Concrete"], condition: SAT, photos: [photo], damages: [crack("corner")] } } }));
    const i = p.findIndex((x) => x.startsWith("There is paving to the front of the block"));
    assert.equal(p[i + 1], `PHOTOS::${photo}`);
    assert.ok(p[i + 2].startsWith("DEFECT::0::At the corner, there is a crack."));
  });

  it("says a satisfactory elevation is satisfactory, with or without damage, and states any other grade", () => {
    const ok = paras(draft("elevations", { sides: { front: { orientation: "North", condition: SAT } } }));
    assert.ok(ok.includes("Satisfactory and in typical condition."));
    const damaged = paras(draft("elevations", { sides: { front: { orientation: "North", condition: SAT, damages: [crack("the brickwork")] } } }));
    assert.ok(damaged.includes("Satisfactory and in typical condition."));
    assert.ok(damaged.some((x) => x.startsWith("DEFECT::0::At the brickwork, there is")));
    assert.ok(paras(draft("elevations", { sides: { front: { orientation: "North", condition: "Poor" } } })).includes("It is in poor condition."));
  });

  it("says a parked vehicle obscured the hardstand as its own sentence", () => {
    const structure = (obscuredBy) => paras(draft("garage_carport_sheds", { structures: { garage: { present: "yes", attachment: "Separate to building", position: "Front", walls: ["Brick"], wallsCondition: SAT, obscuredBy } } })).join(" ");
    assert.ok(structure(["Stored goods", "Parked car/s"]).includes("Sections of the walls and hardstand were obscured by stored goods. A parked car obscured part of the hardstand."));
    assert.ok(structure(["Parked vehicles"]).includes("Parked vehicles obscured part of the hardstand."));
  });

  it("words fence defects as 'A gap at ...' / 'A loose paling at ...'", () => {
    const p = paras(draft("fences", { items: { left: { present: "yes", material: ["Timber palings"], condition: SAT, damages: [{ location: "the gate", damageType: "Gap" }, { location: "the corner", damageType: "Loose paling" }] } } }));
    assert.ok(p.includes("DEFECT::0::A gap at the gate."));
    assert.ok(p.includes("DEFECT::1::A loose paling at the corner."));
  });

  it("words the floors' forklift scuff marks and line markings", () => {
    const p = paras(draft("internal_areas", { hard_floorLevel: "Ground floor", hard_generalCondition: SAT, hard_scuffMarks: "yes", hard_lineMarkings: "Satisfactory" }));
    assert.ok(p.includes("ROOMHEAD::Ground Floor"));
    assert.ok(p.includes("Satisfactory and in typical condition. There are scuff marks from forklifts. The painted line markings are satisfactory."));
  });
});

