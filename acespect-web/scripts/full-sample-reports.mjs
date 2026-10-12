#!/usr/bin/env node
// Fully populated sample reports: one per Dilapidation report type, with EVERY field the form shows filled in -- every select answered,
// every multi-select ticked, every text box written, every repeating item (each room, side, area, survey part) and every defect list
// completed, and photographs on every photo field -- built from the REAL published templates, then run through the real report pipeline
// (wording, approval, PDF and Word). Run it against a running backend + web app (scripts/ci/report-e2e.sh starts them):
//
//   SMOKE_SCRIPT=scripts/full-sample-reports.mjs FULL_OUT=<folder> PHOTOS_DIR=<folder of man-L.jpg, house-L.jpg, ...> \
//   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public scripts/ci/report-e2e.sh
//
// A field is filled when the form shows it. Fields that exist only for a different answer to a question already answered (for example
// "which part of the property?" when the scope was answered "all structures") cannot be shown at the same time; coverage.md lists them.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { serveFolder } from "./lib/placeholder-photos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const API = (process.env.ACESPECT_API ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = resolve(process.env.FULL_OUT ?? ".");
const PHOTOS_DIR = resolve(process.env.PHOTOS_DIR ?? ".");
const PHOTO_PORT = Number(process.env.PHOTO_PORT ?? 5198);
if (!EMAIL || !PASSWORD) throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD are required");
const photoServer = await serveFolder(PHOTO_PORT, PHOTOS_DIR);

