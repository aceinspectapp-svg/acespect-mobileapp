#!/usr/bin/env node
// The inspector's side of the web app, driven in a real browser against a running backend + web app (scripts/ci/report-e2e.sh starts them):
//
//   SMOKE_SCRIPT=$PWD/scripts/inspector-flow-check.mjs DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public scripts/ci/report-e2e.sh
//
// It signs in as a newly registered inspector (the inspector pages admit only that role) and checks, with the real pages:
//   1. New Inspection: for EVERY report type, property type and construction stage, the dialog creates the sections the mobile app
//      would -- the right names, in order, each once -- and a Construction draft records its stage.
//   2. Saves: four saves of one draft arriving at the same moment leave every section once (they used to double the list).
//   3. Editing: typing in a field autosaves it, and the draft keeps the same sections.
//   4. A failed load keeps the screen: when the server refuses the inspection lists (429, 401) while the tab is in use, the open
//      inspection stays on screen instead of going blank ("Inspection not found"), and recovers when the server is back.
import { createServer } from "vite";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const puppeteer = createRequire(new URL("../../acespect-backend/package.json", import.meta.url))("puppeteer");
const API = process.env.ACESPECT_API;
const WEB = process.env.ACESPECT_WEB;
if (!API || !WEB) throw new Error("ACESPECT_API and ACESPECT_WEB are required (scripts/ci/report-e2e.sh sets them)");

const vite = await createServer({ root, server: { middlewareMode: true }, logLevel: "error" });
const layout = await vite.ssrLoadModule("/src/web/constants/sectionLayout.ts");
const data = await vite.ssrLoadModule("/src/web/constants/inspectionData.ts");

const results = [];
const check = (group, what, ok, detail = "") => {
  results.push({ group, what, ok });
  console.log(`${ok ? "ok  " : "FAIL"} [${group}] ${what}${detail ? ` -- ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- an inspector to sign in as ------------------------------------------------------------------------------------------------------
async function api(path, init = {}, token) {
  const r = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
const who = { email: `inspector-${Date.now()}@example.com`, password: "Inspector-Test-123!", name: "Test Inspector" };
await api("/auth/register", { method: "POST", body: JSON.stringify(who) });
const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: who.email, password: who.password }) });
const token = login.accessToken;
const user = { id: login.user.id, email: login.user.email, name: login.user.name, role: "inspector" };

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], protocolTimeout: 300_000 });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 1000 });
await page.evaluateOnNewDocument((t, u) => { localStorage.setItem("acespect_token", t); localStorage.setItem("acespect_user", JSON.stringify(u)); }, token, user);

// failures to answer the lists can be switched on for step 4
let listMode = "ok";
await page.setRequestInterception(true);
page.on("request", (req) => {
  const u = new URL(req.url());
  const isList = u.pathname.endsWith("/api/v1/web/inspections") || u.pathname.endsWith("/api/v1/web/users");
  if (listMode !== "ok" && isList && req.method() === "GET") {
    const status = Number(listMode);
    return void req.respond({ status, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: status === 429 ? "Too many requests, please try again later." : "{}" });
  }
  req.continue();
});

const field = (label, kind = "input") => `::-p-xpath(//label[normalize-space()="${label}"]/following-sibling::${kind})`;
const bodyText = () => page.evaluate(() => document.body.innerText);

