// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { splitReviewerQueue, canEditInspection } = await server.ssrLoadModule("/src/web/reviewerQueue.ts");

const ins = (id, reviewerId, status = "submitted") => ({ id, reviewerId, status });

describe("reviewer queue", () => {
  const all = [ins("a", "me"), ins("b", null), ins("c", "other"), ins("d", "me", "approved"), ins("e", null, "draft"), ins("f", "other", "in-review")];

  it("splits into mine, unassigned and other reviewers' work, leaving drafts out", () => {
    const q = splitReviewerQueue(all, "me");
    assert.deepEqual(q.mine.map((i) => i.id), ["a", "d"]);
    assert.deepEqual(q.unassigned.map((i) => i.id), ["b"]);
    assert.deepEqual(q.others.map((i) => i.id), ["c", "f"]);
  });

  it("only the assigned reviewer or an admin can edit", () => {
    assert.equal(canEditInspection({ id: "me", role: "reviewer" }, { reviewerId: "me" }), true);
    assert.equal(canEditInspection({ id: "me", role: "reviewer" }, { reviewerId: "other" }), false);
    assert.equal(canEditInspection({ id: "me", role: "reviewer" }, { reviewerId: null }), false);
    assert.equal(canEditInspection({ id: "x", role: "admin" }, { reviewerId: "other" }), true);
    assert.equal(canEditInspection({ id: "i", role: "inspector" }, { reviewerId: "i" }), false);
    assert.equal(canEditInspection(null, { reviewerId: "me" }), false);
  });
});
