// The phone apps' form rules -- the Android app (acespect-mobile) and the iOS app (acespect-ios) are two copies of the same Expo app, so
// every case runs against both, and a fix made in one copy only fails here. Covers A-Akshana's form fixes (PR #85) and their iOS port:
//   - a yes/no question with no option list shows Yes / No (Job Information's "Occupied?");
//   - a room's standard name is saved with its first answer, and a name box with a standard name is never required -- but "No Access
//     Areas -> Area" and the house retaining walls' "Location" (no standard name) stay required;
//   - answers left behind a hidden question neither open other questions nor demand a defect (withoutHiddenAnswers);
//   - each tab of a fixed-tabs group gets its own inputs (keyed by the tab);
//   - Dilapidation / Apartment has no Driveway, Paving, Elevations or Roof section.
// Plus the website: a draft section held open only by a blank name box reads Complete.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fsPath = (p) => resolve(webRoot, p).replaceAll("\\", "/").replace(/^(?!\/)/, "/");
// The app files are plain TypeScript; a fixed tsconfig stops vite looking up the apps' own (it extends "expo/tsconfig.base", which only exists
// where an app's node_modules are installed -- not in CI).
const server = await createServer({ root: webRoot, server: { middlewareMode: true, fs: { strict: false } }, esbuild: { tsconfigRaw: '{"compilerOptions":{}}' }, logLevel: "error" });
after(() => server.close());
const web = await server.ssrLoadModule("/src/web/templateFields.ts");

const APPS = ["acespect-mobile", "acespect-ios"];
const app = {};
for (const a of APPS) {
  app[a] = {
    flat: await server.ssrLoadModule(`/@fs${fsPath(`../${a}/src/utils/flattenSectionToDraft.ts`)}`),
    types: await server.ssrLoadModule(`/@fs${fsPath(`../${a}/src/components/inspection/fieldRenderers/types.ts`)}`),
    sections: await server.ssrLoadModule(`/@fs${fsPath(`../${a}/src/constants/inspectionSections.ts`)}`),
    src: (p) => readFileSync(resolve(webRoot, `../${a}/src/${p}`), "utf8"),
  };
}

// The groups as the published templates have them (dilapidation / residential_house, commercial, public_assets).
const rooms = {
  key: "rooms", type: "repeating-group", label: "Rooms", order: 0,
  repeat: { presentation: "fixed-tabs", collapsible: true, titleFieldKey: "roomName", fixedInstances: [{ key: "lounge", label: "Lounge" }, { key: "kitchen", label: "Kitchen" }] },
  itemFields: [
    { key: "roomName", type: "text", label: "Room name (leave blank to keep the standard name)", order: 0, required: true },
    { key: "present", type: "yesno", label: "Present / inspected?", order: 1, required: true },
  ],
};
const noAccess = {
  key: "noAccess", type: "repeating-group", label: "No Access Areas", order: 0,
  repeat: { addable: true, presentation: "strip", titleFieldKey: "area" },
  itemFields: [
    { key: "area", type: "text", label: "Area", order: 0, required: true },
    { key: "reason", type: "text", label: "Reason", order: 1, required: true },
  ],
};
const houseWalls = {
  key: "items", type: "repeating-group", label: "Retaining walls", order: 0,
  repeat: { addable: true, presentation: "strip", titleFieldKey: "location" },
  itemFields: [
    { key: "location", type: "text", label: "Location", order: 0, required: true },
    { key: "material", type: "text", label: "Material", order: 1, required: true },
  ],
};
const parts = {
  key: "parts", type: "repeating-group", label: "Parts", order: 0,
  repeat: { addable: true, presentation: "strip", collapsible: true, titleFieldKey: "partName", addButtonLabel: "Add Part" },
  itemFields: [
    { key: "partName", type: "text", label: "Name this part", order: 0, required: true },
    { key: "condition", type: "text", label: "Condition", order: 1, required: true },
  ],
};
// A tab answered "not available": the questions under it hide, and answers left from before must not demand a defect.
const sides = {
  key: "sides", type: "repeating-group", label: "Sides", order: 0,
  repeat: { presentation: "fixed-tabs", fixedInstances: [{ key: "right", label: "Right" }] },
  itemFields: [
    { key: "available", type: "yesno", label: "Available for inspection?", order: 0, required: true },
    { key: "condition", type: "color-select", label: "Condition", order: 1, required: true, gate: { fieldKey: "available", equals: "yes" }, options: [{ value: "fair", label: "Fair" }, { value: "average", label: "Average" }] },
    { key: "hasDamage", type: "yesno", label: "Any damage?", order: 2, required: true, gate: { fieldKey: "available", equals: "yes" } },
    {
      key: "damages", type: "damage-list", label: "Damages", order: 3, gate: { fieldKey: "hasDamage", equals: "yes" },
      repeat: { addable: true, presentation: "strip", requireWhen: { fieldKey: "condition", equals: ["average", "poor"] } },
      itemFields: [{ key: "notes", type: "text", label: "Notes", order: 0, required: true }],
    },
  ],
};

