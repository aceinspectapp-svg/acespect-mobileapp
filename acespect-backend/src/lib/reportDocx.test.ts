import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import express from 'express';
import type { AddressInfo } from 'node:net';

process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);

const MISSING_ID = 'aaaaaaaa-2222-4333-8444-555555555555';
const OK_ID = 'bbbbbbbb-2222-4333-8444-555555555555';
const REFUSED_ID = 'cccccccc-2222-4333-8444-555555555555';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** word/document.xml out of a .docx (a zip), without a zip library. */
function documentXml(docx: Buffer): string {
  for (let i = 0; i < docx.length - 30; i++) {
    if (docx.readUInt32LE(i) !== 0x04034b50) continue;
    const method = docx.readUInt16LE(i + 8), size = docx.readUInt32LE(i + 18), nameLen = docx.readUInt16LE(i + 26), extra = docx.readUInt16LE(i + 28);
    const name = docx.toString('utf8', i + 30, i + 30 + nameLen);
    const start = i + 30 + nameLen + extra;
    if (name === 'word/document.xml') { const raw = docx.subarray(start, start + size); return (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'); }
  }
  throw new Error('no word/document.xml');
}

async function server() {
  const app = express();
  app.get('/api/v1/media/:id', (req, res) => {
    if (req.params.id === MISSING_ID) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
    if (req.params.id === REFUSED_ID) return res.status(403).end();
    res.type('image/png').send(PNG);
  });
  const s = await new Promise<import('node:http').Server>((resolve) => { const x = app.listen(0, () => resolve(x)); });
  return { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/v1/media`, close: () => s.close() };
}

test('Word: a missing (404) photograph prints "Photograph unavailable" in its place, as the PDF does, and the warning names the photo and the inspection', async (t) => {
  const { __forTests } = await import('./reportDocx');
  const s = await server();
  const warnings: string[] = [];
  t.mock.method(console, 'warn', (m: string) => { warnings.push(String(m)); });
  try {
    const blocks = [
      { k: 'img', src: `${s.base}/${OK_ID}?e=1&s=x`, w: 200, h: 150 },
      { k: 'img', src: `${s.base}/${MISSING_ID}?e=1&s=x`, w: 200, h: 150 },
    ];
    const pictures = await __forTests.loadPictures(blocks, 'token', 'insp-42');
    assert.deepEqual(warnings, [`[report] photograph ${MISSING_ID} is missing (404) in inspection insp-42; it prints as "Photograph unavailable".`]);
    const xml = documentXml(await __forTests.write(blocks, pictures));
    assert.equal((xml.match(/Photograph unavailable/g) ?? []).length, 1);
    assert.equal((xml.match(/<pic:pic\b/g) ?? []).length, 1, 'the photo that is there is still printed');
    assert.ok(!xml.includes('photograph not available'));
    // The box has the photo's size (200 x 150 px -> 3000 x 2250 twips) and the PDF's colours.
    assert.match(xml, /w:w="3000"/);
    assert.match(xml, /w:val="2250" w:hRule="exact"|w:hRule="exact" w:val="2250"/);
    assert.match(xml, /w:fill="FBF3E3"/);
  } finally { s.close(); }
});

test('Word: a refused photograph link (403) still stops the Word file', async (t) => {
  const { __forTests } = await import('./reportDocx');
  const s = await server();
  t.mock.method(console, 'warn', () => undefined);
  try {
    await assert.rejects(
      __forTests.loadPictures([{ k: 'img', src: `${s.base}/${REFUSED_ID}?e=1&s=x`, w: 10, h: 10 }], 'token', 'insp-42'),
      (e: unknown) => (e as { code?: string }).code === 'REPORT_PHOTOS_FAILED' && String((e as Error).message).includes(REFUSED_ID),
    );
  } finally { s.close(); }
});
