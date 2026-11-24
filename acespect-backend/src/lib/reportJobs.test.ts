import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ApiError } from '../utils/ApiError';
import { FILE_TTL_MS, clearReportJobs, getReportJob, jobStatus, startReportJob, sweepReportJobs, writeTestFile, type MakeReport } from './reportJobs';

afterEach(() => clearReportJobs());

const settle = () => new Promise((r) => setTimeout(r, 10));
/** A report that waits until `finish` is called, telling each stage first. */
function controllable() {
  let finish!: (b: Buffer) => void, fail!: (e: unknown) => void;
  let tell!: Parameters<MakeReport>[0];
  const make: MakeReport = (onStage) => {
    tell = onStage;
    return new Promise<Buffer>((res, rej) => { finish = res; fail = rej; });
  };
  return { make, finish: (b: Buffer) => finish(b), fail: (e: unknown) => fail(e), stage: (...a: Parameters<Parameters<MakeReport>[0]>) => tell(...a) };
}

const INSP = '11111111-1111-4111-8111-111111111111';
const input = (make: MakeReport, format: 'pdf' | 'docx' = 'pdf') => ({ inspectionId: INSP, format, userId: 'u1', fileName: `V1-construction-report.${format}`, meta: { kind: 'construction' }, make });

test('a report is made in the background: waiting → stages → done, then the file is there to download', async () => {
  const c = controllable();
  const { job, joined } = startReportJob(input(c.make));
  assert.equal(joined, false);
  assert.equal(jobStatus(job).state, 'opening', 'a new job is opening the report until it is known to be queued');
  c.stage('waiting');
  assert.equal(jobStatus(job).state, 'waiting');
  const photos = { failed: [], missing: [], pending: () => 3, stats: () => ({ requested: 10, loaded: 7, firstAt: 1, lastAt: 2 }) };
  c.stage('opening', photos);
  assert.equal(jobStatus(job).state, 'opening');
  assert.deepEqual(jobStatus(job).photos, { requested: 10, loaded: 7 });
  c.stage('printing');
  assert.equal(jobStatus(job).state, 'printing');
  c.finish(Buffer.from('%PDF-1.7 test'));
  await settle();
  const done = getReportJob(INSP, job.id)!;
  assert.equal(done.state, 'done');
  assert.equal(done.bytes, 13);
  assert.match(done.sha256!, /^[0-9a-f]{64}$/);
  assert.equal(readFileSync(done.path!, 'utf8'), '%PDF-1.7 test');
  assert.equal(jobStatus(done).fileName, 'V1-construction-report.pdf');
});

test('the same report asked for again while it is being made joins that job; a finished one is not reused', async () => {
  const c = controllable();
  const first = startReportJob(input(c.make));
  const again = startReportJob(input(controllable().make));
  assert.equal(again.joined, true);
  assert.equal(again.job.id, first.job.id);
  // A Word file of the same inspection is its own job.
  assert.equal(startReportJob(input(controllable().make, 'docx')).joined, false);
  c.finish(Buffer.from('x'));
  await settle();
  const later = startReportJob(input(controllable().make));
  assert.equal(later.joined, false);
  assert.notEqual(later.job.id, first.job.id);
});

test('a failed report keeps its plain message and code for the web app', async () => {
  const c = controllable();
  const { job } = startReportJob(input(c.make));
  c.fail(new ApiError(502, '1 photograph could not be loaded (the server answered 500), so the report was not made.', 'REPORT_PHOTOS_FAILED'));
  await settle();
  assert.equal(job.state, 'failed');
  assert.deepEqual(jobStatus(job).error, { message: '1 photograph could not be loaded (the server answered 500), so the report was not made.', code: 'REPORT_PHOTOS_FAILED' });
  assert.equal(job.error!.status, 502);
  // An unexpected error still gives a message (and never a stack).
  const d = controllable();
  const other = startReportJob(input(d.make));
  d.fail(new Error('Target closed\n    at Page.pdf'));
  await settle();
  assert.equal(other.job.error!.code, 'REPORT_FAILED');
  assert.equal(other.job.error!.message, 'The report could not be made. Reason: Target closed');
});

test('a job is only found under its own inspection', () => {
  const { job } = startReportJob(input(controllable().make));
  assert.ok(getReportJob(INSP, job.id));
  assert.equal(getReportJob('22222222-2222-4222-8222-222222222222', job.id), undefined);
  assert.equal(getReportJob(INSP, 'nope'), undefined);
});

test('finished files are removed after their time, with files an earlier server run left behind', async () => {
  const c = controllable();
  const { job } = startReportJob(input(c.make));
  c.finish(Buffer.from('x'));
  await settle();
  const path = job.path!;
  const leftover = writeTestFile('old-run.pdf', Date.now() - FILE_TTL_MS - 60_000);
  sweepReportJobs(Date.now());
  assert.ok(existsSync(path), 'a fresh file is kept');
  assert.ok(!existsSync(leftover), 'an old leftover is removed');
  sweepReportJobs(Date.now() + FILE_TTL_MS + 1000);
  assert.ok(!existsSync(path));
  assert.equal(getReportJob(INSP, job.id), undefined);
});
