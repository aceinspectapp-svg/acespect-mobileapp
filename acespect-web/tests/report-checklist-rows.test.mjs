// Construction Inspection Checklist: each row shows only the item's name on the left (its status is in the right-hand column),
// and the "not complete" status reads "NOT YET" in the key, the rows and the count line.
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
    assert.match(table, /\{statusLabel\(it\)\} ›<\/a> : statusLabel\(it\)\}/, "the right-hand status column: the status (with a defect row's count)");
  });
  it("the not-complete status reads NOT YET everywhere: the key tile, the row's right-hand column and the table's count line", () => {
    assert.match(src, /notcomplete: \{ label: "NOT YET", sub: "Not yet started \/ not sighted"/);
    assert.match(src, /\{s\.label\}/, "the key tile prints the same label as the rows");
    assert.match(src, /\$\{t\.counts\.notcomplete\} not yet`/);
    assert.doesNotMatch(src, /NOT COMPLETE|not complete`/);
  });
});
