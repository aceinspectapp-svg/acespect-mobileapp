// Pre-Purchase / Apartment prints exactly as main did, apart from its ending (fix/ppi-apartment-terms: the template's Glossary,
// Maintenance and Terms instead of CONDITIONS FOR THE PROVISION OF THE REPORT). For 3 sets of answers that walk through every option and
// four covers each (tests/fixtures/render-ppi-apartment.mjs), compared with tests/fixtures/ppi-apartment-report-hashes.json:
//   before -- everything before the ending, as main fa7e735 printed it;
//   hashes -- the whole body, ending included.
// If the Apartment report is changed on purpose later, regenerate the fixture from that change's base.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { renderPpiApartment } from "./fixtures/render-ppi-apartment.mjs";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { before, hashes } = JSON.parse(readFileSync(resolve(webRoot, "tests/fixtures/ppi-apartment-report-hashes.json"), "utf8"));
const out = await renderPpiApartment(webRoot, server);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const ENDING = '<div class="report-page-break" data-ppi-title="Glossary">';

describe("Pre-Purchase / Apartment: everything before the ending prints exactly as main did", () => {
  it("covers every case", () => assert.deepEqual(Object.keys(out).sort(), Object.keys(before).sort()));
  for (const [k, html] of Object.entries(out)) it(k, () => {
    const at = html.indexOf(ENDING);
    assert.ok(at > 0, "the ending starts with the Glossary");
    assert.equal(sha(html.slice(0, at)), before[k]);
  });
});

describe("Pre-Purchase / Apartment: the whole body, ending included", () => {
  it("covers every case", () => assert.deepEqual(Object.keys(out).sort(), Object.keys(hashes).sort()));
  for (const [k, html] of Object.entries(out)) it(k, () => assert.equal(sha(html), hashes[k]));
});
