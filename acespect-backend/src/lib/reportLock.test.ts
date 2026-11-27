import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);

const ID = '11111111-2222-4333-8444-555555555555';
const ROLES = ['ADMIN', 'REVIEWER', 'INSPECTOR', 'CLIENT', 'FIELD_USER'];
const MESSAGE = 'A final report has been uploaded for this inspection. Download it from Final Report Versions.';

/** The four report routes, guarded exactly as inspections.routes.ts guards them, with the report itself replaced by a stub. */
async function start(listed: () => number) {
  const express = (await import('express')).default;
  const { reportLock, requireReportUnlocked } = await import('./reportLock');
  reportLock.countListed = async () => listed();
  const fakeAuth: RequestHandler = (req, _res, next) => { req.user = { id: 'u', role: String(req.headers['x-test-role']) }; next(); };
  const made: RequestHandler = (_req, res) => { res.status(200).send('report'); };
  const app = express();
  app.get('/inspections/:id/report.pdf', fakeAuth, requireReportUnlocked, made);
  app.get('/inspections/:id/report.docx', fakeAuth, requireReportUnlocked, made);
  app.post('/inspections/:id/report-jobs', fakeAuth, requireReportUnlocked, made);
  app.get('/inspections/:id/report-jobs/:jobId/file', fakeAuth, requireReportUnlocked, made);
  app.use((err: { statusCode?: number; code?: string; message: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({ error: { message: err.message, code: err.code } });
  });
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/inspections/${ID}`;
  const routes: [string, string][] = [['GET', '/report.pdf'], ['GET', '/report.docx'], ['POST', '/report-jobs'], ['GET', '/report-jobs/22222222-2222-4333-8444-555555555555/file']];
  return { base, routes, close: () => server.close() };
}

test('the four report routes are guarded by the lock in the real inspections router (after sign-in, before the handler)', async () => {
  const { inspectionsRouter } = await import('../modules/inspections/inspections.routes');
  const { requireReportUnlocked } = await import('./reportLock');
  const { requireAuth } = await import('../middleware/auth');
  type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] } };
  const stack = (inspectionsRouter as unknown as { stack: Layer[] }).stack;
  for (const [method, path] of [['get', '/:id/report.pdf'], ['get', '/:id/report.docx'], ['post', '/:id/report-jobs'], ['get', '/:id/report-jobs/:jobId/file']] as const) {
    const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
    assert.ok(layer, `${method} ${path} exists`);
    const handles = layer!.route!.stack.map((h) => h.handle);
    assert.equal(handles[0], requireAuth, `${path}: sign-in first`);
    assert.equal(handles[1], requireReportUnlocked, `${path}: then the lock`);
    assert.equal(handles.length, 3, `${path}: then the report handler`);
  }
  // The job's progress (not the file) and every other route stay as they were.
  const progress = stack.find((l) => l.route?.path === '/:id/report-jobs/:jobId' && l.route.methods.get)!;
  assert.ok(!progress.route!.stack.some((h) => h.handle === requireReportUnlocked));
});

test('while a final version exists, every role gets 423 with the lock message on all four routes', async () => {
  const s = await start(() => 1);
  try {
    for (const role of ROLES) {
      for (const [method, path] of s.routes) {
        const res = await fetch(s.base + path, { method, headers: { 'x-test-role': role } });
        assert.equal(res.status, 423, `${role} ${method} ${path}`);
        const body = (await res.json()) as { error: { message: string; code: string } };
        assert.equal(body.error.message, MESSAGE);
        assert.equal(body.error.code, 'REPORT_LOCKED');
      }
    }
  } finally { s.close(); }
});

test('with no version (or every version deleted) the routes work again', async () => {
  const s = await start(() => 0);
  try {
    for (const role of ROLES) {
      for (const [method, path] of s.routes) {
        const res = await fetch(s.base + path, { method, headers: { 'x-test-role': role } });
        assert.equal(res.status, 200, `${role} ${method} ${path}`);
        assert.equal(await res.text(), 'report');
      }
    }
  } finally { s.close(); }
});

test('the headless report printer is refused while the inspection is locked (before any browser is opened)', async () => {
  const { reportLock } = await import('./reportLock');
  const { withReportPage } = await import('./reportPdf');
  reportLock.countListed = async () => 1;
  let used = false;
  await assert.rejects(
    withReportPage(ID, 'token', async () => { used = true; return 'x'; }),
    (err: { statusCode?: number; code?: string; message?: string }) => err.statusCode === 423 && err.code === 'REPORT_LOCKED' && err.message === MESSAGE,
  );
  assert.equal(used, false, 'the report page was never opened');
});

test('the lock counts listed versions only: replaced and deleted rows do not lock', async () => {
  const src = (await import('node:fs')).readFileSync(require.resolve('./reportLock'), 'utf8');
  assert.match(src, /count\(\{ where: \{ inspectionId, replacedAt: null, deletedAt: null \} \}\)/);
});
