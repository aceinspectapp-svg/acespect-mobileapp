// Run with: npm test
// Large reports are made in the background: the web app asks for the file, shows "Preparing report…" with how far the server has got,
// and downloads the file when it is ready (src/web/reportJob.ts).
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { makeReportFile, progressText } = await server.ssrLoadModule("/src/web/reportJob.ts");

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A fake API: answers each request from `script` (path → list of answers, used in turn) and records what was asked. */
function fakeApi(script) {
  const asked = [];
  const request = async (path, init = {}) => {
    asked.push(`${init.method ?? "GET"} ${path}${init.body ? ` ${init.body}` : ""}`);
    const list = script[path];
    assert.ok(list && list.length, `unexpected request ${path}`);
    return list.length > 1 ? list.shift() : list[0].clone(); // the last answer repeats
  };
  return { request, asked };
}
const job = (state, extra = {}) => ({ job: { id: "j1", state, fileName: "V1-construction-report.pdf", elapsedSeconds: 1, ...extra } });
const noWait = { sleep: async () => undefined };

describe("a report made in the background", () => {
  it("asks for it, follows its progress and downloads the finished file", async () => {
    const { request, asked } = fakeApi({
      "/inspections/i1/report-jobs": [json(202, job("waiting"))],
      "/inspections/i1/report-jobs/j1": [
        json(200, job("opening", { photos: { requested: 250, loaded: 40 } })),
        json(200, job("opening", { photos: { requested: 250, loaded: 250 } })),
        json(200, job("printing", { photos: { requested: 250, loaded: 250 } })),
        json(200, job("done", { bytes: 4 })),
      ],
      "/inspections/i1/report-jobs/j1/file": [new Response("%PDF", { status: 200 })],
    });
    const seen = [];
    const blob = await makeReportFile("i1", "pdf", request, { ...noWait, onProgress: (j) => seen.push(progressText(j, "pdf")) });
    assert.equal(await blob.text(), "%PDF");
    assert.deepEqual(asked, [
      'POST /inspections/i1/report-jobs {"format":"pdf"}',
      "GET /inspections/i1/report-jobs/j1",
      "GET /inspections/i1/report-jobs/j1",
      "GET /inspections/i1/report-jobs/j1",
      "GET /inspections/i1/report-jobs/j1",
      "GET /inspections/i1/report-jobs/j1/file",
    ]);
    assert.deepEqual(seen, [
      "Preparing report…",
      "Preparing report… waiting for another report to finish first",
      "Preparing report… loading photographs (40 of 250)",
      "Preparing report… loading photographs (250 of 250)",
      "Preparing report… putting the PDF together",
      "The PDF is ready.",
    ]);
  });

  it("shows the server's own reason when the report could not be made", async () => {
    const { request } = fakeApi({
      "/inspections/i1/report-jobs": [json(202, job("waiting"))],
      "/inspections/i1/report-jobs/j1": [json(200, job("failed", { error: { message: "1 photograph could not be loaded (the server answered 500), so the report was not made.", code: "REPORT_PHOTOS_FAILED" } }))],
    });
    await assert.rejects(makeReportFile("i1", "docx", request, noWait), /^Error: Failed to generate Word document: 1 photograph could not be loaded/);
  });

  it("says so when the server no longer has the job (a restart)", async () => {
    const { request } = fakeApi({
      "/inspections/i1/report-jobs": [json(202, job("waiting"))],
      "/inspections/i1/report-jobs/j1": [json(404, { error: { message: "This report is no longer being prepared (the server may have restarted). Please ask for it again.", code: "REPORT_JOB_NOT_FOUND" } })],
    });
    await assert.rejects(makeReportFile("i1", "pdf", request, noWait), /no longer being prepared/);
  });

  it("an older server without background reports is asked for the file directly, as before", async () => {
    const { request, asked } = fakeApi({
      "/inspections/i1/report-jobs": [json(404, { error: { message: "Route not found: POST /api/v1/inspections/i1/report-jobs", code: "NOT_FOUND" } })],
      "/inspections/i1/report.pdf": [new Response("%PDF-old", { status: 200 })],
    });
    assert.equal(await (await makeReportFile("i1", "pdf", request, noWait)).text(), "%PDF-old");
    assert.deepEqual(asked.slice(1), ["GET /inspections/i1/report.pdf"]);
  });

  it("gives up after its time limit instead of waiting forever", async () => {
    const { request } = fakeApi({
      "/inspections/i1/report-jobs": [json(202, job("waiting"))],
      "/inspections/i1/report-jobs/j1": [json(200, job("opening"))],
    });
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      await assert.rejects(makeReportFile("i1", "pdf", request, { giveUpAfterMs: 60_000, sleep: async () => { now += 30_000; } }), /took longer than 1 minutes/);
    } finally {
      Date.now = realNow;
    }
  });
});

describe("the report page", () => {
  const view = readFileSync(resolve(webRoot, "src/web/pages/ReportView.tsx"), "utf8");
  const file = readFileSync(resolve(webRoot, "src/web/reportFile.ts"), "utf8");
  it("shows Preparing report… on both buttons and the progress beside them", () => {
    assert.match(view, /\{downloading \? "Preparing report…" : "Download PDF"\}/);
    assert.match(view, /\{downloading \? "Preparing report…" : "Download Word"\}/);
    assert.match(view, /data-report-progress=""/);
    assert.match(view, /openReportFile\(id, format, reportFileName\(\{ id, jobNo: inspection\?\.jobNo \}, prePurchase \? "pre-purchase" : !!construction, format\), setProgress\)/);
  });
  it("makes both files through the background job", () => {
    assert.match(file, /await makeReportFile\(id, format, request,/);
    assert.doesNotMatch(file, /\/report\.\$\{format\}/);
  });
});
