#!/usr/bin/env node
// Re-derives the generated report wording (reportText, summary rows, damages)
// for inspections that were saved before a wording fix landed.
//
// The sentences are composed when a section is saved in the web editor and then
// stored, so an inspection saved earlier keeps its old text until it is saved
// again. This does that re-save for you, with exactly the same derivation and
// the same PATCH the reviewer's Field Data editor uses.
//
//   ACESPECT_TOKEN=<reviewer/admin access token> \
//   node scripts/regenerate-report-text.mjs --inspection <id> [--inspection <id> ...]
//   node scripts/regenerate-report-text.mjs --all
//
// It is a DRY RUN by default: it lists every section whose text would change
// and shows the first paragraph that differs. Add --apply to write the changes.
//
//   ACESPECT_API   API base, default http://localhost:4000/api/v1
//   ACESPECT_TOKEN a logged-in reviewer/admin access token (required)
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const API = (process.env.ACESPECT_API ?? "http://localhost:4000/api/v1").replace(/\/$/, "");
const TOKEN = process.env.ACESPECT_TOKEN;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const all = args.includes("--all");
const ids = args.flatMap((a, i) => (a === "--inspection" && args[i + 1] ? [args[i + 1]] : []));

if (!TOKEN || (!all && ids.length === 0)) {
  console.error("Usage: ACESPECT_TOKEN=... node scripts/regenerate-report-text.mjs (--inspection <id> ... | --all) [--apply]");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
async function api(path, init) {
  const res = await fetch(`${API}${path}`, { headers, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

// Same display-label -> slug mapping as templateFields.ts's toSlug().
const SLUGS = {
  Dilapidation: "dilapidation",
  "Pre-Purchase": "pre_purchase",
  "Construction Stage": "construction_stage",
  Investigations: "investigations",
  "Residential House": "residential_house",
  Apartment: "apartment",
  "Commercial Properties": "commercial_properties",
  "Public Assets": "public_assets",
};
const slug = (v) => SLUGS[v] ?? String(v ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const templateCache = new Map();
async function templateFor(inspection, sectionKey) {
  const key = `${slug(inspection.type)}/${slug(inspection.propertyType)}/${sectionKey}`;
  if (!templateCache.has(key)) {
    const res = await fetch(`${API}/templates/active/${key}`, { headers });
    templateCache.set(key, res.ok ? (await res.json()).template : null);
  }
  return templateCache.get(key);
}

// The database hands JSON keys back in its own order, so compare with sorted keys.
function canonical(value) {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

function firstDifference(before, after) {
  const a = (before ?? "").split("\n\n");
  const b = (after ?? "").split("\n\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { before: a[i] ?? "(none)", after: b[i] ?? "(none)" };
  }
  return null;
}

const targets = all ? (await api("/web/inspections")).inspections.map((i) => i.id) : ids;
let changed = 0;
let unchanged = 0;
let skipped = 0;

for (const id of targets) {
  const { inspection } = await api(`/web/inspections/${id}`);
  for (const section of inspection.sections ?? []) {
    const key = section.key ?? section.id;
    const template = section.answers ? await templateFor(inspection, key) : null;
    if (!template) {
      skipped += 1; // no answers (never filled in) or no template for this profile
      continue;
    }
    const derived = flattenSectionToDraft(template.fields, section.answers, key);
    const summaryChanged = canonical(derived.fields.conditionSummary ?? []) !== canonical(section.fields?.conditionSummary ?? []);
    if (derived.reportText === (section.reportText ?? "") && !summaryChanged) {
      unchanged += 1;
      continue;
    }
    changed += 1;
    const diff = firstDifference(section.reportText, derived.reportText);
    console.log(`\n${inspection.jobNo ?? id} / ${section.name ?? key}${summaryChanged ? "  (summary rows change)" : ""}`);
    if (diff) {
      console.log(`  before: ${diff.before.replace(/\n/g, " ").slice(0, 220)}`);
      console.log(`  after:  ${diff.after.replace(/\n/g, " ").slice(0, 220)}`);
    }
    if (apply) {
      await api(`/web/sections/${section.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          answers: section.answers,
          fields: derived.fields,
          reportText: derived.reportText,
          damages: derived.damages.map((d) => ({
            type: d.type,
            location: d.location,
            direction: d.direction,
            widthMm: d.widthMm,
            lengthMm: d.lengthMm,
            notes: d.notes,
            photos: d.photos,
          })),
        }),
      });
    }
  }
}

await server.close();
console.log(
  `\n${apply ? "Updated" : "Would update"} ${changed} section(s); ${unchanged} already up to date; ${skipped} skipped (no answers or no template).` +
    (apply || changed === 0 ? "" : "\nDry run -- nothing was written. Re-run with --apply to save."),
);
