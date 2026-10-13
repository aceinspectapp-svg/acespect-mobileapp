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
import { makeFiller } from "./lib/form-filler.mjs";

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

const { fillSection, coverage, resetCoverage } = makeFiller({
  tplOf,
  photosFor: (ctx) => (ctx.defect ? nextMix().slice(0, ctx.defectNo < 2 ? 2 : 1) : nextMix()),
});

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
