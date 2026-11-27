import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
import type { NextFunction, Request, Response } from 'express';
import JSZip from 'jszip';

process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);

const INSPECTION = '11111111-2222-4333-8444-555555555555';
const USERS: Record<string, { id: string; name: string; email: string }> = {
  ADMIN: { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Ada Admin', email: 'ada@example.test' },
  REVIEWER: { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Rex Reviewer', email: 'rex@example.test' },
  INSPECTOR: { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Ian Inspector', email: 'ian@example.test' },
  CLIENT: { id: 'aaaaaaaa-0000-4000-8000-000000000004', name: 'Cleo Client', email: 'cleo@example.test' },
  FIELD_USER: { id: 'aaaaaaaa-0000-4000-8000-000000000005', name: 'Fay Field', email: 'fay@example.test' },
};

/** A minimal but real Word .docx package. */
async function docx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

interface Row {
  id: string; inspectionId: string; versionNumber: number; blobPath: string; fileName: string; sizeBytes: number; contentType: string; note: string | null;
  uploadedById: string; uploadedAt: Date; replacedAt: Date | null; replacedById: string | null; replacedByUploadId: string | null;
}

/** The real router and rules, with the database, storage, audit trail and sign-in replaced by in-memory fakes. */
async function start() {
  const express = (await import('express')).default;
  const { makeFinalReportsRouter } = await import('./finalReports.routes');
  const { planUpload, samePlan } = await import('./finalReports.rules');
  const { ApiError } = await import('../../utils/ApiError');
  const rows: Row[] = [];
  const blobs = new Map<string, Buffer>();
  const events: { action: string; inspectionId?: string | null; target?: { id?: string | null }; before?: unknown; after?: unknown; metadata?: unknown }[] = [];
  const view = (r: Row) => {
    const u = Object.values(USERS).find((x) => x.id === r.uploadedById)!;
    return { ...r, uploadedBy: { id: u.id, name: u.name, email: u.email } };
  };
  const current = (inspectionId: string) => rows.filter((r) => r.inspectionId === inspectionId && !r.replacedAt);
  const uploadDir = mkdtempSync(join(tmpdir(), 'final-reports-test-'));
  const router = makeFinalReportsRouter({
    uploadDir,
    requireAuth: (req, _res, next) => {
      const role = String(req.headers['x-test-role'] ?? '');
      if (!USERS[role]) return next(ApiError.unauthorized());
      req.user = { id: USERS[role].id, role };
      next();
    },
    audit: (async (e: (typeof events)[number]) => { events.push(e); return true; }) as never,
    store: {
      put: async (path, filePath) => { blobs.set(path, await readFile(filePath)); },
      get: async (path) => (blobs.has(path) ? { stream: Readable.from(blobs.get(path)!), length: blobs.get(path)!.length } : null),
      discard: async (path) => { blobs.delete(path); },
    },
    repo: {
      assertCanView: async (id) => { if (id !== INSPECTION) throw ApiError.notFound('Inspection not found'); return { jobNo: 'J-1' }; },
      listCurrent: async (id) => current(id).sort((a, b) => b.versionNumber - a.versionNumber).map(view),
      findVersion: async (id, vid) => { const r = current(id).find((x) => x.id === vid); return r ? view(r) : null; },
      commit: async ({ plan, mode, seenLatest, row }) => {
        if (!samePlan(plan, planUpload(current(row.inspectionId), mode, seenLatest))) throw new ApiError(409, 'changed', 'VERSIONS_CHANGED');
        let replaced: Row | null = null;
        if (plan.kind === 'replace') {
          replaced = rows.find((r) => r.id === plan.replaces.id)!;
          Object.assign(replaced, { replacedAt: new Date(), replacedById: row.uploadedById, replacedByUploadId: row.id });
        }
        const saved: Row = { ...row, versionNumber: plan.versionNumber, uploadedAt: new Date(), replacedAt: null, replacedById: null, replacedByUploadId: null };
        rows.push(saved);
        return { saved: view(saved), replaced: replaced ? view(replaced) : null };
      },
    },
  });
  const app = express();
  app.use('/api/v1/inspections/:id/final-versions', router);
  app.use((err: { statusCode?: number; code?: string; message: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ error: { message: err.message, code: err.code } });
  });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/inspections/${INSPECTION}/final-versions`;

  const send = async (role: string, file: { bytes: Buffer; name: string } | null, fields: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) form.append('file', new Blob([new Uint8Array(file.bytes)]), file.name);
    return fetch(base, { method: 'POST', body: form, headers: { 'x-test-role': role } });
  };
  const list = async (role = 'ADMIN') => fetch(base, { headers: { 'x-test-role': role } });
  return { base, rows, blobs, events, send, list, uploadDir, close: () => { server.close(); rmSync(uploadDir, { recursive: true, force: true }); } };
}

type ListBody = { latestVersion: number; versions: { id: string; versionNumber: number; fileName: string; current: boolean; note: string | null; uploadedBy: { name: string; email: string } }[] };

test('ADMIN and REVIEWER may list, upload and download', async () => {
  const s = await start();
  try {
    for (const role of ['ADMIN', 'REVIEWER']) assert.equal((await s.list(role)).status, 200, `${role} list`);
    const up = await s.send('REVIEWER', { bytes: await docx('one'), name: 'Report.docx' });
    assert.equal(up.status, 201);
    const { version } = (await up.json()) as { version: { id: string } };
    for (const role of ['ADMIN', 'REVIEWER']) {
      const res = await fetch(`${s.base}/${version.id}/file`, { headers: { 'x-test-role': role } });
      assert.equal(res.status, 200, `${role} download`);
      assert.match(res.headers.get('content-type') ?? '', /wordprocessingml\.document/);
      assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="Report\.docx"/);
      assert.match(res.headers.get('cache-control') ?? '', /no-store/);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), await docx('one'));
    }
  } finally { s.close(); }
});

test('INSPECTOR, CLIENT and FIELD_USER get 403 on list, upload and download, and nothing is stored or audited for them', async () => {
  const s = await start();
  try {
    const up = await s.send('ADMIN', { bytes: await docx('one'), name: 'a.docx' });
    const { version } = (await up.json()) as { version: { id: string } };
    const before = { rows: s.rows.length, blobs: s.blobs.size, events: s.events.length };
    for (const role of ['INSPECTOR', 'CLIENT', 'FIELD_USER']) {
      assert.equal((await s.list(role)).status, 403, `${role} list`);
      assert.equal((await s.send(role, { bytes: await docx('x'), name: 'x.docx' }, { mode: 'new', basedOn: '1' })).status, 403, `${role} upload`);
      assert.equal((await fetch(`${s.base}/${version.id}/file`, { headers: { 'x-test-role': role } })).status, 403, `${role} download`);
    }
    assert.deepEqual({ rows: s.rows.length, blobs: s.blobs.size, events: s.events.length }, before);
    assert.equal((await fetch(s.base)).status, 401, 'not signed in');
  } finally { s.close(); }
});

test('first upload is v1 without asking; "Yes" makes v2; "No" replaces v2, keeps the old file marked replaced and audits it', async () => {
  const s = await start();
  try {
    // First upload: no question -- saved as Version 1 even when no choice is sent.
    const first = await s.send('ADMIN', { bytes: await docx('v1'), name: 'v1.docx' }, { note: 'First edit' });
    assert.equal(first.status, 201);
    assert.equal(((await first.json()) as { version: { versionNumber: number } }).version.versionNumber, 1);

    // A later upload must say which: without a choice it is refused (the web app asks "Save as a new version?").
    const unanswered = await s.send('ADMIN', { bytes: await docx('v2'), name: 'v2.docx' }, { basedOn: '1' });
    assert.equal(unanswered.status, 409);
    assert.equal(((await unanswered.json()) as { error: { code: string } }).error.code, 'VERSION_CHOICE_REQUIRED');

    // Yes -> Version 2.
    const yes = await s.send('REVIEWER', { bytes: await docx('v2'), name: 'v2.docx' }, { mode: 'new', basedOn: '1', note: 'Second edit' });
    assert.equal(yes.status, 201);
    const v2 = ((await yes.json()) as { version: { id: string; versionNumber: number } }).version;
    assert.equal(v2.versionNumber, 2);
    const v1Row = { ...s.rows.find((r) => r.versionNumber === 1)! };

    // No -> replaces Version 2: same number, new uploader / date / file; the old row and file are kept, marked replaced.
    const no = await s.send('ADMIN', { bytes: await docx('v2b'), name: 'v2-fixed.docx' }, { mode: 'replace', basedOn: '2', note: 'Fixed typo' });
    assert.equal(no.status, 201);
    const body = (await no.json()) as { version: { id: string; versionNumber: number }; replacedId: string };
    assert.equal(body.version.versionNumber, 2);
    assert.equal(body.replacedId, v2.id);

    const old = s.rows.find((r) => r.id === v2.id)!;
    assert.ok(old.replacedAt, 'old v2 marked replaced');
    assert.equal(old.replacedById, USERS.ADMIN!.id);
    assert.equal(old.replacedByUploadId, body.version.id);
    assert.ok(s.blobs.has(old.blobPath), 'the replaced file is still in storage');
    assert.deepEqual(s.rows.find((r) => r.versionNumber === 1), v1Row, 'Version 1 untouched');
    assert.match(s.rows.find((r) => r.id === body.version.id)!.blobPath, new RegExp(`^final-reports/${INSPECTION}/v2-${body.version.id}\\.docx$`));

    const listed = (await (await s.list()).json()) as ListBody;
    assert.equal(listed.latestVersion, 2);
    assert.deepEqual(listed.versions.map((v) => [v.versionNumber, v.fileName, v.current]), [[2, 'v2-fixed.docx', true], [1, 'v1.docx', false]], 'newest first, replaced row hidden');
    assert.equal(listed.versions[0]!.note, 'Fixed typo');
    assert.deepEqual(listed.versions[0]!.uploadedBy, { id: USERS.ADMIN!.id, name: 'Ada Admin', email: 'ada@example.test' });
    assert.equal((await fetch(`${s.base}/${v2.id}/file`, { headers: { 'x-test-role': 'ADMIN' } })).status, 404, 'a replaced version is not offered');

    const replace = s.events.find((e) => e.action === 'report.final_version.replace')!;
    assert.ok(replace, 'the replacement is audited');
    assert.equal(replace.inspectionId, INSPECTION);
    assert.equal((replace.before as { id: string }).id, v2.id);
    assert.equal((replace.after as { id: string }).id, body.version.id);
  } finally { s.close(); }
});

test('a replace or new version based on an out-of-date list is refused, and its file is not kept', async () => {
  const s = await start();
  try {
    await s.send('ADMIN', { bytes: await docx('v1'), name: 'v1.docx' });
    await s.send('ADMIN', { bytes: await docx('v2'), name: 'v2.docx' }, { mode: 'new', basedOn: '1' });
    const blobs = s.blobs.size;
    const stale = await s.send('REVIEWER', { bytes: await docx('x'), name: 'x.docx' }, { mode: 'replace', basedOn: '1' });
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { error: { code: string } }).error.code, 'VERSIONS_CHANGED');
    assert.equal(s.blobs.size, blobs);
    assert.equal(s.rows.filter((r) => r.replacedAt).length, 0, 'nothing was replaced');
  } finally { s.close(); }
});

test('a non-.docx file and a file over 50 MB are rejected with a clear message', async () => {
  const s = await start();
  try {
    const cases: [string, { bytes: Buffer; name: string }, number][] = [
      ['a PDF', { bytes: Buffer.from('%PDF-1.7 not a word file'), name: 'report.pdf' }, 415],
      ['a PDF renamed .docx', { bytes: Buffer.from('%PDF-1.7 not a word file'), name: 'report.docx' }, 415],
      ['a zip that is not a Word document', { bytes: await (() => { const z = new JSZip(); z.file('a.txt', 'hi'); return z.generateAsync({ type: 'nodebuffer' }); })(), name: 'report.docx' }, 415],
      ['a real .docx named .doc', { bytes: await docx('x'), name: 'report.doc' }, 415],
    ];
    for (const [name, file, status] of cases) {
      const res = await s.send('ADMIN', file);
      assert.equal(res.status, status, name);
      assert.match(((await res.json()) as { error: { message: string } }).error.message, /Only Word \(\.docx\) files/, name);
    }
    const big = await s.send('ADMIN', { bytes: Buffer.alloc(50 * 1024 * 1024 + 1), name: 'big.docx' });
    assert.equal(big.status, 413);
    assert.match(((await big.json()) as { error: { message: string } }).error.message, /larger than 50 MB/);
    assert.equal(s.rows.length, 0);
    assert.equal(s.blobs.size, 0);
    assert.equal(s.events.length, 0);
  } finally { s.close(); }
});

test('each upload, replace and download writes one audit event', async () => {
  const s = await start();
  try {
    const a = (await (await s.send('ADMIN', { bytes: await docx('v1'), name: 'v1.docx' })).json()) as { version: { id: string } };
    await s.send('ADMIN', { bytes: await docx('v2'), name: 'v2.docx' }, { mode: 'new', basedOn: '1' });
    await s.send('REVIEWER', { bytes: await docx('v2b'), name: 'v2b.docx' }, { mode: 'replace', basedOn: '2' });
    await fetch(`${s.base}/${a.version.id}/file`, { headers: { 'x-test-role': 'REVIEWER' } }).then((r) => r.arrayBuffer());
    assert.deepEqual(s.events.map((e) => e.action), ['report.final_version.upload', 'report.final_version.upload', 'report.final_version.replace', 'report.final_version.download']);
    assert.ok(s.events.every((e) => e.inspectionId === INSPECTION));
    assert.equal(s.events[3]!.target?.id, a.version.id);
  } finally { s.close(); }
});

test('the temporary upload files are removed after every request', async () => {
  const s = await start();
  try {
    await s.send('ADMIN', { bytes: await docx('v1'), name: 'v1.docx' });
    await s.send('ADMIN', { bytes: Buffer.from('nope'), name: 'x.docx' });
    await s.send('ADMIN', { bytes: Buffer.alloc(50 * 1024 * 1024 + 1), name: 'big.docx' });
    assert.deepEqual(readdirSync(s.uploadDir), []);
  } finally { s.close(); }
});
