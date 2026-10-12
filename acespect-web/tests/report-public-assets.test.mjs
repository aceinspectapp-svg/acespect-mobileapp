// Dilapidation / Public Assets wording, run against the real published template.
// Sentences follow the Public Assets report document: the Description line, then each Survey Part
// (Part A frontage, Part B laneway) category by category.
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

const PA = { inspectionType: "dilapidation", propertyType: "public_assets" };
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const fieldsOf = (key) => snapshot.find((t) => t.inspectionType === PA.inspectionType && t.propertyType === PA.propertyType && t.sectionKey === key).fields;

// Answers are written as the labels the inspector sees, then converted to the stored option values (Public Assets stores item0, item1, ...).
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
    else if (f.type === "damage-list" || f.type === "repeating-group") out[k] = v.map((d) => convert(f.itemFields, d));
    else out[k] = v;
  }
  return out;
}
const draft = (key, answers) => flattenSectionToDraft(fieldsOf(key), convert(fieldsOf(key), answers), key, PA);
const paragraphs = (t) => t.split("\n\n");
const crack = (location, extra = {}) => ({ location, damageType: "Cracking", sub_cracking: "Fine", direction: "Vertical", widthMm: 3, lengthMm: 500, ...extra });

const partA = {
  partName: "Part A: Frontage to project site", surveyStart: "South end", startRef: "3m past the boundary of no. 5", surveyDirection: "North", surveyEnd: "North end", endRef: "the corner of Smith Street",
  itemsPresent: ["Footpaths and Crossovers", "Nature Strip, Light Posts, Signage, Trees", "Kerb and Channel", "Road Surface & Parking Bays"],
  footpaths_material: ["Concrete"], footpaths_condition: "Fair", footpaths_summary: "Significant cracks", footpaths_obscuredBy: ["Overgrown grass", "Parked vehicles"],
  footpaths_damages: [crack("outside no. 7", { crackStartLocation: "the kerb", direction: "Horizontal", widthMm: 6, lengthMm: 850 }), crack("outside no. 9", { widthMm: 2, lengthMm: 300 })],
  footpaths_assets: [
    { assetType: "Utility pit cover", count: "1", condition: "Satisfactory with typical wear and tear", location: "the driveway of no. 7" },
    { assetType: "Bollard / Parking meter", count: "3", condition: "Fair", location: "the corner" },
    { assetType: "Tree", count: "Nil" },
  ],
  naturestrip_material: ["Grass"], naturestrip_condition: "Satisfactory with typical wear and tear", naturestrip_summary: "No significant cracking/damage", naturestrip_obscuredBy: ["Vegetation"],
  kerbs_material: ["Concrete"], kerbs_condition: "Poor", kerbs_summary: "Numerous cracking throughout", kerbs_damages: [crack("outside no. 6", { widthMm: 5, lengthMm: 400 })],
  roadsurface_material: ["Asphalt"], roadsurface_condition: "Satisfactory with typical wear and tear", roadsurface_summary: "No significant cracking/damage", roadsurface_lineMarkings: "Worn",
  guardRails: "yes", guardRailsDamages: [crack("near the bridge")], retainingWalls: "no", bridges: "no",
};
const partB = {
  partName: "Part B: Laneway", surveyStart: "West end", startRef: "the project boundary", surveyDirection: "East", surveyEnd: "East end", endRef: "the lane entry",
  itemsPresent: ["Fencing / Walls — Left Side", "Fencing / Walls — Right Side", "Laneway Surface"],
  fenceleft_material: ["Timber palings", `${OTHER}Hardwood sleepers`], fenceleft_condition: "Fair", fenceleft_summary: "Several minor cracks", fenceleft_obscuredBy: [`${OTHER}Stacked pallets`],
  fenceleft_damages: [{ location: "third panel", damageType: "Movement / Displacement", sub_movement: "Leaning" }],
  fenceright_material: ["Brick walls"], fenceright_condition: "Satisfactory with typical wear and tear", fenceright_summary: "No significant cracking/damage",
  lanesurface_material: ["Concrete"], lanesurface_condition: "Average", lanesurface_summary: "Several minor cracks", lanesurface_lineMarkings: "NA", lanesurface_damages: [crack("centre of the lane", { widthMm: 4, lengthMm: 700 })],
  lanesurface_assets: [{ assetType: "Stormwater cover", count: "1", condition: "Fair", location: "the lane entry" }],
  otherDescription: "A skip bin was parked in the lane",
};

