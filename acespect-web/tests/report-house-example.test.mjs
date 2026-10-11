// Dilapidation / Residential House, checked against the REAL Houspect report
// ("Dilapidation Residential Example Apr 2025.pdf"). The answers below are what an inspector would tick and type on the
// real inspector form ("Dilapidation Residential_Inspector Template_1 May2024.pdf") to describe that inspection, and every
// expected sentence is word for word a sentence of the example report.
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
const { resolveInstances, isGateSatisfied } = await server.ssrLoadModule("/src/web/templateFields.ts");

const HOUSE = { inspectionType: "dilapidation", propertyType: "residential_house" };
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const fieldsOf = (key) => snapshot.find((t) => t.inspectionType === HOUSE.inspectionType && t.propertyType === HOUSE.propertyType && t.sectionKey === key).fields;

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
    if (v === undefined) continue;
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
const draft = (key, answers) => flattenSectionToDraft(fieldsOf(key), convert(fieldsOf(key), answers), key, HOUSE);
const paras = (d) => d.reportText.split("\n\n");
const SAT = "Satisfactory with typical wear and tear";
const crack = (location, w, l, run) => ({ location, damageType: "Cracking", widthMm: w, lengthMm: l, direction: run });

describe("House example report: Description and Overview", () => {
  const d = draft("description", {
    constructionIs: "Single storey house", constructedYear: "2015", streetFrontage: "East", blockSlope: "Mostly flat", wallCladdingGround: ["Brick veneer"], wallCladdingFirst: ["Not applicable"],
    foundations: "Concrete slab", roofDesign: "Pitched", roofCovering: ["Tile"], windows: ["Mix of aluminium and timber"],
    proposedWorksType: "New housing estate", projectSiteAddress: "Highlands Estate Stage 450, Mickleham", siteSide: "Rear", siteDirection: "West", scopeForInspection: "External and internal to all structures",
  });

  it("describes the property", () => {
    assert.equal(
      d.reportText,
      "The property is a single storey house, facing east on a mostly flat block of land and estimated to have been constructed around 2015. It is constructed of brick veneer walls on concrete slab with a pitched roof and a covering of tile. Windows are constructed of a mix of aluminium and timber.",
    );
  });

  it("words the project works as 'the {project}' for works that are not to a residential property", () => {
    assert.equal(wordingFor(HOUSE).descriptionBlocks({ fields: d.fields, areaCount: 0 }).works, "The project works are the Highlands Estate Stage 450, Mickleham, which is at the rear - approximately west - of the site of this inspection.");
    const house = draft("description", { proposedWorksType: "Residential property", projectSiteAddress: "3 Test Street", siteSide: "Left-hand side", siteDirection: "North" });
    assert.equal(wordingFor(HOUSE).descriptionBlocks({ fields: house.fields, areaCount: 0 }).works, "The project works are to the property at 3 Test Street, which is at the left-hand side - approximately north - of the site of this inspection.");
  });
});

