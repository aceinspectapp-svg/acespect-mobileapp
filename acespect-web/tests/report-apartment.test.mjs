// Dilapidation / Apartment, worded line by line from Houspect's Nov 2026 "Dilapidation Multi Level Office Building" office template, on
// the Apartment form rebuilt in the template's shape (acespect-backend restructure-apartment-form-template.ts): the driveway, paving,
// fences and retaining walls, garage / carport / loading bay / shed, the four elevations, the roof, the rooms floor by floor, the notes.
// Every line the report prints is one of the template's lines with the inspector's answers in its blanks.
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
const { orderedPieces } = await server.ssrLoadModule("/src/web/reportParts.ts");

const APT = { inspectionType: "dilapidation", propertyType: "apartment" };
const W = wordingFor(APT);
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const fieldsOf = (key) => snapshot.find((t) => t.inspectionType === APT.inspectionType && t.propertyType === APT.propertyType && t.sectionKey === key).fields;

/** A choice's stored value, by (the start of) its label -- searched at any depth. */
function v(fields, key, label) {
  const find = (fs) => {
    for (const f of fs) {
      if (f.key === key && f.options) return f;
      const inner = f.itemFields ? find(f.itemFields) : undefined;
      if (inner) return inner;
    }
  };
  const f = find(fields);
  if (!f) throw new Error(`no question ${key}`);
  const l = label.toLowerCase();
  const o = f.options.find((x) => x.label.toLowerCase() === l) ?? f.options.find((x) => x.label.toLowerCase().startsWith(l));
  if (!o) throw new Error(`no option "${label}" in ${key}`);
  return o.value;
}
const draft = (key, answers, sectionKey = key) => flattenSectionToDraft(fieldsOf(key), answers, sectionKey, APT);
const paras = (d) => d.reportText.split("\n\n").filter(Boolean);
const crack = (location, start, end, widthMm, lengthMm, photos = []) => ({ location, damageType: "cracking", crackStartLocation: start, crackEndLocation: end, widthMm, lengthMm, photos });

describe("Apartment: Description and Overview (template lines 14-22)", () => {
  const D = fieldsOf("description");
  const answers = {
    buildingType: v(D, "buildingType", "High-rise"), storeys: "10", signedAs: "Unit 706", facing: v(D, "facing", "North-east"), slope: v(D, "slope", "Flat"), design: v(D, "design", "Contemporary"), constructedYear: "2010s",
    cladding: v(D, "cladding", "Concrete panels"), foundations: v(D, "foundations", "Concrete slab"), roofDesign: v(D, "roofDesign", "Flat"), roofCovering: v(D, "roofCovering", "Membrane"), windows: v(D, "windows", "Aluminium"),
    projectAddr: "18 Lighthouse Street, Galle", direction: v(D, "direction", "Left"), directionCompass: v(D, "directionCompass", "East"), scopeType: v(D, "scopeType", "Partial"), scopePartAt: "unit 706 and its balconies",
  };

  it("words the property as line 14 does", () => {
    assert.deepEqual(paras(draft("description", answers)), [
      "The property is a unit in a 10-storey high-rise apartment building signed as Unit 706, facing north-east on a flat block of land. It is of a contemporary design and estimated to have been constructed around the 2010s. It is constructed of concrete panel walls on concrete slab with a flat roof and a covering of membrane. Windows are constructed of aluminium.",
    ]);
  });

  it("says a typed year as line 14's decade: 'around the 2000s', not 'around 2008'", () => {
    const t = draft("description", { ...answers, constructedYear: "2008" }).reportText;
    assert.ok(t.includes("estimated to have been constructed around the 2000s."), t);
  });

  it("words an extension as line 15 does", () => {
    const p = paras(draft("description", { ...answers, extension: "yes", extensionTo: v(D, "extensionTo", "Rear"), extensionYear: "2005", extensionWalls: v(D, "extensionWalls", "Brick veneer"), extensionFoundations: v(D, "extensionFoundations", "Concrete slab"), extensionRoofDesign: v(D, "extensionRoofDesign", "Flat"), extensionRoofCovering: v(D, "extensionRoofCovering", "Membrane") }));
    assert.equal(p[1], "There is an extension to the rear built around 2005. It is constructed of brick veneer walls on concrete slab with a flat roof and a covering of membrane.");
  });

  it("words the project works and the scope as lines 21-22 do", () => {
    const fields = draft("description", answers).fields;
    assert.deepEqual(W.descriptionBlocks({ fields, areaCount: 0 }), {
      works: "The project works are to the property at 18 Lighthouse Street, Galle, which is at the left - approximately east - of the site of this inspection.",
      scope: "The scope for inspection is external and internal to part of the property at unit 706 and its balconies.",
    });
  });

  it("asks no Pre-Purchase questions any more (kind of works, limitations, safety issues)", () => {
    const keys = D.map((f) => f.key);
    for (const gone of ["worksType", "limitations", "safetyIssues"]) assert.ok(!keys.includes(gone), gone);
  });
});

