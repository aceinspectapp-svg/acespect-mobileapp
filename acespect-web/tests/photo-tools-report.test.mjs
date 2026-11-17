// What the reviewer's photo tools change in the printed report: the order photos are arranged in, and a photo's "large" print size.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { packPhotoRows, PAGE_PACK, COMPACT_PACK, LARGE_HEIGHT_FACTOR } = await server.ssrLoadModule("/src/web/photoLayout.ts");
const { markedPhotos } = await server.ssrLoadModule("/src/web/reportParts.ts");
const { withExcludedPhotosRemoved } = await server.ssrLoadModule("/src/web/report.ts");

const P = 3 / 4;
const L = 4 / 3;
const p = (n, q = "") => `/api/v1/media/00000000-0000-4000-8000-${String(n).padStart(12, "0")}${q}`;

describe("a photo printed at the large size", () => {
  it("gets a row of its own, and the other photos pack around it in order", () => {
    const rows = packPhotoRows([P, P, L, P, P, P], PAGE_PACK, [false, false, true, false, false, false]);
    assert.deepEqual(rows.map((r) => r.indices), [[0, 1], [2], [3, 4, 5]]);
  });

  it("is drawn at the page's width, no taller than 1.4 times the usual limit", () => {
    const [row] = packPhotoRows([L], PAGE_PACK, [true]);
    const size = row.sizes[0];
    assert.ok(size.height <= PAGE_PACK.maxHeight * LARGE_HEIGHT_FACTOR + 1e-9);
    assert.ok(size.width <= PAGE_PACK.width + 1e-9);
    assert.ok(Math.abs(size.width / size.height - L) < 1e-9, "shown at its own shape, never stretched");
    assert.ok(size.width > (PAGE_PACK.width - 0.5) / 2, "bigger than a standard landscape box");
  });

  it("is bigger than the standard box for a portrait too", () => {
    const standard = packPhotoRows([P], PAGE_PACK)[0].sizes[0];
    const large = packPhotoRows([P], PAGE_PACK, [true])[0].sizes[0];
    assert.ok(large.height > standard.height && large.width > standard.width, `${large.width}x${large.height} vs ${standard.width}x${standard.height}`);
  });

  it("changes nothing when no photo is marked large", () => {
    assert.deepEqual(packPhotoRows([P, L, P, P], PAGE_PACK, [false, false, false, false]), packPhotoRows([P, L, P, P], PAGE_PACK));
  });

  it("also works in the narrow reviewer preview", () => {
    const rows = packPhotoRows([L, L], COMPACT_PACK, [true, false]);
    assert.deepEqual(rows.map((r) => r.indices), [[0], [1]]);
  });
});

describe("photos printed under an item follow the order the reviewer arranged", () => {
  const section = (answerPhotos, listed) => ({
    answers: { driveway_common_photos: answerPhotos },
    photos: listed,
    damages: [],
  });

  it("prints them in the answers' order, not the section's flat list's", () => {
    const s = section([p(3), p(1), p(2)], [p(1), p(2), p(3)]);
    assert.deepEqual(markedPhotos(s, ["driveway_common_photos"]), [p(3), p(1), p(2)]);
  });

  it("leaves out a photo the section no longer lists (left out of the report), keeping the rest in order", () => {
    const s = section([p(3), p(1), p(2)], [p(1), p(3)]);
    assert.deepEqual(markedPhotos(s, ["driveway_common_photos"]), [p(3), p(1)]);
  });

  it("uses the section's current (signed) link for each photo", () => {
    const s = section([p(1), p(2)], [p(2, "?e=9&s=x"), p(1, "?e=9&s=y")]);
    assert.deepEqual(markedPhotos(s, ["driveway_common_photos"]), [p(1, "?e=9&s=y"), p(2, "?e=9&s=x")]);
  });

  it("prints a photo once even when two marks name it, and never a defect's own", () => {
    const s = { answers: { a: [p(1), p(2)] }, photos: [p(1), p(2), p(3)], damages: [{ photos: [p(2)] }] };
    assert.deepEqual(markedPhotos(s, ["a", p(1)]), [p(1)]);
  });
});

describe("a photo the reviewer leaves out of the report", () => {
  const section = (excluded, damageExcluded = []) => ({ photos: [p(1), p(2)], excludedPhotoUrls: excluded, damages: [{ photos: [p(2), p(3)], excludedPhotoUrls: damageExcluded }] });

  it("is left out of a defect's photos too (the photo panel records it on the section)", () => {
    const s = withExcludedPhotosRemoved(section([p(3)]));
    assert.deepEqual(s.damages[0].photos, [p(2)]);
    assert.deepEqual(s.photos, [p(1), p(2)]);
  });

  it("is recognised whatever signature its link carries", () => {
    const s = withExcludedPhotosRemoved({ ...section([p(1)]), photos: [p(1, "?e=1&s=a"), p(2, "?e=1&s=b")] });
    assert.deepEqual(s.photos, [p(2, "?e=1&s=b")]);
  });

  it("still honours a defect's own list", () => {
    assert.deepEqual(withExcludedPhotosRemoved(section([], [p(2)])).damages[0].photos, [p(3)]);
  });
});
