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
  const W = PAGE_PACK.width, G = PAGE_PACK.gap;
  const portraitW = (W - 2 * G) / 3; // a portrait's width: three to a row, filling it
  const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

  it("puts three portraits in a row, never more", () => {
    assert.deepEqual(shape([P, P, P]), [3]);
    assert.deepEqual(shape([P, P, P, P]), [3, 1]);
    assert.deepEqual(shape([P, P, P, P, P, P, P, P]), [3, 3, 2]);
  });

  it("puts at most two photos in a row that holds a landscape", () => {
    assert.deepEqual(shape([L, L]), [2]);
    assert.deepEqual(shape([L, L, L, L, L]), [2, 2, 1]);
    assert.deepEqual(shape([P, L]), [2]);
    assert.deepEqual(shape([L, P, P, P]), [2, 2]);
    assert.deepEqual(shape([P, P, L]), [2, 1]); // two portraits, then the landscape starts its own row
  });

  it("makes three portraits fill the row exactly", () => {
    const [row] = rows([P, P, P]);
    const used = row.sizes.reduce((w, z) => w + z.width, 0) + 2 * G;
    near(used, W, "row width");
  });

  it("makes a landscape exactly as tall as a portrait is wide", () => {
    const portrait = rows([P, P, P])[0].sizes[0];
    const landscape = rows([L, L])[0].sizes[0];
    near(portrait.width, portraitW, "portrait width");
    near(landscape.height, portrait.width, "landscape height = portrait width");
    near(landscape.width, portrait.height, "landscape width = portrait height");
    const pair = rows([L, L])[0].sizes.reduce((w, z) => w + z.width, 0) + G;
    assert.ok(pair <= W + 1e-9, "two landscapes fit the row");
  });

  it("gives every photo of a kind the same size, in full rows, short rows, mixed rows and alone", () => {
    const all = rows([P, P, P, P, P, L, L, L, P, L]).flatMap((r) => r.indices.map((i, k) => [i, r.sizes[k]]));
    const portraits = all.filter(([i]) => [0, 1, 2, 3, 4, 8].includes(i)).map(([, z]) => z);
    const landscapes = all.filter(([i]) => [5, 6, 7, 9].includes(i)).map(([, z]) => z);
    for (const z of portraits) { near(z.width, portraits[0].width, "portrait width"); near(z.height, portraits[0].height, "portrait height"); }
    for (const z of landscapes) { near(z.width, landscapes[0].width, "landscape width"); near(z.height, landscapes[0].height, "landscape height"); }
    near(rows([L])[0].sizes[0].height, portraitW, "a lone landscape");
  });

  it("never crops or stretches: every photo keeps its own shape", () => {
    for (const a of [P, L, 1, 9 / 16, 2 / 3, 3 / 2, 16 / 9, 0.4, 3]) {
      const z = rows([a])[0].sizes[0];
      near(z.width / z.height, a, `shape ${a}`);
    }
  });

  it("gives every portrait the same width and every landscape that same height, whatever the exact shape", () => {
    for (const a of [3 / 4, 2 / 3, 0.7]) near(rows([a])[0].sizes[0].width, portraitW, `portrait ${a} width`);
    for (const a of [4 / 3, 3 / 2, 1]) near(rows([a])[0].sizes[0].height, portraitW, `landscape ${a} height`);
  });

  it("scales an unusually wide landscape down so two still fit a row", () => {
    const [row] = rows([3, 3]);
    assert.ok(row.sizes.reduce((w, z) => w + z.width, 0) + G <= W + 1e-9);
  });

  it("keeps every photo within the maximum height", () => {
    for (const row of rows([0.5, 0.5, 0.5, 0.4, L])) for (const z of row.sizes) assert.ok(z.height <= PAGE_PACK.maxHeight + 1e-9);
    const small = packPhotoRows([P, L], { ...PAGE_PACK, maxHeight: 3 });
    for (const z of small[0].sizes) assert.ok(z.height <= 3 + 1e-9);
  });

  it("uses every photo exactly once, in order", () => {
    const aspects = [P, L, L, P, P, L, P];
    assert.deepEqual(rows(aspects).flatMap((r) => r.indices), aspects.map((_, i) => i));
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
