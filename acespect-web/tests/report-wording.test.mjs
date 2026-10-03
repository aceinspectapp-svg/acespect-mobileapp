// Run with: npm test   (Node's built-in test runner -- no extra dependencies)
//
// Exercises the real report-sentence logic (src/web/reportSentences.ts +
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
const { composeSectionSentence } = await server.ssrLoadModule("/src/web/reportSentences.ts");

const snapshot = JSON.parse(
  readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"),
);
const template = (sectionKey) =>
  snapshot.find(
    (t) => t.inspectionType === "dilapidation" && t.propertyType === "residential_house" && t.sectionKey === sectionKey,
  ).fields;

const text = (sectionKey, answers) => flattenSectionToDraft(template(sectionKey), answers, sectionKey);
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
    assert.equal(reportText("driveway", { present: "no" }), "There is no driveway to the property.");
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
        "At the centre of the driveway, there is a moderate crack to the slab, starting from the garage entrance and running vertically. The crack is approximately 6mm wide and approximately 850mm long.",
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
    assert.ok(out.includes("At the kerb edge, there is material deterioration (spalling)."));
  });

  it("uses plural wording for plural defect types", () => {
    const out = reportText("driveway", { ...base, damages: [{ damageType: "safety_issues", sub_safety: "tripping_hazard", location: "gate" }] });
    assert.ok(out.includes("At the gate, there are safety issues (tripping hazard)."));
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
    assert.ok(out.includes("There is paving to the front, constructed of concrete. It is in fair condition with typical wear and tear."));
  });

  it("states the absence when every slot is marked not present", () => {
    const out = reportText("paving_paths", { areas: { front: { present: "no" }, left: { present: "no" } } });
    assert.equal(out, "There is no paving to the property.");
  });

  it("names a fence by its side and lists every material", () => {
    const out = reportText("fences", {
      items: { rear: { present: "yes", material: ["timber_palings", "brick"], condition: "poor" } },
    });
    assert.ok(out.includes("The rear fence is constructed of timber palings and brick and is in poor condition with typical weathering."));
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
        "There is a shed separate to the house at the rear, constructed of metal with a colorbond roof and a concrete floor, and is generally in fair state of repair.",
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
    assert.ok(out.includes("There is a retaining wall to the rear, constructed of timber sleepers. It is in fair condition with typical weathering."));
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
    assert.ok(out.includes("There is a pool/spa located at the rear of the property, constructed of fibreglass, which is generally in fair state of repair."));
    assert.ok(out.includes("The surrounding area is paved with tiles."));
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
    assert.ok(out.includes("The front elevation generally faces north. It is in fair condition. There were no signs of notable damage."));
    assert.ok(out.includes("Partial inspection only: rear."));
    assert.ok(out.includes("Cladding: paint is flaking from sections."));
    assert.ok(!out.includes("rear elevation"));
  });

  it("states roof inspection limits as sentences", () => {
    const out = reportText("roof_chimneys", {
      sections: { upper: { condition: "fair", coveringType: ["tile"], inspectionStatus: ["no_chimney_s"] } },
    });
    assert.ok(out.includes("The upper roof & chimneys appears to be in fair condition, constructed of tile. No chimney/s."));
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
    assert.ok(out.startsWith("Renovations were in progress at the time of the inspection (kitchen)."));
    const ground = out.indexOf("GROUND FLOOR");
    const first = out.indexOf("FIRST FLOOR");
    assert.ok(ground > -1 && first > ground, "rooms are grouped by floor, ground first");
    assert.ok(out.includes("It is in poor condition. Several minor gaps and cracks observed."));
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
    assert.ok(out.includes("The driveway is to the front of the block and is constructed of concrete. It is in fair condition with typical wear and tear."));
  });

  it("no longer says 'no driveway' for an entry that only has a condition", () => {
    const out = composeSectionSentence("driveway", { condition: "fair" }, drivewayFields, "Driveway");
    assert.ok(out.includes("The driveway is in fair condition with typical wear and tear."));
  });

  it("gives 'leaning' and 'other' defects a noun to sit on", () => {
    const run = (damageType) =>
      composeSectionSentence("driveway", { condition: "fair", damages: [{ damageType, location: "centre", widthMm: 5 }] }, drivewayFields, "Driveway");
    assert.ok(run("leaning").includes("there is a leaning defect. The leaning defect is approximately 5mm wide."));
    assert.ok(run("other").includes("there is a defect. The defect is approximately 5mm wide."));
    assert.ok(run("crack").includes("there is a crack. The crack is approximately 5mm wide."));
  });

  it("does not stack 'At the' in front of a location that starts with a preposition", () => {
    const out = composeSectionSentence(
      "driveway",
      { condition: "fair", damages: [{ damageType: "crack", location: "above the front window" }] },
      drivewayFields,
      "Driveway",
    );
    assert.ok(out.includes("Above the front window, there is a crack."));
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
        .includes("The front fence is constructed of timber paling and is in fair condition with typical weathering."),
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
    assert.ok(out.includes("There is a carport separate to the house at the right, and is generally in fair state of repair."));
  });

  it("skips an item marked Available: No", () => {
    const fields = [{ key: "available", type: "yesno" }, condition];
    assert.equal(composeSectionSentence("elevations", { available: "no", condition: "fair" }, fields, "Rear"), "");
  });
});