describe("Apartment: EXTERNAL (template lines 31-118)", () => {
  it("Driveway: 'There is no driveway.' / 'The driveway is to the front of the block and is constructed of ...' and the crack line", () => {
    const F = fieldsOf("driveway");
    assert.deepEqual(paras(draft("driveway", { present: "no" })), ["There is no driveway."]);
    assert.deepEqual(paras(draft("driveway", { present: "yes", location: v(F, "location", "Front"), material: v(F, "material", "Concrete"), condition: v(F, "condition", "Satisfactory"), obscuredBy: [v(F, "obscuredBy", "A parked vehicle")], damages: [crack("driveway entry", "the kerb crossing", "the garage door", 2, 1200)], photos: ["/m/d1.jpg?s=1"] })), [
      "The driveway is to the front of the block and is constructed of concrete. It is in satisfactory condition with typical wear and tear. Sections of the driveway were obscured by a parked vehicle.",
      "DEFECT::0::At the driveway entry, there is a crack starting at the kerb crossing and running to the garage door. The crack is 2 millimetres wide and 1200 millimetres long.",
      "PHOTOS::/m/d1.jpg",
    ]);
  });

  it("Paving: 'There is paving to the front of the block, constructed of ...' for each side, nothing for a side without", () => {
    const F = fieldsOf("paving_paths");
    assert.deepEqual(paras(draft("paving_paths", { areas: { front: { present: "yes", material: [v(F, "material", "Pavers")], condition: v(F, "condition", "Fair"), obscuredBy: [v(F, "obscuredBy", "Vegetation")], photos: ["/m/p1.jpg"] }, left: { present: "no" } } })), [
      "There is paving to the front of the block, constructed of pavers. It is in fair condition. Sections of the paving were obscured by vegetation.",
      "PHOTOS::/m/p1.jpg",
    ]);
    assert.ok(paras(draft("paving_paths", { areas: { left: { present: "yes", material: [v(F, "material", "Concrete")] } } })).includes("There is paving to the left-hand side of the block, constructed of concrete."));
  });

  it("Fences: each side's line, 'There is no left-hand fence.', 'There are no fences surrounding this property.' and the fence defect line", () => {
    const F = fieldsOf("fences");
    const one = { items: { front: { present: "yes", material: [v(F, "material", "Brick")], condition: v(F, "condition", "Satisfactory"), obscuredBy: [v(F, "obscuredBy", "Vegetation")], damages: [{ location: "gate post", element: "render", damageType: "material_deterioration", sub_material: v(F, "sub_material", "Spalling") }] }, left: { present: "no" }, rear: { present: "no" }, right: { present: "no" } } };
    assert.deepEqual(paras(draft("fences", one)), [
      "The front fence is constructed of brick and is in satisfactory condition with typical weathering. Sections of the fence are obscured by vegetation.",
      "DEFECT::0::Spalling to the render at the gate post.",
      "There is no left-hand fence.",
      "There is no rear fence.",
      "There is no right-hand fence.",
    ]);
    const none = { items: { front: { present: "no" }, left: { present: "no" }, rear: { present: "no" }, right: { present: "no" } } };
    assert.deepEqual(paras(draft("fences", none)), ["There are no fences surrounding this property."]);
  });

  it("says nothing of what the inspector could not see ('Not inspected'), and no 'There are no fences surrounding this property.' then", () => {
    assert.equal(draft("driveway", { present: "not_inspected" }).reportText, "");
    assert.equal(draft("paving_paths", { areas: { front: { present: "not_inspected" } } }).reportText, "");
    assert.equal(draft("garage_carport_sheds", { structures: { garage: { present: "not_inspected" } } }).reportText, "");
    assert.equal(draft("fences", { items: { front: { present: "not_inspected" }, left: { present: "not_inspected" }, rear: { present: "not_inspected" }, right: { present: "not_inspected" } } }).reportText, "");
    assert.deepEqual(paras(draft("fences", { items: { front: { present: "no" }, left: { present: "not_inspected" } } })), ["There is no front fence."]);
  });

  it("Retaining walls: 'There is a retaining wall on the left side of the property, running from the front to the rear. ...'", () => {
    const F = fieldsOf("retaining_walls");
    assert.deepEqual(paras(draft("retaining_walls", { present: "yes", items: [{ side: v(F, "side", "Left"), of: v(F, "of", "Property"), runningFrom: v(F, "runningFrom", "Front"), runningTo: v(F, "runningTo", "Rear"), material: [v(F, "material", "Timber sleepers")], condition: v(F, "condition", "Satisfactory"), details: [v(F, "details", "There is some decay")] }] })), [
      "There is a retaining wall on the left side of the property, running from the front to the rear. It is constructed of timber sleepers. It is in satisfactory condition with typical weathering. There is some decay.",
    ]);
    assert.equal(draft("retaining_walls", { present: "no" }).reportText, "");
  });

  it("Garage/Carport/Loading Bay and Any other free standing Structures: lines 62 and 69, each under its heading", () => {
    const F = fieldsOf("garage_carport_sheds");
    const p = paras(draft("garage_carport_sheds", { structures: {
      garage: { present: "yes", locatedAt: v(F, "locatedAt", "In the basement"), walls: [v(F, "walls", "Concrete")], roof: [v(F, "roof", "Concrete slab")], condition: v(F, "condition", "Fair"), obscuredBy: [v(F, "obscuredBy", "Shelving"), v(F, "obscuredBy", "A parked car")] },
      carport: { present: "no" },
      shed: { present: "yes", locatedAt: v(F, "locatedAt", "At the rear"), walls: [v(F, "walls", "Metal")], roof: [v(F, "roof", "Colorbond")], condition: v(F, "condition", "Satisfactory"), significantDamage: "no" },
    } }));
    assert.deepEqual(p, [
      "PART::Garage/Carport/Loading Bay",
      "There is a garage located in the basement, constructed of concrete with a concrete slab roof, and is generally in fair state of repair. Sections of the walls were obscured by shelving. A parked car obscured part of the hardstand.",
      "PART::Any other free standing Structures",
      "There is a shed located at the rear of the property, constructed of metal with a Colorbond roof, and is generally in satisfactory state of repair. There is no visible significant damage.",
    ]);
  });

  it("Main structure: each elevation under its heading, the party-wall line, the defects and lines 78-80", () => {
    const F = fieldsOf("elevations");
    const p = paras(draft("elevations", { sides: {
      front: { present: "yes", orientation: v(F, "orientation", "North"), condition: v(F, "condition", "Satisfactory"), alsoNoted: [v(F, "alsoNoted", "Downpipe"), v(F, "alsoNoted", "Eaves have water stains"), v(F, "alsoNoted", "Eaves have mould")], damages: [crack("front wall", "the window head", "the eaves", 1, 400)] },
      left: { present: "yes", orientation: v(F, "orientation", "East"), partyWall: "yes", partyWallNo: "705", partyWallMaterial: "Concrete", condition: v(F, "condition", "Fair"), damages: [crack("party wall", "the floor slab", "the ceiling", 0.5, 900)] },
      rear: { present: "no" },
    } }));
    assert.deepEqual(p, [
      "ROOMHEAD::Front Elevation (north)",
      "Satisfactory condition with typical wear and tear.",
      "DEFECT::0::At the front wall, there is a crack starting at the window head and running to the eaves. The crack is 1 millimetres wide and 400 millimetres long.",
      "Downpipe is not connected to the stormwater system. Eaves have water stains and mould most likely due to overflowing gutters.",
      "ROOMHEAD::Left Elevation (east)",
      "The left elevation is a party wall abutting the next property at No. 705. It is constructed of concrete which is in fair condition.",
      "DEFECT::1::At the party wall, there is a crack starting at the floor slab and running to the ceiling. The crack is approximately 0.5 millimetres wide and approximately 900 millimetres long.",
    ]);
  });

  it("Roof Covering (and Chimney): the multi-level complex line, the ground / ladder / OH&S lines and the chimney line", () => {
    const F = fieldsOf("roof_chimneys");
    assert.deepEqual(paras(draft("roof_chimneys", { status: v(F, "status", "Not inspected"), chimney: "no" })), [
      "PART::Roof Covering",
      "The roof could not be inspected as the building is a multi-level building complex. Roof coverings in a building complex are common property and need to be maintained through the Owners Corporation.",
    ]);
    assert.deepEqual(paras(draft("roof_chimneys", { status: v(F, "status", "Observed from the ground"), covering: [v(F, "covering", "Tiles")], condition: v(F, "condition", "Satisfactory"), with: [v(F, "with", "Typical weathering")], chimney: "yes", chimneyMaterial: [v(F, "chimneyMaterial", "Brick")], chimneyCondition: v(F, "chimneyCondition", "Fair"), chimneyWith: [v(F, "chimneyWith", "Gaps")] })), [
      "PART::Roof Covering and Chimney",
      "The roof covering of tiles appears to be in satisfactory condition with typical weathering. Comments are based on limited observations from the ground only and using a camera zoom.",
      "The chimney is constructed of brick and appears to be in fair condition with gaps and cracking to the brickwork.",
    ]);
    assert.ok(paras(draft("roof_chimneys", { status: v(F, "status", "Observed from a ladder"), covering: [v(F, "covering", "Membrane")], condition: v(F, "condition", "Fair"), chimney: "no" })).includes("The roof covering of membrane appears to be in fair condition. Comments are based on limited observations standing on a ladder to the lower roof and from the ground using a camera zoom."));
    assert.ok(paras(draft("roof_chimneys", { status: v(F, "status", "Upper roof"), condition: v(F, "condition", "Fair"), lowerCondition: v(F, "lowerCondition", "Satisfactory"), chimney: "no" })).includes("Due to OH & S constraints the upper roof could not be accessed safely. Observations from the ground indicate that the roof covering is in fair condition. The lower level roofing generally appears to be in satisfactory condition."));
  });
});

