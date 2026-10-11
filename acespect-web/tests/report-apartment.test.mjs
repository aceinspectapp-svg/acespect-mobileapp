// Dilapidation / Apartment wording, run against the real published template: the Houspect "Multi Level Offices" inspector
// template (1 May 2024) -- the Commercial report without the warehouse, for an office or hotel building of several levels.
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
const SAT = "Satisfactory with typical wear and tear";

describe("Apartment: the form is the Multi Level Offices template", () => {
  it("has the office-building choices and no warehouse areas", () => {
    const labels = (section, key) => fieldsOf(section).find((f) => f.key === key).options.map((o) => o.label);
    assert.deepEqual(labels("description", "constructionIs"), ["Commercial offices", "Hotel/motel"]);
    assert.deepEqual(labels("description", "wallCladdingGround"), ["Tilt concrete panels", "Hebel", "Metal", "Brick", "Combo of"]);
    assert.ok(labels("description", "wallCladdingFirst").includes("Cement sheet"));
    assert.deepEqual(labels("description", "foundations"), ["Concrete slab", "Brick piers"]);
    assert.deepEqual(labels("description", "roofCovering"), ["Metal decking", "Zincalume", "Mix of"]);
    assert.ok(labels("roof_chimneys", "generalObservations").includes("Cracked tiles"));
    const keys = fieldsOf("internal_areas").map((f) => f.key);
    assert.ok(keys.some((k) => k.startsWith("gen_")));
    assert.ok(!keys.some((k) => /^(wh|prod|hard|roofin)_/.test(k)), "no warehouse, production, hardstand or roof underside");
  });

  it("lists the offices and staff facilities by level Grnd / 1 / 2 / 3, with a Consulting room", () => {
    const areas = fieldsOf("pool_spa").find((f) => f.key === "areas");
    assert.deepEqual(areas.repeat.fixedInstances.map((i) => i.label), [
      "Reception / Foyer", "Offices", "Board room", "Meeting room", "Consulting room", "Staff rooms / kitchens", "WC Male / Female", "Stairs / stairwell / Landing", "Storerooms", "Other area",
    ]);
    assert.deepEqual(areas.itemFields.find((f) => f.key === "floorLevel").options.map((o) => o.label), ["Ground floor", "1st floor", "2nd floor", "3rd floor"]);
    assert.equal(areas.repeat.addable, true, "extra 'Area?' tables can be added");
  });

  it("has no 'loose bricks' or 'leaning fences' lines in the notes, as in the office template", () => {
    const movement = fieldsOf("notes").find((f) => f.key === "movement");
    assert.deepEqual(movement.repeat.fixedInstances.map((i) => i.key), ["bouncy_floors", "floors_out_of_level", "doors_binding"]);
  });
});

describe("Apartment: Description and Overview", () => {
  it("says what kind of building it is", () => {
    const d = draft("description", {
      constructionIs: ["Commercial offices"], constructedYear: "2005", streetFrontage: "East", blockSlope: "Mostly flat",
      wallCladdingGround: ["Tilt concrete panels"], wallCladdingFirst: ["Metal", "Brick"], foundations: "Concrete slab", roofDesign: "Combo pitched and flat", roofCovering: ["Metal decking"], windows: "Aluminium",
    });
    assert.equal(
      d.reportText,
      "The property is a commercial office building, facing east on a mostly flat block of land and estimated to have been constructed around 2005. It is constructed of tilt concrete panel walls to the ground floor and metal and brick to the first floor on concrete slab with a combination of pitched and flat roofs and a covering of metal decking. Windows are constructed of aluminium.",
    );
    assert.ok(draft("description", { constructionIs: ["Hotel/motel"] }).reportText.startsWith("The property is a hotel or motel."));
  });
});

