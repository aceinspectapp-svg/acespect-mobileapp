// "For a full download please Click here to access." -- "Click here" downloads every original photo of the inspection as one zip.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { OriginalPhotosPending, useOriginalPhotosLink } = await server.ssrLoadModule("/src/web/components/OriginalPhotosLink.tsx");
const { ReportDescription } = await server.ssrLoadModule("/src/web/components/ReportDescription.tsx");

const html = (type, props) => renderToStaticMarkup(React.createElement(type, props));
const read = (p) => readFileSync(resolve(webRoot, p), "utf8");

describe("full download Click here -> original photos zip", () => {
  it("holds the PDF/Word export back while the link loads", () => {
    assert.match(html(OriginalPhotosPending, { pending: true }), /data-photo-grid-pending/);
    assert.equal(html(OriginalPhotosPending, { pending: false }), "");
    function Probe() { const l = useOriginalPhotosLink("abc"); return React.createElement("i", null, `${l.pending}:${l.url}`); }
    assert.equal(html(Probe, {}), "<i>true:null</i>");
  });

  it("no new sentence is printed any more", () => {
    for (const p of ["src/web/components/OriginalPhotosLink.tsx", "src/web/components/ReportDescription.tsx", "src/web/construction/ConstructionReport.tsx"]) {
      assert.doesNotMatch(read(p), /original photographs taken during this inspection|link available until/);
    }
  });

  it("the Description & Overview Photographs sentence (dilapidation, pre-purchase, investigations) links the zip first, the folder link as fallback", () => {
    const src = read("src/web/components/ReportDescription.tsx");
    assert.match(src, /const fullDownloadUrl = originals\.url \|\| photoArchiveUrl;/);
    assert.match(src, /<a href=\{fullDownloadUrl\}[^>]*>\s*Click here\s*<\/a>/);
    // The Download All note is still tied to the folder link only.
    assert.match(src, /\{photoArchiveUrl && <Note>\{PHOTOGRAPHS_NOTE\}<\/Note>\}/);
    // Loading: the sentence without a link, and the pending marker.
    const out = html(ReportDescription, { inspection: { id: "abc", type: "dilapidation", propertyType: "residential_house", address: "1 A St", suburb: "B", sections: [] }, reportText: "" });
    assert.match(out, /data-photo-grid-pending/);
    assert.doesNotMatch(out, /Click here/);
  });

  it("the construction Photographs sentence links the zip, and stays plain \"Click here\" without a link", () => {
    const src = read("src/web/construction/ConstructionReport.tsx");
    assert.match(src, /const fullDownloadUrl = originals\.url \|\| archive;/);
    assert.match(src, /\{fullDownloadUrl \? <a href=\{fullDownloadUrl\}[^>]*>Click here<\/a> : "Click here"\} to access\./);
    assert.match(src, /You may view\/save individual photographs by clicking on a file in the list\. To save a copy of all photographs, click the Download All button/);
  });
});
