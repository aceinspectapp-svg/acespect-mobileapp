#!/usr/bin/env node
// The report audit: builds reports in many scenarios for every report type, then checks each one from several sides --
//
//   photos     every photo is drawn at its own shape (never cropped, never stretched), inside the page, in rows of equal height,
//              through the one shared photo grid, numbered in order -- in the web page, in the PDF and in the Word file
//   colours    one navy and one red throughout (no stray old brand colours), every piece of text readable (WCAG contrast)
//   layout     the cover (banner, rows, sign-off), a footer with "Page N of M" on every page, no blank pages, no heading left at a page bottom
//   wording    no leaked template markers or broken sentences in the PDF or the Word text
//   word file  a valid package whose pictures keep their shape, with the same text as the PDF
//
// Run it against a running backend + web app (scripts/ci/report-e2e.sh starts them):
//
//   SMOKE_SCRIPT=scripts/audit-reports.mjs AUDIT_OUT=<folder> PHOTOS_DIR=<folder with man-L.jpg, house-L.jpg, ...> \
//   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public scripts/ci/report-e2e.sh
//
// Optional: AUDIT_SCENARIOS=real,mixes (a comma list), AUDIT_TYPES=residential_house,construction, AUDIT_ONLY=real/residential_house,none/apartment (just those reports), KEEP=1 (keep every PDF and Word file).
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { makeFiller } from "./lib/form-filler.mjs";
import { photosOf, serveFolder, startPhotoServer } from "./lib/placeholder-photos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const API = (process.env.ACESPECT_API ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
const WEB = (process.env.ACESPECT_WEB ?? "http://localhost:5173").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = resolve(process.env.AUDIT_OUT ?? mkdtempSync(join(tmpdir(), "report-audit-")));
const PHOTOS_DIR = resolve(process.env.PHOTOS_DIR ?? ".");
const REAL_PORT = Number(process.env.PHOTO_PORT ?? 5198);
const SVG_PORT = REAL_PORT + 1;
if (!EMAIL || !PASSWORD) throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD are required");
mkdirSync(OUT, { recursive: true });