describe("House example report: External", () => {
  it("driveway and paving", () => {
    const d = draft("driveway", { present: "yes", locatedAt: "Front right", material: "Concrete", condition: SAT, obscuredBy: [OTHER + "plant pots"], damages: [crack("middle of the driveway", 0.9, 2000, "Vertical")] });
    assert.ok(paras(d).includes("The driveway is to the front right of the block and is constructed of concrete. It is in satisfactory condition with typical wear and tear. Sections of the driveway were obscured by plant pots."));
    assert.ok(paras(d).some((p) => p.includes("there is a vertical crack approximately 0.9 millimetres wide and approximately 2000 millimetres long.")));
    const paving = draft("paving_paths", { areas: { front: { present: "yes", material: ["Concrete"], condition: SAT, obscuredBy: [OTHER + "plant pots", "Stored goods"] }, left: { present: "yes", material: ["Concrete"], condition: SAT, obscuredBy: ["Vegetation", "Stored goods"] }, rear: { present: "yes", material: ["Concrete"], condition: SAT, damages: [crack("right corner", 1.4, 500, "Diagonal")] } } });
    const p = paras(paving);
    assert.ok(p.includes("There is paving to the front of the block, constructed of concrete. It is in satisfactory condition with typical wear and tear. Sections of the paving were obscured by plant pots and stored goods."));
    assert.ok(p.includes("There is paving to the left-hand side of the block, constructed of concrete. It is in satisfactory condition with typical wear and tear. Sections of the paving were obscured by vegetation and stored goods."));
    assert.ok(p.some((x) => x === "DEFECT::0::At the right corner there is a diagonal crack approximately 1.4 millimetres wide and approximately 500 millimetres long."));
  });

  it("fences", () => {
    const p = paras(draft("fences", { items: { front: { present: "no" }, rear: { present: "yes", material: ["Timber palings"], condition: SAT, obscuredBy: ["Vegetation", OTHER + "a shed"] } } }));
    assert.equal(p[0], "There is no front fence.");
    assert.ok(p.includes("The rear fence is constructed of timber palings and is in satisfactory condition with typical weathering. Sections of the fence were obscured by vegetation and a shed."));
  });

  it("garage, shed and pergola", () => {
    const p = paras(draft("garage_carport_sheds", {
      structures: {
        garage: { present: "yes", attachment: "Attached to house", position: "Front", walls: ["Brick"], wallsCondition: SAT, roof: ["Tiles"], floor: ["Concrete hardstand"], obscuredBy: ["Shelving", "Stored goods"] },
        shed: { present: "yes", attachment: "Separate to house", position: "Rear", walls: ["Metal"], wallsCondition: SAT, roof: ["Metal"], floor: ["Concrete hardstand"], obscuredBy: ["Shelving", "Stored goods"] },
        granny_flat: { present: "yes", structureName: "Pergola", attachment: "Attached to house", position: "Rear", walls: [OTHER + "timber"], wallsCondition: SAT, roof: [OTHER + "laserlite roof covering"] },
      },
    }));
    assert.ok(p.includes("There is a garage attached to the house at the front, constructed of brick with a tiled roof and concrete hardstand, and is generally in satisfactory state of repair. Sections of the walls and floor were obscured by shelving and stored goods."));
    assert.ok(p.includes("There is a shed located at the rear of the property, constructed of metal with a metal roof and concrete hardstand, and is generally in satisfactory state of repair. Sections of the walls and hardstand were obscured by shelving and stored goods."));
    assert.ok(p.includes("There is a pergola attached to the house at the rear, constructed of timber with a laserlite roof covering, which is generally in satisfactory state of repair."));
  });

  it("elevations", () => {
    const p = paras(draft("elevations", {
      sides: {
        front: { orientation: "East", condition: SAT, obscuredBy: [OTHER + "plant pots"], damages: [{ location: "porch", damageType: "Surface Damage", sub_surface: "Chips", element: "rendered pier" }] },
        right: { orientation: "North", partyWall: "yes", partyWallNumber: "2", partialInspection: ["Rear"], condition: SAT, obscuredBy: ["Stored goods", OTHER + "outdoor furniture"] },
      },
    }));
    assert.ok(p.includes("ROOMHEAD::Front Elevation (east)"));
    assert.ok(p.includes("Satisfactory and in typical condition. Sections were obscured by plant pots."));
    assert.ok(p.includes("DEFECT::0::At the porch there is a chip to the rendered pier."));
    assert.ok(p.includes("The right elevation is a party wall abutting the next property at No. 2 and could only be partly inspected to the rear which is in satisfactory and in typical condition. Sections were obscured by stored goods and outdoor furniture."));
  });

  it("roof", () => {
    const p = paras(draft("roof_chimneys", { sections: { upper: { inspectionStatus: ["Limited observations from ground level using camera zoom"], generalCondition: ["Satisfactory to fair with typical weathering"] } } }));
    assert.ok(p.includes("The roof covering appears to be in satisfactory to fair condition with typical weathering. Comments are based on limited observations from the ground only and using a camera zoom."));
  });
});

