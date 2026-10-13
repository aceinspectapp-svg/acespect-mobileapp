// Photo numbers ("Photograph 6", "Photo 6") are claimed once per group of photographs, however many times React renders it -- so they never skip
// (React's development double render used to claim a second block each time) -- and a typed place that already starts with "the" is not given a second one.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { PhotoNumberProvider, usePhotoNumbering } = await server.ssrLoadModule("/src/web/components/reportKit.tsx");
const { withThe } = await server.ssrLoadModule("/src/web/wording/shared.ts");

function Group({ where, photos }) {
  const n = usePhotoNumbering(photos, where);
  usePhotoNumbering(photos, where); // asked a second time, as a double render does
  return React.createElement("p", null, `${where}:${n.start}`);
}

describe("photo numbering", () => {
  it("gives each group the next free numbers, once, however often it asks", () => {
    const html = renderToStaticMarkup(
      React.createElement(PhotoNumberProvider, null,
        React.createElement(Group, { where: "front", photos: ["a.jpg"] }),
        React.createElement(Group, { where: "defect:1", photos: ["b.jpg", "c.jpg", "d.jpg"] }),
        React.createElement(Group, { where: "defect:2", photos: ["e.jpg", "f.jpg"] }),
      ),
    );
    assert.match(html, /front:1/);
    assert.match(html, /defect:1:2/);
    assert.match(html, /defect:2:5/);
  });
});

describe("a typed place that already starts with an article", () => {
  it("is not given a second one", () => {
    assert.equal(withThe("the rear corner"), "the rear corner");
    assert.equal(withThe("rear corner"), "the rear corner");
    assert.equal(withThe("a gate post"), "a gate post");
  });
});
