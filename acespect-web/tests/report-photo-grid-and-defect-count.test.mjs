// Two print changes to the report (PDF and Word are both made from the same page):
//  1. A photo grid on a report page fits three rows of portrait photos -- nine to a page -- above the footer; landscape boxes, the column
//     width, the gaps and the "Photo N" captions are as they were.
//  2. A Construction checklist row answered "Defect" shows how many of the report's numbered defects it refers to: "REFER DEFECTS (2)".
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
const { packPhotoRows, PAGE_PACK, COMPACT_PACK, PORTRAIT_BOX, LANDSCAPE_BOX } = await server.ssrLoadModule("/src/web/photoLayout.ts");
const { buildConstructionReport, rowDefects } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { statusLabel } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const P = 3 / 4, L = 4 / 3;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// The PDF's page (reportPdf.ts): A4, 30 mm top and 42 mm bottom margins, 22 mm side margins. The grid is drawn as a share of the
// text column, so a box of PAGE_PACK's w cm is drawn at w * (16.6 / 16.4) cm.
const BODY_CM = 29.7 - 3.0 - 4.2;
const SCALE = 16.6 / PAGE_PACK.width;
const CAPTION_CM = 0.5; // "Photo N" under each photo: 2px + one line of ~10.7px text at line-height 1.45 is ~0.47 cm
const rowsHeight = (rows) => rows.reduce((h, r, i) => h + r.height * SCALE + CAPTION_CM + (i ? PAGE_PACK.gap : 0), 0);

describe("photo grid: nine portrait photos to a page", () => {
  it("three rows of three portraits fit on one page", () => {
    const rows = packPhotoRows(Array(9).fill(P), PAGE_PACK);
    assert.deepEqual(rows.map((r) => r.indices.length), [3, 3, 3]);
    assert.ok(rowsHeight(rows) <= BODY_CM, `three portrait rows are ${rowsHeight(rows).toFixed(2)} cm, the page body ${BODY_CM} cm`);
    // ... which they did not before, with the 3:4 box
    const before = packPhotoRows(Array(9).fill(P), { ...PAGE_PACK, portraitBox: undefined });
    assert.ok(rowsHeight(before) > BODY_CM, "the old 3:4 box fitted only two rows");
  });

  it("keeps the column width, gaps and order; only the portrait box's height changes", () => {
    const portraitW = (PAGE_PACK.width - 2 * PAGE_PACK.gap) / 3;
    const rows = packPhotoRows([P, P, P, P], PAGE_PACK);
    assert.deepEqual(rows.map((r) => r.indices), [[0, 1, 2], [3]]);
    for (const z of rows.flatMap((r) => r.sizes)) { near(z.width, portraitW, "portrait width as before"); near(z.height, portraitW * 5 / 4, "4:5 box"); }
    assert.equal(PAGE_PACK.gap, 0.25);
  });

  it("does not crop: the 3:4 photo is shown whole inside the box (object-fit: contain), and so is the unavailable box at the same size", () => {
    const kit = readFileSync(resolve(webRoot, "src/web/components/reportKit.tsx"), "utf8");
    const grid = kit.slice(kit.indexOf("export function PhotoGrid("), kit.indexOf("export const PhotoNumberContext"));
    assert.match(grid, /objectFit: "contain"/);
    assert.doesNotMatch(grid, /objectFit: "cover"/);
    assert.equal((grid.match(/aspectRatio: `\$\{row\.sizes\[k\]!\.width \/ row\.sizes\[k\]!\.height\}`/g) ?? []).length, 2, "photo and 'Photograph unavailable' box share the size");
  });

  it("leaves landscape boxes, mixed rows' landscapes, the reviewer panel and the cover spot as they were", () => {
    const landscapeW = (PAGE_PACK.width - PAGE_PACK.gap) / 2;
    for (const z of packPhotoRows([L, L, L, P], PAGE_PACK).flatMap((r) => r.sizes).slice(0, 3)) {
      near(z.width, landscapeW, "landscape width"); near(z.width / z.height, LANDSCAPE_BOX, "landscape 4:3");
    }
    const compact = packPhotoRows([P], COMPACT_PACK)[0].sizes[0];
    near(compact.width / compact.height, PORTRAIT_BOX, "reviewer panel keeps 3:4");
    const cover = packPhotoRows([P], { ...PAGE_PACK, maxHeight: 7.5, portraitBox: undefined })[0].sizes[0];
    near(cover.width / cover.height, PORTRAIT_BOX, "cover spot keeps 3:4");
  });

  it("a page of mixed rows also fits three rows: no row is taller than a portrait row", () => {
    for (const aspects of [[L, P, P, P, P, L, P], [P, L, L, L, P, P, P], [L, L, L, L, L, L]]) {
      const rows = packPhotoRows(aspects, PAGE_PACK);
      for (let i = 0; i + 3 <= rows.length; i++) assert.ok(rowsHeight(rows.slice(i, i + 3)) <= BODY_CM, `rows ${i}..${i + 2} of ${aspects}`);
    }
  });
});

