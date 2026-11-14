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

  it("makes two landscapes fill the row exactly, the same width as three portraits", () => {
    const pair = rows([L, L])[0].sizes.reduce((w, z) => w + z.width, 0) + G;
    const three = rows([P, P, P])[0].sizes.reduce((w, z) => w + z.width, 0) + 2 * G;
    near(pair, W, "two landscapes");
    near(pair, three, "a landscape row is as wide as a portrait row");
  });

  it("gives every photo of a kind the same box, in full rows, short rows, mixed rows and alone", () => {
    const all = rows([P, P, P, P, P, L, L, L, P, L]).flatMap((r) => r.indices.map((i, k) => [i, r.sizes[k]]));
    const portraits = all.filter(([i]) => [0, 1, 2, 3, 4, 8].includes(i)).map(([, z]) => z);
    const landscapes = all.filter(([i]) => [5, 6, 7, 9].includes(i)).map(([, z]) => z);
    for (const z of portraits) { near(z.width, portraitW, "portrait width"); near(z.height, portraitW * 5 / 4, "portrait height (the page's 4:5 box, so nine portraits fit on a page)"); }
    for (const z of landscapes) { near(z.width, (W - G) / 2, "landscape width"); near(z.height, ((W - G) / 2) * 3 / 4, "landscape height"); }
    near(rows([L])[0].sizes[0].width, (W - G) / 2, "a lone landscape");
    near(rows([P])[0].sizes[0].width, portraitW, "a lone portrait");
  });

  it("gives a photo of any other shape its kind's usual box (it is drawn whole inside it)", () => {
    const portrait = rows([P])[0].sizes[0];
    const landscape = rows([L])[0].sizes[0];
    for (const a of [9 / 19.5, 2 / 3, 0.4, 0.7]) assert.deepEqual(rows([a])[0].sizes[0], portrait, `portrait ${a}`);
    for (const a of [1, 3 / 2, 16 / 9, 3]) assert.deepEqual(rows([a])[0].sizes[0], landscape, `landscape ${a}`);
  });

  it("keeps every photo within the maximum height", () => {
    for (const row of rows([0.5, 0.5, 0.5, 0.4, L])) for (const z of row.sizes) assert.ok(z.height <= PAGE_PACK.maxHeight + 1e-9);
    const small = packPhotoRows([P, L], { ...PAGE_PACK, maxHeight: 3 });
    for (const z of small[0].sizes) assert.ok(z.height <= 3 + 1e-9);
    near(small[0].sizes[0].width / small[0].sizes[0].height, 4 / 5, "a shrunk portrait box keeps its shape");
    near(small[0].sizes[1].width / small[0].sizes[1].height, 4 / 3, "a shrunk landscape box keeps its shape");
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
