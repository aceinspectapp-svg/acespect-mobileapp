// Every report type except Pre-Purchase / Apartment and Pre-Purchase / Commercial prints exactly as it did on main before the Pre-Purchase layout change: each
// construction stage (house and apartment) as its whole report, and every other report type (Dilapidation, Investigations, Pre-Purchase
// House) as its cover and each section's text, defects and printed section -- 3 sets of answers that walk through every
// option, with text and numbers present and empty (tests/fixtures/render-other-reports.mjs). Compared with what main 1dc7a6b printed
// (tests/fixtures/other-stages-report-hashes.json).
// If another report type's wording is changed on purpose later, regenerate the fixture from that change's base.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { renderOtherReports } from "./fixtures/render-other-reports.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { hashes } = JSON.parse(readFileSync(resolve(webRoot, "tests/fixtures/other-stages-report-hashes.json"), "utf8"));
const out = await renderOtherReports(webRoot, server);

describe("Every other report type prints exactly as before the Pre-Purchase / Apartment and Commercial layouts", () => {
  it("covers every construction stage and every other report type", () => {
    assert.deepEqual(Object.keys(out).sort(), Object.keys(hashes).sort());
    assert.ok(Object.keys(out).some((k) => k.startsWith("dilapidation|")) && Object.keys(out).some((k) => k.startsWith("construction_stage|")));
    assert.ok(!Object.keys(out).some((k) => k.startsWith("pre_purchase|apartment") || k.startsWith("pre_purchase|commercial_properties")));
  });
  // Pre-Purchase / House shares its office template with Commercial, but its report is generated separately and must not change.
  it("Pre-Purchase / House is covered, all three sets of answers, and prints as main did", () => {
    for (const v of [0, 1, 2]) {
      const k = `pre_purchase|residential_house|v${v}`;
      assert.ok(out[k] && hashes[k], k);
      assert.equal(createHash("sha256").update(out[k]).digest("hex"), hashes[k], k);
    }
  });
  for (const [k, html] of Object.entries(out)) {
    it(k, () => assert.equal(createHash("sha256").update(html).digest("hex"), hashes[k]));
  }
});
