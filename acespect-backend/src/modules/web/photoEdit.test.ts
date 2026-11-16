import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { applyPhotoEdit, mediaIdOf, needsOptimizing, optimizePhoto, removeMediaId, swapMediaId, OPTIMIZE_MAX_BYTES } from './photoEdit';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const link = (id: string) => `/api/v1/media/${id}`;

describe('photo links', () => {
  it('reads the id from a plain, prefixed or signed link', () => {
    assert.equal(mediaIdOf(link(A)), A);
    assert.equal(mediaIdOf(`https://api.example.com/api/v1/media/${A.toUpperCase()}?sig=abc&exp=1`), A);
    assert.equal(mediaIdOf('/api/v1/other/x'), null);
    assert.equal(mediaIdOf('not a link'), null);
  });
});

describe('swapping a photo everywhere in a section', () => {
  it('replaces it in photo lists, nested answers, composed text and meta-free strings, keeping every other photo', () => {
    const section = {
      photos: [link(A), link(B)],
      answers: { parts: [{ startEndPhotos: [link(A), link(C)], footpaths_damages: [{ photos: [link(A)] }] }], note: 'unrelated' },
      reportText: `Intro.\n\nPHOTOS::${link(C)},${link(A)}\n\nEnd.`,
    };
    const out = swapMediaId(section, A, B);
    assert.deepEqual(out.photos, [link(B), link(B)]);
    assert.deepEqual(out.answers.parts[0]!.startEndPhotos, [link(B), link(C)]);
    assert.deepEqual(out.answers.parts[0]!.footpaths_damages[0]!.photos, [link(B)]);
    assert.equal(out.answers.note, 'unrelated');
    assert.ok(out.reportText.includes(`PHOTOS::${link(C)},${link(B)}`));
    assert.ok(!JSON.stringify(out).includes(A));
  });

  it('keeps a link\'s prefix and signature, changing only the id', () => {
    assert.equal(swapMediaId(`https://h/api/v1/media/${A}?sig=1`, A, B), `https://h/api/v1/media/${B}?sig=1`);
  });
});

describe('removing a photo everywhere in a section', () => {
  it('takes it out of photo lists and answers, leaving the others in order', () => {
    const out = removeMediaId({ photos: [link(A), link(B), link(C)], answers: { rooms: { kitchen: { photos: [link(B), link(A)] } } } }, B);
    assert.deepEqual(out.photos, [link(A), link(C)]);
    assert.deepEqual(out.answers.rooms.kitchen.photos, [link(A)]);
  });

  it('leaves no stray comma or empty marker in composed report text', () => {
    assert.equal(removeMediaId(`Text.\n\nPHOTOS::${link(A)},${link(B)}\n\nMore.`, A), `Text.\n\nPHOTOS::${link(B)}\n\nMore.`);
    assert.equal(removeMediaId(`PHOTOS::${link(A)},${link(B)},${link(C)}`, B), `PHOTOS::${link(A)},${link(C)}`);
    assert.equal(removeMediaId(`Text.\n\nPHOTOS::${link(A)}\n\nMore.`, A), `Text.\n\nMore.`);
  });
});

async function picture(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().toBuffer();
}

describe('rotating and cropping the picture', () => {
  it('turns a landscape photo upright with a quarter turn', async () => {
    const out = await applyPhotoEdit(await picture(400, 300), { rotate: 90 });
    assert.deepEqual([out.width, out.height], [300, 400]);
  });

  it('keeps the size for a half turn and for no turn', async () => {
    assert.deepEqual(Object.values(await applyPhotoEdit(await picture(400, 300), { rotate: 180 })).slice(1), [400, 300]);
    assert.deepEqual(Object.values(await applyPhotoEdit(await picture(400, 300), { rotate: 0 })).slice(1), [400, 300]);
  });

  it('crops a box of the rotated photo, as fractions of it', async () => {
    const out = await applyPhotoEdit(await picture(400, 300), { rotate: 90, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    assert.deepEqual([out.width, out.height], [150, 200]); // rotated to 300 x 400, then half of each side
  });

  it('never makes a photo smaller than a thumbnail or reaches outside it', async () => {
    const out = await applyPhotoEdit(await picture(400, 300), { rotate: 0, crop: { x: 0.95, y: 0.95, w: 0.5, h: 0.5 } });
    assert.ok(out.width >= 32 && out.height >= 32 && out.width <= 400 && out.height <= 300);
  });

  it('produces a JPEG', async () => {
    const out = await applyPhotoEdit(await picture(100, 80), { rotate: 270 });
    assert.equal((await sharp(out.bytes).metadata()).format, 'jpeg');
  });
});

/** A noisy, detailed picture (hard to compress), like a real photo of brickwork. */
async function noisy(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

describe('bringing a photo to 1024 x 768 and under 200 KB', () => {
  it('fits a big landscape photo inside the box and under the size limit', async () => {
    const out = await optimizePhoto(await noisy(4032, 3024));
    assert.deepEqual([out.width, out.height], [1024, 768]);
    assert.ok(out.bytes.length <= OPTIMIZE_MAX_BYTES, `${out.bytes.length} bytes`);
  });

  it('keeps a portrait photo shape: it fits the 768 height, so 576 x 768', async () => {
    const out = await optimizePhoto(await noisy(3024, 4032));
    assert.deepEqual([out.width, out.height], [576, 768]);
    assert.ok(out.bytes.length <= OPTIMIZE_MAX_BYTES);
  });

  it('never enlarges a small photo', async () => {
    const out = await optimizePhoto(await picture(400, 300));
    assert.deepEqual([out.width, out.height], [400, 300]);
  });

  it('uses the highest quality that fits: a simple picture keeps quality 92', async () => {
    const out = await optimizePhoto(await picture(2000, 1500));
    assert.equal(out.quality, 92);
  });

  it('steps the quality down only as far as it must for a detailed picture', async () => {
    const out = await optimizePhoto(await noisy(1024, 768));
    assert.ok(out.quality < 92 && out.quality >= 50, `quality ${out.quality}`);
    assert.ok(out.bytes.length <= OPTIMIZE_MAX_BYTES);
  });

  it('knows which copies still need it', () => {
    assert.equal(needsOptimizing(150_000, 1024, 768), false);
    assert.equal(needsOptimizing(250_000, 800, 600), true);
    assert.equal(needsOptimizing(100_000, 1366, 768), true);
    assert.equal(needsOptimizing(100_000, 768, 1024), true);
  });
});