describe("Apartment: INTERNAL and NOTES (template lines 119-225)", () => {
  it("prints the rooms under their floor, each with its line 125 and its defects with 'approximately'", () => {
    const F = fieldsOf("internal_areas");
    const p = paras(draft("internal_areas", { rooms: {
      entry_hallway: { present: "yes", floorLevel: "__other__:Level 7", condition: v(F, "condition", "Satisfactory"), obscuredBy: [v(F, "obscuredBy", "Furniture")], photos: ["/m/i1.jpg"] },
      living_room: { present: "yes", floorLevel: "__other__:Level 7", condition: v(F, "condition", "Average"), damages: [crack("living room wall", "the top of the skirting board", "a point about 1.1 metres above the floor", 1, 1100, ["/m/c.jpg"])] },
      bedroom_1: { present: "yes", roomName: "Main Bedroom", floorLevel: "__other__:Level 7", condition: v(F, "condition", "Satisfactory") },
      dining: { present: "no" },
    } }));
    assert.deepEqual(p, [
      "LEVEL 7",
      "ROOMHEAD::Entry / Hallway",
      "Satisfactory condition with typical wear and tear. Sections were obscured by furniture.",
      "PHOTOS::/m/i1.jpg",
      "ROOMHEAD::Living Room",
      "It is in average condition.",
      "DEFECT::0::At the living room wall, there is a crack starting at the top of the skirting board and running to a point about 1.1 metres above the floor. The crack is approximately 1 millimetres wide and approximately 1100 millimetres long.",
      "ROOMHEAD::Main Bedroom",
      "Satisfactory condition with typical wear and tear.",
    ]);
  });

  it("prints the NOTES as the template's bullets", () => {
    assert.deepEqual(paras(draft("notes", { noAccess: [{ area: "roof", reason: "the roof being common property" }], squeakyFloors: "yes", squeakyWhere: "hallway", unlevelFloors: "no", photosRestricted: "yes", photosRestrictedTo: "internal areas", additionalNotes: "Construction was active next door." })), [
      "There was no access to the roof due to the roof being common property.",
      "Squeaky flooring was noted to the hallway.",
      "The owner restricted the number of photographs to the internal areas.",
      "Construction was active next door.",
    ]);
  });

  it("words an added structure as line 71 does", () => {
    const F = fieldsOf("custom_structure");
    assert.equal(
      draft("custom_structure", { description: "Bin enclosure", locatedAt: v(F, "locatedAt", "At the rear"), material: [v(F, "material", "Brick")], condition: v(F, "condition", "Satisfactory"), significantDamage: "no" }, "custom_bin_enclosure").reportText,
      "There is a bin enclosure located at the rear of the property, constructed of brick, which is generally in satisfactory state of repair. There is no visible significant damage.",
    );
  });

  it("asks the defects only what the template's defect line says (no severity, direction or notes)", () => {
    const list = fieldsOf("driveway").find((f) => f.type === "damage-list").itemFields.map((f) => f.key);
    for (const gone of ["sub_cracking", "direction", "notes"]) assert.ok(!list.includes(gone), gone);
    for (const kept of ["location", "damageType", "crackStartLocation", "crackEndLocation", "widthMm", "lengthMm", "photos"]) assert.ok(list.includes(kept), kept);
  });
});

