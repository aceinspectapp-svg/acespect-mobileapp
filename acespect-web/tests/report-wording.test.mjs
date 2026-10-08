// Run with: npm test   (Node's built-in test runner -- no extra dependencies)
//
// Exercises the real report-sentence logic (src/web/wording/ +
// templateFields.ts) loaded through Vite, against:
//   * the published Dilapidation / Residential House templates, read from the
//     backend's template snapshot -- what inspectors actually fill in; and
//   * a few small inline fixtures in the original seed's older field layout,
//     which the composers still accept.
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());

const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { wordingFor } = await server.ssrLoadModule("/src/web/wording/registry.ts");
const { composeSection } = await server.ssrLoadModule("/src/web/wording/types.ts");
const HOUSE = { inspectionType: "dilapidation", propertyType: "residential_house" };
const composeSectionSentence = (key, inst, fields, label) => composeSection(wordingFor(HOUSE), key, inst, fields, label);
const { listMissingItems } = await server.ssrLoadModule("/src/web/templateFields.ts");

const snapshot = JSON.parse(
  readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"),
);
const template = (sectionKey) =>
  snapshot.find(
    (t) => t.inspectionType === "dilapidation" && t.propertyType === "residential_house" && t.sectionKey === sectionKey,
  ).fields;

const text = (sectionKey, answers) => flattenSectionToDraft(template(sectionKey), answers, sectionKey, HOUSE);
const reportText = (sectionKey, answers) => text(sectionKey, answers).reportText;
const paragraphs = (t) => t.split("\n\n");

// Fields every published damage-list entry needs to describe itself.
const crack = (extra = {}) => ({ damageType: "cracking", sub_cracking: "moderate", location: "centre of the driveway", ...extra });

