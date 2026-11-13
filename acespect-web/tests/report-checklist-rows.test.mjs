// Construction Inspection Checklist: each row shows only the item's name on the left (its status is in the right-hand column),
// and the "not complete" key tile reads "NOT YET".
//
// Run with: npm test
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/web/construction/ConstructionReport.tsx"), "utf8");
const table = src.slice(src.indexOf("function Table("), src.indexOf("// ───────────────────────── Defects"));

describe("construction checklist rows and key", () => {
  it("rows no longer print the item's sentence under its name", () => {
    assert.doesNotMatch(table, /\{it\.text\}/);
    assert.match(table, /\{s\.label\} ›<\/a> : s\.label\}/, "the right-hand status column is unchanged");
  });
  it("the not-complete key tile reads NOT YET; the row's right-hand column keeps NOT COMPLETE", () => {
    assert.match(src, /const TILE_LABEL: Partial<Record<ItemStatus, string>> = \{ notcomplete: "NOT YET" \};/);
    assert.match(src, /\{TILE_LABEL\[k\] \?\? s\.label\}/);
    assert.match(src, /notcomplete: \{ label: "NOT COMPLETE", sub: "Not yet started \/ not sighted"/);
  });
});
