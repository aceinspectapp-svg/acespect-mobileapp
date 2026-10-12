// Wording found wrong while reading every answer in the wording matrices (scripts/wording-matrix.mjs). Each case is the sentence a reader would have seen.
//
// Run with: npm test
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
const { scopePhrase } = await server.ssrLoadModule("/src/web/descriptionScope.ts");
const { apartmentObservation } = await server.ssrLoadModule("/src/web/wording/dilapidation.apartment.ts");
const { typedCase, lower, stripKeepMarks } = await server.ssrLoadModule("/src/web/wording/shared.ts");
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));

const fieldsOf = (type, key) => snapshot.find((t) => t.inspectionType === "dilapidation" && t.propertyType === type && t.sectionKey === key).fields;
const valueOf = (f, label) => {
  const l = label.toLowerCase();
  const o = f.options.find((x) => x.label.toLowerCase() === l) ?? f.options.find((x) => x.label.toLowerCase().startsWith(l));
  if (!o) throw new Error(`no option "${label}" in ${f.key}`);
  return o.value;
};
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
const draft = (type, key, answers) => {
  const fields = fieldsOf(type, key);
  return flattenSectionToDraft(fields, convert(fields, answers), key, { inspectionType: "dilapidation", propertyType: type }).reportText.replace(/DEFECT::\d+::/g, "");
};