describe("Apartment: worded as the office report, good and bad differently", () => {
  it("words the driveway, car park, fences and garage in the report's sentences", () => {
    const drive = paras(draft("driveway", { present: "yes", locatedAt: "Front left", material: "Asphalt", condition: "Poor", crackingSummary: "Numerous cracking throughout", obscuredBy: ["Parked cars", "Trailer"] }));
    assert.ok(drive.includes("The driveway is to the front left of the block and is constructed of asphalt. It is in poor condition. Numerous cracking observed throughout. Sections of the driveway were obscured by parked cars and trailer."));
    const car = paras(draft("paving_paths", { areas: { front: { present: "yes", material: ["Concrete"], condition: SAT } } }));
    assert.ok(car.includes("There is paving to the front of the block, constructed of concrete. It is in satisfactory condition with typical wear and tear."));
    const fence = paras(draft("fences", { items: { left: { present: "yes", material: ["Brick"], condition: SAT } } }));
    assert.ok(fence.includes("The left-hand fence is constructed of brick and is in satisfactory condition with typical weathering."));
    const garage = paras(draft("garage_carport_sheds", { structures: { garage: { present: "yes", attachment: "Basement", walls: ["Basement"], wallsCondition: SAT, floor: ["Concrete hardstand"] } } }));
    assert.ok(garage.includes("ROOMHEAD::Garage"));
    assert.ok(garage.some((x) => x.startsWith("There is a garage in the basement, with concrete hardstand, and is generally in satisfactory state of repair.")));
  });

  it("words the elevations and roof", () => {
    const e = paras(draft("elevations", { sides: { rear: { orientation: "South", condition: "Fair", damageSummary: "Several minor gaps and cracks", obscuredBy: ["Stored goods"], damages: [crack("above the window")] } } }));
    assert.ok(e.includes("ROOMHEAD::Rear Elevation (south)"));
    assert.ok(e.includes("It is in fair condition. Several minor gaps and cracks observed. Sections were obscured by stored goods."));
    assert.ok(e.some((x) => x.startsWith("DEFECT::0::Above the window there is a vertical fine crack")));
    const roof = paras(draft("roof_chimneys", { inspectionStatus: ["Limited observations from ground level using camera zoom"], generalCondition: SAT, generalObservations: ["Cracked tiles"] })).join(" ");
    assert.ok(roof.includes("The roof covering appears to be in satisfactory condition. Comments are based on limited observations from the ground only and using a camera zoom. Cracked tiles noted."));
  });

  it("groups the offices under the level they are on, up to the 3rd floor", () => {
    const d = draft("pool_spa", {
      areas: {
        reception_foyer: { present: "yes", floorLevel: "Ground floor", generalCondition: SAT },
        consulting_room: { present: "yes", floorLevel: "3rd floor", generalCondition: "Fair", damageSummary: "Items of damage throughout", damages: [crack("window frame")] },
      },
    });
    const p = paras(d);
    assert.deepEqual(p.filter((x) => /^[A-Z ]+ FLOOR$/.test(x)), ["GROUND FLOOR", "THIRD FLOOR"]);
    assert.ok(p.includes("The reception and foyer are in satisfactory and typical condition."));
    assert.ok(p.includes("The consulting room is in fair condition. Items of damage observed throughout."));
  });

  it("keeps what was recorded about the whole building, and has no warehouse text", () => {
    const d = draft("internal_areas", { gen_renovationsInProgress: "yes", gen_renovationsRooms: "Level 2 kitchen", gen_safetyAdvisories: "no", gen_roomsNotAccessed: "Plant room", gen_movementObserved: "yes", gen_movementWhere: "Level 1 corridor floor" });
    const p = paras(d);
    assert.ok(p.includes("Renovations in progress to level 2 kitchen."));
    assert.ok(p.includes("No access granted to Plant room."));
    assert.ok(p.includes("Movement was observed in the internal areas: Level 1 corridor floor."));
    assert.ok(!/warehouse|production|hardstand/i.test(d.reportText));
  });
});

describe("Apartment: wording registry", () => {
  it("is a final report type of its own, with the project-works sentences on the Description page", () => {
    const w = wordingFor(APT);
    assert.equal(w.status, "final");
    assert.deepEqual(w.profile, APT);
    assert.equal(typeof w.descriptionBlocks, "function");
  });
});