describe("Apartment: the report laid out as the template is", () => {
  const section = (key, reportText, extra = {}) => ({ id: key, key, name: key, reportText, photos: [], damages: [], answers: {}, ...extra });

  it("prints the template's headings in its order, each once, INTERNAL as its band only", () => {
    const pieces = orderedPieces(
      [
        section("driveway", "There is no driveway."),
        section("paving_paths", "There is paving to the front of the block."),
        section("fences", "There are no fences surrounding this property."),
        section("retaining_walls", "There is a retaining wall on the left side of the property."),
        section("garage_carport_sheds", "PART::Garage/Carport/Loading Bay\n\nThere is a garage.\n\nPART::Any other free standing Structures\n\nThere is a shed."),
        section("elevations", "ROOMHEAD::Front Elevation (north)"),
        section("roof_chimneys", "PART::Roof Covering\n\nThe roof could not be inspected."),
        section("internal_areas", "LEVEL 7\n\nROOMHEAD::Living Room"),
        section("custom_bin_enclosure", "There is a bin enclosure.", { name: "Bin enclosure" }),
        section("notes", "There was no access to the roof."),
      ],
      W,
      (s) => s.key,
    );
    assert.deepEqual(pieces.map((p) => [p.section.name, p.band ?? "-", p.showHeading]), [
      ["Driveway", "EXTERNAL", true],
      ["Paving / Parking areas / Basement car parks", "EXTERNAL", true],
      ["Fences and Retaining Walls", "EXTERNAL", true],
      ["Fences and Retaining Walls", "EXTERNAL", false],
      ["Garage/Carport/Loading Bay", "EXTERNAL", true],
      ["Any other free standing Structures", "EXTERNAL", true],
      ["Any other free standing Structures", "EXTERNAL", false],
      ["Main structure", "EXTERNAL", true],
      ["Roof Covering", "EXTERNAL", true],
      ["INTERNAL", "INTERNAL", false],
      ["notes", "-", true],
    ]);
  });

  it("prints no Condition Summary page and no pool disclaimer, and the front photo to fit the page (line 16)", () => {
    assert.equal(W.conditionSummary, false);
    assert.equal(W.poolSpaDisclaimer, false);
    assert.deepEqual(W.frontPhoto, { placeholder: "Insert photograph of front of property (from street view). Size to fit the page and centre.", fit: "page" });
  });

  it("says the weather in the template's words ('Dry / Sunny / Intermittent showers / Rain / Overcast')", async () => {
    const { weatherWords } = await server.ssrLoadModule("/src/web/report.ts");
    assert.equal(weatherWords("overcast, intermittent_showers"), "Overcast, Intermittent showers");
    assert.equal(weatherWords("sunny, __other__:Light wind"), "Sunny, Light wind");
  });
});

