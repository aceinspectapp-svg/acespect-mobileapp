// The app's retry rule (src/services/retryPolicy.ts): which failures are sent again, and how long the app waits.
// A server busy making a large report answers 408 / 502 / 503 / 504 (or nothing) for 2-3 minutes: a photo, a section, the submit,
// a QC result or a defect change must ride that out, and only a real refusal may come back as an error.
//
// Run with: npm test   (Node 22.6+ reads the TypeScript file directly)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUSY_STATUSES, BUSY_WAITS_MS, NO_ANSWER_WAITS_MS, isNoAnswer, isServerBusy, isTransientFailure, nextWaitMs, retryAfterMs, statusOf, withRetry,
} from "../src/services/retryPolicy.ts";

const answered = (status, headers = {}) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, headers } });
const noAnswer = (message = "Network Error", code = "ERR_NETWORK") => Object.assign(new Error(message), { code });
const sum = (a) => a.reduce((x, y) => x + y, 0);

describe("which failures are worth sending again", () => {
  for (const st of [408, 425, 429, 500, 502, 503, 504]) it(`${st}: the server is busy -> send again`, () => assert.ok(isTransientFailure(answered(st)) && isServerBusy(answered(st))));
  it("no answer (no connection, a timeout, a dropped connection) -> send again", () => {
    for (const e of [noAnswer(), noAnswer("timeout of 15000ms exceeded", "ECONNABORTED"), noAnswer("socket hang up", "ECONNRESET")]) assert.ok(isTransientFailure(e) && isNoAnswer(e));
  });
  for (const st of [400, 401, 403, 404, 409, 413, 422]) it(`${st}: a real answer about this request -> not sent again by the rule`, () => assert.equal(isTransientFailure(answered(st)), false));
  it("the list is the documented one", () => assert.deepEqual([...BUSY_STATUSES], [408, 425, 429, 500, 502, 503, 504]));
  it("statusOf reads the answer's status", () => { assert.equal(statusOf(answered(502)), 502); assert.equal(statusOf(noAnswer()), undefined); });
});

describe("how long the app waits", () => {
  it("a busy server is waited out for longer than a large report keeps it busy (2-3 minutes), even with the random spread", () => {
    const least = sum(BUSY_WAITS_MS) * 0.8;
    assert.ok(least >= 180_000, `${least} ms`);
  });
  it("no answer at all gets the short run (the phone is likely offline; its queue takes over)", () => assert.ok(sum(NO_ANSWER_WAITS_MS) <= 30_000));
  it("each wait is the schedule's, spread by up to 20 % either way", () => {
    assert.equal(nextWaitMs(answered(502), 0, () => 0.5), 2000);
    assert.equal(nextWaitMs(answered(502), 0, () => 0), 1600);
    assert.equal(nextWaitMs(answered(502), 0, () => 1), 2400);
    assert.equal(nextWaitMs(noAnswer(), 2, () => 0.5), 15000);
  });
  it("gives up when the schedule runs out, and at once for a real refusal", () => {
    assert.equal(nextWaitMs(answered(503), BUSY_WAITS_MS.length), null);
    assert.equal(nextWaitMs(noAnswer(), NO_ANSWER_WAITS_MS.length), null);
    assert.equal(nextWaitMs(answered(422), 0), null);
  });
  it("the server's Retry-After is honoured (seconds or a date), up to a minute", () => {
    assert.equal(retryAfterMs(answered(429, { "retry-after": "7" })), 7000);
    assert.equal(retryAfterMs(answered(503, { "Retry-After": "600" })), 60000);
    assert.equal(retryAfterMs(answered(503, { "retry-after": new Date(Date.UTC(2026, 10, 19, 12, 0, 30)).toUTCString() }), Date.UTC(2026, 10, 19, 12, 0, 0)), 30000);
    assert.equal(retryAfterMs(answered(503)), undefined);
    assert.equal(nextWaitMs(answered(429, { "retry-after": "7" }), 0, () => 0.5), 7000);
  });
});

describe("withRetry: a request is sent again until it goes through, or a real refusal", () => {
  const instant = { sleep: async () => undefined, random: () => 0.5 };
  it("a server busy for a whole large report (8 busy answers, then OK): the request goes through, nothing is lost", async () => {
    let calls = 0;
    const waited = [];
    const r = await withRetry(async () => { if (++calls <= 8) throw answered(calls % 2 ? 502 : 504); return "saved"; }, { ...instant, onRetry: (_e, ms) => waited.push(ms) });
    assert.equal(r, "saved");
    assert.equal(calls, 9);
    assert.ok(sum(waited) >= 160_000, `${sum(waited)} ms waited, a 160 s report`);
  });
  it("Azure's 408 (the front end gave up waiting) is sent again", async () => {
    let calls = 0;
    assert.equal(await withRetry(async () => { if (++calls < 3) throw answered(408); return "ok"; }, instant), "ok");
    assert.equal(calls, 3);
  });
  it("a real refusal comes back at once, not sent again", async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw answered(422); }, instant), /422/);
    assert.equal(calls, 1);
  });
  it("still busy after every wait: the last failure comes back (the app's queue then keeps the work for later)", async () => {
    let calls = 0;
    await assert.rejects(withRetry(async () => { calls++; throw answered(503); }, instant), /503/);
    assert.equal(calls, BUSY_WAITS_MS.length + 1);
  });
  it("a caller's own repeatable answer (a photo upload's 409 'already being saved') gets the short run", async () => {
    let calls = 0;
    const r = await withRetry(async () => { if (++calls < 3) throw answered(409); return "the saved copy"; }, { ...instant, retryable: (e) => isTransientFailure(e) || statusOf(e) === 409 });
    assert.equal(r, "the saved copy");
    let n = 0;
    await assert.rejects(withRetry(async () => { n++; throw answered(409); }, { ...instant, retryable: (e) => statusOf(e) === 409 }));
    assert.equal(n, NO_ANSWER_WAITS_MS.length + 1);
  });
});

describe("the app uses the rule everywhere it sends", () => {
  const src = (f) => readFileSync(new URL(`../src/services/${f}`, import.meta.url), "utf8");
  it("photo upload and submit are sent again through withRetry", () => {
    const s = src("inspectionApi.ts");
    assert.match(s, /return withRetry\(sendOnce, \{ retryable: \(err\) => isTransientFailure\(err\) \|\| statusOf\(err\) === 409 \}\)/);
    assert.match(s, /await withRetry\(\(\) => api\.post<SubmitResult>\('\/inspections\/submit'/);
  });
  it("reads (GET) are asked again on a busy server", () => assert.match(src("apiClient.ts"), /=== 'get' && isTransientFailure\(error\)/));
  it("the QC result and defect queues keep a change when the server is busy (not marked as refused)", () => {
    assert.match(src("inspectionQueue.ts"), /const isNetworkError = \(e: unknown\) => isTransientFailure\(e\);/);
    assert.match(src("qcCache.ts"), /export const isRetryLater = \(e: unknown\): boolean => isTransientFailure\(e\);/);
    const q = src("defectQueue.ts");
    assert.match(q, /if \(!isRetryLater\(e\)\) throw e;/);
    assert.match(q, /if \(isRetryLater\(e\)\) \{/);
    assert.doesNotMatch(q, /isNetworkError/);
  });
});