describe("Public Assets: Description and Overview", () => {
  const desc = { proposedWorksType: "Development site", projectSiteAddress: "123 Test Street", scopeConfirmed: ["Footpaths, utility pit covers", "Kerb and channel", "Road surfaces"] };

  it("says what the inspection is for", () => {
    assert.equal(draft("description", desc).reportText, "The inspection is for Public Assets to 123 Test Street.");
    assert.equal(draft("description", { proposedWorksType: `${OTHER}Tram line` }).reportText, "The inspection is for Public Assets.", "no project site address, nothing to name");
  });

  it("words the project works and the scope on the Description page, counting the survey areas", () => {
    const fields = draft("description", desc).fields;
    const blocks = wordingFor(PA).descriptionBlocks({ fields, areaCount: 2 });
    assert.equal(blocks.works, "The project works are to the development site at 123 Test Street.");
    const placed = wordingFor(PA).descriptionBlocks({ fields: { ...fields, siteSide: "Front", siteDirection: "NE" }, areaCount: 2 });
    assert.equal(placed.works, "The project works are to the development site at 123 Test Street, which is at the front - approximately north-east - of the site of this inspection.");
    // the document's own sentence, for works to a residential property
    const house = draft("description", { proposedWorksType: "Residential property", projectSiteAddress: "123 Test Street" }).fields;
    assert.equal(wordingFor(PA).descriptionBlocks({ fields: house, areaCount: 0 }).works, "The project works are to the property at 123 Test Street.");
    assert.equal(blocks.scope, "The scope for inspection is public assets including footpaths, utility pit covers, kerb and channel and road surfaces to the following two areas:");
    assert.equal(wordingFor(PA).descriptionBlocks({ fields, areaCount: 0 }).scope, "The scope for inspection is public assets including footpaths, utility pit covers, kerb and channel and road surfaces.");
    const bare = draft("description", { projectSiteAddress: "123 Test Street" }).fields;
    assert.equal(wordingFor(PA).descriptionBlocks({ fields: bare, areaCount: 3 }).scope, "The scope for inspection is public assets including paths, nature strip, kerbs, lane surface, posts, signs, trees to the following three areas:");
  });

  it("words those two sentences itself, as the House and Commercial reports do", () => {
    assert.equal(typeof wordingFor(PA).descriptionBlocks, "function");
    assert.equal(typeof wordingFor({ inspectionType: "dilapidation", propertyType: "residential_house" }).descriptionBlocks, "function");
    assert.equal(typeof wordingFor({ inspectionType: "dilapidation", propertyType: "commercial_properties" }).descriptionBlocks, "function");
  });
});