describe("House example report: Internal", () => {
  const d = draft("internal_areas", {
    renovationsInProgress: "yes", renovationsRooms: "laundry", roomsNotAccessed: "Bedroom 3",
    rooms: {
      front_entry_hallway: { present: "yes", floorLevel: "Ground floor", roomName: "Entry and Hallway", obscuredBy: ["Furniture", "Stored goods"], generalCondition: SAT, damages: [crack("entry door architrave mitre", 0.4, 70, "Diagonal")] },
      kitchen: { present: "yes", floorLevel: "Ground floor", roomName: "Kitchen, Family and Dining", obscuredBy: ["Furniture", "Stored goods"], generalCondition: SAT },
      bedroom: { present: "yes", floorLevel: "Ground floor", roomName: "Bedroom 1 and ensuite", obscuredBy: ["Furniture", "Stored goods"], generalCondition: SAT },
      bathroom: { present: "yes", floorLevel: "Ground floor", obscuredBy: ["Stored goods"], generalCondition: SAT },
      toilet: { present: "yes", floorLevel: "Ground floor", roomName: "Powder room", generalCondition: SAT },
      laundry: { present: "yes", floorLevel: "Ground floor", obscuredBy: ["Stored goods"], generalCondition: SAT },
    },
  });
  const p = paras(d);

  it("words each room as the report does", () => {
    assert.ok(p.includes("The entry and hallway are in satisfactory and typical condition. Sections were obscured by furniture and stored goods."));
    assert.ok(p.includes("The kitchen, family and dining areas are in satisfactory and typical condition. Sections were obscured by furniture and stored goods."));
    assert.ok(p.includes("The bedroom and ensuite are in satisfactory and typical condition. Sections were obscured by furniture and stored goods."));
    assert.ok(p.includes("The bathroom is in satisfactory and typical condition. Sections were obscured by stored goods."));
    assert.ok(p.includes("The powder room is in satisfactory and typical condition."));
    assert.ok(p.includes("DEFECT::0::At the entry door architrave mitre there is a diagonal crack approximately 0.4 millimetres wide and approximately 70 millimetres long."));
  });

  it("says what the report's notes say about renovations and rooms not accessed", () => {
    assert.ok(p.includes("Renovations in progress to laundry."));
    assert.ok(p.includes("No access granted to Bedroom 3."));
  });
});

