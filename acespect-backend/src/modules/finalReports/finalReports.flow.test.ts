/**
 * Final Report Versions and the report lock, end to end through the real app (routes, sign-in, roles, Prisma, audit trail) against a real
 * PostgreSQL database. Skipped unless TEST_DATABASE_URL points at a scratch database that has had `prisma migrate deploy` run on it. Files
 * go to the local temp folder (Azure storage is left unset). It creates its own users and inspection, tagged by a unique suffix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import JSZip from 'jszip';

const url = process.env.TEST_DATABASE_URL;
const MESSAGE = 'A final report has been uploaded for this inspection. Download it from Final Report Versions.';

async function docx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('final versions lock the generated report for every role until all are deleted', { skip: url ? false : 'set TEST_DATABASE_URL to run' }, async () => {
  if (!/^postgres(ql)?:\/\/([^@/]*@)?(localhost|127\.0\.0\.1)[:/]/.test(url!)) throw new Error('TEST_DATABASE_URL must be a local database');
  process.env.DATABASE_URL = url;
  process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
  process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
  process.env.AZURE_STORAGE_ACCOUNT_NAME = '';
  process.env.AZURE_STORAGE_CONNECTION_STRING = '';
  const { prisma } = await import('../../lib/prisma');
  const { createApp } = await import('../../app');
  const { signAccessToken } = await import('../../utils/jwt');

  const tag = `fv${Date.now()}`;
  const roles = ['ADMIN', 'REVIEWER', 'INSPECTOR', 'CLIENT', 'FIELD_USER'] as const;
  const users = Object.fromEntries(await Promise.all(roles.map(async (role) => [role, await prisma.user.create({ data: { email: `${tag}-${role.toLowerCase()}@example.test`, name: `${tag} ${role}`, role, passwordHash: 'x' } })])));
  const inspection = await prisma.inspection.create({ data: { inspectorId: users.INSPECTOR.id, reviewerId: users.REVIEWER.id, inspectionType: 'Dilapidation', propertyType: 'Residential House', jobNo: `vic ${tag}`, status: 'IN_REVIEW' } });
  const id = inspection.id;
  const token = (role: (typeof roles)[number]) => signAccessToken({ sub: users[role].id, role, tv: 0 }, 15);

  const server: Server = await new Promise((resolve) => { const s = createApp().listen(0, () => resolve(s)); });
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/inspections/${id}`;
  const call = (role: (typeof roles)[number], method: string, path: string, body?: string | FormData) =>
    fetch(api + path, { method, body, headers: { Authorization: `Bearer ${token(role)}`, ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}) } });
  const upload = async (role: (typeof roles)[number], name: string, fields: Record<string, string> = {}) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(await docx(name))]), name);
    return call(role, 'POST', '/final-versions', form);
  };
  const reportRoutes: [string, string, string?][] = [['GET', '/report.pdf'], ['GET', '/report.docx'], ['POST', '/report-jobs', JSON.stringify({ format: 'docx' })], ['GET', '/report-jobs/22222222-2222-4333-8444-555555555555/file']];
  const events = async () => (await prisma.auditEvent.findMany({ where: { inspectionId: id, action: { startsWith: 'report.' } }, orderBy: { seq: 'asc' }, select: { action: true } })).map((e) => e.action);

  try {
    assert.equal(((await (await call('INSPECTOR', 'GET', '/report-lock')).json()) as { locked: boolean }).locked, false);

    // First upload: Version 1, stored under the cleaned job number folder; the inspection becomes locked.
    const v1 = await upload('ADMIN', 'v1.docx');
    assert.equal(v1.status, 201);
    const v1Id = ((await v1.json()) as { version: { id: string; versionNumber: number } }).version.id;
    const row1 = await prisma.reportFinalVersion.findUniqueOrThrow({ where: { id: v1Id } });
    assert.equal(row1.blobPath, `final-reports/VIC-${tag.toUpperCase()}/Pre-Dilapidation-v1-${v1Id}.docx`);

    for (const role of roles) {
      assert.equal(((await (await call(role === 'CLIENT' || role === 'FIELD_USER' ? 'ADMIN' : role, 'GET', '/report-lock')).json()) as { locked: boolean }).locked, true);
      for (const [method, path, body] of reportRoutes) {
        const res = await call(role, method, path, body);
        assert.equal(res.status, 423, `${role} ${method} ${path}`);
        assert.equal(((await res.json()) as { error: { message: string } }).error.message, MESSAGE);
      }
    }

    // Yes -> v2; No -> replaces v2; REVIEWER cannot delete; ADMIN deletes v2 (v1 is Current final again) and then v1 (unlocked).
    const v2 = ((await (await upload('REVIEWER', 'v2.docx', { mode: 'new', basedOn: '1' })).json()) as { version: { id: string; versionNumber: number } }).version;
    assert.equal(v2.versionNumber, 2);
    const v2b = ((await (await upload('ADMIN', 'v2b.docx', { mode: 'replace', basedOn: '2' })).json()) as { version: { id: string; versionNumber: number } }).version;
    assert.equal(v2b.versionNumber, 2);
    assert.ok((await prisma.reportFinalVersion.findUniqueOrThrow({ where: { id: v2.id } })).replacedAt, 'replaced row kept, marked');
    assert.equal((await call('REVIEWER', 'DELETE', `/final-versions/${v2b.id}`)).status, 403);
    assert.equal((await call('ADMIN', 'DELETE', `/final-versions/${v2b.id}`)).status, 200);
    const afterOne = (await (await call('REVIEWER', 'GET', '/final-versions')).json()) as { locked: boolean; versions: { versionNumber: number; current: boolean }[] };
    assert.deepEqual(afterOne.versions.map((v) => [v.versionNumber, v.current]), [[1, true]]);
    assert.equal(afterOne.locked, true);
    assert.equal((await call('ADMIN', 'GET', '/report.docx')).status, 423, 'still locked with one version left');

    assert.equal((await call('ADMIN', 'DELETE', `/final-versions/${v1Id}`)).status, 200);
    assert.equal(((await (await call('INSPECTOR', 'GET', '/report-lock')).json()) as { locked: boolean }).locked, false);
    const kept = await prisma.reportFinalVersion.findMany({ where: { inspectionId: id } });
    assert.equal(kept.length, 3, 'nothing is ever removed from the database');
    assert.ok(kept.filter((r) => r.id !== v2.id).every((r) => r.deletedAt && r.deletedById === users.ADMIN.id));

    // Unlocked: the routes pass the lock again (a bad format is refused by the handler itself, an unknown job is not found -- not 423).
    for (const role of ['ADMIN', 'REVIEWER', 'INSPECTOR'] as const) {
      assert.equal((await call(role, 'POST', '/report-jobs', JSON.stringify({ format: 'none' }))).status, 400, `${role} report-jobs reaches the handler`);
      assert.equal((await call(role, 'GET', '/report-jobs/22222222-2222-4333-8444-555555555555/file')).status, 404, `${role} job file reaches the handler`);
    }

    // The next upload is Version 3 (numbers are never reused) and locks again.
    const v3 = ((await (await upload('ADMIN', 'v3.docx')).json()) as { version: { versionNumber: number } }).version;
    assert.equal(v3.versionNumber, 3);

    assert.deepEqual(await events(), [
      'report.final_version.upload', 'report.locked',
      'report.final_version.upload', 'report.final_version.replace',
      'report.final_version.delete', 'report.final_version.delete', 'report.unlocked',
      'report.final_version.upload', 'report.locked',
    ]);
  } finally {
    server.close();
    await prisma.reportFinalVersion.deleteMany({ where: { inspectionId: id } });
    await prisma.inspection.delete({ where: { id } });
    await prisma.user.deleteMany({ where: { email: { startsWith: `${tag}-` } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
