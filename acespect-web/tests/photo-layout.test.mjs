// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { packPhotoRows, PAGE_PACK } = await server.ssrLoadModule("/src/web/photoLayout.ts");

const P = 3 / 4; // a portrait photo
const L = 4 / 3; // a landscape photo
const shape = (aspects) => packPhotoRows(aspects, PAGE_PACK).map((r) => r.indices.length);
const rows = (aspects) => packPhotoRows(aspects, PAGE_PACK);

describe("photo grid row packing", () => {
  it("puts three portraits in a single row", () => {
    assert.deepEqual(shape([P, P, P]), [3]);
  });

  it("puts two portraits and a landscape in a single row", () => {
    assert.deepEqual(shape([P, P, L]), [3]);
    assert.deepEqual(shape([P, L, P]), [3]);
    assert.deepEqual(shape([L, P, P]), [3]);
  });

  it("puts two landscapes side by side, not three (they would get too small)", () => {
    assert.deepEqual(shape([L, L]), [2]);
    assert.deepEqual(shape([L, L, L]), [2, 1]);
    assert.deepEqual(shape([L, L, L, L]), [2, 2]);
  });

  it("gives every photo in a full row the same height, filling the page width", () => {
    for (const aspects of [[P, P, P], [P, P, L], [L, L], [P, L]]) {
      const [row] = rows(aspects);
      assert.ok(row.full, "the row spans the full width");
      const used = aspects.slice(0, row.indices.length).reduce((w, a) => w + a * row.height, 0) + (row.indices.length - 1) * PAGE_PACK.gap;
      assert.ok(Math.abs(used - PAGE_PACK.width) < 1e-6, `widths add up to the page width (${used})`);
    }
  });

  it("keeps every row between the minimum and maximum height", () => {
    const aspects = [P, L, P, L, L, P, P, L, P, L, L];
    for (const row of rows(aspects)) {
      assert.ok(row.height <= PAGE_PACK.maxHeight + 1e-9);
      if (row.full) assert.ok(row.height >= PAGE_PACK.minHeight - 1e-9, `row height ${row.height}`);
    }
  });

  it("uses every photo exactly once, in order", () => {
    const aspects = [P, L, L, P, P, L, P];
    assert.deepEqual(rows(aspects).flatMap((r) => r.indices), aspects.map((_, i) => i));
  });

  it("shows a lone photo at a sensible size instead of stretching it across the page", () => {
    for (const a of [P, L]) {
      const [row] = rows([a]);
      assert.equal(row.full, false);
      assert.ok(row.height <= PAGE_PACK.maxHeight);
      assert.ok(row.height * a < PAGE_PACK.width, "narrower than the page");
    }
  });

  it("only ever leaves the LAST row short", () => {
    const r = rows([P, L, L, P, L, L, L]);
    r.slice(0, -1).forEach((row) => assert.ok(row.full));
  });

  it("handles no photos", () => {
    assert.deepEqual(rows([]), []);
  });
});

describe("per-section photo archive link", () => {
  let sectionPhotoArchiveUrl;
  it("loads", async () => {
    ({ sectionPhotoArchiveUrl } = await server.ssrLoadModule("/src/web/photoArchive.ts"));
  });
  const job = "https://acme.egnyte.com/app/index.do#storage/files/1/Shared/ACE%20SPECT/inspection-photos/HV-26-3001";

  it("is the job folder plus the section's own sub-folder", () => {
    assert.equal(sectionPhotoArchiveUrl(job, "driveway"), `${job}/driveway`);
    assert.equal(sectionPhotoArchiveUrl(`${job}/`, "paving_paths"), `${job}/paving_paths`);
  });

  it("cleans the key the way the storage code names the folder, and nests sub-areas", () => {
    assert.equal(sectionPhotoArchiveUrl(job, "internal_areas:ceilings"), `${job}/internal_areas/ceilings`);
    assert.equal(sectionPhotoArchiveUrl(job, "my section/../x"), `${job}/my_section____x`);
  });

  it("gives no link without a job folder or a section key", () => {
    assert.equal(sectionPhotoArchiveUrl(null, "driveway"), null);
    assert.equal(sectionPhotoArchiveUrl(job, ""), null);
  });
});
