// Run with: npm test
// The report tab waits minutes for a large report (fix/report-job-polling): its login is renewed before every request (it outlasts a
// 15-minute login), a busy or unreachable server is asked again with a short back-off instead of failing at the first miss, a login that
// has ended says "Please sign in again", and the finished file is opened or saved from a button the person clicks.
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());

// A browser's localStorage, for api.ts.
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
const { makeReportFile, SignInAgainError, RETRY_WAITS_MS } = await server.ssrLoadModule("/src/web/reportJob.ts");
const { ensureSession, tokenExpiresInMs } = await server.ssrLoadModule("/src/web/api.ts");

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const job = (state) => ({ job: { id: "j1", state, fileName: "V1-construction-report.docx", elapsedSeconds: 1 } });
/** Answers each path from its list in turn (the last repeats); an answer that is a function is called (to throw like a failed fetch). */
function fakeApi(script) {
  const asked = [];
  const request = async (path, init = {}) => {
    asked.push(`${init.method ?? "GET"} ${path}`);
    const list = script[path];
    assert.ok(list && list.length, `unexpected request ${path}`);
    const next = list.length > 1 ? list.shift() : list[0];
    if (typeof next === "function") return next();
    return next.clone();
  };
  return { request, asked };
}
/** What the browser does when Azure's front end drops a request without our CORS headers: fetch rejects. */
const corsFailure = () => { throw new TypeError("Failed to fetch"); };
/** A fake clock: sleeping moves it on. */
function clock() {
  let t = 0;
  const waits = [];
  return { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, waits };
}
const done = (extra = {}) => ({
  "/inspections/i1/report-jobs": [json(202, job("opening"))],
  "/inspections/i1/report-jobs/j1": [json(200, job("done"))],
  "/inspections/i1/report-jobs/j1/file": [new Response("DOCX", { status: 200 })],
  ...extra,
});

describe("the login while a report is being made", () => {
  it("is checked before starting the job and before every request while it waits", async () => {
    const calls = [];
    const { request } = fakeApi(done({ "/inspections/i1/report-jobs/j1": [json(200, job("opening")), json(200, job("printing")), json(200, job("done"))] }));
    const c = clock();
    await makeReportFile("i1", "docx", request, { ...c, session: async (force) => { calls.push(force ? "force" : "check"); return "ok"; } });
    assert.deepEqual(calls, ["check", "check", "check", "check", "check"], "start, three status checks and the download, each checked first");
  });

  it("expired between the check and the request (401 TOKEN_EXPIRED): renewed and asked again, and the report still arrives", async () => {
    const calls = [];
    const { request, asked } = fakeApi(done({
      "/inspections/i1/report-jobs/j1": [json(401, { error: { code: "TOKEN_EXPIRED", message: "Access token expired" } }), json(200, job("done"))],
    }));
    const blob = await makeReportFile("i1", "docx", request, { ...clock(), session: async (force) => { calls.push(force ? "force" : "check"); return "ok"; } });
    assert.equal(await blob.text(), "DOCX");
    assert.ok(calls.includes("force"), "the login was renewed after the 401");
    assert.deepEqual(asked.filter((a) => a.endsWith("/j1")), ["GET /inspections/i1/report-jobs/j1", "GET /inspections/i1/report-jobs/j1"]);
  });

  it("cannot be renewed (the server refuses): Please sign in again, before the job is even asked for", async () => {
    const { request, asked } = fakeApi(done());
    await assert.rejects(makeReportFile("i1", "docx", request, { ...clock(), session: async () => "signed-out" }), (e) => e instanceof SignInAgainError && /^Please sign in again/.test(e.message));
    assert.deepEqual(asked, []);
  });

  it("renewed but still refused (401 again), or ended for good (SESSION_IDLE): Please sign in again", async () => {
    const twice = fakeApi(done({ "/inspections/i1/report-jobs/j1": [json(401, { error: { code: "TOKEN_EXPIRED" } })] }));
    await assert.rejects(makeReportFile("i1", "docx", twice.request, { ...clock(), session: async () => "ok" }), SignInAgainError);
    const idle = fakeApi(done({ "/inspections/i1/report-jobs": [json(401, { error: { code: "SESSION_IDLE" } })] }));
    await assert.rejects(makeReportFile("i1", "docx", idle.request, { ...clock(), session: async () => "ok" }), SignInAgainError);
  });

  it("renewal gets no answer (server busy): waited out like any other miss, then carries on", async () => {
    const answers = ["unavailable", "unavailable", "ok"];
    const { request } = fakeApi(done());
    const c = clock();
    const blob = await makeReportFile("i1", "docx", request, { ...c, session: async () => answers.shift() ?? "ok" });
    assert.equal(await blob.text(), "DOCX");
    assert.deepEqual(c.waits.slice(0, 2), [RETRY_WAITS_MS[0], RETRY_WAITS_MS[1]]);
  });
});