describe("Public Assets: survey parts", () => {
  const out = draft("elevations", { parts: [partA, partB] });
  const paras = paragraphs(out.reportText);

  it("names each part and says where the survey started and finished", () => {
    assert.ok(paras.includes("ROOMHEAD::Part A: Frontage to project site"));
    assert.ok(paras.includes("The following observations commenced from the south end at 3m past the boundary of no. 5 and proceeded north to the north end at the corner of Smith Street."));
    assert.ok(paras.includes("The following observations commenced from the west end at the project boundary and proceeded east to the east end at the lane entry."));
  });

  it("describes a category: material, condition, and what obscured it", () => {
    assert.ok(paras.includes("ROOMHEAD::Footpaths and Crossovers"));
    assert.ok(paras.includes("The footpath and crossovers are constructed of concrete and in fair condition. Sections were obscured by overgrown grass and parked vehicles."));
    assert.ok(paras.includes("There is a grass nature strip which is in typical condition. Sections of the nature strip were obscured by vegetation."));
    assert.ok(paras.includes("The kerbs and channel are constructed of concrete and in poor condition."));
    assert.ok(paras.includes("The road surface and parking bays are constructed of asphalt and in satisfactory condition with typical shrinkage cracks and wear and tear. The painted line markings are worn."));
    assert.ok(paras.includes("The laneway surface is constructed of concrete and in average condition."));
  });

  it("gives each category its own condition tag", () => {
    assert.equal(paras.filter((p) => p.startsWith("COND::")).length, 7);
  });

  it("lists the most significant defects, each as its own tagged sentence in template order across both parts", () => {
    assert.ok(paras.includes("There are significant cracks. The most significant items are:"));
    const defects = paras.filter((p) => p.startsWith("DEFECT::"));
    assert.equal(defects.length, 6);
    assert.deepEqual(defects.map((d) => Number(d.split("::")[1])), [0, 1, 2, 3, 4, 5]);
    assert.ok(defects[0].includes("Outside no. 7, there is a horizontal fine crack starting at the kerb. The crack is 6 millimetres wide and 850 millimetres long."));
    assert.equal(out.damages.length, 6);
  });

  it("says nothing about cracking for a category with none -- a good category is just reported as good", () => {
    assert.ok(!/no significant cracking/i.test(out.reportText));
    assert.ok(!paras.includes("The most significant items are:"));
  });

  it("describes street assets by count, kind and location, and skips a count of nil", () => {
    assert.ok(paras.includes("There is a utility pit cover at the driveway of no. 7. It is in satisfactory condition with typical wear and tear."));
    assert.ok(paras.includes("There are three bollards/parking meters at the corner. They are in fair condition."));
    assert.ok(paras.includes("There is a stormwater cover at the lane entry. It is in fair condition."));
    assert.ok(!out.reportText.toLowerCase().includes("there are nil") && !/\btrees?\b/.test(paras.filter((p) => p.startsWith("There")).join(" ")));
  });

  it("words the laneway fences left and right under one heading, with typed Other answers", () => {
    assert.equal(paras.filter((p) => p === "ROOMHEAD::Fencing / Walls along laneway").length, 1);
    assert.ok(paras.includes("The left side fences and walls are constructed of timber palings and hardwood sleepers and in fair condition. Sections were obscured by stacked pallets."));
    assert.ok(paras.includes("The right side fences and walls are constructed of brick walls and in satisfactory condition with typical weathering."));
  });

  it("keeps guard rails, free text and notes instead of dropping them", () => {
    assert.ok(paras.includes("Guard rails are present along the roadway."));
    assert.ok(paras.includes("A skip bin was parked in the lane."));
  });

  it("leaves out a category that is not part of the survey part", () => {
    const only = draft("elevations", { parts: [{ partName: "Part C", itemsPresent: ["Kerb and Channel"], kerbs_material: ["Concrete"], kerbs_condition: "Fair", kerbs_summary: "Several minor cracks" }] });
    assert.ok(!only.reportText.includes("Footpaths"));
    assert.ok(only.reportText.includes("The kerbs and channel are constructed of concrete and in fair condition"));
  });

  it("says 'a mix of' when Mix is chosen, never printing the word 'mix' as a material", () => {
    const run = (material) => draft("elevations", { parts: [{ partName: "P", itemsPresent: ["Kerb and Channel"], kerbs_material: material, kerbs_condition: "Fair" }] }).reportText;
    assert.ok(run(["Mix"]).includes("constructed of a mix of materials"));
    assert.ok(run(["Concrete", "Mix"]).includes("constructed of concrete and other materials"));
  });

  it("leaves no raw option code or leftover marker in what the reader sees", () => {
    assert.ok(!/\bitem\d+\b|__other__|undefined/.test(out.reportText));
  });
});

