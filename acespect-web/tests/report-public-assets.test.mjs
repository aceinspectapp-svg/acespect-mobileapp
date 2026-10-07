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
  footpaths_material: ["Concrete"], footpaths_condition: "Fair", footpaths_summary: "Several minor cracks", footpaths_obscuredBy: ["Overgrown grass", "Parked vehicles"],
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
    assert.equal(draft("description", desc).reportText, "The inspection is for Public Assets to the development site.");
    assert.equal(draft("description", { proposedWorksType: `${OTHER}Tram line` }).reportText, "The inspection is for Public Assets to the tram line.");
  });

  it("words the project works and the scope on the Description page, counting the survey areas", () => {
    const fields = draft("description", desc).fields;
    const blocks = wordingFor(PA).descriptionBlocks({ fields, areaCount: 2 });
    assert.equal(blocks.works, "The project works are to the property at 123 Test Street.");
    assert.equal(blocks.scope, "The scope for inspection is public assets including footpaths, utility pit covers, kerb and channel and road surfaces to the following two areas:");
    assert.equal(wordingFor(PA).descriptionBlocks({ fields, areaCount: 0 }).scope, "The scope for inspection is public assets including footpaths, utility pit covers, kerb and channel and road surfaces");
  });

  it("is the only report type that words those two sentences itself", () => {
    assert.equal(typeof wordingFor(PA).descriptionBlocks, "function");
    assert.equal(wordingFor({ inspectionType: "dilapidation", propertyType: "residential_house" }).descriptionBlocks, undefined);
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
    assert.ok(paras.includes("The footpath and crossovers are constructed of concrete and in fair condition with typical wear and tear. Sections were obscured by overgrown grass and parked vehicles."));
    assert.ok(paras.includes("There is a nature strip of grass which is in typical condition. Sections of the nature strip were obscured by vegetation."));
    assert.ok(paras.includes("The kerbs and channel are constructed of concrete and in poor condition with typical wear and tear."));
    assert.ok(paras.includes("The road surface and parking bays are constructed of asphalt and in satisfactory condition with typical shrinkage cracks and wear and tear. The painted line markings are worn."));
    assert.ok(paras.includes("The laneway surface is constructed of concrete and in average condition with typical shrinkage cracks and wear and tear."));
  });

  it("gives each category its own condition tag", () => {
    assert.equal(paras.filter((p) => p.startsWith("COND::")).length, 7);
  });

  it("lists the most significant defects, each as its own tagged sentence in template order across both parts", () => {
    assert.ok(paras.includes("Several minor cracks observed. The most significant items are:"));
    const defects = paras.filter((p) => p.startsWith("DEFECT::"));
    assert.equal(defects.length, 6);
    assert.deepEqual(defects.map((d) => Number(d.split("::")[1])), [0, 1, 2, 3, 4, 5]);
    assert.ok(defects[0].includes("Outside no. 7, there is a fine crack, starting from the kerb and running horizontally. The crack is approximately 6mm wide and approximately 850mm long."));
    assert.equal(out.damages.length, 6);
  });

  it("says nothing about defects for a category with none, only its overview", () => {
    assert.ok(paras.includes("No significant cracking or damage observed."));
    assert.ok(!paras.includes("No significant cracking or damage observed. The most significant items are:"));
  });

  it("describes street assets by count, kind and location, and skips a count of nil", () => {
    assert.ok(paras.includes("There is a utility pit cover at the driveway of no. 7. It is in satisfactory condition with typical wear and tear."));
    assert.ok(paras.includes("There are three bollards/parking meters at the corner. They are in fair condition with typical wear and tear."));
    assert.ok(paras.includes("There is a stormwater cover at the lane entry. It is in fair condition with typical wear and tear."));
    assert.ok(!out.reportText.toLowerCase().includes("there are nil") && !/\btrees?\b/.test(paras.filter((p) => p.startsWith("There")).join(" ")));
  });

  it("words the laneway fences left and right under one heading, with typed Other answers", () => {
    assert.equal(paras.filter((p) => p === "ROOMHEAD::Fencing / Walls along laneway").length, 1);
    assert.ok(paras.includes("The left side fences and walls are constructed of timber palings and hardwood sleepers and in fair condition with typical weathering. Sections were obscured by stacked pallets."));
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

