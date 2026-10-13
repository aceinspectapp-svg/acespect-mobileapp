// A new inspection started on the web has the same sections the mobile app would show for that report type (and, for Construction
// Stage, for the chosen stage) -- compared against the mobile app's own section lists, so a change on one side that is not made
// on the other fails here.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mobile = resolve(webRoot, "../acespect-mobile/src/constants");
// The mobile files are plain TypeScript; a fixed tsconfig stops vite looking up the mobile app's own (it extends "expo/tsconfig.base", which only exists
// where the mobile app's node_modules are installed -- not in CI, which installs the web app alone).
const server = await createServer({
  root: webRoot,
  server: { middlewareMode: true, fs: { strict: false } },
  esbuild: { tsconfigRaw: '{"compilerOptions":{}}' },
  logLevel: "error",
});
after(() => server.close());
const web = await server.ssrLoadModule("/src/web/constants/sectionLayout.ts");
const { INSPECTION_TYPES, PROPERTY_TYPES, isValidCombo } = await server.ssrLoadModule("/src/web/constants/inspectionData.ts");
const mobileSections = await server.ssrLoadModule(`/@fs${mobile}/inspectionSections.ts`);
const mobileStages = await server.ssrLoadModule(`/@fs${mobile}/constructionStages.ts`);

/** What the mobile hub lists for a profile, as [template key, name] pairs (sign-off is a screen, not a data section). */
function mobileList(inspectionTypeId, propertyTypeId, stageId) {
  const groups = mobileSections.getSectionGroupsForProperty(propertyTypeId, inspectionTypeId, stageId);
  return groups
    .flatMap((g) => g.sections)
    .filter((s) => s.id !== "report_signoff")
    .map((s) => {
      const key = mobileSections.templateKeyForSectionId(s.id);
      return [key, mobileSections.getSectionTitle(key, propertyTypeId, s.title, inspectionTypeId)];
    });
}

describe("the sections a new web inspection starts with match the mobile app", () => {
  for (const type of INSPECTION_TYPES) {
    for (const prop of PROPERTY_TYPES) {
      if (!isValidCombo(type.id, prop.id)) continue;
      if (type.id === "construction_stage") {
        for (const stage of mobileStages.CONSTRUCTION_STAGES) {
          it(`${type.title} / ${prop.title} / ${stage.title}: Job Information, then the stage's own sections`, () => {
            const ours = web.sectionsForNewInspection(type.id, prop.id, stage.id).map((s) => [s.key, s.name]);
            assert.deepEqual(ours, mobileList(type.id, prop.id, stage.id));
            assert.ok(ours.length > 1, "a stage has sections of its own");
          });
        }
        it(`${type.title} / ${prop.title}: with no stage chosen there is only Job Information`, () => {
          assert.deepEqual(web.sectionsForNewInspection(type.id, prop.id).map((s) => s.key), ["job-info"]);
        });
      } else {
        it(`${type.title} / ${prop.title}`, () => {
          const ours = web.sectionsForNewInspection(type.id, prop.id);
          const theirs = mobileList(type.id, prop.id);
          // the same sections in the same order; a name differs only where the mobile profile renames a section (the plain names come from each screen)
          assert.deepEqual(ours.map((s) => s.key), theirs.map(([key]) => key));
          const renamed = mobileSections.getSectionTitle;
          for (const s of ours) {
            const override = renamed(s.key, prop.id, "\u0000", type.id);
            if (override !== "\u0000") assert.equal(s.name, override, `${s.key} is called "${override}" on mobile`);
          }
          assert.equal(ours[0].key, "job-info");
        });
      }
    }
  }

  it("every Construction Stage section on the web is one the mobile app has (and the other way round)", () => {
    for (const stage of mobileStages.CONSTRUCTION_STAGES) {
      const w = web.CONSTRUCTION_STAGE_BY_ID[stage.id];
      assert.ok(w, `stage ${stage.id}`);
      assert.deepEqual(w.sections, stage.sections.map((s) => ({ id: s.id, title: s.title, icon: s.icon, ...(s.propertyTypes ? { propertyTypes: s.propertyTypes } : {}) })));
    }
    assert.equal(web.CONSTRUCTION_STAGES.length, mobileStages.CONSTRUCTION_STAGES.length);
  });

  it("a Construction Stage draft records its stage in Job Information, like the mobile app", () => {
    assert.deepEqual(web.jobInfoAnswersForNewInspection("construction_stage", "lock_up"), { constructionStage: "lock_up" });
    assert.equal(web.jobInfoAnswersForNewInspection("dilapidation", "lock_up"), undefined);
  });
});