describe("published templates: Driveway (flat, present yes/no)", () => {
  const base = { present: "yes", locatedAt: "front_left", material: "concrete", condition: "satisfactory_with_typical_wear_and_tear" };

  it("writes the template sentence, with the grade shortened", () => {
    const out = reportText("driveway", base);
    assert.match(out, /^COND::#65a30d::Satisfactory\n\n/);
    assert.ok(
      out.includes(
        "The driveway is to the front left of the block and is constructed of concrete. It is in satisfactory condition with typical wear and tear.",
      ),
    );
    assert.ok(!out.includes("Is there a driveway?"), "the yes/no is folded into the prose, not printed as a line");
  });

  it("states the absence when there is no driveway", () => {
    assert.equal(reportText("driveway", { present: "no" }), "There is no driveway.");
  });

  it("prints what was typed for 'Other', not the word 'other'", () => {
    const out = reportText("driveway", { ...base, material: "other", materialOther: "Recycled brick" });
    assert.ok(out.includes("constructed of recycled brick."));
  });

  it("words a semi-circle driveway sensibly", () => {
    const out = reportText("driveway", { ...base, locatedAt: "semi_circle_with_2_entries_exits" });
    assert.ok(out.includes("The driveway is a semi-circle with 2 entries/exits and is constructed of concrete."));
  });

  it("adds the cracking overview and obstructions to the same paragraph", () => {
    const out = reportText("driveway", {
      ...base,
      crackingSummary: "numerous_cracking_throughout",
      obscuredBy: ["vegetation", "stored_goods"],
    });
    assert.ok(out.includes("Numerous cracking observed throughout."));
    assert.ok(out.includes("Sections of the driveway were obscured by vegetation and stored goods."));
  });

  it("describes a cracking defect with severity, start point and direction", () => {
    const out = reportText("driveway", {
      ...base,
      damages: [crack({ crackStartLocation: "the garage entrance", direction: "vertical", widthMm: 6, lengthMm: 850, element: "slab" })],
    });
    assert.ok(
      out.includes(
        "At the centre of the driveway there is a vertical moderate crack to the slab starting from the garage entrance approximately 6 millimetres wide and approximately 850 millimetres long.",
      ),
    );
  });

  it("keeps the summary note readable for a location that starts with a preposition", () => {
    const { fields } = text("driveway", { ...base, damages: [crack({ location: "above the garage door" })] });
    assert.equal(fields.conditionSummary[0].defectNote, "Cracking above the garage door");
  });

  it("words non-crack defects with their sub-type", () => {
    const out = reportText("driveway", {
      ...base,
      damages: [{ damageType: "material_deterioration", sub_material: "spalling", location: "kerb edge" }],
    });
    assert.ok(out.includes("At the kerb edge there is spalling."));
    const chip = reportText("driveway", { ...base, damages: [{ damageType: "surface_damage", sub_surface: "chips", location: "porch", element: "rendered pier" }] });
    assert.ok(chip.includes("At the porch there is a chip to the rendered pier."));
  });

  it("uses plural wording for plural defect types", () => {
    const out = reportText("driveway", { ...base, damages: [{ damageType: "safety_issues", location: "gate" }] });
    assert.ok(out.includes("At the gate there are safety issues."));
    const hazard = reportText("driveway", { ...base, damages: [{ damageType: "safety_issues", sub_safety: "tripping_hazard", location: "gate" }] });
    assert.ok(hazard.includes("At the gate there is a tripping hazard."));
  });

  it("feeds the Executive Summary even though the template defines no colours", () => {
    const { fields } = text("driveway", { ...base, damages: [crack()] });
    assert.deepEqual(fields.conditionSummary, [
      { subLabel: undefined, conditionLabel: "Satisfactory", conditionColor: "#65a30d", defectNote: "Cracking at centre of the driveway" },
    ]);
  });
});

describe("published templates: fixed-slot sections (Paving, Fences, Garage)", () => {
  it("prints nothing for slots that were never visited", () => {
    const out = reportText("paving_paths", {
      areas: { front: { present: "yes", material: ["concrete"], condition: "fair" } },
    });
    assert.equal(paragraphs(out).filter((p) => p.startsWith("There is paving")).length, 1);
    assert.ok(out.includes("There is paving to the front of the block, constructed of concrete. It is in fair condition."));
  });

  it("states the absence when every slot is marked not present", () => {
    const out = reportText("paving_paths", { areas: { front: { present: "no" }, left: { present: "no" } } });
    assert.equal(out, "There is no paving to the property.");
  });

  it("names a fence by its side and lists every material", () => {
    const out = reportText("fences", {
      items: { rear: { present: "yes", material: ["timber_palings", "brick"], condition: "poor" } },
    });
    assert.ok(out.includes("The rear fence is constructed of timber palings and brick and is in poor condition."));
  });

  it("names a garage slot, how it is attached and what it is made of", () => {
    const out = reportText("garage_carport_sheds", {
      structures: {
        shed: {
          present: "yes",
          attachment: "separate_to_house",
          position: "rear",
          walls: ["metal"],
          roof: ["colorbond"],
          floor: ["concrete"],
          wallsCondition: "fair",
        },
      },
    });
    assert.ok(
      out.includes(
        "There is a shed located at the rear of the property, constructed of metal with a colorbond roof and a concrete floor, and is generally in fair state of repair.",
      ),
    );
  });

  it("drops the garage slot marked not present, and says so when none exist", () => {
    assert.equal(
      reportText("garage_carport_sheds", { structures: { garage: { present: "no" } } }),
      "There is no garage, carport or shed to the property.",
    );
  });
});

describe("published templates: Retaining Walls and Pool / Spa", () => {
  it("states the absence from the section-level 'Are there any?' answer", () => {
    assert.equal(reportText("retaining_walls", { present: "no" }), "There are no retaining walls to the property.");
  });

  it("words a retaining wall from its titled list entry", () => {
    const out = reportText("retaining_walls", {
      present: "yes",
      items: [{ location: "rear", materials: ["timber_sleepers"], condition: "fair" }],
    });
    assert.ok(out.includes("There is a retaining wall to the rear, constructed of timber sleepers. It is in fair condition."));
  });

  it("words a pool and its fence from the flat template", () => {
    const out = reportText("pool_spa", {
      present: "yes",
      position: "rear",
      constructed: ["fibreglass"],
      paving: ["tiles"],
      poolFence: ["glass_panels"],
      fenceSafety: "no_does_not_appear_to_be_safe",
      condition: "fair",
    });
    assert.ok(out.includes("There is a pool/spa located at the rear of the property, constructed of fibreglass, which from limited views is generally in fair state of repair."));
    assert.ok(out.includes("The surrounds are paved with tiles."));
    assert.ok(out.includes("The pool fence is constructed of glass panels and does not appear to be safe."));
  });

  it("uses the condition for the pool's grade, not the fence-safety pill", () => {
    const { fields } = text("pool_spa", { present: "yes", fenceSafety: "appears_to_be_okay", condition: "poor" });
    assert.equal(fields.conditionSummary[0].conditionLabel, "Poor");
  });
});

describe("published templates: Elevations, Roof, Internal Areas, Notes", () => {
  it("words an elevation and skips the sides that were not touched", () => {
    const out = reportText("elevations", {
      sides: {
        front: {
          orientation: "north",
          condition: "fair",
          damageSummary: "no_visible_significant_damage",
          partialInspection: ["rear"],
          cladding: ["paint_is_flaking_from_sections"],
        },
      },
    });
    assert.ok(out.includes("ROOMHEAD::Front Elevation (north)"));
    assert.ok(out.includes("Could only be partly inspected to the rear. It is in fair condition."));
    assert.ok(!/notable damage/.test(out), "the damage overview pick is not a sentence in the report");
    assert.ok(out.includes("Cladding: paint is flaking from sections."));
    assert.ok(!out.includes("rear elevation"));
  });

  it("states roof inspection limits as sentences", () => {
    const out = reportText("roof_chimneys", {
      sections: { upper: { condition: "fair", coveringType: ["tile"], inspectionStatus: ["no_chimney_s"] } },
    });
    assert.ok(out.includes("The roof covering appears to be in fair condition, constructed of tile. There are no chimneys visible."));
  });

  it("groups rooms under one floor banner each and composes the section-level answers", () => {
    const out = reportText("internal_areas", {
      renovationsInProgress: "yes",
      renovationsRooms: "kitchen",
      rooms: {
        living_room: { present: "yes", floorLevel: "1st_floor", generalCondition: "fair" },
        kitchen: { present: "yes", floorLevel: "ground_floor", generalCondition: "poor", damageSummary: "several_minor_gaps_and_cracks" },
        bedroom: { present: "no" },
      },
    });
    assert.ok(out.startsWith("Renovations in progress to kitchen."));
    const ground = out.indexOf("GROUND FLOOR");
    const first = out.indexOf("FIRST FLOOR");
    assert.ok(ground > -1 && first > ground, "rooms are grouped by floor, ground first");
    assert.ok(out.includes("The kitchen, family and living areas are in poor condition."));
    assert.ok(out.includes("The kitchen, family and living areas are in poor condition. Several minor gaps and cracks observed."));
    assert.ok(!out.includes("Bedroom"));
  });

  it("gives an unnamed extra room a sensible heading", () => {
    const out = reportText("internal_areas", { rooms: { added_1: { present: "yes", generalCondition: "fair" } } });
    assert.ok(out.includes("ROOMHEAD::Other room"));
  });

  it("completes the checklist's sentence openers with the note, and prints nothing for 'No'", () => {
    const out = reportText("notes", {
      movement: {
        bouncy_floors: { value: "yes", note: "the hallway" },
        doors_binding: { value: "no" },
        loose_bricks: { value: "yes", note: "rear chimney" },
      },
    });
    assert.ok(out.includes("Floors are bouncy / squeaking at the hallway."));
    assert.ok(out.includes("Location: rear chimney."));
    assert.ok(!out.includes("binding"));
  });

  it("leaves Notes completely empty when nothing was ticked", () => {
    assert.equal(reportText("notes", { movement: { bouncy_floors: { value: "no" } } }), "");
  });
});

describe("Description & Overview", () => {
  const desc = (answers) => reportText("description", answers);

  it("prints typed 'Other' text for every field that offers it", () => {
    const out = desc({
      foundations: "other",
      foundationsOther: "Recycled brick footing",
      roofDesign: "other",
      roofDesignOther: "Skillion",
      roofCovering: ["other"],
      roofCoveringOther: "Terracotta shingle",
      windows: ["other"],
      windowsOther: "uPVC",
      wallCladdingGround: ["other"],
      wallCladdingGroundOther: "Recycled timber",
    });
    assert.ok(out.includes("recycled timber walls on recycled brick footing with a skillion roof and a covering of terracotta shingle"));
    assert.ok(out.includes("Windows are constructed of uPVC."));
  });

  it("keeps typed acronyms and brand spellings as typed", () => {
    assert.ok(desc({ windows: ["other"], windowsOther: "uPVC" }).includes("Windows are constructed of uPVC."));
    assert.ok(desc({ windows: ["aluminium", "timber"] }).includes("Windows are constructed of aluminium and timber."));
  });

  it("spells out intercardinal directions", () => {
    assert.ok(desc({ streetFrontage: "ne" }).includes("facing north-east"));
    assert.ok(desc({ streetFrontage: "sw" }).includes("facing south-west"));
    assert.ok(desc({ streetFrontage: "north" }).includes("facing north"));
  });

  it("does not say 'stage' twice", () => {
    assert.ok(desc({ underConstructionStage: "Frame" }).includes("at frame stage."));
    assert.ok(desc({ underConstructionStage: "Frame Stage" }).includes("at frame stage."));
  });

  it("has no stray comma when the construction type is blank", () => {
    assert.equal(desc({ streetFrontage: "north", constructedYear: "1985" }), "The property is facing north and estimated to have been constructed around 1985.");
  });

  it("keeps the floor distinction when only first-floor cladding is answered", () => {
    assert.ok(desc({ wallCladdingFirst: ["hebel"] }).includes("hebel walls to the first floor"));
  });

  it("ignores 'Not applicable' first-floor cladding", () => {
    assert.equal(desc({ wallCladdingGround: ["brick_veneer"], wallCladdingFirst: ["not_applicable"] }), "It is constructed of brick veneer walls.");
  });
});

describe("original seed field layout (still accepted)", () => {
  const condition = {
    key: "condition",
    type: "color-select",
    options: [
      { value: "fair", label: "Fair", color: "#d97706" },
      { value: "poor", label: "Poor", color: "#dc2626" },
    ],
  };
  const damageList = (key = "damages") => ({
    key,
    type: "damage-list",
    itemFields: [
      { key: "damageType", type: "pill-select", options: [{ value: "crack", label: "Crack" }, { value: "leaning", label: "Leaning" }, { value: "other", label: "Other" }] },
    ],
  });
  const drivewayFields = [
    { key: "location", type: "pill-select", options: [{ value: "front", label: "Front" }] },
    { key: "material", type: "pill-select", options: [{ value: "concrete", label: "Concrete" }] },
    condition,
    damageList(),
  ];

  it("writes the same driveway sentence", () => {
    const out = composeSectionSentence("driveway", { location: "front", material: "concrete", condition: "fair" }, drivewayFields, "Driveway");
    assert.ok(out.includes("The driveway is to the front of the block and is constructed of concrete. It is in fair condition."));
  });

  it("no longer says 'no driveway' for an entry that only has a condition", () => {
    const out = composeSectionSentence("driveway", { condition: "fair" }, drivewayFields, "Driveway");
    assert.ok(out.includes("The driveway is in fair condition."));
  });

  it("gives 'leaning' and 'other' defects a noun to sit on", () => {
    const run = (damageType) =>
      composeSectionSentence("driveway", { condition: "fair", damages: [{ damageType, location: "centre", widthMm: 5 }] }, drivewayFields, "Driveway");
    assert.ok(run("leaning").includes("there is a leaning defect approximately 5 millimetres wide."));
    assert.ok(run("other").includes("there is a defect approximately 5 millimetres wide."));
    assert.ok(run("crack").includes("there is a crack approximately 5 millimetres wide."));
  });

  it("does not stack 'At the' in front of a location that starts with a preposition", () => {
    const out = composeSectionSentence(
      "driveway",
      { condition: "fair", damages: [{ damageType: "crack", location: "above the front window" }] },
      drivewayFields,
      "Driveway",
    );
    assert.ok(out.includes("Above the front window there is a crack."));
  });

  it("gives drainage its article", () => {
    const fields = [
      condition,
      { key: "drainage", type: "color-select", options: [{ value: "adequate", label: "Adequate" }, { value: "minor_issue", label: "Minor Issue" }] },
    ];
    const run = (drainage) => composeSectionSentence("paving_paths", { condition: "fair", drainage }, fields, "Areas 1");
    assert.ok(run("adequate").includes("Drainage is adequate."));
    assert.ok(run("minor_issue").includes("Drainage is a minor issue."));
  });

  it("still reads single-select materials (pick-one, not tick-any)", () => {
    const opt = (key, ...pairs) => ({ key, type: "pill-select", options: pairs.map(([value, label]) => ({ value, label })) });
    assert.ok(
      composeSectionSentence("paving_paths", { name: "path", pathType: "concrete", condition: "fair" }, [opt("pathType", ["concrete", "Concrete"]), condition], "Areas 1")
        .includes("There is paving to the path, constructed of concrete."),
    );
    assert.ok(
      composeSectionSentence("fences", { location: "front", structureType: "timber_paling", condition: "fair" }, [opt("location", ["front", "Front"]), opt("structureType", ["timber_paling", "Timber Paling"]), condition], "Items 1")
        .includes("The front fence is constructed of timber paling and is in fair condition."),
    );
    assert.ok(
      composeSectionSentence("retaining_walls", { location: "left", material: "block", condition: "new" }, [opt("location", ["left", "Left"]), opt("material", ["block", "Block"]), condition], "Items 1")
        .includes("There is a retaining wall to the left, constructed of block."),
    );
  });

  it("keeps 'to the house' for the original seed's plain Attached / Separate", () => {
    const fields = [
      { key: "attachment", type: "pill-select", options: [{ value: "separate", label: "Separate" }] },
      { key: "position", type: "pill-select", options: [{ value: "right", label: "Right" }] },
      condition,
    ];
    const out = composeSectionSentence("garage_carport_sheds", { name: "Carport", attachment: "separate", position: "right", condition: "fair" }, fields, "Structures 1");
    assert.ok(out.includes("There is a carport located at the right of the property, and is generally in fair state of repair."));
  });

  it("skips an item marked Available: No", () => {
    const fields = [{ key: "available", type: "yesno" }, condition];
    assert.equal(composeSectionSentence("elevations", { available: "no", condition: "fair" }, fields, "Rear"), "");
  });
});

describe("what is still pending in a section", () => {
  const missing = (key, answers) => listMissingItems(template(key), answers);

  it("lists the one question when nothing is answered", () => {
    assert.deepEqual(missing("driveway", {}), ["Is there a driveway?"]);
  });

  it("lists the gated questions once 'Yes' is chosen, and none when 'No'", () => {
    const out = missing("driveway", { present: "yes" });
    assert.ok(out.includes("Located at") && out.includes("Material") && out.includes("Condition"));
    assert.deepEqual(missing("driveway", { present: "no" }), []);
  });

  it("names each slot of a fixed-slot section", () => {
    const out = missing("paving_paths", { areas: { front: { present: "yes", material: ["concrete"] } } });
    assert.ok(out.some((m) => m.startsWith("Front: ")));
    assert.ok(out.some((m) => m.startsWith("Left: ")), "slots nobody touched are pending too");
  });

  it("asks for a defect when the condition demands one", () => {
    const out = missing("driveway", { present: "yes", locatedAt: "front_left", material: "concrete", condition: "poor", crackingSummary: "several_minor_cracks", obscuredBy: ["vegetation"], notes: "x" });
    assert.ok(out.includes("record at least one defect"));
  });
});

describe("Driveway divided into parts (what seed-driveway-parts.ts publishes)", () => {
  const flat = template("driveway");
  const partsTemplate = [
    {
      key: "parts", type: "repeating-group", label: "Driveway", order: 0,
      repeat: { presentation: "fixed-tabs", fixedInstances: [{ key: "front_left", label: "Front left" }, { key: "front_right", label: "Front right" }, { key: "rear", label: "Rear" }, { key: "side", label: "Side" }] },
      itemFields: flat.filter((f) => f.key !== "locatedAt"),
    },
  ];
  const run = (parts) => flattenSectionToDraft(partsTemplate, { parts }, "driveway", HOUSE);
  const part = (material, condition) => ({ present: "yes", material, condition });

  it("gives every part its own condition label and paragraph", () => {
    const { reportText, fields } = run({ front_left: part("concrete", "fair"), front_right: part("pavers", "poor"), side: part("gravel", "new") });
    assert.equal((reportText.match(/COND::/g) ?? []).length, 3);
    assert.ok(reportText.includes("The driveway is to the front left of the block and is constructed of concrete."));
    assert.ok(reportText.includes("The driveway is to the front right of the block and is constructed of pavers."));
    assert.ok(reportText.includes("The driveway is to the side of the block and is constructed of gravel."));
    assert.deepEqual(fields.conditionSummary.map((r) => [r.subLabel, r.conditionLabel]), [["Front left", "Fair"], ["Front right", "Poor"], ["Side", "New"]]);
  });

  it("leaves out a part marked not present, and says so only when every part is absent", () => {
    const some = run({ front_left: part("concrete", "fair"), rear: { present: "no" } });
    assert.ok(!some.reportText.includes("rear"));
    assert.equal(some.fields.conditionSummary.length, 1);
    assert.equal(run({ front_left: { present: "no" }, rear: { present: "no" } }).reportText, "There is no driveway.");
  });
});

describe("Pool / Spa divided into parts (what seed-section-parts.ts publishes)", () => {
  const flat = template("pool_spa");
  const partsTemplate = [
    {
      key: "parts", type: "repeating-group", label: "Pool / Spa", order: 0,
      repeat: { presentation: "fixed-tabs", fixedInstances: [{ key: "pool", label: "Pool" }, { key: "spa", label: "Spa" }] },
      itemFields: flat,
    },
  ];
  const run = (parts) => flattenSectionToDraft(partsTemplate, { parts }, "pool_spa", HOUSE);

  it("gives the pool and the spa their own label and paragraph", () => {
    const { reportText, fields } = run({
      pool: { present: "yes", position: "rear", constructed: ["fibreglass"], poolFence: ["glass_panels"], fenceSafety: "appears_to_be_okay", condition: "satisfactory_with_typical_wear_and_tear" },
      spa: { present: "yes", constructed: ["concrete_and_tile"], condition: "poor" },
    });
    assert.equal((reportText.match(/COND::/g) ?? []).length, 2);
    assert.ok(reportText.includes("There is a pool located at the rear of the property, constructed of fibreglass, which from limited views is generally in satisfactory state of repair."));
    assert.ok(reportText.includes("The pool fence is constructed of glass panels and appears to be okay."));
    assert.ok(reportText.includes("There is a spa located at the property, constructed of concrete and tile, which from limited views is generally in poor state of repair."));
    assert.deepEqual(fields.conditionSummary.map((r) => [r.subLabel, r.conditionLabel]), [["Pool", "Satisfactory"], ["Spa", "Poor"]]);
  });

  it("leaves out a part that is not there, and says so only when neither exists", () => {
    const poolOnly = run({ pool: { present: "yes", condition: "fair" }, spa: { present: "no" } });
    assert.ok(!poolOnly.reportText.toLowerCase().includes("spa"));
    assert.equal(run({ pool: { present: "no" }, spa: { present: "no" } }).reportText, "There is no pool or spa to the property.");
  });
});

describe("each defect sentence is tagged so its own photos can sit under it", () => {
  const defect = (location, photo) => ({ damageType: "cracking", sub_cracking: "fine", location, photos: [photo] });

  it("numbers the defects across the whole section, in the same order as the saved defect list", () => {
    const out = text("fences", {
      items: {
        front: { present: "yes", material: ["brick"], condition: "fair", damages: [defect("gate", "front-1.jpg"), defect("corner", "front-2.jpg")] },
        left: { present: "yes", material: ["brick"], condition: "fair", damages: [defect("post", "left-1.jpg")] },
      },
    });
    const tagged = [...out.reportText.matchAll(/DEFECT::(\d+)::At the ([a-z]+)/g)].map((m) => [Number(m[1]), m[2]]);
    assert.deepEqual(tagged, [[0, "gate"], [1, "corner"], [2, "post"]]);
    // the marker position is the position in the saved defect list, so it points at that defect's own photos
    tagged.forEach(([i, where]) => assert.ok(out.damages[i].location.includes(where)));
    assert.deepEqual(out.damages.map((d) => d.photos[0]), ["front-1.jpg", "front-2.jpg", "left-1.jpg"]);
  });

  it("leaves a defect from an absent part out of both the text and the list", () => {
    const out = text("fences", {
      items: {
        front: { present: "no", damages: [defect("stale", "stale.jpg")] },
        left: { present: "yes", material: ["brick"], condition: "fair", damages: [defect("post", "left-1.jpg")] },
      },
    });
    assert.ok(out.reportText.includes("DEFECT::0::At the post"));
    assert.equal(out.damages.length, 1);
  });

  it("keeps a multi-line note inside its own defect paragraph", () => {
    const out = text("driveway", { present: "yes", locatedAt: "front_left", material: "concrete", condition: "fair", damages: [{ ...defect("slab", "a.jpg"), notes: "first line\nsecond line" }] });
    assert.ok(out.reportText.includes("DEFECT::0::At the slab"));
    assert.ok(out.reportText.includes("first line second line."));
  });
});

describe("a typed 'Other' (stored inline as __other__:<text>) and a bare 'Other'", () => {
  const desc = (answers) => reportText("description", answers);
  const none = (s) => assert.ok(!s.includes("__other__"), `a raw __other__ leaked into: ${s}`);

  it("prints the typed text in the property description", () => {
    const out = desc({ foundations: "__other__:Raft slab", windows: ["aluminium", "__other__:uPVC"], roofCovering: ["__other__:Terracotta shingle"], roofDesign: "__other__:Skillion" });
    none(out);
    assert.ok(out.includes("on raft slab with a skillion roof and a covering of terracotta shingle"));
    assert.ok(out.includes("Windows are constructed of aluminium and uPVC."));
  });

  it("says nothing for an 'Other' with nothing typed, rather than printing the word 'other'", () => {
    assert.equal(desc({ foundations: "other" }), "");
    assert.equal(desc({ windows: ["other"] }), "");
    assert.equal(desc({ foundations: "__other__:" }), "");
    assert.ok(desc({ windows: ["timber", "other"] }).includes("Windows are constructed of timber."));
  });

  it("prints typed materials and obstructions in a category", () => {
    const out = reportText("fences", {
      items: { front: { present: "yes", material: ["timber_palings", "__other__:Hardwood sleepers"], condition: "fair", obscuredBy: ["__other__:Parked trailer", "other"] } },
    });
    none(out);
    assert.ok(out.includes("constructed of timber palings and hardwood sleepers and is in fair condition"));
    assert.ok(out.includes("obscured by parked trailer."));
  });

  it("words a typed defect type, crack severity and direction", () => {
    const base = { present: "yes", locatedAt: "front_left", material: "concrete", condition: "fair" };
    const run = (d) => text("driveway", { ...base, damages: [{ location: "kerb", ...d }] });
    const typed = run({ damageType: "__other__:Rotting edge", widthMm: 4 });
    none(typed.reportText);
    assert.ok(typed.reportText.includes("At the kerb there is a rotting edge approximately 4 millimetres wide."));
    assert.equal(typed.fields.conditionSummary[0].defectNote, "Rotting edge at kerb");
    assert.ok(run({ damageType: "cracking", sub_cracking: "__other__:Stress crack" }).reportText.includes("there is a stress crack."));
    assert.ok(run({ damageType: "cracking", sub_cracking: "fine", direction: "__other__:diagonally down" }).reportText.includes("running diagonally down"));
    assert.ok(run({ damageType: "other" }).reportText.includes("there is a defect."));
    assert.ok(run({ damageType: "__other__:" }).reportText.includes("there is a defect."));
  });

  it("unwraps a typed 'Other' in the saved field data, and drops a bare one", () => {
    assert.equal(text("description", { proposedWorksType: "__other__:Pipeline works" }).fields.proposedWorksType, "Pipeline works");
    assert.ok(!("proposedWorksType" in text("description", { proposedWorksType: "other" }).fields));
    const damage = text("driveway", { present: "yes", damages: [{ damageType: "__other__:Rotting edge", location: "kerb" }] }).damages[0];
    assert.equal(damage.type, "Rotting edge");
  });
});

describe("House wording aligned to the reference document", () => {
  it("names the left and right sides 'left-hand' / 'right-hand' for paving and fences", () => {
    const paving = reportText("paving_paths", { areas: { left: { present: "yes", material: ["pavers"], condition: "fair" }, rear: { present: "yes", material: ["concrete"], condition: "fair" } } });
    assert.ok(paving.includes("There is paving to the left-hand side of the block, constructed of pavers."));
    assert.ok(paving.includes("There is paving to the rear of the block, constructed of concrete."));
    const fences = reportText("fences", { items: { left: { present: "yes", material: ["brick"], condition: "fair" } } });
    assert.ok(fences.includes("The left-hand fence is constructed of brick and is in fair condition."));
  });

  it("says 'There is no front fence.' for a side marked absent, in order, only while another side has a fence", () => {
    const some = reportText("fences", {
      items: { front: { present: "no" }, left: { present: "yes", material: ["brick"], condition: "fair" }, rear: { present: "no" }, right: { present: "no" } },
    });
    assert.deepEqual(paragraphs(some).filter((p) => !p.startsWith("COND::")), [
      "There is no front fence.",
      "The left-hand fence is constructed of brick and is in fair condition.",
      "There is no rear fence.",
      "There is no right-hand fence.",
    ]);
    const none = reportText("fences", { items: { front: { present: "no" }, left: { present: "no" } } });
    assert.equal(none, "There are no fences surrounding this property.");
  });

  it("says walls and floor were obscured for a garage, walls and hardstand for a shed on a hardstand, and the floor for a carport", () => {
    const run = (key, floor = []) =>
      reportText("garage_carport_sheds", { structures: { [key]: { present: "yes", attachment: "attached_to_house", walls: ["brick"], floor, condition: "fair", wallsCondition: "fair", obscuredBy: ["stored_goods"] } } });
    assert.ok(run("garage", ["concrete_hardstand"]).includes("Sections of the walls and floor were obscured by stored goods."));
    assert.ok(run("shed", ["concrete_hardstand"]).includes("Sections of the walls and hardstand were obscured by stored goods."));
    assert.ok(run("shed").includes("Sections of the walls and floor were obscured by stored goods."));
    assert.ok(run("carport").includes("Sections of the floor were obscured by stored goods."));
  });

  it("reads 'Satisfactory and in typical condition.' for a satisfactory elevation or room, other grades keep 'It is in ...'", () => {
    const side = (condition) => reportText("elevations", { sides: { front: { orientation: "north", condition, damageSummary: "no_visible_significant_damage", obscuredBy: ["vegetation"] } } });
    assert.ok(side("satisfactory").includes("Satisfactory and in typical condition. Sections were obscured by vegetation."));
    assert.ok(side("poor").includes("It is in poor condition."));
    assert.ok(!side("poor").includes("typical condition"));
    const room = (generalCondition) => reportText("internal_areas", { rooms: { kitchen: { present: "yes", floorLevel: "ground_floor", generalCondition, obscuredBy: ["furniture"] } } });
    assert.ok(room("satisfactory").includes("The kitchen, family and living areas are in satisfactory and typical condition. Sections were obscured by furniture."));
    assert.ok(room("fair").includes("The kitchen, family and living areas are in fair condition."));
  });

  it("describes a party wall, and what could be seen of it, as the real report does", () => {
    const out = reportText("elevations", { sides: { left: { orientation: "west", condition: "satisfactory", partyWall: "yes", partyWallNumber: "12" } } });
    assert.ok(paragraphs(out).includes("The left elevation is a party wall abutting the next property at No. 12 and could not be inspected."));
    const partly = reportText("elevations", { sides: { right: { orientation: "north", condition: "satisfactory", partyWall: "yes", partyWallNumber: "2", partialInspection: ["rear"], obscuredBy: ["stored_goods"] } } });
    assert.ok(partly.includes("The right elevation is a party wall abutting the next property at No. 2 and could only be partly inspected to the rear which is in satisfactory and in typical condition. Sections were obscured by stored goods."));
    const fair = reportText("elevations", { sides: { left: { orientation: "west", condition: "fair", partyWall: "yes", partyWallNumber: "Unit 2", partialInspection: ["front"] } } });
    assert.ok(fair.includes("abutting the next property at Unit 2 and could only be partly inspected to the front which is in fair condition."));
  });

  it("prints the cracking / damage overview only when the inspector recorded an issue", () => {
    const drive = (crackingSummary) => reportText("driveway", { present: "yes", locatedAt: "front_left", material: "concrete", condition: "fair", crackingSummary });
    assert.ok(drive("several_minor_cracks").includes("Several minor cracks observed."));
    assert.ok(drive("numerous_cracking_throughout").includes("Numerous cracking observed throughout."));
    assert.ok(!/crack/i.test(drive("no_visible_significant_cracking")), "good condition says nothing about cracking");
    assert.ok(!/crack/i.test(drive(undefined)));
    const side = (damageSummary) => reportText("elevations", { sides: { front: { orientation: "north", condition: "fair", damageSummary } } });
    assert.ok(side("several_minor_gaps_and_cracks").includes("Several minor gaps and cracks observed."));
    assert.ok(!/damage|observed/i.test(side("no_visible_significant_damage")));
    const room = (damageSummary) => reportText("internal_areas", { rooms: { bathroom: { present: "yes", floorLevel: "ground_floor", generalCondition: "fair", damageSummary } } });
    assert.ok(room("multiple_items_of_damage_throughout").includes("Multiple items of damage observed throughout."));
    assert.ok(!/damage|observed/i.test(room("no_visible_significant_damage")));
  });
});

describe("House: scope, safety and additional damage answers are printed", () => {
  it("prints scope changes, limitations and safety issues on the Description, and nothing for a plain 'No'", () => {
    const p = paragraphs(
      text("description", { constructionIs: "single_storey_house", scopeChanges: "Rear shed added", scopeLimitations: "yes", scopeLimitationsNotes: "Roof space not accessible", safetyIssues: "yes", safetyIssuesNotes: "Loose paving at the entry" }).reportText,
    );
    assert.ok(p.includes("Changes to the scope: Rear shed added."));
    assert.ok(p.includes("Limitations to the scope of the inspection: Roof space not accessible."));
    assert.ok(p.includes("Safety issues: Loose paving at the entry."));
    assert.ok(!/limitations|safety/i.test(text("description", { constructionIs: "single_storey_house", scopeLimitations: "no", safetyIssues: "no" }).reportText));
  });

  it("writes Notes' additional damage records as sentences, not just saved data", () => {
    const out = text("notes", { damages: [{ location: "garden wall", damageType: "cracking", sub_cracking: "moderate", widthMm: 6, lengthMm: 900 }] });
    const defect = paragraphs(out.reportText).find((x) => x.includes("garden wall"));
    assert.ok(defect && !defect.includes("DEFECT::") && defect.includes("approximately 6 millimetres wide and approximately 900 millimetres long"), "plain text, no marker: Notes is a plain list");
    assert.equal(out.damages.length, 1);
  });
});
