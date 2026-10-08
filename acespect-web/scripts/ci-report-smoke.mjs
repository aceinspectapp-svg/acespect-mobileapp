#!/usr/bin/env node
// End-to-end smoke test of report generation, run by CI (.github/workflows/report-checks.yml)
// -- and runnable locally -- against a running backend + web app:
//
//   ACESPECT_API=http://localhost:4010/api/v1 ACESPECT_WEB=http://localhost:5190 \
//   SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/ci-report-smoke.mjs
//
// It signs in, submits a realistic Dilapidation / Residential House inspection built
// from the REAL published templates (prisma/templates-snapshot.json) -- including the
// answer shapes the forms can produce ("Other" typed inline, defects with photos, absent
// items, fixed slots) -- re-derives the report text exactly as the web editor does,
// approves every section, downloads the PDF through the real Puppeteer path and checks
// what a reader would see. Exit code 1 on any failed expectation.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const API = (process.env.ACESPECT_API ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
const WEB = (process.env.ACESPECT_WEB ?? "http://localhost:5173").replace(/\/$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("SMOKE_EMAIL and SMOKE_PASSWORD are required");
  process.exit(1);
}

const SNAP = JSON.parse(readFileSync(resolve(here, "../../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const HOUSE = { inspectionType: "dilapidation", propertyType: "residential_house" };
const PUBLIC_ASSETS = { inspectionType: "dilapidation", propertyType: "public_assets" };
const COMMERCIAL = { inspectionType: "dilapidation", propertyType: "commercial_properties" };
const APARTMENT = { inspectionType: "dilapidation", propertyType: "apartment" };
const tpl = (k, p = HOUSE) => SNAP.find((t) => t.inspectionType === p.inspectionType && t.propertyType === p.propertyType && t.sectionKey === k);

// Photos are served by the web app itself, so the test needs no network access.
const P1 = `${WEB}/houspect-logo.png`;
const P2 = `${WEB}/houspect-signature.png`;

const OTHER = "__other__:";
function valueOf(field, label) {
  if (label.startsWith(OTHER)) return label; // a typed Other, stored as the form stores it
  const l = String(label).toLowerCase();
  const o = field.options.find((x) => x.label.toLowerCase() === l) ?? field.options.find((x) => x.label.toLowerCase().startsWith(l));
  // The forms team renamed or removed this option: skip it rather than fail -- the fixture, not the report, is stale.
  if (!o) { console.warn(`  note: no option "${label}" in ${field.key} any more -- left out`); return undefined; }
  return o.value;
}
// readable labels -> stored option values, recursively, driven by the template
function convert(fields, answers) {
  const out = {};
  for (const [key, val] of Object.entries(answers)) {
    const f = fields.find((x) => x.key === key);
    if (!f) { console.warn(`  note: the template no longer has field "${key}" -- left out of the test inspection`); continue; }
    if (f.options && typeof val === "string") { const v = valueOf(f, val); if (v !== undefined) out[key] = v; }
    else if (f.options && Array.isArray(val)) out[key] = val.map((v) => valueOf(f, v)).filter((v) => v !== undefined);
    else if (f.type === "damage-list") out[key] = val.map((d) => convert(f.itemFields, d));
    else if (f.type === "repeating-group") {
      out[key] = Array.isArray(val) ? val.map((d) => convert(f.itemFields, d)) : Object.fromEntries(Object.entries(val).map(([k, d]) => [k, convert(f.itemFields, d)]));
    } else out[key] = val;
  }
  return out;
}

const crack = (location, extra = {}) => ({ location, damageType: "Cracking", sub_cracking: "Fine", direction: "Vertical", widthMm: 2, lengthMm: 300, notes: "", photos: [P1, P2], ...extra });

const houseAnswers = {
  "job-info": { jobNumber: "HV-26-CI01", inspectionDate: "2026-10-03", assignedInspector: "CI Inspector", clientName: "CI Smoke Client", inspectionAddress: "1 Smoke Test Road, Box Hill VIC 3128", weather: ["Dry"] },
  description: {
    front_elevation: [P1],
    constructionIs: "Double storey house", constructedYear: "1998", streetFrontage: "North", blockSlope: "Gently sloping",
    wallCladdingGround: ["Brick veneer", `${OTHER}Fibre cement sheeting`], foundations: `${OTHER}Raft slab`,
    roofDesign: "Pitched", roofCovering: ["Tile", `${OTHER}Terracotta shingle`], windows: ["Aluminium", `${OTHER}uPVC`],
    proposedWorksType: "Residential property", projectSiteAddress: "3 Smoke Test Road", siteSide: "Left-hand side", siteDirection: "North",
    scopeForInspection: "External and internal to all structures",
  },
  driveway: {
    present: "yes", locatedAt: "Front left", material: "Concrete", condition: "Fair", crackingSummary: "Several minor cracks", obscuredBy: ["Vegetation"],
    damages: [
      crack("centre of the driveway near the garage entrance", { element: "slab", sub_cracking: "Moderate", crackStartLocation: "the garage entrance", direction: "Horizontal", widthMm: 6, lengthMm: 850, notes: "Likely caused by tree root movement nearby." }),
      { location: "kerb", damageType: `${OTHER}Rotting edge`, widthMm: 4, photos: [P1] },
    ],
  },
  paving_paths: {
    areas: {
      front: { present: "yes", material: ["Concrete", "Pavers"], condition: "Satisfactory", obscuredBy: ["Vegetation"], damages: [crack("edge of the courtyard path", { notes: "Minor, cosmetic only." })] },
      left: { present: "no" },
      rear: { present: "yes", material: ["Grass only"], condition: "New" },
      right: { present: "no" },
    },
  },
  fences: {
    items: {
      front: { present: "yes", material: ["Timber palings", `${OTHER}Hardwood sleepers`], condition: "Poor", obscuredBy: [`${OTHER}Parked trailer`], damages: [{ location: "base of the fence, third panel from the gate", damageType: "Movement / Displacement", sub_movement: "Leaning", notes: "Posts have rotted at ground level.", photos: [P1] }] },
      left: { present: "yes", material: ["Brick"], condition: "Fair" },
      rear: { present: "yes", material: ["Metal sheets"], condition: "Satisfactory" },
      right: { present: "no" },
    },
  },
  retaining_walls: {
    present: "yes",
    items: [{ location: "Left", materials: ["Brick"], condition: "Fair", obscuredBy: ["Vegetation"], damages: [crack("mid-span of the wall", { element: "wall face", sub_cracking: "Moderate", widthMm: 4, lengthMm: 600 })] }],
  },
  garage_carport_sheds: {
    structures: {
      garage: { present: "yes", attachment: "Attached to house", position: "Front", walls: ["Brick"], wallsCondition: "Fair", roof: ["Colorbond"], floor: ["Concrete"], obscuredBy: ["Stored goods"], cladding: ["Paint is weathered"], damages: [crack("support post footing", { sub_cracking: "Moderate", widthMm: 5, lengthMm: 620, notes: "Likely settlement-related." })] },
      carport: { present: "no" },
      shed: { present: "yes", attachment: "Separate to house", position: "Rear", walls: ["Metal"], wallsCondition: "Poor", roof: ["Metal"], floor: ["Gravel"] },
      granny_flat: { present: "no" },
    },
  },
  pool_spa: {
    present: "yes", position: "Rear", constructed: ["Fibreglass"], paving: ["Tiles"], poolFence: ["Glass panels"], fenceSafety: "Appears to be okay",
    condition: "Satisfactory", obscuredBy: ["Vegetation"],
    damages: [{ location: "spa deck edge", element: "tiles", damageType: "Surface Damage", sub_surface: "Chips", notes: "Surface chip, non-structural.", photos: [P1, P2] }],
  },
  elevations: {
    sides: {
      front: { orientation: "South", condition: "Fair", damageSummary: "Several minor gaps and cracks", cladding: ["Paint is flaking from sections"], damages: [crack("above the front window", { element: "render", sub_cracking: "Fine", direction: "Diagonal", widthMm: 3, lengthMm: 400, notes: "Consistent with seasonal movement." })] },
      left: { orientation: "West", partyWall: "yes", partyWallNumber: "Unit 2", partialInspection: ["Rear"], condition: "Poor", damageSummary: "Multiple items of damage throughout" },
      rear: { orientation: "North", condition: "New", damageSummary: "No visible significant damage" },
      right: { orientation: "East", condition: "Satisfactory", damageSummary: "No visible significant damage", obscuredBy: ["Vegetation", "Sheds"] },
    },
  },
  roof_chimneys: {
    sections: {
      upper: { inspectionStatus: ["Inspected partly from upstairs windows"], coveringType: ["Colorbond"], condition: "Fair" },
      lower: { coveringType: ["Tile"], condition: "Poor", damages: [crack("ridge capping", { sub_cracking: "Moderate", widthMm: 5, lengthMm: 400 })] },
    },
  },
  internal_areas: {
    renovationsInProgress: "yes", renovationsRooms: "kitchen", safetyAdvisories: "no", roomsNotAccessed: "Roof space (no manhole access)", movementObserved: "no",
    rooms: {
      living_room: { present: "yes", floorLevel: "Ground floor", obscuredBy: ["Furniture"], generalCondition: "Fair", damageSummary: "Several minor gaps and cracks", damages: [crack("ceiling cornice, southwest corner", { element: "cornice", widthMm: 1, lengthMm: 600, notes: "Consistent with seasonal movement." })] },
      kitchen: { present: "yes", floorLevel: "Ground floor", generalCondition: "Poor", damageSummary: "Multiple items of damage throughout" },
      bedroom: { present: "yes", roomName: "Bedroom 1", floorLevel: "1st floor", generalCondition: "Satisfactory", damageSummary: "No visible significant damage" },
      bathroom: { present: "yes", floorLevel: "1st floor", generalCondition: "Fair", damages: [{ location: "shower base grout line", damageType: "Moisture-Related Evidence", sub_moisture: "Mould", photos: [P1] }] },
      stairwell: { present: "no" },
    },
  },
  notes: {
    movement: { bouncy_floors: { value: "yes", note: "the hallway near the kitchen" }, doors_binding: { value: "no" }, loose_bricks: { value: "yes", note: "the rear chimney" } },
    noAccess: [{ area: "roof space", reason: "no manhole access" }],
    additionalNotes: "Owner mentioned recent storm damage to the rear fence, unrelated to project works.",
    damages: [crack("garden wall", { notes: "" })],
  },
};


async function api(path, init = {}, token) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res;
}

const failures = [];
const expect = (ok, what) => { console.log(`${ok ? "  ok  " : " FAIL "} ${what}`); if (!ok) failures.push(what); };

const login = await (await api("/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).json();
const token = login.accessToken ?? login.tokens?.accessToken ?? login.token;
if (!token) throw new Error(`login returned no access token: ${Object.keys(login)}`);


// A Public Assets survey: no building, just the description and two survey parts (frontage, laneway).
const publicAssetsAnswers = {
  "job-info": { jobNumber: "HV-26-CI02", inspectionDate: "2026-10-03", assignedInspector: "CI Inspector", clientName: "CI Public Assets Client", inspectionAddress: "1 Smoke Test Road, Box Hill VIC 3128", weather: ["Dry"] },
  description: {
    proposedWorksType: "Development site", projectSiteAddress: "3 Smoke Test Road", siteSide: "Front", siteDirection: "North",
    scopeConfirmed: ["Footpaths, utility pit covers", "Kerb and channel", "Road surfaces"], safetyAssessed: "yes", safetyAssessedNotes: "All assessed", scopeLimitations: "no",
  },
  elevations: {
    parts: [
      {
        partName: "Part A: Frontage to project site", surveyStart: "South end", startRef: "3m past the boundary of no. 5", surveyDirection: "North", surveyEnd: "North end", endRef: "the corner of Smith Street",
        itemsPresent: ["Footpaths and Crossovers", "Kerb and Channel", "Road Surface & Parking Bays"],
        footpaths_material: ["Concrete"], footpaths_condition: "Fair", footpaths_summary: "Several minor cracks", footpaths_obscuredBy: ["Overgrown grass"],
        footpaths_damages: [crack("outside no. 7", { crackStartLocation: "the kerb", direction: "Horizontal", widthMm: 6, lengthMm: 850 })],
        footpaths_assets: [{ assetType: "Utility pit cover", count: "1", condition: "Satisfactory with typical wear and tear", location: "the driveway of no. 7" }],
        kerbs_material: ["Concrete"], kerbs_condition: "Poor", kerbs_summary: "Numerous cracking throughout", kerbs_damages: [crack("outside no. 6", { widthMm: 5, lengthMm: 400 })],
        roadsurface_material: ["Asphalt"], roadsurface_condition: "Satisfactory with typical wear and tear", roadsurface_summary: "No significant cracking/damage", roadsurface_lineMarkings: "Worn",
        guardRails: "no", retainingWalls: "no", bridges: "no",
      },
      {
        partName: "Part B: Laneway", surveyStart: "West end", startRef: "the project boundary", surveyDirection: "East", surveyEnd: "East end", endRef: "the lane entry",
        itemsPresent: ["Fencing / Walls — Left Side", "Laneway Surface"],
        fenceleft_material: ["Timber palings", "__other__:Hardwood sleepers"], fenceleft_condition: "Fair", fenceleft_summary: "No significant cracking/damage", fenceleft_obscuredBy: ["__other__:Stacked pallets"],
        lanesurface_material: ["Concrete"], lanesurface_condition: "Average", lanesurface_summary: "Several minor cracks", lanesurface_lineMarkings: "NA",
        lanesurface_damages: [crack("centre of the lane", { widthMm: 4, lengthMm: 700 })],
        lanesurface_assets: [{ assetType: "Stormwater cover", count: "1", condition: "Fair", location: "the lane entry" }],
      },
    ],
  },
};

// A commercial / industrial site: the House-style sentences, offices and warehouse areas.
const SAT = "Satisfactory with typical wear and tear";
const commercialAnswers = {
  "job-info": { jobNumber: "HV-26-CI03", inspectionDate: "2026-10-03", assignedInspector: "CI Inspector", clientName: "CI Commercial Client", inspectionAddress: "1 Smoke Test Road, Box Hill VIC 3128", weather: ["Dry"] },
  description: {
    constructionIs: ["Warehouse"], constructedYear: "1990", streetFrontage: "North", blockSlope: "Mostly flat", wallCladdingGround: ["Concrete panels"], foundations: "Concrete slab",
    roofDesign: "Pitched", roofCovering: ["Colorbond"], windows: "Aluminium", proposedWorksType: "Development site", projectSiteAddress: "3 Smoke Test Road", siteSide: "Front", siteDirection: "North",
  },
  driveway: { present: "yes", locatedAt: "Front left", material: "Concrete", condition: "Fair", crackingSummary: "Several minor cracks", obscuredBy: ["Vegetation"], damages: [crack("near the gate", { notes: "" })] },
  paving_paths: { areas: { front: { present: "yes", material: ["Concrete"], condition: SAT, obscuredBy: ["Vegetation"] }, left: { present: "no" }, rear: { present: "yes", material: ["Pavers"], condition: "Poor", damages: [crack("the loading apron", { notes: "" })] } } },
  fences: { items: { front: { present: "no" }, left: { present: "yes", material: ["Brick"], condition: SAT, obscuredBy: ["Vegetation"] }, rear: { present: "yes", material: ["Metal sheets"], condition: "Poor", worstItem: "Rusted posts and leaning panels near the gate" } } },
  garage_carport_sheds: { structures: { garage: { present: "yes", attachment: "Separate to building", position: "Front", walls: ["Brick"], wallsCondition: SAT, roof: ["Metal"], floor: ["Concrete hardstand"], obscuredBy: ["Shelving", "Stored goods"] }, loading_dock: { present: "no" } } },
  elevations: { sides: { front: { orientation: "North", condition: SAT, damageSummary: "No visible significant damage", obscuredBy: ["Vegetation"] }, left: { orientation: "West", partyWall: "yes", partyWallNumber: "12", condition: "Fair", damageSummary: "Several minor gaps and cracks", damages: [crack("above the window", { notes: "" })] } } },
  pool_spa: { areas: { reception_foyer: { present: "yes", floorLevel: "Ground floor", generalCondition: SAT, damageSummary: "No visible significant damage" }, offices: { present: "yes", floorLevel: "1st floor", generalCondition: "Fair", damageSummary: "Several minor cracks and gaps", damages: [crack("ceiling cornice", { notes: "" })] } } },
  notes: { postProject: "yes", additionalNotes: "", damages: [crack("rear loading bay", { notes: "" })] },
  internal_areas: {
    gen_renovationsInProgress: "no", gen_safetyAdvisories: "no", gen_roomsNotAccessed: "Plant room (locked)", gen_movementObserved: "no",
    wh_floorLevel: "Ground floor", wh_obscuredBy: ["Shelving", "Pallets"], wh_generalCondition: "Fair", wh_damageSummary: "Several minor gaps and cracks", wh_damages: [crack("north wall, grid C", { notes: "" })],
    prod_floorLevel: "Ground floor", prod_generalCondition: SAT, prod_damageSummary: "No visible significant damage",
    hard_floorLevel: "Ground floor", hard_generalCondition: "Poor", hard_damageSummary: "Multiple items of damage throughout", hard_damages: [crack("slab", { widthMm: 8, lengthMm: 2000, notes: "" })],
    roofin_generalCondition: SAT, roofin_damageSummary: ["Water stains"], roofin_sarking: "yes",
  },
};

// An apartment: a multi-level office building (the Multi Level Offices inspector template): outside, then offices by level.
const apartmentAnswers = {
  "job-info": { jobNumber: "HV-26-CI04", inspectionDate: "2026-10-03", assignedInspector: "CI Inspector", clientName: "CI Apartment Client", inspectionAddress: "1 Smoke Test Road, Box Hill VIC 3128", weather: ["Dry"] },
  description: {
    constructionIs: ["Commercial offices"], constructedYear: "2005", streetFrontage: "East", blockSlope: "Mostly flat", wallCladdingGround: ["Tilt concrete panels"], wallCladdingFirst: ["Metal"],
    foundations: "Concrete slab", roofDesign: "Flat", roofCovering: ["Metal decking"], windows: "Aluminium",
    proposedWorksType: "Development site", projectSiteAddress: "3 Smoke Test Road", siteSide: "Front", siteDirection: "North", safetyIssues: "yes", safetyIssuesNotes: "Loose balustrade on level 2",
  },
  driveway: { present: "yes", locatedAt: "Front left", material: "Asphalt", condition: "Poor", crackingSummary: "Numerous cracking throughout", obscuredBy: ["Parked cars"], damages: [crack("near the ramp", { notes: "" })] },
  elevations: { sides: { front: { orientation: "East", condition: SAT, damageSummary: "No visible significant damage", obscuredBy: ["Vegetation"] }, left: { orientation: "North", partyWall: "yes", partyWallNumber: "12", condition: "Fair", damageSummary: "Several minor gaps and cracks", damages: [crack("above the window", { notes: "" })] } } },
  pool_spa: { areas: { reception_foyer: { present: "yes", floorLevel: "Ground floor", generalCondition: SAT, damageSummary: "No visible significant damage" }, consulting_room: { present: "yes", floorLevel: "3rd floor", generalCondition: "Fair", damageSummary: "Items of damage throughout", damages: [crack("window frame", { notes: "" })] } } },
  internal_areas: { gen_renovationsInProgress: "no", gen_safetyAdvisories: "no", gen_roomsNotAccessed: "Plant room (locked)", gen_movementObserved: "no" },
  notes: { postProject: "no", additionalNotes: "" },
};

// One report type, end to end: submit, compose the wording, approve, download the PDF, read what the reader would see.
async function runCase(c) {
  console.log(`\n== ${c.name}`);
  const sections = Object.entries(c.answers).map(([key, a], i) => ({
    key,
    name: tpl(key, c.profile).name,
    icon: "",
    order: i,
    status: "complete",
    reportText: "",
    fields: {},
    answers: convert(tpl(key, c.profile).fields, a),
    photos: c.photoSections.includes(key) ? [P1, P2] : [],
    damages: [],
  }));
  const submitted = await (await api("/inspections/submit", {
    method: "POST",
    body: JSON.stringify({ inspectionType: c.inspectionTitle, propertyType: c.propertyTitle, jobNo: c.jobNo, address: "1 Smoke Test Road", suburb: "Box Hill VIC 3128", client: c.client, date: "2026-10-03", sections }),
  }, token)).json();
  const id = submitted.inspection?.id ?? submitted.id ?? submitted.inspectionId;
  if (!id) throw new Error(`submit returned no id: ${JSON.stringify(submitted).slice(0, 300)}`);
  console.log(`submitted inspection ${id}`);

  // Compose the saved wording the way the web editor does on save, then approve every section.
  const regen = spawnSync("node", [join(here, "regenerate-report-text.mjs"), "--inspection", id, "--apply"], { env: { ...process.env, ACESPECT_API: API, ACESPECT_TOKEN: token }, encoding: "utf8" });
  process.stdout.write(regen.stdout ?? "");
  if (regen.status !== 0) { process.stderr.write(regen.stderr ?? ""); throw new Error("regenerate-report-text.mjs failed"); }
  const { inspection } = await (await api(`/web/inspections/${id}`, {}, token)).json();
  for (const s of inspection.sections) {
    if (["job-info"].includes(s.key)) continue;
    await api(`/web/sections/${s.id}`, { method: "PATCH", body: JSON.stringify({ reviewStatus: "approved" }) }, token);
  }

  const res = await fetch(`${API}/inspections/${id}/report.pdf`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status === 200, `report.pdf returns HTTP 200 (got ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  expect(buf.subarray(0, 5).toString() === "%PDF-", "the response is a PDF");
  const dir = mkdtempSync(join(tmpdir(), "report-smoke-"));
  const pdfPath = join(dir, "report.pdf");
  writeFileSync(pdfPath, buf);
  console.log(`saved ${pdfPath}`);

  const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0);
  expect(pages >= c.minPages, `the PDF has a plausible page count (${pages})`);
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
  const flat = text.replace(/\s+/g, " ");

  for (const heading of c.headings) expect(flat.toLowerCase().includes(heading.toLowerCase()), `contains "${heading}"`);
  // what the answers must read as
  for (const phrase of c.phrases) expect(flat.toLowerCase().includes(phrase.toLowerCase()), `prints "${phrase}"`);
  // things a reader must never see
  const banned = [/__other__/, /DEFECT::/, /COND::/, /ROOMHEAD::/, /\bitem\d+\b/, /\bundefined\b/, /\[object Object\]/, /\bNaN\b/, /of \./, /[a-z]\.\.(?!\.)/, /\bother\b\s*\./i];
  for (const re of banned) expect(!re.test(flat), `does not contain ${re}`);
  // every defect photo and section photo should have made it in as an image
  let images = 0;
  try { images = execFileSync("pdfimages", ["-list", pdfPath], { encoding: "utf8" }).split("\n").filter((l) => /^\s*\d+\s+\d+\s+image/.test(l)).length; } catch { /* poppler build without pdfimages */ }
  expect(images >= c.minImages, `the PDF embeds the photographs (${images} images)`);
  return pdfPath;
}

const pdfs = [];
pdfs.push(await runCase({
  name: "Dilapidation / Residential House",
  profile: HOUSE, inspectionTitle: "Dilapidation", propertyTitle: "Residential House", jobNo: "HV-26-CI01", client: "CI Smoke Client",
  answers: houseAnswers, photoSections: ["driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "pool_spa", "elevations", "roof_chimneys"],
  headings: ["Description and Overview", "Condition Summary", "Driveway", "Fences", "Internal Areas"],
  phrases: ["raft slab", "terracotta shingle", "uPVC", "hardwood sleepers", "parked trailer", "rotting edge"],
  minPages: 8, minImages: 10,
}));
pdfs.push(await runCase({
  name: "Dilapidation / Public Assets",
  profile: PUBLIC_ASSETS, inspectionTitle: "Dilapidation", propertyTitle: "Public Assets", jobNo: "HV-26-CI02", client: "CI Public Assets Client",
  answers: publicAssetsAnswers, photoSections: ["elevations"],
  headings: ["Description and Overview", "Part A: Frontage to project site", "Footpaths and Crossovers", "Kerbs and Channel", "Road surface and Parking bays", "Laneway surface"],
  phrases: [
    "The inspection is for Public Assets to the development site",
    "The scope for inspection is public assets including footpaths, utility pit covers, kerb and channel and road surfaces to the following two areas",
    "commenced from the south end at 3m past the boundary of no. 5 and proceeded north",
    "The footpath and crossovers are constructed of concrete and in fair condition",
    "The most significant items are",
    "There is a utility pit cover at the driveway of no. 7",
    "hardwood sleepers", "stacked pallets",
  ],
  minPages: 4, minImages: 4,
}));

pdfs.push(await runCase({
  name: "Dilapidation / Commercial Properties",
  profile: COMMERCIAL, inspectionTitle: "Dilapidation", propertyTitle: "Commercial Properties", jobNo: "HV-26-CI03", client: "CI Commercial Client",
  answers: commercialAnswers, photoSections: ["driveway", "paving_paths", "fences", "garage_carport_sheds", "elevations", "pool_spa", "internal_areas"],
  headings: ["Description and Overview", "Condition Summary", "Reception / Foyer", "Warehouse", "Underside Roof Covering & Frame"],
  phrases: [
    "The property is a warehouse, facing north on a mostly flat block of land",
    "The driveway is to the front left of the block and is constructed of concrete.",
    "It is in fair condition. Several minor cracks observed. Sections of the driveway were obscured by vegetation.",
    "The left-hand fence is constructed of brick and is in satisfactory condition with typical weathering.",
    "It is located on the ground floor.",
    "There is no paving to the left-hand side of property.",
    "There is no front fence.",
    "Sections of the walls and floor were obscured by shelving and stored goods.",
    "The left elevation is a party wall abutting the next property at No. 12 and could not be inspected.",
    "Several minor gaps and cracks observed.",
    "is in satisfactory and typical condition. Water stains observed. Sections were obscured by sarking.",
  ],
  minPages: 6, minImages: 4,
}));

pdfs.push(await runCase({
  name: "Dilapidation / Apartment",
  profile: APARTMENT, inspectionTitle: "Dilapidation", propertyTitle: "Apartment", jobNo: "HV-26-CI04", client: "CI Apartment Client",
  answers: apartmentAnswers, photoSections: ["driveway", "elevations", "pool_spa"],
  headings: ["Description and Overview", "Condition Summary", "Reception / Foyer", "Consulting room"],
  phrases: [
    "The property is a commercial office building, facing east on a mostly flat block of land",
    "It is in poor condition. Numerous cracking observed throughout. Sections of the driveway were obscured by parked cars.",
    "The left elevation is a party wall abutting the next property at No. 12 and could not be inspected.",
    "The reception and foyer are in satisfactory and typical condition.",
    "The consulting room is in fair condition. Items of damage observed throughout.",
    "No access granted to Plant room (locked).",
    "Safety issues: Loose balustrade on level 2.",
  ],
  minPages: 6, minImages: 4,
}));

if (failures.length) {
  console.error(`\n${failures.length} expectation(s) failed. The PDFs are at ${pdfs.join(", ")}`);
  process.exit(1);
}
console.log("\nreport smoke test passed");
