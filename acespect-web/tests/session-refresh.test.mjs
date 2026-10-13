// Keeping a signed-in person signed in: when the login has expired, every call that carries it renews it once and repeats; when renewal can
// never work the person is signed out to the sign-in page (not left on a page where everything fails); when it merely fails for now
// (too many requests, a restart) the session is left alone.
//
// Run with: npm test
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// ---- a pretend browser: storage, location, tabs taking turns, and a server we script -------------------------------------------------
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k) };
const redirects = [];
globalThis.window = { location: { pathname: "/inspector/forms", search: "", assign: (u) => void redirects.push(u) } };
Object.defineProperty(globalThis, "navigator", { value: { locks: { request: async (_n, cb) => cb() } }, configurable: true });

let server; // (url, init) => Response
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  calls.push({ url: u, auth: init.headers?.Authorization ?? null, body: init.body });
  return server(u, init);
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refreshCalls = () => calls.filter((c) => c.url.endsWith("/auth/refresh")).length;

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vite = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => vite.close());
const api = await vite.ssrLoadModule("/src/web/api.ts");
const fields = await vite.ssrLoadModule("/src/web/templateFields.ts");

const user = { id: "u1", email: "a@example.com", name: "A", role: "inspector" };
/** A server that accepts only the NEW token and says "expired" to the old one. */
const expiringServer = (onRefresh) => (u, init) => {
  if (u.endsWith("/auth/refresh")) return onRefresh(init);
  const auth = init.headers?.Authorization ?? "";
  if (auth === "Bearer new-access") return json(200, { ok: true, template: { id: "t1", fields: [] } });
  return json(401, { error: { code: "TOKEN_EXPIRED", message: "Access token expired" } });
};
const ok = () => json(200, { accessToken: "new-access", refreshToken: "new-refresh", user });
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(async () => {
  store.clear();
  calls.length = 0;
  redirects.length = 0;
  api.setSession("old-access", user);
  api.setRefreshToken("old-refresh");
  await tick();
});

describe("an expired login", () => {
  it("is renewed ONCE however many requests hit it at the same moment, and each request then succeeds", async () => {
    server = expiringServer(async () => { await tick(); return ok(); });
    const results = await Promise.all([api.req("/web/inspections"), api.req("/web/users"), api.req("/web/inspections/x")]);
    assert.equal(results.length, 3);
    assert.equal(refreshCalls(), 1, "one /auth/refresh for three requests");
    assert.equal(api.getToken(), "new-access");
    assert.equal(localStorage.getItem("acespect_refresh"), "new-refresh");
    assert.equal(redirects.length, 0);
  });

  it("is renewed for a call that does not go through req() too: the form templates (they used to come back empty, leaving the editor with no fields)", async () => {
    server = expiringServer(() => ok());
    const t = await fields.fetchActiveTemplate("dilapidation", "residential_house", "description");
    assert.ok(t && t.id === "t1", "the template loaded after the login was renewed");
    assert.equal(refreshCalls(), 1);
  });

  it("is not renewed again when another tab has already done it: the stored login is simply used", async () => {
    server = expiringServer(() => assert.fail("must not call /auth/refresh"));
    // this tab sent the old token; by the time it asks to renew, another tab has stored a new one
    const original = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      const res = await original(url, init);
      if (!String(url).includes("/auth/refresh") && init.headers?.Authorization === "Bearer old-access") api.setSession("new-access", user);
      return res;
    };
    try {
      await api.req("/web/inspections");
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(refreshCalls(), 0);
    assert.equal(calls.filter((c) => c.auth === "Bearer new-access").length, 1, "the call was repeated with the stored login");
  });
});

describe("a renewal that cannot work", () => {
  it("signs the person out to the sign-in page, with the reason, instead of leaving a page where everything fails", async () => {
    server = expiringServer(() => json(401, { error: { code: "INVALID_REFRESH_TOKEN", message: "Invalid or expired refresh token" } }));
    await assert.rejects(() => api.req("/web/inspections"));
    assert.equal(api.getToken(), null, "the stored login is cleared");
    assert.equal(localStorage.getItem("acespect_refresh"), null);
    assert.deepEqual(redirects, ["/?reason=SESSION_REVOKED"]);
  });

  it("shows the inactivity message when the server says the session timed out", async () => {
    server = expiringServer(() => json(401, { error: { code: "SESSION_IDLE", message: "timed out" } }));
    await assert.rejects(() => api.req("/web/inspections"));
    assert.deepEqual(redirects, ["/?reason=SESSION_IDLE"]);
  });
});

describe("a renewal that fails only for now", () => {
  for (const [label, response] of [["too many requests (429)", () => json(429, { error: { code: "RATE_LIMITED" } })], ["a server error (503)", () => json(503, {})], ["no connection", () => { throw new TypeError("fetch failed"); }]]) {
    it(`keeps the session on ${label}, so the next request can try again`, async () => {
      server = expiringServer(response);
      await assert.rejects(() => api.req("/web/inspections"));
      assert.equal(api.getToken(), "old-access", "the stored login is kept");
      assert.equal(localStorage.getItem("acespect_refresh"), "old-refresh");
      assert.equal(redirects.length, 0, "no redirect");
      // and when the server is back, the very next request renews and works
      server = expiringServer(() => ok());
      await tick();
      await api.req("/web/inspections");
      assert.equal(api.getToken(), "new-access");
    });
  }
});