describe("Public Assets: Condition Summary", () => {
  const rows = draft("elevations", { parts: [partA, partB] }).fields.conditionSummary;

  it("has one row per category of each survey part, with its own grade", () => {
    assert.deepEqual(
      rows.map((r) => [r.subLabel, r.conditionLabel]),
      [
        ["Part A: Frontage to project site — Footpaths and Crossovers", "Fair"],
        ["Part A: Frontage to project site — Nature strip, Light posts, Signage, Trees", "Satisfactory"],
        ["Part A: Frontage to project site — Kerbs and Channel", "Poor"],
        ["Part A: Frontage to project site — Road surface and Parking bays", "Satisfactory"],
        ["Part B: Laneway — Fencing / Walls along laneway (left side)", "Fair"],
        ["Part B: Laneway — Fencing / Walls along laneway (right side)", "Satisfactory"],
        ["Part B: Laneway — Laneway surface", "Average"],
      ],
    );
  });

  it("notes the defects recorded against the category", () => {
    assert.ok(rows[0].defectNote.includes("outside no. 7"));
    assert.equal(rows[1].defectNote, undefined);
  });
});

describe("Public Assets: every answer on the website form is printed", () => {
  it("prints the safety, access and scope-limitation answers on the Description", () => {
    const p = paragraphs(draft("description", { proposedWorksType: "Road", safetyAssessed: "yes", safetyAssessedNotes: "Traffic management in place", scopeLimitations: "yes", scopeLimitationsNotes: "Part of the lane was fenced off" }).reportText);
    assert.ok(p.includes("All safety and access matters were assessed on site. Traffic management in place."));
    assert.ok(p.includes("There were limitations to the scope of the inspection. Part of the lane was fenced off."));
  });

  it("says which way the road runs, and each asset's start point, direction and size", () => {
    const part = {
      partName: "Part A", runsDirection: "South to north", surveyStart: "South end", surveyDirection: "North", surveyEnd: "North end",
      itemsPresent: ["Kerb and Channel"], kerbs_material: ["Concrete"], kerbs_condition: "Fair", kerbs_summary: "Several minor cracks",
      kerbs_assets: [{ assetType: "Utility pit cover", count: "1", condition: "Fair", location: "no. 7", startDirection: "the driveway, heading north", widthMm: 600, lengthMm: 900 }],
    };
    const p = paragraphs(draft("elevations", { parts: [part] }).reportText);
    assert.ok(p.includes("The road / lane runs south to north."));
    assert.ok(p.includes("There is a utility pit cover at no. 7. It is in fair condition. It starts at the driveway, heading north. It is approximately 600mm wide and approximately 900mm long."));
  });
});

