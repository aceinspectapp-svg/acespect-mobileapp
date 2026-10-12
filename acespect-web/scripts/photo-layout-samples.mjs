#!/usr/bin/env node
// Sample PDF of the report's photo layout: one section per combination of photo shapes (two portraits and a landscape, two
// landscapes and a portrait, ...), each photo a labelled placeholder drawn at the shape named in its label, so what the layout does
// with each mix can be seen on paper. Run against a running backend + web app (scripts/ci/report-e2e.sh starts them):
//
//   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public SMOKE_SCRIPT=scripts/photo-layout-samples.mjs \
//   SAMPLES_OUT=/path/to/folder scripts/ci/report-e2e.sh
//
// Writes photo-layout-samples.pdf into SAMPLES_OUT (default: the system temp folder).
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const API = (process.env.ACESPECT_API ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const OUT = resolve(process.env.SAMPLES_OUT ?? tmpdir());
const PHOTO_PORT = Number(process.env.PHOTO_PORT ?? 5198);
if (!EMAIL || !PASSWORD) throw new Error("SMOKE_EMAIL and SMOKE_PASSWORD are required");

// ---- the placeholder photos: SVGs of a given shape, served locally ------------------------------------------------------------
const SHAPES = {
  P: { w: 900, h: 1200, name: "PORTRAIT 3:4", color: "#2f6f9f" },
  L: { w: 1200, h: 900, name: "LANDSCAPE 4:3", color: "#b86a2d" },
  S: { w: 1000, h: 1000, name: "SQUARE 1:1", color: "#4d8f5a" },
  W: { w: 1800, h: 600, name: "PANORAMA 3:1", color: "#8a4f9e" },
  T: { w: 600, h: 1200, name: "TALL 1:2", color: "#a33a4a" },
};
const svgFor = (kind, n, set) => {
  const s = SHAPES[kind];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${s.h}" viewBox="0 0 ${s.w} ${s.h}"><rect width="100%" height="100%" fill="${s.color}"/><rect x="12" y="12" width="${s.w - 24}" height="${s.h - 24}" fill="none" stroke="white" stroke-width="8"/><line x1="0" y1="0" x2="${s.w}" y2="${s.h}" stroke="white" stroke-opacity=".35" stroke-width="6"/><line x1="${s.w}" y1="0" x2="0" y2="${s.h}" stroke="white" stroke-opacity=".35" stroke-width="6"/><text x="50%" y="42%" font-family="Arial" font-size="${Math.min(s.w, s.h) / 3}" font-weight="700" fill="white" text-anchor="middle">${kind}${n}</text><text x="50%" y="58%" font-family="Arial" font-size="${Math.min(s.w, s.h) / 11}" fill="white" text-anchor="middle">${s.name}</text><text x="50%" y="68%" font-family="Arial" font-size="${Math.min(s.w, s.h) / 14}" fill="white" fill-opacity=".85" text-anchor="middle">${set}</text></svg>`;
};
const server = createServer((req, res) => {
  const m = /^\/photo\/([A-Z])(\d+)\/(.+)\.svg$/.exec(req.url ?? "");
  if (!m || !SHAPES[m[1]]) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }).end(svgFor(m[1], m[2], decodeURIComponent(m[3])));
});
await new Promise((ok) => server.listen(PHOTO_PORT, ok));
const photosOf = (shapes, set) => [...shapes].map((k, i) => `http://localhost:${PHOTO_PORT}/photo/${k}${i + 1}/${encodeURIComponent(set)}.svg`);

