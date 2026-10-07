// The report type decides the wording: every report type has exactly one wording entry, a type
// with no entry never borrows another type's sentences, and the sections come second.
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
const { WORDING_BY_PROFILE, wordingFor } = await server.ssrLoadModule("/src/web/wording/registry.ts");
const { reportProfileOf, profileKey } = await server.ssrLoadModule("/src/web/wording/profile.ts");

const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const snapshotProfiles = [...new Set(snapshot.map((t) => `${t.inspectionType}/${t.propertyType}`))].sort();

// The report types whose own wording has been supplied. Add a type here when its wording document has been turned into its own file.
const FINAL = ["dilapidation/residential_house"];

describe("report types", () => {
  it("has a wording entry for every report type that has templates, and no others", () => {
    assert.deepEqual(Object.keys(WORDING_BY_PROFILE).sort(), snapshotProfiles);
    assert.equal(snapshotProfiles.length, 12);
  });

  it("knows which report types have their own wording and which still stand in", () => {
    const final = Object.entries(WORDING_BY_PROFILE).filter(([, w]) => w.status === "final").map(([k]) => k);
    assert.deepEqual(final.sort(), [...FINAL].sort());
    for (const [key, w] of Object.entries(WORDING_BY_PROFILE)) {
      assert.equal(profileKey(w.profile), key, `${key} is filed under its own profile`);
      if (!FINAL.includes(key)) assert.equal(w.status, "provisional", `${key} is flagged provisional until its wording arrives`);
    }
  });

  it("reads a report type from the stored titles or from slugs", () => {
    assert.deepEqual(reportProfileOf("Dilapidation", "Residential House"), { inspectionType: "dilapidation", propertyType: "residential_house" });
    assert.deepEqual(reportProfileOf("Pre-Purchase", "Commercial Properties"), { inspectionType: "pre_purchase", propertyType: "commercial_properties" });
    assert.deepEqual(reportProfileOf("construction_stage", "apartment"), { inspectionType: "construction_stage", propertyType: "apartment" });
  });

  it("never writes sentences for a report type that has no wording entry", () => {
    const fields = snapshot.find((t) => t.inspectionType === "dilapidation" && t.propertyType === "residential_house" && t.sectionKey === "driveway").fields;
    const answers = { present: "yes", locatedAt: "front_left", material: "concrete", condition: "fair" };
    const known = flattenSectionToDraft(fields, answers, "driveway", { inspectionType: "dilapidation", propertyType: "residential_house" });
    assert.ok(known.reportText.includes("The driveway is to the front left of the block"));
    const unknown = flattenSectionToDraft(fields, answers, "driveway", { inspectionType: "something_new", propertyType: "residential_house" });
    assert.equal(wordingFor({ inspectionType: "something_new", propertyType: "residential_house" }).status, "none");
    assert.ok(!unknown.reportText.includes("The driveway is to the"), "no House sentences for an unregistered report type");
  });
});