describe("Public Assets: good and bad are worded differently, from the real form's choices", () => {
  const SAT = "Satisfactory with typical wear and tear";
  const part = (extra) => paragraphs(draft("elevations", { parts: [{ partName: "Part A", itemsPresent: ["Kerb and Channel"], kerbs_material: ["Concrete"], ...extra }] }).reportText);

  it("says 'with typical wear and tear' only for a satisfactory category; any other grade is just stated", () => {
    assert.ok(part({ kerbs_condition: SAT }).includes("The kerbs and channel are constructed of concrete and in satisfactory condition with typical wear and tear."));
    for (const grade of ["Fair", "Average", "Poor"]) assert.ok(part({ kerbs_condition: grade }).includes(`The kerbs and channel are constructed of concrete and in ${grade.toLowerCase()} condition.`), grade);
  });

  it("says the overview only when it records an issue, in the form's own words for that category", () => {
    assert.ok(!/significant|deterioration|cracks/i.test(part({ kerbs_condition: "Fair", kerbs_summary: "No significant cracking/damage" }).join(" ")));
    assert.ok(part({ kerbs_condition: "Fair", kerbs_summary: "Numerous items of deterioration throughout" }).includes("Numerous items of deterioration observed throughout."));
    const strip = paragraphs(draft("elevations", { parts: [{ partName: "A", itemsPresent: ["Nature Strip, Light Posts, Signage, Trees"], naturestrip_condition: "Fair", naturestrip_summary: "Several minor items of deterioration" }] }).reportText);
    assert.ok(strip.includes("Several minor items of deterioration observed."));
    const foot = paragraphs(draft("elevations", { parts: [{ partName: "A", itemsPresent: ["Footpaths and Crossovers"], footpaths_condition: "Fair", footpaths_summary: "Significant cracks" }] }).reportText);
    assert.ok(foot.includes("There are significant cracks."));
  });

  it("says what is wrong with a street asset in the template's 'with ...' clause", () => {
    const asset = (extra) => part({ kerbs_condition: SAT, kerbs_assets: [{ assetType: "Utility pit cover", count: "1", location: "no. 7", ...extra }] }).join(" ");
    assert.ok(asset({ condition: SAT }).includes("There is a utility pit cover at no. 7. It is in satisfactory condition with typical wear and tear."));
    assert.ok(asset({ condition: SAT, defectKind: "Crack" }).includes("It is in satisfactory condition with some cracks."));
    assert.ok(asset({ condition: SAT, defectKind: "Chipping" }).includes("It is in satisfactory condition with chipping."));
    assert.ok(asset({ condition: SAT, defectKind: "Leaning" }).includes("It is in satisfactory condition with leaning."));
    assert.ok(asset({ condition: SAT, defectKind: "Damage" }).includes("It is in satisfactory condition with some damage."));
    assert.ok(asset({ condition: SAT, defectKind: "OK" }).includes("It is in satisfactory condition with typical wear and tear."));
    assert.ok(asset({ condition: "Poor" }).includes("It is in poor condition."));
    assert.ok(asset({ condition: "Poor", defectKind: "Crack" }).includes("It is in poor condition with some cracks."));
    const many = part({ kerbs_condition: SAT, kerbs_assets: [{ assetType: "Bollard / Parking meter", count: "2", condition: "Poor", defectKind: "Rust", location: "the corner" }] }).join(" ");
    assert.ok(many.includes("There are two bollards/parking meters at the corner. They are in poor condition with some rust."));
  });

  it("says trees are 'in typical condition'", () => {
    const trees = (extra) => part({ kerbs_condition: SAT, kerbs_assets: [{ assetType: "Tree", count: "2", ...extra }] }).join(" ");
    assert.ok(trees({ condition: SAT }).includes("There are two trees in typical condition."));
    assert.ok(part({ kerbs_condition: SAT, kerbs_assets: [{ assetType: "Tree", count: "1", condition: SAT }] }).join(" ").includes("There is one tree in typical condition."));
    assert.ok(trees({ condition: SAT, defectKind: "Leaning" }).includes("There are two trees in satisfactory condition with leaning."));
  });

  it("words the survey start as the template does: from the road, proceeded, to the end at the house", () => {
    const p = paragraphs(draft("elevations", { parts: [{ partName: "Part A: Frontage to project site", roadName: "Smith Street", surveyDirection: "North", surveyEnd: "North end", endRef: "3 metres past the side boundary of house number 9", itemsPresent: ["Kerb and Channel"], kerbs_condition: SAT }] }).reportText);
    assert.ok(p.includes("The following observations commenced from Smith Street and proceeded north to the north end at 3 metres past the side boundary of house number 9."));
  });

  it("words the defects as the template does: crack start, where it runs to, width and length; loose palings and graffiti on a laneway fence", () => {
    const fence = paragraphs(draft("elevations", {
      parts: [{
        partName: "Part B", itemsPresent: ["Fencing / Walls — Right Side"], fenceright_material: ["Timber palings"], fenceright_condition: SAT, fenceright_summary: "Significant cracks",
        fenceright_damages: [
          { location: "kerb", damageType: "Cracking", crackStartLocation: "the corner", crackEndLocation: "north", widthMm: 3, lengthMm: 700 },
          { location: "house no. 4", damageType: "Loose palings" },
          { location: "the lane entry", damageType: "Graffiti" },
        ],
      }],
    }).reportText);
    assert.ok(fence.includes("There are significant cracks. The most significant items are:"));
    assert.ok(fence.some((x) => x.endsWith("At the kerb, there is a crack starting at the corner and running to the north. The crack is 3 millimetres wide and 700 millimetres long.")));
    assert.ok(fence.some((x) => x.endsWith("There are loose palings at house no. 4.")));
    assert.ok(fence.some((x) => x.endsWith("There is graffiti at the lane entry.")));
  });

  it("words each category's 'There are significant ...' line from the template's choices, and the line markings", () => {
    const k = part({ kerbs_condition: SAT, kerbs_summary: "Significant cracks and chipping" });
    assert.ok(k.includes("There are significant cracks and chipping."));
    assert.ok(part({ kerbs_condition: SAT, kerbs_summary: "Significant subsidence" }).includes("There is significant subsidence."));
    const road = (m) => paragraphs(draft("elevations", { parts: [{ partName: "A", itemsPresent: ["Road Surface & Parking Bays"], roadsurface_material: ["Asphalt"], roadsurface_condition: SAT, roadsurface_lineMarkings: m }] }).reportText).join(" ");
    assert.ok(road("Worn").includes("The painted line markings are worn."));
    assert.ok(road("New").includes("The painted line markings are new."));
    assert.ok(road("Satisfactory with typical wear and tear").includes("The painted line markings are in satisfactory condition with typical wear and tear."));
  });

  it("has the real form's business signage and the extra street-asset kinds", () => {
    const rows = snapshot.filter((t) => t.inspectionType === "dilapidation" && t.propertyType === "public_assets");
    const job = rows.find((t) => t.sectionKey === "job-info").fields.map((f) => f.key);
    assert.ok(job.includes("businessName") && job.includes("businessSignage"));
    const partsField = rows.find((t) => t.sectionKey === "elevations").fields.find((f) => f.key === "parts");
    const road = partsField.itemFields.find((f) => f.key === "roadsurface_assets").itemFields.find((f) => f.key === "assetType").options.map((o) => o.label);
    for (const kind of ["Bike lane", "Traffic island", "Pedestrian crossing"]) assert.ok(road.includes(kind), kind);
  });
});

