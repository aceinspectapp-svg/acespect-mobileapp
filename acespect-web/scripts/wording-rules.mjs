#!/usr/bin/env node
// Derives the report's sentence RULES straight from the wording code, for
// Dilapidation / Residential House:
//
//   * every form field is filled with a placeholder such as {material}, and the
//     real wording code is run -- the output is each category's sentence pattern;
//   * then each field is blanked one at a time, and the words that disappear are
//     exactly the part of the sentence that field is responsible for.
//
//   node scripts/wording-rules.mjs [out.json]      (default: ./wording-rules.json)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? "wording-rules.json");
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const template = (k) =>
  snapshot.find((t) => t.inspectionType === "dilapidation" && t.propertyType === "residential_house" && t.sectionKey === k);

const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { absenceSentence } = await server.ssrLoadModule("/src/web/reportSentences.ts");

const SECTIONS = [
  { key: "description", title: "Description & Overview" },
  { key: "driveway", title: "Driveway" },
  { key: "paving_paths", title: "Paving & Paths", group: "areas", slot: "front" },
  { key: "fences", title: "Fences", group: "items", slot: "front" },
  { key: "retaining_walls", title: "Retaining Walls", group: "items", list: true },
  { key: "garage_carport_sheds", title: "Garage / Carport / Sheds", group: "structures", slot: "garage" },
  { key: "pool_spa", title: "Pool / Spa" },
  { key: "elevations", title: "Elevations", group: "sides", slot: "front" },
  { key: "roof_chimneys", title: "Roof Covering & Chimneys", group: "sections", slot: "upper" },
  { key: "internal_areas", title: "Internal Areas", group: "rooms", slot: "living_room" },
];

const SELECT = new Set(["pill-select", "select-tiles", "color-select"]);
const MULTI = new Set(["chip-multiselect", "tile-multiselect"]);
const TEXT = new Set(["text", "textarea"]);
const COND_KEYS = ["condition", "generalCondition", "wallsCondition"];

// readable names for the blanks, by field key (anything not listed falls back to a shortened form label)
const NAMES = {
  constructionIs: "house type", streetFrontage: "street frontage direction", blockSlope: "block slope", constructedYear: "year built",
  underConstructionStage: "construction stage", wallCladdingGround: "ground floor wall material", wallCladdingFirst: "first floor wall material",
  foundations: "foundations", roofDesign: "roof shape", roofCovering: "roof covering", windows: "window material", obscuredBy: "obstructions",
  obstruction: "obstructions", obstructions: "obstructions", locatedAt: "location", materials: "materials", walls: "wall material",
  roof: "roof material", floor: "floor material", fenceSafety: "fence safety answer", poolFence: "fence material", constructed: "pool construction",
  paving: "paving material", partyWallNumber: "party wall number", partialInspection: "parts only partly inspected",
  crackingSummary: "cracking overview", damageSummary: "damage overview", inspectionStatus: "inspection limitation",
  renovationsRooms: "rooms being renovated", safetyAdvisoryTypes: "safety advisory type", safetyAdvisoryNotes: "advisory details",
  roomsNotAccessed: "rooms not accessed", movementWhere: "where movement was seen", generalConditionComments: "general condition answer",
  roomName: "room name", floorLevel: "floor", cladding: "cladding observations", windowsDoors: "window / door observations",
  eaves: "eaves observations", downpipesGutters: "gutter observations", notes: "inspector's notes", coveringType: "roof covering",
  position: "position", attachment: "attachment", orientation: "orientation", location: "location", material: "material",
};
const nameOf = (f) => NAMES[f.key] ?? short(f.label);

// "Attachment (if the basement is the garage, ...)" -> "attachment"; "Is the pool / spa fence OK?" -> "pool / spa fence ok"
const short = (label) => {
  let s = label.replace(/\s*\(.*?\)/g, "").replace(/\s*[—-]\s.*$/, "").replace(/[?:]+$/g, "").replace(/^(Is|Are) (there )?(a |an |the |any )?/i, "").trim();
  if (s.length > 38) s = s.slice(0, 38).trim();
  return s.charAt(0).toLowerCase() + s.slice(1);
};

// every select becomes a single placeholder option, so the code prints {field name} where an answer goes
function transform(f) {
  const g = { ...f };
  if (SELECT.has(f.type)) {
    const isCond = COND_KEYS.includes(f.key);
    g.options = [{ value: isCond ? "fair" : "x", label: isCond ? "{condition}" : `{${nameOf(f)}}` }];
  } else if (MULTI.has(f.type)) {
    g.options = [{ value: "x", label: `{${nameOf(f)}}` }];
  }
  if (f.itemFields) g.itemFields = f.itemFields.map(transform);
  return g;
}
const answerFor = (f) => {
  if (f.type === "yesno") return "yes";
  if (SELECT.has(f.type)) return COND_KEYS.includes(f.key) ? "fair" : "x";
  if (MULTI.has(f.type)) return ["x"];
  if (TEXT.has(f.type)) return `{${nameOf(f)}}`;
  return undefined; // photos, numbers, damage lists, groups: handled elsewhere / left out
};