const SNAP = JSON.parse(readFileSync(resolve(here, "../../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const tplOf = (profile, key) => SNAP.find((t) => t.inspectionType === "dilapidation" && t.propertyType === profile && t.sectionKey === key);

// ---- photographs ---------------------------------------------------------------------------------------------------------------
// The supplied photographs, as supplied (L) and cropped to a portrait (P) and a square (S), alternating between the two pictures.
const turn = { L: 0, P: 0, S: 0 };
const photo = (shape) => `http://localhost:${PHOTO_PORT}/${["man", "house"][turn[shape]++ % 2]}-${shape}.jpg`;
const MIXES = ["L L", "P P L", "L L L", "L P", "L P P", "S L", "P P P", "L", "L L P", "P L P L", "P", "L P L P L P", "S S", "L L L L"];
let mixAt = 0;
const nextMix = () => MIXES[mixAt++ % MIXES.length].split(" ").map(photo);

// ---- filling a form ----------------------------------------------------------------------------------------------------------------
const GRADES = ["satisfactory_with_typical_wear_and_tear", "fair", "average", "poor", "new"];
let rotate = 0;
let grade = 0;
const SKIP_CHOICE = /^(not applicable|none\b|n\/?a\b|no visible|no significant|nil\b|no chimney|nothing|no repairs|no attention|not required|no$)/i;
const SENTENCES = [
  "Photographed and noted on the day of the inspection.",
  "No access was available to the far side, so this was assessed from the near side only.",
  "Recorded for the before-works condition of the property.",
];
let sentenceAt = 0;

function textFor(f, ctx) {
  const k = f.key;
  const lab = f.label ?? "";
  const by = [
    [/^jobNumber$/, ctx.jobNo], [/^assignedInspector$/, "Report Smoke"], [/^clientName$/, ctx.client], [/^inspectionAddress$/, "1 Sample Street, Box Hill VIC 3128"],
    [/^businessName$/, "Sample Building Co."], [/^firstPicNo$/, "1"], [/^lastPicNo$/, "120"], [/constructedYear/i, "1998"], [/^underConstructionStage$/, "frame stage"],
    [/^storeys$/, "2"], [/projectSiteAddress|projectAddr/, "3 Sample Street, Box Hill VIC 3128"], [/^partyWallNumber$/, "12"], [/^unitNumber$/, "7"], [/^buildingName$/, "Sample Heights"],
    [/^partName$/, ctx.partName ?? "Part A: Frontage to project site"], [/^roadName$/, "Sample Street"], [/^startRef$/, "3m past the boundary of no. 5"], [/^endRef$/, "the corner of Smith Street"],
    [/^startDirection$/, "south to north"], [/^crackStartLocation$/, "the front corner"], [/^crackEndLocation$/, "the rear corner"], [/^location$/, ctx.where ?? "the centre of the area"],
    [/^element$/, "slab"], [/^description$/, "Timber pergola"], [/^otherDescription$/, "A small pump house at the north end"], [/^other$/, "A short note on an additional area."],
    [/^scopeChanges$/, "A second garage was added to the scope after the inspection was booked."], [/^scopeDetail$/, "the rear unit"], [/^scopePartDetail$/, "the ground floor"],
    [/^gen_roomsNotAccessed$|^roomsNotAccessed$/, "Plant room (locked)"], [/^gen_renovationsRooms$|^renovationsRooms$/, "the first floor offices"],
    [/movementWhere$/, "the hallway near the kitchen"], [/SafetyAdvisoryNotes$|^safetyAdvisoryNotes$/i, "Exposed cables were noted in the meter box."],
    [/^reason$/, "Locked at the time of the inspection"], [/^worstItem$/, "Rusted posts and leaning panels near the gate"], [/^drainageNote$/, "Water ponds near the downpipe."],
    [/^(areaName|elevationName|fenceName|structureName|wallName|roomName|name|area)$/, ctx.instanceLabel ?? "Rear courtyard"],
    [/proposedWorksTypeOther|worksTypeOther/, "tunnel works"], [/siteSideOther/, "opposite side"], [/siteDirectionOther/, "north-east"], [/weatherOther/, "light fog"],
    [/orientationOther/, "north-east corner"], [/partialInspectionOther/, "the side boundary"],
    [/Other$|^materialOther$/, "reclaimed hardwood"],
    [/notes$|Notes$|comments$|describe$|where$|^note$|Where$/i, null],
  ];
  for (const [re, v] of by) if (re.test(k)) return v ?? SENTENCES[sentenceAt++ % SENTENCES.length];
  return /address/i.test(lab) ? "1 Sample Street, Box Hill VIC 3128" : "as noted on site";
}

const wantedFor = (fields) => {
  const w = {};
  for (const f of fields) {
    const g = f.gate;
    if (!g || g.fieldKey === "__instanceKey") continue;
    (w[g.fieldKey] ??= []).push(...(g.equalsAny ?? [g.equals]));
  }
  return w;
};
const visible = (f, scope) => {
  const g = f.gate;
  if (!g) return true;
  const v = scope[g.fieldKey];
  const hit = (t) => (Array.isArray(v) ? v.includes(t) : v === t);
  return g.equalsAny ? g.equalsAny.some(hit) : hit(g.equals);
};

// Which fields of a section are filled in at least once (a party-wall field is filled on Left and Right only; a defect's crack fields on its cracking defect).
const coverage = { total: new Set(), filled: new Set(), names: new Map() };
const resetCoverage = () => { coverage.total.clear(); coverage.filled.clear(); coverage.names.clear(); };

function pickChoice(f, wanted) {
  const opts = (f.options ?? []).filter((o) => !o.exclusive);
  const w = wanted?.find((v) => opts.some((o) => o.value === v));
  if (w) return w;
  if (f.type === "color-select") { const want = GRADES[grade++ % GRADES.length]; return opts.find((o) => o.value === want)?.value ?? opts[0]?.value; }
  if (f.key === "proposedWorksType") return opts.find((o) => /residential/i.test(o.label))?.value ?? opts[0]?.value;
  const pool = opts.filter((o) => o.value !== "other" && !SKIP_CHOICE.test(o.label.trim()));
  return (pool.length ? pool : opts)[rotate++ % (pool.length || opts.length)]?.value;
}

/** Fills every field the form shows for these `fields`. `preset` answers go in first (a defect's type, an instance's fixed answers). */
function fill(fields, ctx = {}, preset = {}) {
  const scope = { ...preset };
  if (ctx.instanceKey) scope.__instanceKey = ctx.instanceKey;
  const wants = wantedFor(fields);
  const done = new Set(Object.keys(preset));
  for (let pass = 0; pass < 4; pass++) {
    for (const f of fields) {
      if (done.has(f.key) || !visible(f, scope) || (f.gate?.fieldKey === "__instanceKey" && !(f.gate.equalsAny ?? [f.gate.equals]).includes(ctx.instanceKey))) continue;
      done.add(f.key);
      scope[f.key] = valueOf(f, scope, ctx, wants[f.key]);
    }
  }
  delete scope.__instanceKey;
  for (const f of fields) {
    const sig = `${ctx.path ?? ""}|${f.key}`;
    coverage.total.add(sig);
    const parent = f.gate ? fields.find((x) => x.key === f.gate.fieldKey) : undefined;
    const reason = !f.gate ? "" : f.gate.fieldKey === "__instanceKey" ? "only on certain tabs" : parent && !(f.gate.equalsAny ?? [f.gate.equals]).some((v) => parent.options?.some((o) => o.value === v)) ? "its question has no such choice, so the app never shows it" : "shown only for a different answer";
    coverage.names.set(sig, `${ctx.path ?? ""}: ${f.label || f.key}  (${f.key}) -- ${reason}`);
    if (done.has(f.key) && !(f.gate?.fieldKey === "__instanceKey" && ctx.instanceKey && !(f.gate.equalsAny ?? [f.gate.equals]).includes(ctx.instanceKey))) coverage.filled.add(sig);
  }
  return scope;
}

function valueOf(f, scope, ctx, wanted) {
  switch (f.type) {
    case "yesno": return wanted?.includes("no") && !wanted.includes("yes") ? "no" : "yes";
    case "pill-select": case "select-tiles": case "color-select": return pickChoice(f, wanted);
    case "chip-multiselect": case "tile-multiselect": {
      const opts = (f.options ?? []).filter((o) => !o.exclusive && o.value !== "other" && !SKIP_CHOICE.test(o.label.trim()));
      const at = rotate++;
      const chosen = [0, 1, 2].map((i) => opts[(at + i) % Math.max(1, opts.length)]?.value).filter((v, i, a) => v && a.indexOf(v) === i);
      const withOther = (f.options ?? []).some((o) => o.value === "other") && ctx.fields?.some?.((x) => x.key === `${f.key}Other`);
      const wantsAll = (wanted ?? []).filter((v) => (f.options ?? []).some((o) => o.value === v));
      return [...new Set([...chosen, ...wantsAll, ...(withOther ? ["other"] : [])])];
    }
    case "photos": { const p = ctx.defect ? nextMix().slice(0, ctx.defectNo < 2 ? 2 : 1) : nextMix(); if (!ctx.defect) ctx.collect?.push(...p); return p; }
    case "numeric": return /width/i.test(f.key) ? 3 : /length/i.test(f.key) ? 450 : 2;
    case "date": return "2026-10-03";
    case "damage-list": return defects(f, ctx);
    case "repeating-group": return group(f, ctx);
    default: return textFor(f, ctx);
  }
}

function defects(f, ctx) {
  const items = f.itemFields ?? [];
  const typeField = items.find((x) => x.key === "damageType");
  const types = (typeField?.options ?? []).filter((o) => o.value !== "other").map((o) => o.value);
  const where = ["the centre of the slab", "the north-east corner", "the base of the wall", "the front edge", "the rear corner", "the join at the step", "the top rail", "the lowest course"];
  // One defect of each type, so every defect type's own fields (the cracking size, the surface / moisture / movement ... choice) are filled in.
  return (types.length ? types : [undefined]).map((type, i) => {
    const preset = type ? { damageType: type } : {};
    return fill(items, { ...ctx, defect: true, defectNo: i, where: where[i % where.length], fields: items, path: `${ctx.path ?? ""} > ${f.label}` }, preset);
  });
}

function group(f, ctx) {
  const items = f.itemFields ?? [];
  const fixed = f.repeat?.fixedInstances;
  if (fixed?.length && f.repeat.presentation !== "strip") {
    return Object.fromEntries(fixed.map((inst) => [inst.key, fill(items, { ...ctx, instanceKey: inst.key, instanceLabel: inst.label, fields: items, path: `${ctx.path ?? ""} > ${f.label || f.key}` })]));
  }
  return [0, 1].map((i) => fill(items, { ...ctx, partName: i ? "Part B: Laneway" : "Part A: Frontage to project site", fields: items, path: `${ctx.path ?? ""} > ${f.label || f.key}` }));
}

function fillSection(profile, key, ctx) {
  const t = tplOf(profile, key);
  const collect = [];
  const answers = fill(t.fields, { ...ctx, collect, fields: t.fields, path: t.name });
  return { key, name: t.name, answers, photos: collect };
}

// ---- the four reports --------------------------------------------------------------------------------------------------------------------
const PLAN = [
  { profile: "residential_house", title: "Residential House", file: "1-Dilapidation-Residential-House", jobNo: "HV-26-FULL01", client: "Full Sample Client",
    sections: ["job-info", "description", "driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "pool_spa", "elevations", "roof_chimneys", "internal_areas", "notes", "custom_structure"] },
  { profile: "commercial_properties", title: "Commercial Properties", file: "2-Dilapidation-Commercial-Properties", jobNo: "HV-26-FULL02", client: "Full Sample Commercial Client",
    sections: ["job-info", "description", "driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "elevations", "roof_chimneys", "internal_areas", "pool_spa", "notes", "custom_structure"] },
  { profile: "apartment", title: "Apartment", file: "3-Dilapidation-Apartment", jobNo: "HV-26-FULL03", client: "Full Sample Apartment Client",
    sections: ["job-info", "description", "elevations", "roof_chimneys", "internal_areas", "paving_paths", "notes", "custom_structure"] },
  { profile: "public_assets", title: "Public Assets", file: "4-Dilapidation-Public-Assets", jobNo: "HV-26-FULL04", client: "Full Sample Public Assets Client",
    sections: ["job-info", "description", "elevations", "custom_structure"] },
];

async function api(path, init = {}, token) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}
const login = await (await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
const token = login.accessToken ?? login.tokens?.accessToken ?? login.token;

mkdirSync(OUT, { recursive: true });
const report = [];
for (const plan of PLAN) {
  console.log(`\n== ${plan.title}`);
  resetCoverage();
  mixAt = 0;
  const ctx = { jobNo: plan.jobNo, client: plan.client };
  const sections = plan.sections.map((key, i) => {
    const s = fillSection(plan.profile, key, ctx);
    return { key: s.key, name: key === "custom_structure" ? "Garden pergola" : s.name, icon: "", order: i, status: "complete", reportText: "", fields: {}, answers: s.answers, photos: s.photos, damages: [] };
  });
  const submitted = await (await api("/inspections/submit", { method: "POST", body: JSON.stringify({ inspectionType: "Dilapidation", propertyType: plan.title, jobNo: plan.jobNo, address: "1 Sample Street", suburb: "Box Hill VIC 3128", client: plan.client, date: "2026-10-03", sections }) }, token)).json();
  const id = submitted.inspection?.id ?? submitted.id ?? submitted.inspectionId;
  if (!id) throw new Error(`submit returned no id: ${JSON.stringify(submitted).slice(0, 300)}`);
  const regen = spawnSync("node", [join(here, "regenerate-report-text.mjs"), "--inspection", id, "--apply"], { env: { ...process.env, ACESPECT_API: API, ACESPECT_TOKEN: token }, encoding: "utf8" });
  if (regen.status !== 0) throw new Error(`regenerate-report-text.mjs failed: ${regen.stderr}`);
  const { inspection } = await (await api(`/web/inspections/${id}`, {}, token)).json();
  for (const s of inspection.sections) if (s.key !== "job-info") await api(`/web/sections/${s.id}`, { method: "PATCH", body: JSON.stringify({ reviewStatus: "approved" }) }, token);
  for (const ext of ["pdf", "docx"]) {
    const res = await fetch(`${API}/inspections/${id}/report.${ext}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status !== 200) throw new Error(`report.${ext} returned ${res.status}`);
    writeFileSync(join(OUT, `${plan.file}.${ext}`), Buffer.from(await res.arrayBuffer()));
  }
  const notFilled = [...coverage.total].filter((x) => !coverage.filled.has(x)).map((x) => coverage.names.get(x));
  console.log(`  ${coverage.filled.size} of ${coverage.total.size} fields filled (every other one is a different answer to a question already answered); saved ${plan.file}`);
  report.push({ plan, filled: coverage.filled.size, total: coverage.total.size, notShown: notFilled });
}

const md = [`# Fully populated sample reports -- field coverage`, "", "Every field the form can show is filled in. The few listed below cannot be: either the question they hang off has no such choice (an old \"If Other\" box that the app never shows because the question takes an inline Other instead), or they belong to a different answer to a question already answered.", ""];
for (const r of report) {
  md.push(`## ${r.plan.title}: ${r.filled} of ${r.total} fields filled`, "", ...(r.notShown.length ? r.notShown.map((x) => `- ${x}`) : ["- (none)"]), "");
}
writeFileSync(join(OUT, "coverage.md"), md.join("\n"));
console.log(`\nwrote the reports and coverage.md to ${OUT}`);
photoServer.close();
