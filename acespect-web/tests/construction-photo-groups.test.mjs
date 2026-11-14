// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { constructionPhotoGroups, withPhotoAdded } = await server.ssrLoadModule("/src/web/construction/photoGroups.ts");
const { isDefectAnswer, DEFECT_DETAIL_FIELDS } = await server.ssrLoadModule("/src/web/construction/defectDetail.ts");
const { composeConstructionSection } = await server.ssrLoadModule("/src/web/construction/compose.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const template = (key) => SNAP.filter((t) => t.sectionKey === key && t.propertyType === "residential_house").sort((a, b) => b.version - a.version)[0].fields;

describe("Construction photos grouped where they print", () => {
  it("gives a row answered Defect its own group, at the row's __defect photos", () => {
    const fields = template("pp_general");
    const answers = { siteDrainage: "yes_defect", siteDrainage__defect: { location: "Rear left", photos: ["a.jpg", "b.jpg"] }, retainingWalls: "yes_ok" };
    const groups = constructionPhotoGroups(fields, answers);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].title, "Defect — Any concerns re site drainage / ground falls");
    assert.equal(groups[0].detail, "Rear left");
    assert.deepEqual(groups[0].photos, ["a.jpg", "b.jpg"]);
    assert.deepEqual(groups[0].path, ["siteDrainage__defect", "photos"]);
    assert.equal(groups[0].defect, true);
  });

  it("names a row's own photo field after its row (Formwork: Photos with measurements)", () => {
    const groups = constructionPhotoGroups(template("pp_formwork"), { slabDimensions: "ok", slabDimensionsPhotos: ["m.jpg"] });
    const g = groups.find((x) => x.path[0] === "slabDimensionsPhotos");
    assert.equal(g.title, "Slab formwork dimensions");
    assert.equal(g.detail, "Photos with measurements");
    assert.deepEqual(g.photos, ["m.jpg"]);
  });

  it("gives each entry of the Defects list its own group", () => {
    const groups = constructionPhotoGroups(template("pp_defects"), { defects: [{ location: "Porch", photos: ["1.jpg"] }, { location: "", photos: [] }] });
    assert.deepEqual(groups.map((g) => [g.title, g.detail, g.path]), [["Defect 1", "Porch", ["defects", 0, "photos"]], ["Defect 2", undefined, ["defects", 1, "photos"]]]);
  });

  it("shows the client issues photos only once the list is attached", () => {
    const fields = template("pp_client_issues");
    assert.equal(constructionPhotoGroups(fields, { clientListStatus: "n_a", clientListPhotos: ["x.jpg"] }).length, 0);
    assert.deepEqual(constructionPhotoGroups(fields, { clientListStatus: "attached", clientListPhotos: ["x.jpg"] }).map((g) => g.photos), [["x.jpg"]]);
  });

  it("adds a photo into the exact spot, creating it when empty, without touching anything else", () => {
    const answers = { siteDrainage: "yes_defect", other: "kept" };
    const next = withPhotoAdded(answers, ["siteDrainage__defect", "photos"], "new.jpg");
    assert.deepEqual(next, { siteDrainage: "yes_defect", other: "kept", siteDrainage__defect: { photos: ["new.jpg"] } });
    assert.deepEqual(answers, { siteDrainage: "yes_defect", other: "kept" }, "the original is not changed");
    const list = withPhotoAdded({ defects: [{ photos: ["1.jpg"] }, { location: "b" }] }, ["defects", 1, "photos"], "2.jpg");
    assert.deepEqual(list, { defects: [{ photos: ["1.jpg"] }, { location: "b", photos: ["2.jpg"] }] });
    assert.deepEqual(withPhotoAdded(list, ["defects", 1, "photos"], "2.jpg").defects[1].photos, ["2.jpg"], "never added twice");
  });

  it("a photo added to a row's defect prints under that defect", () => {
    const fields = template("pp_general");
    const answers = withPhotoAdded({ siteDrainage: "yes_defect" }, ["siteDrainage__defect", "photos"], "added.jpg");
    const composed = composeConstructionSection("pp_general", fields, answers, false);
    assert.deepEqual(composed.damages.map((d) => d.photos), [["added.jpg"]]);
  });
});

describe("the defect details form", () => {
  it("opens for a defect answer only", () => {
    const f = template("pp_general").find((x) => x.key === "siteDrainage");
    assert.equal(isDefectAnswer(f, "yes_defect"), true);
    assert.equal(isDefectAnswer(f, "no_ok"), false);
    assert.equal(isDefectAnswer(f, undefined), false);
  });

  it("has the same fields as the iOS app's form", () => {
    const ios = readFileSync(resolve(webRoot, "../acespect-ios/src/components/inspection/fieldRenderers/defectDetail.ts"), "utf8");
    for (const f of DEFECT_DETAIL_FIELDS) assert.ok(ios.includes(`key: '${f.key}'`), f.key);
    assert.deepEqual(DEFECT_DETAIL_FIELDS.map((f) => f.key), ["location", "category", "severity", "photos", "comments", "constructionCode"]);
  });
});
