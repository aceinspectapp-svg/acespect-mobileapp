// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { looksLikePhoneWording } = await server.ssrLoadModule("/src/web/phoneWording.ts");

describe("looksLikePhoneWording: tells the phone's raw report text from composed sentences", () => {
  it("recognises the phone's 'Question?: answer' pairs", () => {
    assert.equal(looksLikePhoneWording("Garage: Present on site?: yes. Position: right."), true);
  });
  it("recognises stored option names (words joined by underscores)", () => {
    assert.equal(looksLikePhoneWording("Walls: fibre_cement. Condition: satisfactory_with_typical_wear_and_tear."), true);
  });
  it("leaves composed sentences alone, including ones a reviewer wrote", () => {
    assert.equal(looksLikePhoneWording("There is a garage located at the right of the property, constructed of fibre cement."), false);
    assert.equal(looksLikePhoneWording("At the front edge there is bulging to the slab. Please refer to Photograph 3."), false);
    assert.equal(looksLikePhoneWording(""), false);
    assert.equal(looksLikePhoneWording(undefined), false);
  });
});
