// The General Description's construction line, every Construction stage, House and Apartment: "on a" only before one thing.
//   "The construction is a single storey on a concrete slab."      (the templates: "on a concrete slab / timber stumps / concrete stumps")
//   "The construction is a double storey on stumps." / "… on timber stumps." / "… on brick piers."   (never "on a stumps")
//   "The construction is a single storey apartment on a concrete slab."   (Apartment keeps "apartment")
// Every foundations option of every stage's real template (templates-snapshot.json), through the shared report code (compose.ts).
//
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
const { composeConstructionSection, onFoundations } = await server.ssrLoadModule("/src/web/construction/compose.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const latest = new Map();
for (const t of SNAP) {
  if (t.inspectionType !== "construction_stage" || !t.sectionKey.endsWith("_description")) continue;
  const k = `${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}
/** The template's wording for each option ("on" + what the template calls it). */
const EXPECTED = {
  concrete_slab: "on a concrete slab",
  timber_stumps: "on timber stumps",
  concrete_stumps: "on concrete stumps",
  stumps: "on stumps",
  brick_piers: "on brick piers",
};

describe("onFoundations: 'a' / 'an' only before one thing", () => {
  const cases = [
    ["concrete slab", "on a concrete slab"], ["stumps", "on stumps"], ["timber stumps", "on timber stumps"], ["concrete stumps", "on concrete stumps"],
    ["brick piers", "on brick piers"], ["screw piles", "on screw piles"], ["waffle pod slab", "on a waffle pod slab"], ["engineered raft", "on an engineered raft"],
    ["concrete slab and stumps", "on concrete slab and stumps"], ["a suspended slab", "on a suspended slab"], ["the existing footings", "on the existing footings"],
    ["concrete slab (raft)", "on a concrete slab (raft)"], ["steel posts.", "on steel posts."], ["mass", "on a mass"],
  ];
  for (const [given, want] of cases) it(`"${given}" -> "${want}"`, () => assert.equal(onFoundations(given), want));
});

describe("the construction line, every stage, House and Apartment, every foundations option", () => {
  let checked = 0;
  for (const [k, t] of latest) {
    const [prop, key] = k.split("|");
    const apt = prop === "apartment";
    const fields = t.fields;
    const fnd = fields.find((f) => f.key === "foundations");
    const kindField = fields.find((f) => f.key === "constructionIs" || f.key === "design");
    if (!fnd || !kindField) continue;
    const kind = kindField.options[0];
    for (const o of fnd.options) {
      it(`${key} (${prop}): "${o.label}"`, () => {
        const lines = composeConstructionSection(key, fields, { [kindField.key]: kind.value, foundations: o.value }, apt).text.split(/\n+/);
        const line = lines.find((l) => /^The construction is |^Foundations are /.test(l));
        assert.ok(line, lines.join(" | "));
        assert.doesNotMatch(line, /\bon a (\w+ )?(stumps|piers)\b/);
        if (key.startsWith("pci_")) {
          // The PCI templates word the foundations as a line of their own: "Foundations are concrete slab."
          assert.ok(lines.includes(`Foundations are ${o.label.toLowerCase()}.`), lines.join(" | "));
          return;
        }
        const want = EXPECTED[o.value];
        assert.ok(want, `no expected wording for ${o.value}`);
        assert.equal(line, `The construction is a ${kind.label.toLowerCase()}${apt ? " apartment" : ""} ${want}.`);
      });
      checked++;
    }
  }
  it("found the foundations question in the templates (Pre-pour to Fixing, House and Apartment)", () => assert.ok(checked >= 40, `${checked}`));
});

describe("a typed 'Other' foundation", () => {
  const t = latest.get("residential_house|lu_description");
  const f = t.fields.find((x) => x.key === "foundations");
  const other = f.options.find((o) => /other/i.test(o.label));
  it("reads with 'on' as typed (plural -> no 'a')", { skip: !f.allowOther }, () => {
    // The form's "Other" box: the typed answer stands for the option.
    const value = other ? other.value : "Screw piles";
    const a = { constructionIs: t.fields.find((x) => x.key === "constructionIs").options[0].value, foundations: value, ...(other ? { foundations_other: "Screw piles" } : {}) };
    const line = composeConstructionSection("lu_description", t.fields, a, false).text.split(/\n+/).find((l) => l.startsWith("The construction is "));
    assert.match(line, /\bon screw piles\.$/i);
  });
});