const puppeteer = createRequire(new URL("../../acespect-backend/package.json", import.meta.url))("puppeteer");
const SNAP = JSON.parse(readFileSync(resolve(here, "../../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const realServer = await serveFolder(REAL_PORT, PHOTOS_DIR);
const svgServer = await startPhotoServer(SVG_PORT);

// ---- the report types ---------------------------------------------------------------------------------------------------------------
const DIL = (propertyType, title, sections) => ({ key: propertyType, title, inspection: "dilapidation", inspectionTitle: "Dilapidation", propertyType, sections, kicker: "DILAPIDATION REPORT", bannerTitle: title });
const TYPES = [
  DIL("residential_house", "Residential House", ["job-info", "description", "driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "pool_spa", "elevations", "roof_chimneys", "internal_areas", "notes", "custom_structure"]),
  DIL("commercial_properties", "Commercial Properties", ["job-info", "description", "driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "elevations", "roof_chimneys", "internal_areas", "pool_spa", "notes", "custom_structure"]),
  DIL("apartment", "Apartment", ["job-info", "description", "elevations", "roof_chimneys", "internal_areas", "paving_paths", "notes", "custom_structure"]),
  DIL("public_assets", "Public Assets", ["job-info", "description", "elevations", "custom_structure"]),
  {
    key: "construction", title: "Residential House", inspection: "construction_stage", inspectionTitle: "Construction Stage", propertyType: "residential_house",
    sections: ["job-info", ...SNAP.filter((t) => t.inspectionType === "construction_stage" && t.propertyType === "residential_house" && t.sectionKey.startsWith("lf_")).map((t) => t.sectionKey)],
    kicker: "CONSTRUCTION REPORT", bannerTitle: "Lock-up & Fixing Stage",
  },
].filter((t) => !process.env.AUDIT_TYPES || process.env.AUDIT_TYPES.split(",").includes(t.key));
const typeOf = (typeKey) => TYPES.find((t) => t.key === typeKey);
const tplOf = (typeKey, key) => { const type = typeOf(typeKey); return SNAP.find((t) => t.inspectionType === type.inspection && t.propertyType === type.propertyType && t.sectionKey === key); };

// ---- the scenarios: what photographs each photo spot gets ----------------------------------------------------------------------------------
const real = (shape, n) => `http://localhost:${REAL_PORT}/${["man", "house"][n % 2]}-${shape}.jpg`;
let unique = 0;
const tag = (url) => `${url}${url.includes("?") ? "&" : "?"}n=${++unique}`; // every spot's photographs are distinct URLs, so a missing one can be told
const shapesToUrls = (mix, set) => photosOf(mix, set, SVG_PORT).map(tag);
const realMix = (mix) => mix.split(" ").map((s, i) => tag(real(s, i + unique)));
const REAL_MIXES = ["L L", "P P L", "L L L", "L P", "L P P", "S L", "P P P", "L", "L L P", "P L P L", "P", "L P L P L P"];
const MIX13 = ["P P L", "L L P", "P P P", "L L L", "P L P L P", "P", "P P P P", "L P", "S W T", "L P P L L P", "L L", "L", "P L L"];
const SCENARIOS = {
  // the supplied photographs, in every mix of portrait / landscape / square
  real: { about: "the supplied photographs in every mix of shapes", photos: (ctx, n) => realMix(REAL_MIXES[n % 12]) },
  // the same photo places and the same number of photographs in each, but all portrait / all horizontal
  portrait: { about: "the supplied photographs, every one portrait (same places and counts as 'real')", photos: (ctx, n) => realMix(REAL_MIXES[n % 12].replace(/[A-Z]/g, "P")) },
  landscape: { about: "the supplied photographs, every one horizontal (same places and counts as 'real')", photos: (ctx, n) => realMix(REAL_MIXES[n % 12].replace(/[A-Z]/g, "L")) },
  // labelled placeholders of each shape, one distinct set per spot
  mixes: { about: "labelled placeholders in all 13 mixes", photos: (ctx, n) => shapesToUrls(MIX13[n % 13], `${ctx.path ?? "spot"} (${MIX13[n % 13]})`) },
  // nothing to draw
  none: { about: "no photographs at all", photos: () => [] },
  // one photo in every spot, of every shape in turn
  single: { about: "exactly one photograph in every spot", photos: (ctx, n) => [tag(real("LPS"[n % 3], n))] },
  // lots
  many: { about: "twelve photographs in every spot (first six sections)", photos: (ctx, n) => Array.from({ length: 12 }, (_, i) => tag(real("LPS"[(n + i) % 3], i))), sections: 6 },
  // very wide, very tall
  extreme: { about: "very wide (4:1) and very tall (1:4) photographs among normal ones", photos: (ctx, n) => shapesToUrls(["X", "Y", "X Y", "L X", "Y P Y", "X X", "S X Y", "Y Y Y", "X L P"][n % 9], `extreme ${n}`) },
  // one that will not load
  broken: { about: "a photograph that cannot be loaded among good ones", photos: (ctx, n) => [tag(real("L", n)), `http://localhost:${REAL_PORT}/does-not-exist-${++unique}.jpg`, tag(real("P", n))] },
  // phone photos: stored sideways with a rotation note
  exif: { about: "phone-style photographs stored sideways with a rotation note", photos: (ctx, n) => [tag(`http://localhost:${REAL_PORT}/exif-portrait.jpg`), tag(real("L", n)), tag(`http://localhost:${REAL_PORT}/exif-portrait.jpg`)] },
  // a short report
  minimal: { about: "a short report: only the first few sections, one photo each", photos: (ctx, n) => [tag(real("LPS"[n % 3], n))], sections: 4 },
};
const chosen = (process.env.AUDIT_SCENARIOS ?? Object.keys(SCENARIOS).filter((k) => !["portrait", "landscape"].includes(k)).join(",")).split(",").filter((s) => SCENARIOS[s]);

// a phone-style JPEG: pixels stored landscape, EXIF orientation 6 (to be shown portrait)
{
  const code = `
from PIL import Image, ImageDraw
im = Image.new("RGB", (1200, 900), (60, 110, 160)); d = ImageDraw.Draw(im)
d.rectangle((20, 20, 1180, 880), outline=(255, 255, 255), width=10); d.text((500, 430), "EXIF PORTRAIT", fill=(255, 255, 255))
exif = im.getexif(); exif[274] = 6
im.save("${join(PHOTOS_DIR, "exif-portrait.jpg")}", "JPEG", quality=92, exif=exif)`;
  spawnSync("python3", ["-c", code]);
}

// ---- API ----------------------------------------------------------------------------------------------------------------------------------
async function api(path, init = {}, token) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}
let token = "";
async function signIn() { // the access token only lasts a few hours; a long audit signs in again for every report
  const login = await (await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
  token = login.accessToken ?? login.tokens?.accessToken ?? login.token;
}
await signIn();

const spotOf = new Map();
let inSection = new Map();
let curKey = "";
const keyOfSpot = (u) => (spotOf.get(u) ?? "").split("::")[0];
async function buildInspection(type, scenarioName, jobNo) {
  await signIn();
  inSection = new Map();
  const scenario = SCENARIOS[scenarioName];
  let spot = 0;
  const filler = makeFiller({
    tplOf,
    photosFor: (ctx) => {
      let urls = scenario.photos(ctx, spot++);
      // the app takes at most 200 photographs in one section (the API refuses more), so a section is never given more than that
      if (!ctx.defect) { urls = urls.slice(0, Math.max(0, 190 - (inSection.get(curKey) ?? 0))); inSection.set(curKey, (inSection.get(curKey) ?? 0) + urls.length); }
      for (const u of urls) spotOf.set(u, `${curKey}::${ctx.path ?? "?"}`);
      return ctx.defect ? urls.slice(0, ctx.defectNo < 2 ? urls.length : Math.min(urls.length, 1)) : urls;
    },
  });
  const keys = scenario.sections ? type.sections.slice(0, scenario.sections) : type.sections;
  const sections = keys.map((key, i) => {
    curKey = key;
    const s = filler.fillSection(type.key, key, { jobNo, client: "Audit Client" });
    return { key, name: key === "custom_structure" ? "Garden pergola" : s.name, icon: "", order: i, status: "complete", reportText: "", fields: {}, answers: s.answers, photos: s.photos.slice(0, 200), damages: [] };
  });
  const submitted = await (await api("/inspections/submit", { method: "POST", body: JSON.stringify({ inspectionType: type.inspectionTitle, propertyType: type.title, jobNo, address: "1 Audit Street", suburb: "Box Hill VIC 3128", client: "Audit Client", date: "2026-10-03", sections }) }, token)).json();
  const id = submitted.inspection?.id ?? submitted.id ?? submitted.inspectionId;
  if (!id) throw new Error(`submit returned no id: ${JSON.stringify(submitted).slice(0, 300)}`);
  const regen = spawnSync("node", [join(here, "regenerate-report-text.mjs"), "--inspection", id, "--apply"], { env: { ...process.env, ACESPECT_API: API, ACESPECT_TOKEN: token }, encoding: "utf8" });
  if (regen.status !== 0) throw new Error(`regenerate-report-text.mjs failed: ${regen.stderr.slice(0, 400)}`);
  const { inspection } = await (await api(`/web/inspections/${id}`, {}, token)).json();
  for (const s of inspection.sections) if (s.key !== "job-info") await api(`/web/sections/${s.id}`, { method: "PATCH", body: JSON.stringify({ reviewStatus: "approved" }) }, token);
  return { id, supplied: [...new Set(sections.flatMap((s) => [...s.photos, ...collectUrls(s.answers)]))] };
}
const collectUrls = (v) => (typeof v === "string" ? (/^https?:\/\/.*\.(jpg|svg)(\?|$)/.test(v) ? [v] : []) : Array.isArray(v) ? v.flatMap(collectUrls) : v && typeof v === "object" ? Object.values(v).flatMap(collectUrls) : []);

// ---- the audits -----------------------------------------------------------------------------------------------------------------------------
// In the printed web page (laid out at the width the PDF is laid out at). Plain JavaScript: it runs inside the page.
const DOM_AUDIT = String.raw`
(() => {
  const root = document.querySelector('.report-page');
  const rr = root.getBoundingClientRect();
  const cs0 = getComputedStyle(root);
  const left = rr.left + parseFloat(cs0.paddingLeft), right = rr.right - parseFloat(cs0.paddingRight);
  const out = { photos: [], problems: [], colors: {}, contrast: [], captions: [], banner: null, rows: [] };
  const notice = (m) => out.problems.push(m);
  const visible = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };

  // photographs: every picture in the report is in the one photo grid
  const imgs = [...root.querySelectorAll('img')].filter(visible);
  for (const img of imgs) {
    if (/houspect-logo|houspect-signature/.test(img.src)) continue;
    const grid = img.closest('[data-photo-grid]');
    if (!grid) { notice('a picture is drawn outside the shared photo grid: ' + img.src.slice(-60)); continue; }
    const r = img.getBoundingClientRect();
    const fit = getComputedStyle(img).objectFit;
    const broken = !img.complete || img.naturalWidth === 0;
    const p = { src: img.currentSrc || img.src, w: r.width, h: r.height, natW: img.naturalWidth, natH: img.naturalHeight, fit, broken, left: r.left, right: r.right };
    out.photos.push(p);
    if (broken) continue;
    const drawn = (r.width - 2) / (r.height - 2), real = img.naturalWidth / img.naturalHeight;
    if (Math.abs(drawn - real) / real > 0.02 && Math.abs((r.width - 2) - (r.height - 2) * real) > 1.5) notice('a picture is not at its own shape: drawn ' + drawn.toFixed(3) + ':1, the photo is ' + real.toFixed(3) + ':1 (' + p.src.slice(-50) + ')');
    if (fit === 'cover') notice('a picture is set to crop (object-fit: cover): ' + p.src.slice(-50));
    if (r.left < left - 1 || r.right > right + 1) notice('a picture runs outside the text column: ' + p.src.slice(-50));
    if (r.width < 20 || r.height < 20) notice('a picture is tiny (' + Math.round(r.width) + 'x' + Math.round(r.height) + 'px): ' + p.src.slice(-50));
  }
  // rows of the grid: every picture in a row has the same height; a full row fills the width
  for (const grid of root.querySelectorAll('[data-photo-grid]')) {
    for (const row of grid.children) {
      const flex = row.querySelector(':scope > div');
      const rowImgs = [...row.querySelectorAll('img')].filter((i) => i.naturalWidth > 0);
      if (rowImgs.length < 2) continue;
      const hs = rowImgs.map((i) => i.getBoundingClientRect().height);
      if (Math.max(...hs) - Math.min(...hs) > 1.5) notice('pictures in one row have different heights: ' + hs.map((h) => Math.round(h)).join(', '));
      const tops = rowImgs.map((i) => i.getBoundingClientRect().top);
      if (Math.max(...tops) - Math.min(...tops) > 1.5) notice('pictures in one row do not line up at the top');
    }
  }
  // numbering: "Photo 1", "Photo 2", ... in order, one per picture of the grids that number their pictures
  for (const s of root.querySelectorAll('[data-photo-grid] span')) { const m = /^Photo (\d+)$/.exec(s.textContent.trim()); if (m) out.captions.push(+m[1]); }
  for (let i = 0; i < out.captions.length; i++) if (out.captions[i] !== i + 1) { const g = [...root.querySelectorAll('[data-photo-grid] span')].find((x) => x.textContent.trim() === 'Photo ' + out.captions[i]); const h = g && [...root.querySelectorAll('h1,h2,h3,[data-section]')].filter((x) => x.compareDocumentPosition(g) & 4).pop(); notice('photo numbers are not in order: ' + out.captions.slice(Math.max(0, i - 2), i + 3).join(',') + (h ? ' (after "' + h.textContent.trim().slice(0, 40) + '")' : '')); break; }

  // colours: text readable on what is behind it; no old brand colours
  const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const [r, g, b, a] = m[1].split(',').map(parseFloat); return { r, g, b, a: a === undefined ? 1 : a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const backdrop = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const seen = new Set();
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const s = getComputedStyle(el);
    for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderLeftColor', 'borderRightColor', 'borderBottomColor']) {
      const c = rgb(s[prop]); if (c && c.a > 0.5 && (prop === 'color' ? own : true) && (prop === 'color' || /Color$/.test(prop))) { if (prop.startsWith('border') && parseFloat(s[prop.replace('Color', 'Width')]) === 0) continue; out.colors[hex(c)] = (out.colors[hex(c)] || 0) + 1; }
    }
    if (!own) continue;
    const fg = rgb(s.color), bg = backdrop(el);
    if (!fg) continue;
    const size = parseFloat(s.fontSize), bold = parseInt(s.fontWeight, 10) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const cr = ratio(fg, bg);
    const key = hex(fg) + '/' + hex(bg) + '/' + need;
    if (cr < need && !seen.has(key)) { seen.add(key); out.contrast.push({ text: el.textContent.trim().slice(0, 40), fg: hex(fg), bg: hex(bg), ratio: +cr.toFixed(2), need }); }
  }
  // the cover
  const banner = [...root.querySelectorAll('div')].find((d) => getComputedStyle(d).borderRightWidth === '9px' && getComputedStyle(d).borderRightStyle === 'solid' && d.innerText && d.innerText.length < 80);
  if (banner) { const s = getComputedStyle(banner); out.banner = { text: banner.innerText.replace(/\s+/g, ' ').trim(), bg: hex(rgb(s.backgroundColor)), edge: hex(rgb(s.borderRightColor)) }; }
  out.pageBreaks = root.querySelectorAll('.report-page-break').length;
  out.missing = root.querySelectorAll('[data-photo-missing]').length;
  out.fullText = root.innerText;
  out.leaves = [];
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const t = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    if (t.length >= 30) out.leaves.push(getComputedStyle(el).textTransform === 'uppercase' ? t.toUpperCase() : t);
  }
  return out;
})()
`;

// colours that belong to an earlier look of the report -- none may be left in it (#dc2626 is not one: it is the "Poor" condition grade's own colour)
const OLD_COLORS = ["#1a2a4a", "#183966", "#0f1d35", "#ce2328"];
const BANNED = [/__other__/, /DEFECT::/, /COND::/, /ROOMHEAD::/, /\bitem\d+\b/, /\bundefined\b/, /\[object Object\]/, /\bNaN\b/, /\bnull\b/, /of \./, /[a-z]\.\.(?!\.)/, /\bother\b\s*\./i, /,,/, /\s[.,;]\s*(?=[A-Z])/, /\b([a-z]{3,}) \1\b/];
const FOOTER_WORDS = new Set("client name date job page of houspect victoria com box vic info www trading acespect pty ltd abn acn waverley houspectvic".split(" "));

const results = [];
const notes = [];
const failures = [];
const flush = () => writeFileSync(join(OUT, "failures-so-far.txt"), failures.map((f) => `${f.scenario} | ${f.check} | ${f.detail}`).join("\n"));
const record = (scenario, type, check, ok, detail = "") => {
  results.push({ scenario, type, check, ok, detail });
  if (!ok) failures.push({ scenario, type, check, detail });
};
const wordsOf = (t) => (t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !FOOTER_WORDS.has(w) && !/^\d+$/.test(w) && !/^(hv|ci|aud)\d*/.test(w));

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"], protocolTimeout: 900_000 });
let n = 0;
for (const scenarioName of chosen) {
  for (const type of TYPES) {
    if (process.env.AUDIT_ONLY && !process.env.AUDIT_ONLY.split(",").includes(`${scenarioName}/${type.key}`)) continue; // e.g. AUDIT_ONLY=real/residential_house,none/apartment: re-run just those reports
    const label = `${scenarioName} / ${type.key}`;
    const jobNo = `HV-26-AUD${String(++n).padStart(2, "0")}`;
    process.stdout.write(`\n== ${label}: ${SCENARIOS[scenarioName].about}\n`);
    try {
      const { id, supplied } = await buildInspection(type, scenarioName, jobNo);
      const base = join(OUT, `${n.toString().padStart(2, "0")}-${scenarioName}-${type.key}`);

      // the web page, as it prints
      const page = await browser.newPage();
      await page.emulateMediaType("print");
      await page.setViewport({ width: 628, height: 1100, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument((t) => localStorage.setItem("acespect_token", t), token);
      await page.goto(`${WEB}/report/${id}`, { waitUntil: "networkidle0", timeout: 300_000 });
      await page.waitForSelector(".report-page", { timeout: 120_000 });
      await page.waitForFunction("!document.querySelector('[data-photo-grid-pending]')", { timeout: 30_000 }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 800));
      const dom = await page.evaluate(DOM_AUDIT);
      await page.close();

      // photographs
      const problems = dom.problems;
      record(label, type.key, "photos: shape, position, rows and numbering", problems.length === 0, problems.slice(0, 6).join(" | "));
      const good = dom.photos.filter((p) => !p.broken);
      // What the report prints by design: Job Information and Notes have no photographs, and the Description prints only the front-of-the-property photograph (the other street / site photographs are for the reviewer and the archive link).
      // only the Residential House form has a front-of-property photo field; the Commercial / Apartment / Public Assets reports print a placeholder there for the reviewer
      const frontPhoto = type.key === "residential_house" || type.key === "construction" ? supplied.find((x) => /description$/.test(keyOfSpot(x))) : undefined;
      const frontIs = (u) => u === frontPhoto;
      const byDesign = (u) => ["job-info", "notes"].includes(keyOfSpot(u)) || (/description$/.test(keyOfSpot(u)) && !frontIs(u));
      const expectedPrinted = supplied.filter((u) => !/does-not-exist/.test(u) && !byDesign(u));
      if (scenarioName === "none") record(label, type.key, "photos: none supplied, none drawn", dom.photos.length === 0, `${dom.photos.length} drawn`);
      else {
        const drawn = new Set(dom.photos.map((p) => p.src));
        const missing = expectedPrinted.filter((u) => !drawn.has(u));
        // Notes and Post Project have no place for photographs (see ReportView); the others print every photograph they are given
        const where = [...new Set(missing.map((u) => spotOf.get(u)))].slice(0, 6).join(" ; ");
        record(label, type.key, "photos: every supplied photograph is drawn", missing.length === 0, `${missing.length} of ${expectedPrinted.length} not drawn; photo spots: ${where}`);
        if (frontPhoto) record(label, type.key, "photos: the front-of-property photograph is drawn", drawn.has(frontPhoto), frontPhoto.slice(-40));
        if (scenarioName !== "broken") record(label, type.key, "photos: every photograph loaded (none shows as a broken picture)", dom.photos.every((p) => !p.broken), `${dom.photos.filter((p) => p.broken).length} broken, e.g. ${dom.photos.find((p) => p.broken)?.src.slice(-60) ?? ""}`);
        record(label, type.key, "photos: some photographs are drawn", good.length > 0, `${good.length} loaded, ${dom.photos.length - good.length} broken`);
      }
      if (scenarioName === "broken") {
        const wanted = supplied.filter((u) => /does-not-exist/.test(u)).length;
        record(label, type.key, "photos: a photograph that cannot be loaded shows a plain 'Photograph unavailable' box (no broken-picture icon) and the rest still print", dom.missing > 0 && dom.missing <= wanted && dom.photos.every((p) => !p.broken) && good.length > 0, `${dom.missing} unavailable boxes for ${wanted} bad links, ${good.length} good photographs`);
      }
      if (scenarioName === "exif") {
        const rot = dom.photos.filter((p) => /exif-portrait/.test(p.src));
        record(label, type.key, "photos: rotation note respected (drawn portrait)", rot.length > 0 && rot.every((p) => p.h > p.w), rot.slice(0, 2).map((p) => `${Math.round(p.w)}x${Math.round(p.h)}`).join(" "));
      }
      // colours
      const stray = OLD_COLORS.filter((c) => dom.colors[c]);
      record(label, type.key, "colours: no old brand colours left", stray.length === 0, stray.map((c) => `${c} x${dom.colors[c]}`).join(", "));
      record(label, type.key, "colours: all text readable (WCAG contrast)", dom.contrast.length === 0, dom.contrast.slice(0, 4).map((c) => `"${c.text}" ${c.fg} on ${c.bg} = ${c.ratio}:1 (needs ${c.need})`).join(" | "));
      // the cover
      record(label, type.key, "cover: navy banner with red edge, kicker and title", !!dom.banner && dom.banner.bg === "#1b3a6b" && dom.banner.edge === "#d1262b" && dom.banner.text.toUpperCase().startsWith(type.kicker) && dom.banner.text.includes(type.bannerTitle), JSON.stringify(dom.banner));

      // the PDF
      const pdfRes = await fetch(`${API}/inspections/${id}/report.pdf`, { headers: { Authorization: `Bearer ${token}` } });
      record(label, type.key, "pdf: generated", pdfRes.status === 200, `HTTP ${pdfRes.status}`);
      const pdfPath = `${base}.pdf`;
      writeFileSync(pdfPath, Buffer.from(await pdfRes.arrayBuffer()));
      const pa = JSON.parse(execFileSync("python3", [join(here, "lib/pdf_audit.py"), pdfPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
      record(label, type.key, "pdf: footer 'Page N of M' on every page, no blank page, no stretched picture, no heading at a page bottom", pa.problems.length === 0, pa.problems.slice(0, 4).join(" | "));
      for (const w of pa.warnings ?? []) notes.push(`${label}: ${w}`);
      const pdfText = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      const flat = pdfText.replace(/\s+/g, " ");
      const hits = BANNED.flatMap((re) => { const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"); const found = [...flat.matchAll(g)].slice(0, 3).map((m) => flat.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)); return found.length ? [`${re} -> ${found.map((f) => `"…${f}…"`).join(" ")}`] : []; });
      record(label, type.key, "wording: no leaked markers or broken punctuation in the PDF", hits.length === 0, hits.join(" "));

      // the Word file
      const wres = await fetch(`${API}/inspections/${id}/report.docx`, { headers: { Authorization: `Bearer ${token}` } });
      record(label, type.key, "word: generated", wres.status === 200, `HTTP ${wres.status}`);
      const docxPath = `${base}.docx`;
      writeFileSync(docxPath, Buffer.from(await wres.arrayBuffer()));
      const wa = JSON.parse(execFileSync("python3", [join(here, "lib/docx_audit.py"), docxPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
      record(label, type.key, "word: valid file, pictures keep their shape and fit the page", wa.ok, wa.problems.slice(0, 3).join(" | "));
      record(label, type.key, "word: the same pictures as the page", scenarioName === "none" ? wa.pictures <= 1 : Math.abs(wa.pictures - good.length) <= Math.max(2, good.length * 0.1), `${wa.pictures} in Word (incl. logo), ${good.length} on the page`);
      // every sentence the page shows is in the PDF (compared on letters and digits only, by its first and last 30, so a line broken across a page still counts)
      const squash = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
      const pdfSquashed = squash(execFileSync("pdftotext", [pdfPath, "-"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })); // reading order, so a sentence wrapped inside a table cell stays whole
      const lost = dom.leaves.filter((t) => { const q = squash(t); return q.length >= 20 && !(pdfSquashed.includes(q.slice(0, 30)) && pdfSquashed.includes(q.slice(-30))); });
      record(label, type.key, "pdf: every sentence on the page is in the PDF", lost.length === 0, `${lost.length} of ${dom.leaves.length} missing${lost.length ? `, e.g. "${lost[0].slice(0, 70)}"` : ""}`);
      // Word carries the same words as the page
      const wtext = execFileSync("textutil", ["-convert", "txt", "-stdout", docxPath], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
      if (scenarioName === "broken") record(label, type.key, "word: the unavailable box carries its text", /Photograph unavailable/.test(wtext), "");
      const pw = wordsOf(dom.fullText), ww = wordsOf(wtext);
      const count = (arr) => arr.reduce((m, w) => m.set(w, (m.get(w) ?? 0) + 1), new Map());
      const [pc, wc] = [count(pw), count(ww)];
      const diff = (a, b) => [...a].map(([w, c]) => [w, c - (b.get(w) ?? 0)]).filter(([, d]) => d > 0).sort((x, y) => y[1] - x[1]);
      const onlyPage = diff(pc, wc), onlyWord = diff(wc, pc);
      const sum = (l) => l.reduce((t, [, d]) => t + d, 0);
      const top = (l) => l.slice(0, 6).map(([w, d]) => `${w}x${d}`).join(" ");
      record(label, type.key, "word: same words as the page", sum(onlyPage) <= pw.length * 0.01 && sum(onlyWord) <= pw.length * 0.01, `${sum(onlyPage)} words only on the page (${top(onlyPage)}), ${sum(onlyWord)} only in Word (${top(onlyWord)}), of ${pw.length}`);

      if (!process.env.KEEP) for (const f of [pdfPath, docxPath]) try { execFileSync("rm", ["-f", f]); } catch { /* ignore */ }
      flush();
      console.log(`   ${results.filter((r) => r.scenario === label).filter((r) => r.ok).length}/${results.filter((r) => r.scenario === label).length} checks pass; ${pa.pages} pages, ${good.length} photographs`);
    } catch (e) {
      record(label, type.key, "the scenario ran", false, String(e.message ?? e).slice(0, 400));
      console.log(`   FAILED to run: ${String(e.message ?? e).slice(0, 200)}`);
    }
  }
}
await browser.close();

// ---- the report -----------------------------------------------------------------------------------------------------------------------------
const lines = ["# Report audit", "", `${results.length} checks in ${new Set(results.map((r) => r.scenario)).size} reports: ${results.filter((r) => r.ok).length} pass, ${failures.length} fail.`, ""];
if (failures.length) {
  lines.push("## Failures", "");
  for (const f of failures) lines.push(`- **${f.scenario}** — ${f.check}: ${f.detail}`);
  lines.push("");
}
if (notes.length) lines.push("## Notes (not failures)", "", ...notes.map((n) => `- ${n}`), "");
lines.push("## Every check", "", "| Report | Check | Result | Detail |", "|---|---|---|---|");
for (const r of results) lines.push(`| ${r.scenario} | ${r.check} | ${r.ok ? "pass" : "**FAIL**"} | ${String(r.detail).replace(/\|/g, "/").slice(0, 160)} |`);
writeFileSync(join(OUT, "audit-report.md"), lines.join("\n"));
console.log(`\n${results.filter((r) => r.ok).length} of ${results.length} checks pass; the report is ${join(OUT, "audit-report.md")}`);
realServer.close();
svgServer.close();
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures.slice(0, 60)) console.log(` - ${f.scenario}: ${f.check} -- ${f.detail}`);
  process.exit(1);
}
