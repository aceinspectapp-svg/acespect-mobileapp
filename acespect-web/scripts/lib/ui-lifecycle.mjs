// One inspection taken through the real screens, in a real browser, from the first click to the downloaded files:
//
//   1. the inspector opens New Inspection, fills the dialog and creates the inspection
//   2. the inspector's form is filled (what the editor autosaves), then the editor is opened and every section is visited
//   3. the inspector presses Submit (the editor's own completeness check, the save that composes the report wording, the finalize call)
//   4. the reviewer opens the review screen, visits every section and presses Approve All
//   5. the reviewer opens the report and presses Download PDF and Download Word
//
// Used by audit-reports.mjs with AUDIT_VIA_UI=1; it hands back the inspection id and the two files so the audit can check them.
// It writes to the database it is pointed at (it registers an inspector and a reviewer, and makes inspections): scratch databases only.
import { createRequire } from "node:module";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BAD_TEXT = [/\bundefined\b/, /\[object Object\]/, /\bNaN\b/, /__other__/, /DEFECT::/, /COND::/, /ROOMHEAD::/];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// UI_SHOTS=<folder> keeps a picture of the main screens, for looking at
const shot = async (page, name) => { if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/${name}.png` }).catch(() => undefined); };

export async function makeLifecycle({ browser, API, WEB, adminLogin, record, backendDir }) {
  const prismaPkg = createRequire(new URL("package.json", backendDir))("@prisma/client");
  const prisma = new prismaPkg.PrismaClient();
  const dbName = (process.env.DATABASE_URL ?? "").split("?")[0].split("/").pop() ?? "";
  if (!/scratch|test|ci/i.test(dbName)) throw new Error(`refusing to create users in database "${dbName}": the UI lifecycle runs on scratch databases only`);

  const api = async (path, init = {}, token) => {
    const r = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${r.status} ${(await r.text()).slice(0, 240)}`);
    return r.json();
  };
  // the same two people every run (made on the first), so a scratch database does not fill with test users
  const signUp = async (role) => {
    const who = { email: `lifecycle-${role}@example.com`, password: "Lifecycle-Test-123!", name: role === "reviewer" ? "Test Reviewer" : "Test Inspector" };
    if (!(await prisma.user.findUnique({ where: { email: who.email } }))) await api("/auth/register", { method: "POST", body: JSON.stringify(who) });
    if (role === "reviewer") await prisma.user.update({ where: { email: who.email }, data: { role: "REVIEWER" } });
    const login = await api("/auth/login", { method: "POST", body: JSON.stringify({ email: who.email, password: who.password }) });
    return { token: login.accessToken, user: { id: login.user.id, email: login.user.email, name: login.user.name, role }, who };
  };

  const field = (label, kind = "input") => `::-p-xpath(//label[normalize-space()="${label}"]/following-sibling::${kind})`;

  /** A browser tab signed in as one user, which remembers everything the page complains about. */
  async function openTab(session, viewport = { width: 1440, height: 1000 }) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.evaluateOnNewDocument((t, u) => { localStorage.setItem("acespect_token", t); localStorage.setItem("acespect_user", JSON.stringify(u)); }, session.token, session.user);
    page.problems = [];
    page.on("pageerror", (e) => page.problems.push(`script error: ${String(e.message).slice(0, 160)}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) page.problems.push(`console error: ${m.text().slice(0, 160)}`); });
    page.on("response", (r) => {
      const u = new URL(r.url());
      // an inspector is not allowed the user list; the app copes with the refusal
      const allowedRefusal = session.user.role === "inspector" && u.pathname.endsWith("/web/users") && r.status() === 403;
      if (u.pathname.startsWith("/api/") && r.status() >= 400 && !/does-not-exist/.test(r.url()) && !allowedRefusal) page.problems.push(`${r.request().method()} ${u.pathname} -> ${r.status()}`);
    });
    return page;
  }

  /** What is wrong with the screen as it stands: leaked placeholders, content running off the side. */
  const screenProblems = (page) => page.evaluate((bad) => {
    const out = [];
    const text = document.body.innerText;
    for (const src of bad) { const m = new RegExp(src).exec(text); if (m) out.push(`the screen shows "${text.slice(Math.max(0, m.index - 25), m.index + 30).replace(/\s+/g, " ")}"`); }
    const wide = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (wide > 4) out.push(`the page scrolls sideways by ${wide}px`);
    return out;
  }, BAD_TEXT.map((r) => r.source));

  const inspector = await signUp("inspector");
  const reviewer = await signUp("reviewer");

  /** Run one report type through the lifecycle. `fill(key, existingAnswers)` returns { answers, photos } for a section. */
  async function run({ label, typeKey, inspectionId, propertyId, stage, jobNo, fill }) {
    const rec = (check, ok, detail = "") => record(label, typeKey, check, ok, detail);

    // ---- 1. New Inspection ------------------------------------------------------------------------------------------------------------
    const tab = await openTab(inspector);
    await tab.goto(`${WEB}/inspector/forms`, { waitUntil: "networkidle0", timeout: 180_000 });
    await (await tab.waitForSelector(`::-p-xpath(//button[normalize-space()="New Inspection"])`, { timeout: 90_000 })).click();
    await tab.waitForSelector(field("Inspection Type", "select"), { timeout: 30_000 });
    await tab.select(field("Inspection Type", "select"), inspectionId);
    await tab.select(field("Property Type", "select"), propertyId);
    if (stage) { await tab.waitForSelector(field("Construction Stage", "select"), { timeout: 10_000 }); await tab.select(field("Construction Stage", "select"), stage); }
    await (await tab.$(field("Job Number"))).type(jobNo);
    await (await tab.$(field("Client"))).type("Audit Client");
    await (await tab.$(field("Property Address"))).type("1 Audit Street");
    await (await tab.$(field("Suburb"))).type("Box Hill VIC 3128");
    const dialogProblems = await screenProblems(tab);
    await shot(tab, `${typeKey}-1-dialog`);
    await (await tab.$(`::-p-xpath(//button[normalize-space()="Create Inspection"])`)).click();
    await tab.waitForFunction(() => /\/inspector\/form\//.test(location.pathname), { timeout: 90_000 });
    const id = tab.url().split("/inspector/form/")[1].split(/[?#]/)[0];
    await tab.waitForFunction(() => document.body.innerText.includes("Inspection Sections"), { timeout: 90_000 });
    rec("ui: New Inspection dialog creates the inspection and opens it", true, `${dialogProblems.join(" | ")}`.trim());
    rec("ui: the New Inspection dialog is clean (no leaked text, no sideways scroll)", dialogProblems.length === 0, dialogProblems.join(" | "));

    const first = (await api(`/web/inspections/${id}`, {}, inspector.token)).inspection;
    const shown = await tab.evaluate(() => [...document.querySelectorAll("button p")].map((p) => p.textContent.trim()).filter((t) => /^\d+\.\s/.test(t)).map((t) => t.replace(/^\d+\.\s/, "")));
    rec("ui: the editor lists every section the new inspection has, each once", JSON.stringify(shown) === JSON.stringify(first.sections.map((s) => s.name)), `${shown.length} shown, ${first.sections.length} stored`);
    await tab.close();

    // ---- 2. the inspector's form is filled (as the editor's autosave sends it), then walked through --------------------------------------
    const sections = first.sections.map((s, i) => {
      const got = fill(s.key, s.answers ?? {});
      const merged = { ...got.answers };
      for (const [k, v] of Object.entries(s.answers ?? {})) if (v !== "" && v != null) merged[k] = v; // what the dialog already recorded (the stage, the job number...) stays
      return { key: s.key, name: s.name, icon: s.icon ?? "", order: i, status: "complete", reportText: "", fields: {}, answers: merged, photos: (got.photos ?? []).slice(0, 200), damages: [] };
    });
    await api(`/inspections/${id}`, { method: "PATCH", body: JSON.stringify({ sections }) }, inspector.token);

    const editor = await openTab(inspector);
    editor.on("dialog", (d) => d.accept());
    await editor.goto(`${WEB}/inspector/form/${id}`, { waitUntil: "networkidle0", timeout: 180_000 });
    await editor.waitForFunction(() => document.body.innerText.includes("Inspection Sections"), { timeout: 90_000 });
    const names = first.sections.map((s) => s.name);
    const seen = [];
    for (let i = 0; i < names.length; i++) {
      const btn = await editor.waitForSelector(`::-p-xpath(//button[.//p[starts-with(normalize-space(), "${i + 1}. ")]])`, { timeout: 30_000 }).catch(() => null);
      if (!btn) { seen.push(`section ${i + 1} (${names[i]}) has no button`); continue; }
      await btn.click();
      await sleep(250);
      if (i < 4 || i === names.length - 1) await shot(editor, `${typeKey}-2-editor-${i + 1}`);
      for (const p of await screenProblems(editor)) seen.push(`${names[i]}: ${p}`);
    }
    rec("ui: every section opens in the inspector's editor, clean", seen.length === 0, seen.slice(0, 4).join(" | "));

    // ---- 3. Submit ----------------------------------------------------------------------------------------------------------------------
    const submit = await editor.waitForSelector(`::-p-xpath(//button[normalize-space()="Submit"])`, { timeout: 30_000 });
    await submit.click();
    let status = "draft";
    for (let t = 0; t < 90 && status === "draft"; t++) { await sleep(1000); status = (await api(`/web/inspections/${id}`, {}, inspector.token)).inspection.status; }
    const warn = await editor.evaluate(() => (/still (have|has) required fields missing[^]*/.exec(document.body.innerText)?.[0] ?? "").slice(0, 300));
    rec("ui: Submit accepts the filled-in form and sends it for review", status !== "draft", warn || `status ${status}`);
    rec("ui: nothing failed behind the editor while it was filled and submitted", editor.problems.length === 0, editor.problems.slice(0, 4).join(" | "));
    await editor.close();
    if (status === "draft") throw new Error(`Submit did not go through: ${warn}`);

    // Submit hands the inspection to a reviewer; a reviewer sees only the inspections assigned to them. Which one is up to the app, and a scratch
    // database can hold several, so the inspection is given to this run's reviewer (the screens are what is being checked, not the choice).
    const assigned = await prisma.inspection.findUnique({ where: { id }, select: { reviewerId: true } });
    if (assigned?.reviewerId !== reviewer.user.id) await prisma.inspection.update({ where: { id }, data: { reviewerId: reviewer.user.id } });
    rec("ui: Submit assigns a reviewer", !!assigned?.reviewerId, assigned?.reviewerId ? "" : "no reviewer was assigned");

    // ---- 4. the reviewer ----------------------------------------------------------------------------------------------------------------
    const review = await openTab(reviewer);
    await review.goto(`${WEB}/reviewer/review/${id}`, { waitUntil: "networkidle0", timeout: 180_000 });
    await review.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 90_000 }, names[0]).catch(() => undefined);
    const reviewSeen = [];
    for (const name of names) {
      // the area's name in the list on the left; the click lands on it as a mouse click would
      const at = await review.evaluate((n) => {
        const el = [...document.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent.trim() === n && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().left < 440);
        if (!el) return null;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, name);
      if (!at) { reviewSeen.push(`${name}: not listed`); continue; }
      await review.mouse.click(at.x, at.y);
      await sleep(250);
      if (process.env.UI_SHOTS_ALL || name === names[0] || name === names[1] || name === names[names.length - 1]) await shot(review, `${typeKey}-3-review-${names.indexOf(name) + 1}`);
      for (const p of await screenProblems(review)) reviewSeen.push(`${name}: ${p}`);
    }
    rec("ui: every section opens on the reviewer's screen, clean", reviewSeen.length === 0, reviewSeen.slice(0, 4).join(" | "));
    const approveBtn = await review.waitForSelector(`::-p-xpath(//button[contains(normalize-space(), "Approve All")])`, { timeout: 30_000 });
    await approveBtn.click();
    await sleep(2500);
    const after = (await api(`/web/inspections/${id}`, {}, reviewer.token)).inspection;
    rec("ui: Approve All approves every section", after.sections.every((s) => s.reviewStatus === "approved"), `${after.sections.filter((s) => s.reviewStatus === "approved").length}/${after.sections.length} approved, inspection ${after.status}`);
    rec("ui: nothing failed behind the reviewer's screen", review.problems.length === 0, review.problems.slice(0, 4).join(" | "));
    await review.close();

    // ---- 5. the report and its two downloads ---------------------------------------------------------------------------------------------
    const files = {};
    const reportTab = await openTab(reviewer, { width: 1200, height: 1000 });
    await reportTab.goto(`${WEB}/report/${id}`, { waitUntil: "networkidle0", timeout: 300_000 });
    await reportTab.waitForSelector(".report-page", { timeout: 120_000 });
    await shot(reportTab, `${typeKey}-4-report`);
    // the browser saves what the buttons download into a folder, as it would to the person's Downloads
    const dir = mkdtempSync(join(tmpdir(), "ui-downloads-"));
    await (await reportTab.createCDPSession()).send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
    for (const [format, button] of [["pdf", "Download PDF"], ["docx", "Download Word"]]) {
      const reply = reportTab.waitForResponse((r) => r.request().method() === "GET" && r.url().includes(`/report.${format}`), { timeout: 600_000 });
      await (await reportTab.waitForSelector(`::-p-xpath(//button[contains(normalize-space(), "${button}")])`, { timeout: 30_000 })).click();
      const status = (await reply).status();
      let name;
      for (let t = 0; t < 120 && !name; t++) { await sleep(500); name = readdirSync(dir).find((f) => f.endsWith(`.${format}`)); }
      files[format] = name ? readFileSync(join(dir, name)) : null;
      const err = await reportTab.evaluate(() => (/Failed to (generate|download)[^\n]*/.exec(document.body.innerText)?.[0] ?? ""));
      rec(`ui: the ${button} button saves the file`, status === 200 && !!name && files[format].length > 5000 && !err, `HTTP ${status}, ${name ?? "no file saved"}, ${files[format]?.length ?? 0} bytes ${err}`);
    }
    await reportTab.close();
    return { id, files };
  }

  return { run, close: () => prisma.$disconnect() };
}