/** Create an inspection through the real dialog and return its id. */
async function createViaDialog({ inspectionType, propertyType, stage, jobNo }) {
  await page.goto(`${WEB}/inspector/forms`, { waitUntil: "networkidle0", timeout: 120_000 });
  await (await page.waitForSelector(`::-p-xpath(//button[normalize-space()="New Inspection"])`, { timeout: 60_000 })).click();
  await page.waitForSelector(field("Inspection Type", "select"), { timeout: 30_000 });
  await page.select(field("Inspection Type", "select"), inspectionType);
  await page.select(field("Property Type", "select"), propertyType);
  if (stage) { await page.waitForSelector(field("Construction Stage", "select"), { timeout: 10_000 }); await page.select(field("Construction Stage", "select"), stage); }
  await (await page.$(field("Job Number"))).type(jobNo);
  await (await page.$(field("Client"))).type("Inspector Test");
  await (await page.$(field("Property Address"))).type("1 Test Street");
  await (await page.$(field("Suburb"))).type("Box Hill");
  await (await page.$(`::-p-xpath(//button[normalize-space()="Create Inspection"])`)).click();
  await page.waitForFunction(() => /\/inspector\/form\//.test(location.pathname), { timeout: 60_000 });
  const id = page.url().split("/inspector/form/")[1].split(/[?#]/)[0];
  await page.waitForFunction(() => document.body.innerText.includes("Inspection Sections"), { timeout: 60_000 });
  return id;
}

/** The numbered section names the editor lists, e.g. "1. Job Information" -> "Job Information". */
const listedSections = () => page.evaluate(() => [...document.querySelectorAll("button p")].map((p) => p.textContent.trim()).filter((t) => /^\d+\.\s/.test(t)).map((t) => t.replace(/^\d+\.\s/, "")));

// ONLY=saving,editing,failed-load runs just those groups (new-inspection is the slow one: it opens the dialog for every report type)
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const wanted = (group) => !only || only.includes(group);

// ---- 1. New Inspection creates the right sections for every report type ----------------------------------------------------------------
let n = 0;
let lastDraft;
for (const type of wanted("new-inspection") ? data.INSPECTION_TYPES : []) {
  for (const prop of data.PROPERTY_TYPES) {
    if (!data.isValidCombo(type.id, prop.id)) continue;
    const stages = type.id === "construction_stage" ? layout.CONSTRUCTION_STAGES.map((s) => s.id) : [undefined];
    for (const stage of stages) {
      const label = `${type.title} / ${prop.title}${stage ? ` / ${layout.CONSTRUCTION_STAGE_BY_ID[stage].title}` : ""}`;
      try {
        const id = await createViaDialog({ inspectionType: type.id, propertyType: prop.id, stage, jobNo: `IF-${++n}` });
        const shown = await listedSections();
        const want = layout.sectionsForNewInspection(type.id, prop.id, stage).map((s) => s.name);
        check("new inspection", `${label}: ${want.length} sections, as the mobile app has them`, JSON.stringify(shown) === JSON.stringify(want), JSON.stringify(shown) === JSON.stringify(want) ? "" : `shown ${shown.length}, wanted ${want.length}`);
        if (stage) {
          const { inspection } = await api(`/web/inspections/${id}`, {}, token);
          check("new inspection", `${label}: the stage is recorded in Job Information`, inspection.sections.find((s) => s.key === "job-info")?.answers?.constructionStage === stage);
        }
        if (type.id === "dilapidation" && prop.id === "commercial_properties") lastDraft = id;
      } catch (e) {
        check("new inspection", label, false, String(e.message ?? e).slice(0, 160));
      }
    }
  }
}

// the groups below work on one Commercial draft; make one if the first group did not
if (!lastDraft && (wanted("saving") || wanted("editing") || wanted("failed-load"))) lastDraft = await createViaDialog({ inspectionType: "dilapidation", propertyType: "commercial_properties", jobNo: `IF-${++n}` });

// ---- 2. overlapping saves do not duplicate sections -----------------------------------------------------------------------------------
if (lastDraft && wanted("saving")) {
  const { inspection } = await api(`/web/inspections/${lastDraft}`, {}, token);
  const sections = inspection.sections.map((s, i) => ({ key: s.key, name: s.name, icon: s.icon ?? "", order: i, status: "pending", reportText: "", fields: {}, answers: s.answers ?? undefined, photos: [], damages: [] }));
  await Promise.allSettled([1, 2, 3, 4].map(() => api(`/inspections/${lastDraft}`, { method: "PATCH", body: JSON.stringify({ sections }) }, token)));
  const after = (await api(`/web/inspections/${lastDraft}`, {}, token)).inspection.sections;
  check("saving", `4 saves at the same moment leave ${sections.length} sections, each once`, after.length === sections.length && new Set(after.map((s) => s.key)).size === sections.length, `${after.length} sections`);
}

// ---- 3. typing in a field autosaves it, and the draft keeps its sections --------------------------------------------------------------
if (lastDraft && wanted("editing")) {
  await page.goto(`${WEB}/inspector/form/${lastDraft}`, { waitUntil: "networkidle0", timeout: 120_000 });
  await page.waitForFunction(() => document.body.innerText.includes("Inspection Sections"), { timeout: 60_000 });
  const before = (await listedSections()).length;
  await (await page.waitForSelector(`::-p-xpath(//button[.//p[contains(., "Job Information")]])`)).click();
  const input = await page.waitForSelector(`::-p-xpath(//input[(not(@type) or @type="text") and not(@readonly) and not(@disabled)])`, { timeout: 30_000 }).catch(async () => {
    console.log("DEBUG the inputs on the page:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("input,textarea")].map((e) => [e.tagName, e.type, e.readOnly, e.disabled, (e.placeholder || "").slice(0, 20)]))));
    throw new Error("no editable text field found in Job Information");
  });
  await input.click({ clickCount: 3 });
  await input.type("Autosave check");
  await sleep(1200); // the autosave fires a second after typing stops...
  const saveButton = await page.$(`::-p-xpath(//button[contains(., "Save Draft")])`);
  if (saveButton) await saveButton.click(); // ...and Save Draft right behind it, so two saves can overlap
  await sleep(3500);
  const { inspection } = await api(`/web/inspections/${lastDraft}`, {}, token);
  const stored = JSON.stringify(inspection.sections.find((s) => s.key === "job-info")?.answers ?? {});
  check("editing", "what was typed is saved", stored.includes("Autosave check"));
  check("editing", `the draft still has its ${before} sections, each once`, inspection.sections.length === before && new Set(inspection.sections.map((s) => s.key)).size === before, `${inspection.sections.length} sections`);
}

// ---- 4. a failed load keeps the screen -------------------------------------------------------------------------------------------------
if (lastDraft && wanted("failed-load")) {
  await page.goto(`${WEB}/inspector/form/${lastDraft}`, { waitUntil: "networkidle0", timeout: 120_000 });
  await page.waitForFunction(() => document.body.innerText.includes("Inspection Sections"), { timeout: 60_000 });
  const refocus = async () => { await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(2500); };
  for (const mode of ["429", "401"]) {
    listMode = mode;
    await refocus();
    const t = await bodyText();
    check("failed load", `the inspection stays on screen when the server answers ${mode}`, !t.includes("Inspection not found") && t.includes("Inspection Sections"));
  }
  listMode = "ok";
  await refocus();
  check("failed load", "and it is still there when the server is back", (await bodyText()).includes("Inspection Sections"));
}

// ---- 5. two tabs, an expired login, both opened at once: neither is signed out ------------------------------------------------------
// Needs the backend started with ACCESS_TOKEN_TTL_MIN=1 (a login that lasts a minute), and is run on its own:
//   ONLY=session ACCESS_TOKEN_TTL_MIN=1 SMOKE_SCRIPT=... scripts/ci/report-e2e.sh
if (wanted("session") && only?.includes("session")) {
  if (process.env.ACCESS_TOKEN_TTL_MIN !== "1") {
    check("session", "needs ACCESS_TOKEN_TTL_MIN=1 for the backend", false);
  } else {
    const fresh = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: who.email, password: who.password }) });
    const draftSections = layout.sectionsForNewInspection("dilapidation", "commercial_properties").map((sec, i) => ({ key: sec.key, name: sec.name, icon: sec.icon, order: i, status: "pending", reportText: "", fields: {}, photos: [], damages: [] }));
    const made = await api("/inspections/submit", { method: "POST", body: JSON.stringify({ inspectionType: "Dilapidation", propertyType: "Commercial Properties", jobNo: "IF-SESSION", address: "1 Test Street", suburb: "Box Hill", client: "Session Test", date: "2026-10-13", sections: draftSections }) }, fresh.accessToken);
    const draftUrl = `${WEB}/inspector/form/${made.inspectionId ?? made.inspection?.id}`;
    const context = await browser.createBrowserContext(); // its own storage, shared by the two tabs, like two tabs of one browser
    const [tabA, tabB] = [await context.newPage(), await context.newPage()];
    await tabA.goto(`${WEB}/`, { waitUntil: "domcontentloaded" });
    await tabA.evaluate((t, r, u) => { localStorage.setItem("acespect_token", t); localStorage.setItem("acespect_refresh", r); localStorage.setItem("acespect_user", JSON.stringify(u)); }, fresh.accessToken, fresh.refreshToken, user);
    console.log("     waiting 75 s for the one-minute login to expire...");
    await sleep(75_000);
    const refreshStatuses = [];
    for (const tab of [tabA, tabB]) tab.on("response", (r) => { if (r.url().endsWith("/auth/refresh")) refreshStatuses.push(r.status()); });
    await Promise.all([tabA.goto(draftUrl, { waitUntil: "networkidle0", timeout: 120_000 }), tabB.goto(draftUrl, { waitUntil: "networkidle0", timeout: 120_000 })]);
    await sleep(1500);
    for (const [name, tab] of [["tab A", tabA], ["tab B", tabB]]) {
      const text = await tab.evaluate(() => document.body.innerText);
      check("session", `${name} still shows the inspection after the login expired`, text.includes("Inspection Sections") && new URL(tab.url()).pathname.startsWith("/inspector/form/"), new URL(tab.url()).pathname.slice(0, 40));
    }
    check("session", "the login was renewed, and no renewal was refused", refreshStatuses.includes(200) && !refreshStatuses.some((x) => x >= 400), `renewals answered: ${refreshStatuses.join(", ") || "none"}`);
    await context.close();
  }
}

await browser.close();
await vite.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks pass${failed.length ? `; ${failed.length} FAILED` : ""}`);
process.exit(failed.length ? 1 : 0);