describe("House form: the real inspector template's choices and fields", () => {
  const fieldOf = (section, key) => {
    const find = (fs) => { for (const f of fs) { if (f.key === key) return f; if (f.itemFields) { const r = find(f.itemFields); if (r) return r; } } };
    return find(fieldsOf(section));
  };
  const labels = (section, key) => (fieldOf(section, key)?.options ?? []).map((o) => o.label);

  it("has the choices the real form offers", () => {
    assert.ok(labels("description", "windows").includes("Mix of aluminium and timber"));
    assert.ok(labels("description", "roofCovering").includes("Mix of"));
    assert.ok(labels("description", "wallCladdingGround").includes("Combo of"));
    assert.ok(labels("description", "constructionIs").includes("Apartment in a multi-level apartment complex"));
    assert.ok(labels("roof_chimneys", "inspectionStatus").includes("Not applicable - apartment"));
  });

  it("has the real form's roof general condition, fence / wall condition details and structure name", () => {
    assert.deepEqual(labels("roof_chimneys", "generalCondition"), ["Satisfactory to fair with typical weathering", "Some surface rust", "Cracked tiles", "Gaps at flashings", "Gaps / cracking to chimney brickwork", "Chimney appears unstable"]);
    assert.ok(labels("fences", "conditionDetails").includes("Loose or missing palings"));
    assert.ok(labels("retaining_walls", "conditionDetails").includes("Decayed"));
    assert.ok(fieldOf("garage_carport_sheds", "structureName"));
  });

  it("has the job fields the real form starts with", () => {
    for (const k of ["businessName", "businessSignage", "firstPicNo", "lastPicNo", "postProject"]) assert.ok(fieldOf("job-info", k), k);
  });

  it("lists the real form's rooms, keeping the keys existing inspections already use", () => {
    const rooms = fieldOf("internal_areas", "rooms").repeat.fixedInstances;
    assert.deepEqual(rooms.map((r) => r.label), [
      "Front entry and hallway", "Kitchen / Family / Living", "Lounge (separate, if any)", "Dining (separate, if any)", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Bedroom 4 / Study",
      "Bathroom", "WC / Powder room", "Laundry", "Stairs / Stairwell / Landing / hallway", "Balcony / Terrace", "Other internal area",
    ]);
    for (const k of ["front_entry_hallway", "living_room", "dining_area", "kitchen", "bedroom", "bathroom", "laundry", "toilet", "stairwell", "other"]) assert.ok(rooms.some((r) => r.key === k), `${k} is still there`);
  });

  it("words what was noted on a fence, a retaining wall and a roof", () => {
    const fence = paras(draft("fences", { items: { left: { present: "yes", material: ["Timber palings"], condition: SAT, conditionDetails: ["Typical weathering and some gaps", "Loose or missing palings", "Leaning"] } } })).join(" ");
    assert.ok(fence.includes("is in satisfactory condition with typical weathering and some gaps. Loose or missing palings and leaning noted."));
    const wall = paras(draft("retaining_walls", { present: "yes", items: [{ location: "Left", materials: ["Brick"], condition: SAT, conditionDetails: ["Decayed"] }] })).join(" ");
    assert.ok(wall.includes("Decayed noted."));
    const roof = paras(draft("roof_chimneys", { sections: { upper: { generalCondition: ["Satisfactory to fair with typical weathering", "Some surface rust", "Cracked tiles", "Chimney appears unstable"] } } })).join(" ");
    assert.ok(roof.includes("Some surface rust and cracked tiles noted. Chimney appears unstable."));
    const named = paras(draft("garage_carport_sheds", { structures: { shed: { present: "yes", structureName: "Greenhouse", attachment: "Separate to house", position: "Rear", wallsCondition: SAT } } })).join(" ");
    assert.ok(named.includes("There is a greenhouse located at the rear of the property"));
  });

  it("still prints a recorded crack, with the overview sentence, and says nothing when the part is good", () => {
    const bad = paras(draft("driveway", { present: "yes", locatedAt: "Front left", material: "Concrete", condition: SAT, crackingSummary: "Several minor cracks", damages: [crack("middle of the driveway", 0.9, 2000, "Vertical")] })).join(" ");
    assert.ok(bad.includes("Several minor cracks observed."));
    assert.ok(/crack approximately 0\.9 millimetres wide/.test(bad), bad);
    const good = paras(draft("driveway", { present: "yes", locatedAt: "Front left", material: "Concrete", condition: SAT, crackingSummary: "No visible significant cracking" })).join(" ");
    assert.ok(!/crack|observed/i.test(good), good);
  });

  it("says 'with typical wear and tear' only for a satisfactory grade; fair and poor get their own plain sentence", () => {
    const drive = (condition) => paras(draft("driveway", { present: "yes", locatedAt: "Front left", material: "Concrete", condition })).join(" ");
    assert.ok(drive(SAT).includes("It is in satisfactory condition with typical wear and tear."));
    assert.ok(drive("Fair").includes("It is in fair condition.") && !/typical/.test(drive("Fair")));
    assert.ok(drive("Poor").includes("It is in poor condition.") && !/typical/.test(drive("Poor")));
    const fence = (condition) => paras(draft("fences", { items: { left: { present: "yes", material: ["Timber palings"], condition, conditionDetails: ["Typical weathering and some gaps"] } } })).join(" ");
    assert.ok(fence(SAT).includes("is in satisfactory condition with typical weathering and some gaps."));
    assert.ok(fence("Poor").includes("is in poor condition with some gaps."));
  });

  it("words good and bad differently across garage, pool, fences and walls", () => {
    const garage = (wallsCondition) => paras(draft("garage_carport_sheds", { structures: { garage: { present: "yes", attachment: "Attached to house", position: "Front", walls: ["Brick"], wallsCondition } } })).join(" ");
    assert.ok(garage(SAT).includes("and is generally in satisfactory state of repair."));
    assert.ok(garage("Poor").includes("and is generally in poor state of repair."));
    assert.ok(garage("New").includes("and is new.") && !/state of repair/.test(garage("New")));
    const pool = (fenceSafety, poolFence) => paras(draft("pool_spa", { present: "yes", position: "Rear", condition: SAT, fenceSafety, poolFence })).join(" ");
    assert.ok(pool("Appears to be okay", ["Glass panels"]).includes("The pool fence is constructed of glass panels and appears to be okay."));
    assert.ok(pool("No, does not appear to be safe", ["Glass panels"]).includes("The pool fence is constructed of glass panels and does not appear to be safe."));
    assert.ok(pool("No, does not appear to be safe").includes("The pool fence does not appear to be safe.") && !/boundary/.test(pool("No, does not appear to be safe")), "no invented fence material");
    const fence = (conditionDetails) => paras(draft("fences", { items: { left: { present: "yes", material: ["Brick"], conditionDetails } } })).join(" ");
    assert.ok(fence(["Typical weathering and some gaps"]).includes("is in satisfactory condition with typical weathering and some gaps."), "the satisfactory choice ticked on its own still states the condition");
  });

  it("asks 'with ensuite' on Bedroom 1 and Bedroom 2 only, and nowhere else", () => {
    const rooms = fieldOf("internal_areas", "rooms");
    const ensuite = rooms.itemFields.find((f) => f.key === "withEnsuite");
    assert.equal(ensuite.type, "yesno");
    assert.equal(ensuite.required, false);
    assert.deepEqual(ensuite.gate, { fieldKey: "__instanceKey", equalsAny: ["bedroom", "bedroom_2"] });
    // what the room editor shows, room by room
    const shownIn = resolveInstances(rooms, {}).filter((r) => isGateSatisfied(ensuite, r.scope)).map((r) => r.label);
    assert.deepEqual(shownIn, ["Bedroom 1", "Bedroom 2"]);
    // no other section or report type has it
    const holders = snapshot.filter((t) => JSON.stringify(t.fields).includes('"withEnsuite"')).map((t) => `${t.propertyType}/${t.sectionKey}`);
    assert.deepEqual(holders, ["residential_house/internal_areas"]);
  });

  it("shows the party-wall question on the left and right elevations only", () => {
    const sides = fieldOf("elevations", "sides");
    const partyWall = sides.itemFields.find((f) => f.key === "partyWall");
    assert.deepEqual(resolveInstances(sides, {}).filter((r) => isGateSatisfied(partyWall, r.scope)).map((r) => r.key), ["left", "right"]);
  });

  it("words a bedroom ticked 'with ensuite' as the real report does", () => {
    const compose = (rooms) => paras(draft("internal_areas", { rooms }));
    const room = compose({ bedroom: { present: "yes", floorLevel: "Ground floor", withEnsuite: "yes", obscuredBy: ["Furniture", "Stored goods"], generalCondition: SAT } });
    assert.ok(room.includes("ROOMHEAD::Bedroom 1 and ensuite"));
    assert.ok(room.includes("The bedroom and ensuite are in satisfactory and typical condition. Sections were obscured by furniture and stored goods."));
    const plain = compose({ bedroom: { present: "yes", floorLevel: "Ground floor", generalCondition: "Fair" } });
    assert.ok(plain.includes("ROOMHEAD::Bedroom 1") && plain.includes("The bedroom is in fair condition."));
  });
});