describe("Public Assets: the cover's purpose paragraph", () => {
  it("is the Public Assets one, with 'builder' except for the two named building consultants", async () => {
    const { defaultPurposeFor } = await server.ssrLoadModule("/src/web/report.ts");
    const pa = { type: "Dilapidation", propertyType: "Public Assets" };
    const text = defaultPurposeFor(pa, "Rene White");
    assert.ok(text.startsWith("The purpose of the inspection is to identify any defects or cracking to public assets and environs"));
    assert.ok(text.includes("insofar as a licensed builder can reasonably identify the defects and current state of the assets."));
    assert.ok(text.endsWith("may include concrete kerbing, footpaths, crossings, nature strip, trees, posts, signage, etc and is the result of a visual survey only."));
    for (const name of ["Trevor Scott", "Peter Farries"]) assert.ok(defaultPurposeFor(pa, name).includes("licensed building consultant can reasonably"), name);
    assert.ok(defaultPurposeFor({ type: "Dilapidation", propertyType: "Residential House" }, "Trevor Scott").includes("identify cracking, gaps and dilapidation in the main structures"));
    assert.ok(defaultPurposeFor({ type: "Dilapidation", propertyType: "Commercial Properties" }, "Trevor Scott").includes("insofar as a licensed building consultant can reasonably"));
    assert.ok(defaultPurposeFor({ type: "Dilapidation", propertyType: "Commercial Properties" }, "Rene White").includes("insofar as a licensed builder can reasonably"));
  });
});

describe("Public Assets: no 'Label: value' lines", () => {
  it("says the safety matters as typed and the notes of an added structure as a sentence", () => {
    assert.equal(draft("notes", { publicAssetSafetyMatters: "Loose brick near the gate" }).reportText, "Loose brick near the gate.");
  });
});

