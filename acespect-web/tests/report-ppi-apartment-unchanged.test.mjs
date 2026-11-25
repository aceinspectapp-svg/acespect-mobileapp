// Pre-Purchase / Apartment prints exactly as main did before the Pre-Purchase / Commercial layout (fix/ppi-commercial-layout): the whole
// report body, cover to Terms, for 3 sets of answers that walk through every option and four covers each
// (tests/fixtures/render-ppi-apartment.mjs), compared with tests/fixtures/ppi-apartment-report-hashes.json (made from main d19f81a).
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
const { hashes } = JSON.parse(readFileSync(resolve(webRoot, "tests/fixtures/ppi-apartment-report-hashes.json"), "utf8"));
const out = await renderPpiApartment(webRoot, server);

describe("Pre-Purchase / Apartment prints exactly as before the Commercial layout", () => {
  it("covers every case", () => assert.deepEqual(Object.keys(out).sort(), Object.keys(hashes).sort()));
  for (const [k, html] of Object.entries(out)) it(k, () => assert.equal(createHash("sha256").update(html).digest("hex"), hashes[k]));
});