// ---- the combinations, one report section each --------------------------------------------------------------------------------
const SNAP = JSON.parse(readFileSync(resolve(here, "../../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const tpl = (k) => SNAP.find((t) => t.inspectionType === "dilapidation" && t.propertyType === "residential_house" && t.sectionKey === k);
function valueOf(field, label) {
  const l = String(label).toLowerCase();
  const o = field.options.find((x) => x.label.toLowerCase() === l) ?? field.options.find((x) => x.label.toLowerCase().startsWith(l));
  return o?.value;
}
function convert(fields, answers) {
  const out = {};
  for (const [key, val] of Object.entries(answers)) {
    const f = fields.find((x) => x.key === key);
    if (!f) continue;
    if (f.options && typeof val === "string") out[key] = valueOf(f, val);
    else if (f.options && Array.isArray(val)) out[key] = val.map((v) => valueOf(f, v)).filter((v) => v !== undefined);
    else if (f.type === "damage-list") out[key] = val.map((d) => convert(f.itemFields, d));
    else if (f.type === "repeating-group") out[key] = Array.isArray(val) ? val.map((d) => convert(f.itemFields, d)) : Object.fromEntries(Object.entries(val).map(([k, d]) => [k, convert(f.itemFields, d)]));
    else out[key] = val;
  }
  return out;
}
const base = { condition: "Fair" };
// section key -> [what the section's photos are, the minimal answers that make the section appear]
const CASES = {
  driveway: ["P P L", "Two portraits and a landscape", { present: "yes", locatedAt: "Front left", material: "Concrete", ...base, damages: [{ location: "the centre of the slab", damageType: "Cracking", sub_cracking: "Fine", direction: "Vertical", widthMm: 2, lengthMm: 300, photos: "DEFECT:P P L" }] }],
  paving_paths: ["L L P", "Two landscapes and a portrait", { areas: { front: { present: "yes", material: ["Concrete"], ...base } } }],
  fences: ["P P P", "Three portraits", { items: { front: { present: "yes", material: ["Brick"], ...base } } }],
  retaining_walls: ["L L L", "Three landscapes", { present: "yes", items: [{ location: "Left", materials: ["Brick"], ...base }] }],
  garage_carport_sheds: ["P L P L P", "Five photos, alternating portrait and landscape", { structures: { garage: { present: "yes", attachment: "Attached to house", position: "Front", walls: ["Brick"], wallsCondition: "Fair" } } }],
  pool_spa: ["P", "One portrait on its own", { present: "yes", position: "Rear", ...base }],
  elevations: ["P P P P", "Four portraits", { sides: { front: { orientation: "North", ...base } } }],
  roof_chimneys: ["L P", "One landscape and one portrait", { sections: { upper: { coveringType: ["Colorbond"], ...base } } }],
  internal_areas: ["S W T", "Unusual shapes: a square, a 3:1 panorama and a tall 1:2 portrait", { rooms: { kitchen: { present: "yes", floorLevel: "Ground floor", generalCondition: "Fair" } } }],
  notes: ["L P P L L P", "Six photos, mixed", { additionalNotes: "Photo layout sample." }],
};
const compact = (s) => s.replace(/\s+/g, "");
const sections = [
  { key: "job-info", name: "Job Information", answers: { jobNumber: "HV-26-PHOTO", inspectionDate: "2026-10-03", assignedInspector: "Photo Layout Sample", clientName: "Photo Layout Samples", inspectionAddress: "1 Sample Road, Box Hill VIC 3128", weather: ["Dry"] }, photos: [] },
  { key: "description", name: "Description & Overview", answers: { constructionIs: "Single storey house", streetFrontage: "North", blockSlope: "Mostly flat", foundations: "Concrete slab", roofDesign: "Pitched", roofCovering: ["Tile"], windows: ["Aluminium"] }, photos: [] },
  ...Object.entries(CASES).map(([key, [shapes, title, answers]]) => {
    const set = `${title} (${shapes})`;
    const withDefectPhotos = (a) => JSON.parse(JSON.stringify(a), (_k, v) => v);
    const a = withDefectPhotos(answers);
    // a defect's own photos: "DEFECT:P P L" -> real photo URLs
    const fill = (v) => (Array.isArray(v) ? v.map(fill) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "photos" && typeof x === "string" && x.startsWith("DEFECT:") ? photosOf(compact(x.slice(7)), `Defect photos (${x.slice(7)})`) : fill(x)])) : v);
    const filled = fill(a);
    return { key, name: tpl(key).name, answers: filled, photos: photosOf(compact(shapes), set), caseTitle: set };
  }),
].map((s, i) => ({ key: s.key, name: s.name ?? tpl(s.key).name, icon: "", order: i, status: "complete", reportText: "", fields: {}, answers: convert(tpl(s.key).fields, s.answers), photos: s.photos, damages: [] }));

async function api(path, init = {}, token) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}
const login = await (await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
const token = login.accessToken ?? login.tokens?.accessToken ?? login.token;
const submitted = await (await api("/inspections/submit", { method: "POST", body: JSON.stringify({ inspectionType: "Dilapidation", propertyType: "Residential House", jobNo: "HV-26-PHOTO", address: "1 Sample Road", suburb: "Box Hill VIC 3128", client: "Photo Layout Samples", date: "2026-10-03", sections }) }, token)).json();
const id = submitted.inspection?.id ?? submitted.id ?? submitted.inspectionId;
if (!id) throw new Error(`submit returned no id: ${JSON.stringify(submitted).slice(0, 300)}`);
console.log(`inspection ${id}`);
const regen = spawnSync("node", [join(here, "regenerate-report-text.mjs"), "--inspection", id, "--apply"], { env: { ...process.env, ACESPECT_API: API, ACESPECT_TOKEN: token }, encoding: "utf8" });
if (regen.status !== 0) throw new Error(`regenerate-report-text.mjs failed: ${regen.stderr}`);
const { inspection } = await (await api(`/web/inspections/${id}`, {}, token)).json();
for (const s of inspection.sections) if (s.key !== "job-info") await api(`/web/sections/${s.id}`, { method: "PATCH", body: JSON.stringify({ reviewStatus: "approved" }) }, token);
const pdf = await fetch(`${API}/inspections/${id}/report.pdf`, { headers: { Authorization: `Bearer ${token}` } });
if (pdf.status !== 200) throw new Error(`report.pdf returned ${pdf.status}`);
mkdirSync(OUT, { recursive: true });
const file = join(OUT, "photo-layout-samples.pdf");
writeFileSync(file, Buffer.from(await pdf.arrayBuffer()));
console.log(`wrote ${file}`);
// PHOTO_HOLD=<seconds>: keep serving the placeholder photos a while longer (to fetch the Word version of the same report).
await new Promise((done) => setTimeout(done, Number(process.env.PHOTO_HOLD ?? 0) * 1000));
server.close();