describe("a busy or unreachable server while polling", () => {
  it("a status check blocked by CORS / no answer, then 502, 503 and 500: asked again after 2, 4, 8 and 15 s, and the file arrives", async () => {
    const { request } = fakeApi(done({
      "/inspections/i1/report-jobs/j1": [corsFailure, json(502, {}), json(503, {}), json(500, { error: { message: "busy" } }), json(200, job("done"))],
    }));
    const c = clock();
    const retries = [];
    const blob = await makeReportFile("i1", "docx", request, { ...c, pollMs: 2500, onRetry: (r) => retries.push(r.reason) });
    assert.equal(await blob.text(), "DOCX");
    assert.deepEqual(c.waits, [2500, 2000, 4000, 8000, 15000], "one poll interval, then the back-off");
    assert.deepEqual(retries, ["no answer from the server", "the server is busy (HTTP 502)", "the server is busy (HTTP 503)", "the server is busy (HTTP 500)"]);
  });

  it("starting the job and downloading the file are asked again the same way (the server joins the job already being made)", async () => {
    const { request, asked } = fakeApi(done({
      "/inspections/i1/report-jobs": [corsFailure, json(504, {}), json(202, job("opening"))],
      "/inspections/i1/report-jobs/j1/file": [json(503, {}), new Response("DOCX", { status: 200 })],
    }));
    assert.equal(await (await makeReportFile("i1", "docx", request, clock())).text(), "DOCX");
    assert.equal(asked.filter((a) => a === "POST /inspections/i1/report-jobs").length, 3);
    assert.equal(asked.filter((a) => a.endsWith("/file")).length, 2);
  });

  it("a 429 waits as long as the server says (Retry-After)", async () => {
    const { request } = fakeApi(done({ "/inspections/i1/report-jobs/j1": [json(429, { error: { code: "RATE_LIMITED" } }, { "Retry-After": "7" }), json(200, job("done"))] }));
    const c = clock();
    await makeReportFile("i1", "docx", request, { ...c, pollMs: 2500 });
    assert.deepEqual(c.waits, [2500, 7000]);
  });

  it("gives up after a few minutes of no answer, and says the server may be busy", async () => {
    const { request } = fakeApi(done({ "/inspections/i1/report-jobs/j1": [corsFailure] }));
    const c = clock();
    await assert.rejects(makeReportFile("i1", "docx", request, { ...c, retryForMs: 4 * 60_000 }), /no answer from the server, and it still had not answered after 4 minutes of trying\. The server may be busy/);
    const retrying = c.waits.slice(1).reduce((a, b) => a + b, 0);
    assert.ok(retrying >= 4 * 60_000 - 15_000 && retrying <= 4 * 60_000 + 15_000, `kept trying for about 4 minutes (${retrying} ms)`);
  });

  it("a real refusal (403, 404 from our server) is not asked again: its own message is shown", async () => {
    const forbidden = fakeApi(done({ "/inspections/i1/report-jobs": [json(403, { error: { message: "You do not have access to this resource" } })] }));
    await assert.rejects(makeReportFile("i1", "docx", forbidden.request, clock()), /Failed to generate Word document: You do not have access to this resource/);
    assert.equal(forbidden.asked.length, 1);
    const gone = fakeApi(done({ "/inspections/i1/report-jobs/j1": [json(404, { error: { message: "This report is no longer being prepared (the server may have restarted). Please ask for it again." } })] }));
    await assert.rejects(makeReportFile("i1", "docx", gone.request, clock()), /no longer being prepared/);
  });
});