// ---- the defect count ------------------------------------------------------------------------------------------------------
const OK = "#1FA463", BAD = "#E63329", NA = "#94A1B2";
const row = (key, label, order, extra = {}) => ({
  key, label, order, type: "pill-select", sectionLetter: "Roof", defectOn: ["defect"],
  options: [{ value: "ok", label: "OK", color: OK }, { value: "n_a", label: "N/A", color: NA }, { value: "defect", label: "Defect", color: BAD }],
  ...extra,
});
const defect = (location) => ({ location, category: ["damage"], severity: ["minor"], photos: [], comments: "", constructionCode: "" });
const section = (key, name, fields, answers) => {
  const d = flattenSectionToDraft(fields, answers, key, { inspectionType: "construction_stage", propertyType: "residential_house" });
  return { key, name, fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
};

describe("checklist: a defect row shows its number of defects", () => {
  const roof = section("pci_roof", "PCI Checklist: External — Roof",
    [
      { key: "upperRoofFrom", label: "Upper roof inspected from", type: "pill-select", order: 0, sectionLetter: "Roof", options: [{ value: "ladder", label: "Ladder", color: OK }] },
      row("upperRoofAppears", "Upper roof appears", 1),
      row("lowerRoofLadder", "Lower roof from ladder", 2),
      row("gutters", "Gutters; clipped", 3),
      row("fascia", "Fascia", 4),
      row("skylights", "Skylights", 5),
    ],
    {
      upperRoofFrom: "ladder", upperRoofAppears: "defect", upperRoofAppears__defect: defect("North"), lowerRoofLadder: "defect", lowerRoofLadder__defect: defect("South"),
      gutters: "defect", gutters__defect: defect("Rear"), fascia: "ok", skylights: "defect", skylights__defect: defect("Kitchen"),
    });
  const model = buildConstructionReport([roof], null);
  const items = model.tables.flatMap((t) => t.groups.flatMap((g) => g.items));
  const byName = (re) => items.find((i) => re.test(i.heading));

  it("counts each row's own defects, matching the numbered defects listed", () => {
    assert.equal(model.defectCount, 4);
    const covering = byName(/roof covering/i), gutters = byName(/gutters/i), sky = byName(/skylights/i);
    assert.deepEqual([covering.defectCount, gutters.defectCount, sky.defectCount], [2, 1, 1]);
    assert.equal(items.filter((i) => i.status === "defect").reduce((n, i) => n + i.defectCount, 0), model.defectCount, "rows add up to the defects listed");
    // each row links to its own first defect (the two-defect row no longer shifts the rows after it)
    assert.deepEqual([covering.defectNo, gutters.defectNo, sky.defectNo], [1, 3, 4]);
  });

  it("prints 'REFER DEFECTS (n)' on defect rows only; every other status reads as before", () => {
    assert.equal(statusLabel(byName(/roof covering/i)), "REFER DEFECTS (2)");
    assert.equal(statusLabel(byName(/gutters/i)), "REFER DEFECTS (1)");
    assert.equal(statusLabel(byName(/fascia/i)), "CHECKED & OK");
    assert.equal(statusLabel({ status: "note" }), "REFER NOTES");
    assert.equal(statusLabel({ status: "defect" }), "REFER DEFECTS", "a defect row with no defect found prints as before");
  });

  it("reads a two-check row's defects from its sentence", () => {
    assert.equal(rowDefects("Refer defects."), 1);
    assert.equal(rowDefects("Observations from the ground indicate that the roof covering is defective. Lower level roofing was checked from the ladder and is defective. Refer defects."), 2);
  });
});