describe("Apartment: an inspection started on the first Apartment form still prints", () => {
  it("words the old element-based External section with the template's lines", () => {
    const old = [
      { key: "elev_overview_elevations", type: "pill-select", label: "Elevations inspected", options: [{ label: "Left", value: "left" }, { label: "All accessible faces", value: "all" }] },
      { key: "elev_overview_partyWall", type: "yesno", label: "Party wall" },
      { key: "ext_walls_condition", type: "color-select", label: "Condition", options: [{ label: "Fair", value: "fair" }] },
    ];
    const d = flattenSectionToDraft(old, { elev_overview_elevations: "all", elev_overview_partyWall: "yes", ext_walls_condition: "fair" }, "elevations", APT);
    assert.deepEqual(paras(d), ["PART::Main structure", "It is in fair condition. There is a party wall abutting the next property."]);
  });
});

describe("Apartment: wording registry and form", () => {
  it("is a final report type of its own", () => {
    assert.equal(W.status, "final");
    assert.deepEqual(W.profile, APT);
  });

  it("has the form rebuilt in the template's shape", () => {
    const name = (k) => snapshot.find((t) => t.inspectionType === "dilapidation" && t.propertyType === "apartment" && t.sectionKey === k).name;
    assert.deepEqual(
      ["driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "elevations", "roof_chimneys", "internal_areas", "notes"].map(name),
      ["Driveway", "Paving / Parking areas / Basement car parks", "Fences", "Retaining Walls", "Garage / Carport / Loading Bay / Shed", "Main structure (Elevations)", "Roof Covering and Chimney", "Internal", "Notes"],
    );
    assert.deepEqual(fieldsOf("elevations")[0].repeat.fixedInstances.map((i) => i.key), ["front", "left", "rear", "right"]);
  });
});