describe("api.ts: the login's own expiry", () => {
  const tokenFor = (expSeconds) => `h.${Buffer.from(JSON.stringify({ sub: "u1", exp: expSeconds })).toString("base64url")}.s`;
  // A renewal that just finished is shared with callers for one tick; each test starts after that.
  beforeEach(async () => { store.clear(); await new Promise((r) => setTimeout(r, 5)); });

  it("reads how long a login has left", () => {
    assert.equal(tokenExpiresInMs(tokenFor(1000), 400_000), 600_000);
    assert.equal(tokenExpiresInMs(tokenFor(1000), 2_000_000), 0);
    assert.equal(tokenExpiresInMs("not-a-token"), 0);
    assert.equal(tokenExpiresInMs(null), 0);
  });

  it("a login with plenty of time left is used as it is; one about to expire is renewed first", async () => {
    const realFetch = globalThis.fetch;
    const renewals = [];
    globalThis.fetch = async (url, init) => {
      renewals.push(String(url));
      return json(200, { accessToken: tokenFor(Math.floor(Date.now() / 1000) + 900), refreshToken: "r2" });
    };
    try {
      store.set("acespect_refresh", "r1");
      store.set("acespect_token", tokenFor(Math.floor(Date.now() / 1000) + 600));
      assert.equal(await ensureSession(), "ok");
      assert.equal(renewals.length, 0, "10 minutes left: not renewed");
      store.set("acespect_token", tokenFor(Math.floor(Date.now() / 1000) + 20));
      assert.equal(await ensureSession(), "ok");
      assert.equal(renewals.length, 1, "20 seconds left: renewed");
      assert.match(renewals[0], /\/auth\/refresh$/);
      assert.equal(store.get("acespect_refresh"), "r2");
      assert.ok(tokenExpiresInMs(store.get("acespect_token")) > 800_000, "the new login is stored");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("renewal refused: signed out (the report tab says so); no answer: unavailable (try again)", async () => {
    const realFetch = globalThis.fetch;
    try {
      store.set("acespect_token", tokenFor(1));
      store.set("acespect_refresh", "r1");
      globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
      assert.equal(await ensureSession({ redirect: false }), "unavailable");
      await new Promise((r) => setTimeout(r, 5));
      globalThis.fetch = async () => json(401, { error: { code: "REFRESH_INVALID" } });
      assert.equal(await ensureSession({ redirect: false }), "signed-out");
      assert.equal(store.get("acespect_token"), undefined, "the dead login is forgotten");
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(await ensureSession({ redirect: false }), "signed-out", "nothing to renew with");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("the report page and its tab", () => {
  const view = readFileSync(resolve(webRoot, "src/web/pages/ReportView.tsx"), "utf8");
  const file = readFileSync(resolve(webRoot, "src/web/reportFile.ts"), "utf8");
  it("the finished file is opened or saved from a button the person clicks, in the tab and on the page", () => {
    assert.match(file, /export const readyLabel = \(format: ReportFormat\) => \(format === "pdf" \? "Open PDF" : "Download Word"\)/);
    assert.match(file, /show\(fileName, `\$\{fileName\} is ready\.`, \{\s*label: ready\.label,\s*onClick:/);
    assert.doesNotMatch(file, /win\.location\.href = url;\s*return;/, "no longer opened by itself once ready");
    assert.match(view, /onClick=\{\(\) => ready\.open\(\)\}/);
    assert.match(view, /data-report-ready=\{ready\.format\}/);
  });
  it("a login that has ended says Please sign in again, with a link to sign in, in the tab and on the page", () => {
    assert.match(file, /show\("Please sign in again", e\.message, \{ label: "Sign in again", href: signInAgainHref\(\) \}\)/);
    assert.match(view, /\{signInAgain && \(\s*<a href=\{signInAgainHref\(\)\}/);
  });
  it("every request in the tab checks the login first, without taking the tab to the sign-in page", () => {
    assert.match(file, /session: \(force\) => ensureSession\(\{ force, redirect: false \}\)/);
    assert.doesNotMatch(file, /fetchWithRefresh\(/);
    assert.doesNotMatch(file, /import \{[^}]*fetchWithRefresh/);
  });
});