function render(reportText) {
  return reportText
    .split("\n\n")
    .filter(Boolean)
    .map((p) => {
      const cond = p.match(/^COND::#[0-9a-f]{6}::(.+)$/i);
      if (cond) return `[Condition tag: ${cond[1]}]`;
      const room = p.match(/^ROOMHEAD::(.+)$/);
      if (room) return `[Room heading: ${room[1]}]`;
      return p;
    })
    .join("\n");
}

// Words of `full` that are not in `without` (longest common subsequence), grouped into runs.
// {placeholders} are single tokens and punctuation is its own token, so the runs come out as clean phrases.
const tokenize = (t) => t.replace(/\n/g, " ¶ ").match(/\{[^}]*\}|[A-Za-z0-9'\u2019\/&-]+|[.,:;()\u2014]|¶/g) ?? [];
const detok = (tokens) => tokens.join(" ").replace(/ ([.,:;)])/g, "$1").replace(/\( /g, "(");
function addedWords(full, without) {
  const a = tokenize(without), b = tokenize(full);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) { keep.add(j); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const runs = [];
  let cur = [], first = -1;
  b.forEach((w, k) => {
    if (!keep.has(k) && w !== "¶") { if (!cur.length) first = k; cur.push(w); } else if (cur.length) { runs.push({ at: first, text: detok(cur) }); cur = []; }
  });
  if (cur.length) runs.push({ at: first, text: detok(cur) });
  return runs;
}

function derive(sec) {
  const tpl = template(sec.key);
  const fields = tpl.fields.map(transform);
  const groupField = sec.group ? fields.find((f) => f.key === sec.group) : undefined;
  const topFields = fields.filter((f) => f.type !== "repeating-group");
  const instFields = groupField ? groupField.itemFields : [];

  const build = (skipKey, overrides = {}) => {
    const top = {};
    for (const f of topFields) { const v = answerFor(f); if (v !== undefined && f.key !== skipKey) top[f.key] = v; }
    const inst = {};
    for (const f of instFields) { const v = answerFor(f); if (v !== undefined && f.key !== skipKey) inst[f.key] = v; }
    Object.assign(top, overrides.top ?? {});
    Object.assign(inst, overrides.inst ?? {});
    return groupField ? { ...top, [sec.group]: sec.list ? [inst] : { [sec.slot]: inst } } : top;
  };
  const run = (answers) => render(flattenSectionToDraft(fields, answers, sec.key).reportText);

  const pattern = run(build());
  const clauses = [];
  const noEffect = [];
  const seen = new Set();
  for (const f of [...topFields, ...instFields]) {
    if (seen.has(f.key) || answerFor(f) === undefined || f.key === "present" || f.key === "available") continue;
    seen.add(f.key);
    const runs = addedWords(pattern, run(build(f.key)));
    if (runs.length === 0) { if (!f.key.endsWith("Other")) noEffect.push(f.label); continue; }
    clauses.push({ field: f.label, at: runs[0].at, adds: runs.map((r) => r.text).join("  …  ") });
  }
  clauses.sort((x, y) => x.at - y.at);

  // what happens when the "is there one?" answer is No
  const presentField = [...topFields, ...instFields].find((f) => f.key === "present");
  let whenNo = null;
  if (presentField) {
    const level = topFields.includes(presentField) ? "top" : "inst";
    whenNo = run(build(undefined, level === "top" ? { top: { present: "no" } } : { inst: { present: "no" } })) || null;
  }
  const absence = absenceSentence(sec.key) ?? null;
  // a section without an absence sentence simply leaves the item out when it is marked not present
  return { key: sec.key, title: sec.title, pattern, clauses: clauses.map(({ field, adds }) => ({ field, adds })), noEffect, whenNo: absence ? whenNo : null, leftOutWhenNo: !absence && !!presentField, absence };
}

const sections = SECTIONS.map(derive);
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), profile: "Dilapidation / Residential House", sections }, null, 2));
console.log(`wrote ${out}`);
for (const s of sections) console.log(`\n## ${s.title}\n${s.pattern}\n  clauses: ${s.clauses.length}, no effect: ${s.noEffect.length}${s.whenNo ? `, when No: ${s.whenNo}` : ""}${s.leftOutWhenNo ? ", when No: left out" : ""}`);
await server.close();