for (const a of APPS) {
  const { flat, types, sections, src } = app[a];
  describe(`${a}: a name box with a standard name is never required; one without stays required`, () => {
    it("rooms: a blank room name keeps the standard name and does not hold the section open", () => {
      assert.equal(flat.meetsAllRequiredFields([rooms], { rooms: { lounge: { present: "yes" }, kitchen: { present: "no" } } }), true);
    });
    it("a list that opens in its own window ('Part A'): a blank name keeps the default", () => {
      assert.equal(flat.meetsAllRequiredFields([parts], { parts: [{ condition: "Fair" }] }), true);
    });
    it("No Access Areas: the Area must be written", () => {
      assert.equal(flat.meetsAllRequiredFields([noAccess], { noAccess: [{ reason: "Locked" }] }), false);
      assert.equal(flat.meetsAllRequiredFields([noAccess], { noAccess: [{ area: "Roof space", reason: "Locked" }] }), true);
    });
    it("the house retaining walls: the Location must be written", () => {
      assert.equal(flat.meetsAllRequiredFields([houseWalls], { items: [{ material: "Timber" }] }), false);
      assert.equal(flat.meetsAllRequiredFields([houseWalls], { items: [{ location: "Rear", material: "Timber" }] }), true);
    });
    it("hasStandardName: fixed lists and lists that open in a window only", () => {
      assert.deepEqual([rooms, parts, noAccess, houseWalls].map(flat.hasStandardName), [true, true, false, false]);
    });
  });

  describe(`${a}: answers behind a hidden question`, () => {
    it("withoutHiddenAnswers hides a chain of gates all the way down", () => {
      const out = types.withoutHiddenAnswers(sides.itemFields, { available: "no", condition: "average", hasDamage: "yes" });
      assert.deepEqual(out, { available: "no" });
    });
    it("a tab answered 'not available' demands nothing, whatever was answered before", () => {
      const answers = { sides: { right: { available: "no", condition: "average", hasDamage: "yes" } } };
      assert.equal(flat.meetsAllRequireWhen([sides], answers), true);
      assert.equal(flat.meetsAllRequiredFields([sides], answers), true);
      assert.equal(flat.meetsAllRequireWhen([sides], { sides: { right: { ...answers.sides.right, available: "yes" } } }), false, "the same answers on Yes still demand a defect");
    });
  });

  describe(`${a}: the screens`, () => {
    const jobInfo = src("screens/inspection/JobInformationScreen.tsx");
    const renderers = src("components/inspection/fieldRenderers/index.tsx");
    it("Job Information: a yes/no question with no option list shows Yes / No ('Occupied?')", () =>
      assert.match(jobInfo, /field\.options\?\.length \? field\.options : \[\{ value: 'yes', label: 'Yes' \}, \{ value: 'no', label: 'No' \}\]/));
    it("a room's standard name is saved with its first answer", () => assert.match(renderers, /if \(titleKey && k !== titleKey && !customName\(open\.key\)\) inst\[titleKey\] = open\.label;/));
    it("a list that opens in a window saves its default name ('Part A') with the first answer -- not a damage list", () =>
      assert.match(renderers, /if \(openInModal && titleKey && k !== titleKey && field\.type !== 'damage-list' && [^\n]*inst\[titleKey\] = defaultInstanceLabel\(idx\);/));
    it("each tab gets its own inputs", () => assert.match(renderers, /<View key=\{active\.key\} style=\{styles\.instanceCard\}>/));
    it("the form hides answers behind a hidden question", () => assert.match(renderers, /const shown = withoutHiddenAnswers\(fields, scope\);/));
  });

  describe(`${a}: Dilapidation / Apartment sections`, () => {
    it("no Driveway, Paving, Elevations or Roof", () => {
      const ids = sections.getSectionGroupsForProperty("apartment", "dilapidation").flatMap((g) => g.sections.map((s) => s.id));
      for (const gone of ["driveway", "paving_paths", "elevations", "roof_chimneys"]) assert.ok(!ids.includes(gone), gone);
      for (const kept of ["fences", "retaining_walls", "garage_carport_sheds", "internal_areas", "notes_defects"]) assert.ok(ids.includes(kept), kept);
    });
  });
}

describe("both apps answer the same", () => {
  it("the same Dilapidation / Apartment sections", () => {
    const list = (a) => app[a].sections.getSectionGroupsForProperty("apartment", "dilapidation").flatMap((g) => g.sections.map((s) => s.id));
    assert.deepEqual(list("acespect-ios"), list("acespect-mobile"));
  });
});

describe("website: the same name-box rule, and a draft held open only by a blank name reads Complete", () => {
  it("still to complete: never a room's name, always a No Access Area", () => {
    assert.deepEqual(web.listMissingItems([rooms], { rooms: { lounge: { present: "yes" }, kitchen: { present: "yes" } } }), []);
    assert.ok(web.listMissingItems([noAccess], { noAccess: [{ reason: "Locked" }] }).some((m) => /Area/.test(m)));
    assert.deepEqual([rooms, parts, noAccess, houseWalls].map(web.hasStandardName), [true, true, false, false]);
  });
  it("the inspector page reads a section Complete when its answers meet every rule, whatever status an older app saved", () => {
    const page = readFileSync(resolve(webRoot, "src/web/pages/inspector/InspectorFormEditor.tsx"), "utf8");
    assert.match(page, /function readsComplete\(section: FormSection\): boolean \{\n\s+if \(section\.status === "complete"\) return true;/);
    assert.match(page, /Object\.keys\(answers\)\.length > 0 && isSectionComplete\(section\)/);
    assert.ok(!/section\.status === "complete"\) \? "Complete"/.test(page), "the badge reads readsComplete, not the stored status alone");
  });
});