describe("wording review: sentences that read wrongly", () => {
  it("says what part of an elevation was inspected without doubling 'the'", () => {
    const t = draft("residential_house", "elevations", { sides: { front: { partialInspection: ["To parapet above the roof line"] } } });
    assert.ok(t.includes("Could only be partly inspected to the parapet above the roof line."), t);
    const u = draft("residential_house", "elevations", { sides: { front: { partialInspection: ["Front", "Rear"] } } });
    assert.ok(u.includes("Could only be partly inspected to the front and rear."), u);
  });

  it("words operational defects as the things they are", () => {
    const d = (sub) => draft("residential_house", "pool_spa", { present: "yes", condition: "Fair", damages: [{ location: "the gate", damageType: "Operational Defects", sub_operational: sub }] });
    assert.ok(d("Doors tight/not closing").includes("there are doors that are tight or not closing."));
    assert.ok(d("Windows tight/not closing").includes("there are windows that are tight or not closing."));
    assert.ok(d("Gates sagging").includes("there are sagging gates."));
    assert.ok(d("Garage doors out of alignment/not closing").includes("there are garage doors out of alignment or not closing."));
  });

  it("words the scope as the template does", () => {
    assert.equal(scopePhrase("External & internal to part of property", "the rear unit"), "external and internal to part of the property at the rear unit");
    assert.equal(scopePhrase("External and internal to all structures", ""), "external and internal to all structures");
    assert.equal(scopePhrase("Internal only to", ""), "internal only to all areas");
    assert.equal(scopePhrase("External only to", "the common areas"), "external only to the common areas");
  });

  it("does not say 'walls walls', and does not call a mix of materials a kind of wall", () => {
    const d = (ground, first) => draft("residential_house", "description", { wallCladdingGround: ground, ...(first ? { wallCladdingFirst: first } : {}) });
    assert.ok(d(["Concrete panels"]).includes("concrete panel walls"));
    assert.ok(d(["Weatherboards"]).includes("weatherboard walls"));
    assert.ok(d(["Combo of"]).includes("walls of a combination of materials"));
    assert.ok(d(["Brick veneer"], ["Combo of"]).includes("brick veneer walls to the ground floor and a combination of materials to the first floor"));
  });

  it("keeps the capital on product names", () => {
    assert.ok(draft("residential_house", "description", { roofCovering: ["Colorbond", "Zincalume"] }).includes("a covering of Colorbond and Zincalume"));
  });

  it("says a trailer or caravan with its article", () => {
    const t = draft("residential_house", "driveway", { present: "yes", locatedAt: "Front left", obscuredBy: ["Vegetation", "Parked cars / trailer / caravan"] });
    assert.ok(/obscured by vegetation and parked cars/.test(t), t);
    const e = draft("residential_house", "elevations", { sides: { front: { obscuredBy: ["Trailer", "Caravan"] } } });
    assert.ok(e.includes("obscured by a trailer and a caravan."), e);
  });

  it("does not say a pool fence 'appears to be not observed' when the fence safety was not answered", () => {
    const t = draft("residential_house", "pool_spa", { present: "yes", poolFence: ["Glass panels"] });
    assert.ok(t.includes("The pool fence is constructed of glass panels."), t);
    assert.ok(!/not observed/.test(t), t);
  });

  it("words garage walls and floors as materials", () => {
    const g = (answers) => draft("residential_house", "garage_carport_sheds", { structures: { garage: { present: "yes", ...answers } } });
    assert.ok(g({ walls: ["Timber framed"] }).includes("constructed of timber frame"));
    assert.ok(g({ walls: ["Brick"], floor: ["Pavers"] }).includes("with a paved floor"));
  });

  it("says a Commercial garage's obscured parts as the template does: the walls and hardstand", () => {
    const t = draft("commercial_properties", "garage_carport_sheds", { structures: { garage: { present: "yes", walls: ["Brick"], floor: ["Concrete hardstand"], obscuredBy: ["Shelving"] } } });
    assert.ok(t.includes("Sections of the walls and hardstand were obscured by shelving."), t);
  });

  it("says the Commercial roof underside's 'throughout' after 'observed'", () => {
    const t = draft("commercial_properties", "internal_areas", { roofin_coveringOf: ["Kliplock"], roofin_generalCondition: "Fair", roofin_damageSummary: ["Water stains", "Items of damage throughout"] });
    assert.ok(t.includes("Water stains and items of damage observed throughout."), t);
  });

  it("Apartment: a door closer that is not applicable is not 'not working'; windows and the flywire read as sentences", () => {
    const ext = draft("apartment", "elevations", { front_door_doorCloser: "Not applicable" });
    assert.ok(!/closer is not working/.test(ext), ext);
    const win = draft("apartment", "description", { windows: "Double glazed" });
    assert.ok(win.includes("Windows are double glazed."), win);
    const alu = draft("apartment", "description", { windows: "Aluminium frame", cladding: "Concrete panels" });
    assert.ok(alu.includes("Windows are constructed of aluminium."), alu);
    assert.ok(alu.includes("concrete panel walls"), alu);
  });

  it("Public Assets: a mixed nature strip is 'a nature strip of ...'", () => {
    const t = draft("public_assets", "elevations", { parts: [{ itemsPresent: ["Nature Strip, Light Posts, Signage, Trees"], naturestrip_material: ["Mix"], naturestrip_condition: "Fair" }] });
    assert.ok(/There is a nature strip of a mix of materials/.test(t) && !/an a mix/.test(t), t);
  });

  it("Apartment: every ticked observation is a full sentence (a capital, a verb, a full stop)", () => {
    const VERB = /\b(is|are|was|were|has|have|had|do|does|did|may|should|must|need|needs|require|requires|required|recommended|appears?|shows?|pass|passes|extends?|installed|added|attended|consulted|engaged|refer|consider|visible|ponds?)\b/i;
    let checked = 0;
    for (const t of snapshot.filter((x) => x.inspectionType === "dilapidation" && x.propertyType === "apartment")) {
      for (const f of t.fields) {
        if (f.type !== "chip-multiselect" || !/_checks\d*$|_checks1$/.test(f.key)) continue;
        for (const o of f.options) {
          if (o.value === "other") continue;
          const sentence = apartmentObservation(t.sectionKey, f.key, o.label);
          checked += 1;
          assert.ok(/^[A-Z]/.test(sentence) && /[.]$/.test(sentence) && VERB.test(sentence), `${t.sectionKey}/${f.key}: "${o.label}" -> "${sentence}"`);
        }
      }
    }
    assert.ok(checked > 100, `only ${checked} observations checked`);
  });

  it("keeps the capitals of typed names and places, and lower-cases the rest", () => {
    const say = (s) => stripKeepMarks(lower(typedCase(s)));
    assert.equal(say("Water Tank"), "water tank");
    assert.equal(say("Pergola"), "pergola");
    assert.equal(say("Collins Street shopfront"), "Collins Street shopfront");
    assert.equal(say("Highlands Estate Stage 450"), "Highlands Estate Stage 450");
    assert.equal(say("Shed behind Smith Street"), "shed behind Smith Street");
    assert.equal(say("rear garden shed"), "rear garden shed");
    assert.equal(say("Rear shed near Bob"), "rear shed near Bob");
  });

  it("does not print defects saved on an item that was later marked not present", () => {
    const t = draft("commercial_properties", "driveway", { present: "no", locatedAt: "Front left", material: "Concrete", condition: "Fair", damages: [{ location: "the centre", damageType: "Cracking" }] });
    assert.equal(t, "There is no driveway.");
  });

  it("says there are retaining walls (not that there are none) when the answer is Yes and none is entered yet", () => {
    assert.equal(draft("residential_house", "retaining_walls", { present: "yes" }), "There are retaining walls to the property.");
    assert.equal(draft("residential_house", "retaining_walls", { present: "no" }), "There are no retaining walls to the property.");
    assert.equal(draft("residential_house", "driveway", { present: "yes" }), "There is a driveway to the property.");
    assert.equal(draft("commercial_properties", "driveway", { present: "yes" }), "There is a driveway to the property.");
    assert.equal(draft("commercial_properties", "retaining_walls", { present: "yes" }), "There are retaining walls to the property.");
  });

  it("keeps a typed place's capitals in a sentence", () => {
    const t = draft("residential_house", "description", { underConstructionStage: "Frame stage" });
    assert.ok(t.includes("under construction at frame stage"), t);
    const g = draft("residential_house", "garage_carport_sheds", { structures: { shed: { present: "yes", structureName: "Water Tank" } } });
    assert.ok(g.includes("There is a water tank"), g);
  });
});
