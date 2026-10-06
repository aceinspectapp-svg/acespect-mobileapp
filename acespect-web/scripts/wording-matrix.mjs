#!/usr/bin/env node
// Generates the "every selectable option -> the exact sentence it produces"
// reference for Dilapidation / Residential House, straight from the published
// templates (acespect-backend/prisma/templates-snapshot.json) and the real
// wording code -- so it can never drift from what the report actually prints.
//
//   node scripts/wording-matrix.mjs [out-base]     (default: ./wording-matrix)
//
// Writes <out-base>.json (for building the Word document) and <out-base>.csv
// (for Excel). Each field is varied ONE AT A TIME against a realistic baseline
// for its section; a field none of whose options ever changes the wording is
// reported under "not used in the report wording".
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outBase = resolve(process.argv[2] ?? "wording-matrix");
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const template = (k) =>
  snapshot.find((t) => t.inspectionType === "dilapidation" && t.propertyType === "residential_house" && t.sectionKey === k);

const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SAMPLE = "Typed example";

// ---- answers written as labels, converted to stored option values -----------
function valueOf(field, label) {
  const l = String(label).toLowerCase();
  const o = field.options.find((x) => x.label.toLowerCase() === l) ?? field.options.find((x) => x.label.toLowerCase().startsWith(l));
  if (!o) throw new Error(`no option "${label}" in ${field.key}`);
  return o.value;
}
function convert(fields, answers) {
  const out = {};
  for (const [key, val] of Object.entries(answers)) {
    const f = fields.find((x) => x.key === key);
    if (!f) throw new Error(`unknown field ${key}`);
    if (f.options && typeof val === "string") out[key] = valueOf(f, val);
    else if (f.options && Array.isArray(val)) out[key] = val.map((v) => valueOf(f, v));
    else if (f.type === "damage-list") out[key] = val.map((d) => convert(f.itemFields, d));
    else if (f.type === "repeating-group")
      out[key] = Array.isArray(val) ? val.map((d) => convert(f.itemFields, d)) : Object.fromEntries(Object.entries(val).map(([k, d]) => [k, convert(f.itemFields, d)]));
    else out[key] = val;
  }
  return out;
}

// ---- sections: where the answers live, and a realistic baseline ------------
const SECTIONS = [
  { key: "description", title: "Description & Overview", clears: { underConstructionStage: ["constructedYear"] }, base: { constructionIs: "Double storey house", constructedYear: "2015", streetFrontage: "South", blockSlope: "Gently sloping", wallCladdingGround: ["Rendered brick"], wallCladdingFirst: ["Weatherboards"], foundations: "Concrete slab", roofDesign: "Pitched", roofCovering: ["Colorbond"], windows: ["Aluminium"] } },
  { key: "driveway", title: "Driveway", base: { present: "yes", locatedAt: "Front left", material: "Concrete", condition: "Fair" } },
  { key: "paving_paths", title: "Paving & Paths", group: "areas", slot: "front", instNote: "one area shown (Front); Left, Rear and Right word identically", base: { present: "yes", material: ["Concrete"], condition: "Fair" } },
  { key: "fences", title: "Fences", group: "items", slot: "front", instNote: "one side shown (Front); Left, Rear and Right word identically", base: { present: "yes", material: ["Timber palings"], condition: "Fair" } },
  { key: "retaining_walls", title: "Retaining Walls", group: "items", list: true, topBase: { present: "yes" }, base: { location: "Left", materials: ["Brick"], condition: "Fair" } },
  { key: "garage_carport_sheds", title: "Garage / Carport / Sheds", group: "structures", slot: "garage", instNote: "one structure shown (Garage); Carport, Shed and Granny flat word identically", base: { present: "yes", attachment: "Attached to house", position: "Front", walls: ["Brick"], wallsCondition: "Fair", roof: ["Colorbond"], floor: ["Concrete"] } },
  { key: "pool_spa", title: "Pool / Spa", base: { present: "yes", position: "Rear", constructed: ["Fibreglass"], paving: ["Tiles"], poolFence: ["Glass panels"], fenceSafety: "Appears to be okay", condition: "Fair" } },
  { key: "elevations", title: "Elevations", group: "sides", slot: "front", instNote: "one side shown (Front); Left, Rear and Right word identically", base: { orientation: "South", condition: "Fair", damageSummary: "No visible significant damage" } },
  { key: "roof_chimneys", title: "Roof Covering & Chimneys", group: "sections", slot: "upper", instNote: "Upper roof shown; the Lower roof words identically", base: { coveringType: ["Colorbond"], condition: "Fair" } },
  { key: "internal_areas", title: "Internal Areas", group: "rooms", slot: "living_room", instNote: "one room shown (Living Room); every other room words identically", base: { present: "yes", floorLevel: "Ground floor", generalCondition: "Fair", damageSummary: "No visible significant damage" } },
];

const SELECT = new Set(["pill-select", "select-tiles", "color-select"]);
const MULTI = new Set(["chip-multiselect", "tile-multiselect"]);
const TEXT = new Set(["text", "textarea"]);

function render(reportText) {
  return reportText
    .split("\n\n")
    .filter(Boolean)
    .map((p) => {
      const cond = p.match(/^COND::#[0-9a-f]{6}::(.+)$/i);
      if (cond) return `[Condition tag: ${cond[1]}]`;
      const room = p.match(/^ROOMHEAD::(.+)$/);
      if (room) return `[Room heading: ${room[1]}]`;
      return p.replace(/^DEFECT::\d+::/, "");
    })
    .join("\n");
}

function runSection(sec) {
  const tpl = template(sec.key);
  const groupField = sec.group ? tpl.fields.find((f) => f.key === sec.group) : undefined;
  const topFields = tpl.fields.filter((f) => f.type !== "repeating-group");
  const instFields = groupField ? groupField.itemFields : [];
  const topBase = sec.topBase ?? (groupField ? {} : sec.base);
  const instBase = groupField ? sec.base : {};

  const answersFor = (topPatch = {}, instPatch = {}) => {
    const top = { ...topBase, ...topPatch };
    const inst = { ...instBase, ...instPatch };
    const raw = groupField
      ? { ...top, [sec.group]: sec.list ? [inst] : { [sec.slot]: inst } }
      : top;
    const stripped = JSON.parse(JSON.stringify(raw, (_k, v) => (v === "__blank__" ? undefined : v)));
    return convert(tpl.fields, stripped);
  };
  const outputFor = (topPatch, instPatch) => render(flattenSectionToDraft(tpl.fields, answersFor(topPatch, instPatch), sec.key).reportText);
  const baseline = outputFor({}, {});

  const groups = [];
  const unused = [];
  const levels = [
    ["top", topFields],
    ["inst", instFields],
  ];
  for (const [level, fields] of levels) {
    for (const f of fields) {
      if (f.type === "photos" || f.type === "damage-list" || f.type === "repeating-group") continue;
      if (f.key.endsWith("Other")) continue; // typed detail for an "Other" option -- shown with that option
      const siblings = fields;
      const apply = (patch) => (level === "top" ? outputFor(patch, {}) : outputFor({}, patch));
      // a field gated on another field's answer needs that answer set for the example to show anything
      const gatePatch = {};
      if (f.gate && f.gate.fieldKey !== "present") {
        const gf = siblings.find((x) => x.key === f.gate.fieldKey);
        const want = f.gate.equals ?? f.gate.equalsAny?.[0];
        if (gf && want !== undefined) gatePatch[gf.key] = gf.options ? gf.options.find((o) => o.value === want)?.label ?? want : want;
      }
      // a year typed in the baseline would hide the "under construction" stage, which only prints when no year is given
      for (const other of sec.clears?.[f.key] ?? []) gatePatch[other] = "__blank__";
      const variations = [];
      if (SELECT.has(f.type) || f.type === "yesno") {
        const opts = f.type === "yesno" ? [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }] : f.options;
        for (const o of opts) {
          const patch = { ...gatePatch, [f.key]: f.type === "yesno" ? o.value : o.label };
          let label = o.label;
          const otherBox = siblings.find((x) => x.key === `${f.key}Other`);
          if (o.value === "other" && otherBox) {
            patch[otherBox.key] = SAMPLE;
            label = `${o.label} (detail typed: "${SAMPLE}")`;
          }
          variations.push({ option: label, patch });
        }
      } else if (MULTI.has(f.type)) {
        const opts = f.options;
        variations.push({ option: "None ticked", patch: { ...gatePatch, [f.key]: [] } });
        for (const o of opts) {
          const patch = { ...gatePatch, [f.key]: [o.label] };
          let label = o.label;
          const otherBox = siblings.find((x) => x.key === `${f.key}Other`);
          if (o.value === "other" && otherBox) {
            patch[otherBox.key] = SAMPLE;
            label = `${o.label} (detail typed: "${SAMPLE}")`;
          }
          variations.push({ option: label, patch });
        }
        if (opts.length >= 2) variations.push({ option: `${opts[0].label} + ${opts[1].label}`, patch: { ...gatePatch, [f.key]: [opts[0].label, opts[1].label] } });
        if (opts.length >= 3 && opts.length <= 6) variations.push({ option: "All ticked", patch: { ...gatePatch, [f.key]: opts.map((o) => o.label) } });
      } else if (TEXT.has(f.type)) {
        variations.push({ option: `Typed: "${SAMPLE}"`, patch: { ...gatePatch, [f.key]: SAMPLE } });
        variations.push({ option: "Left blank", patch: { ...gatePatch, [f.key]: "__blank__" } });
      } else continue;

      const rows = variations.map((v) => {
        const sentence = apply(v.patch);
        return { option: v.option, sentence, same: sentence === baseline };
      });
      if (rows.every((r) => r.same)) {
        unused.push(f.label);
        continue;
      }
      groups.push({ field: f.label, rows });
    }
  }
  return { key: sec.key, title: sec.title, instNote: sec.instNote, baseline, groups, unused };
}

// ---- defect wording (identical across every category) -----------------------
function damageRows() {
  const tpl = template("pool_spa");
  const dmgField = tpl.fields.find((f) => f.key === "damages");
  const typeField = dmgField.itemFields.find((f) => f.key === "damageType");
  const base = { present: "yes", condition: "Fair" };
  const run = (d) => {
    const answers = convert(tpl.fields, { ...base, damages: [d] });
    const text = flattenSectionToDraft(tpl.fields, answers, "pool_spa").reportText;
    return render(text).split("\n").filter((p) => /there (is|are)\b/i.test(p) || /^The .* is approximately/.test(p)).join("\n");
  };
  const loc = "centre of the pool deck";
  const rows = [];
  for (const t of typeField.options) {
    const sub = dmgField.itemFields.find((f) => f.gate?.fieldKey === "damageType" && f.gate.equals === t.value);
    if (!sub) {
      rows.push({ situation: "Defect type", option: t.label, sentence: run({ damageType: t.label, location: loc }) });
      continue;
    }
    for (const s of sub.options) {
      rows.push({ situation: `Defect type: ${t.label}`, option: s.label, sentence: run({ damageType: t.label, [sub.key]: s.label, location: loc }) });
    }
  }
  const crack = { damageType: "Cracking", sub_cracking: "Fine", location: loc };
  rows.push({ situation: "Cracking: extra details", option: "Width and length given", sentence: run({ ...crack, widthMm: 4, lengthMm: 250 }) });
  rows.push({ situation: "Cracking: extra details", option: "Width only", sentence: run({ ...crack, widthMm: 4 }) });
  rows.push({ situation: "Cracking: extra details", option: "Start point and direction given", sentence: run({ ...crack, crackStartLocation: "the pool step", direction: "Vertical" }) });
  rows.push({ situation: "Cracking: extra details", option: "Element given", sentence: run({ ...crack, element: "coping" }) });
  rows.push({ situation: "Location typed", option: "Starts with a preposition (above the skimmer box)", sentence: run({ ...crack, location: "above the skimmer box" }) });
  rows.push({ situation: "Location typed", option: "Left blank", sentence: run({ ...crack, location: "" }) });
  rows.push({ situation: "Defect notes", option: `Typed: "Monitor at next inspection"`, sentence: run({ ...crack, notes: "Monitor at next inspection" }) });
  return rows;
}

// ---- Notes & Post Project (checklist) ---------------------------------------
function notesRows() {
  const tpl = template("notes");
  const movement = tpl.fields.find((f) => f.key === "movement");
  const rows = [];
  const run = (answers) => render(flattenSectionToDraft(tpl.fields, convert(tpl.fields, answers), "notes").reportText) || "(nothing is printed -- the NOTES heading is hidden if there is nothing else)";
  for (const item of movement.repeat.fixedInstances) {
    rows.push({ situation: `Checklist: ${item.label}`, option: "No", sentence: run({ movement: { [item.key]: { value: "no" } } }) });
    rows.push({ situation: `Checklist: ${item.label}`, option: `Yes, detail typed: "${SAMPLE}"`, sentence: run({ movement: { [item.key]: { value: "yes", note: SAMPLE } } }) });
    rows.push({ situation: `Checklist: ${item.label}`, option: "Yes, no detail typed", sentence: run({ movement: { [item.key]: { value: "yes" } } }) });
  }
  rows.push({ situation: "No Access Areas", option: `Area "roof space", reason "no manhole access"`, sentence: run({ noAccess: [{ area: "roof space", reason: "no manhole access" }] }) });
  rows.push({ situation: "No Access Areas", option: "Area typed, reason left blank", sentence: run({ noAccess: [{ area: "sub-floor" }] }) });
  rows.push({ situation: "No Access Areas", option: "Reason typed, area left blank", sentence: run({ noAccess: [{ reason: "locked gate" }] }) });
  rows.push({ situation: "Additional notes", option: `Typed: "${SAMPLE}"`, sentence: run({ additionalNotes: SAMPLE }) });
  return rows;
}

const sections = SECTIONS.map(runSection);
const result = { generatedAt: new Date().toISOString(), profile: "Dilapidation / Residential House", sections, defects: damageRows(), notes: notesRows() };
writeFileSync(`${outBase}.json`, JSON.stringify(result, null, 2));

const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
const csv = [["Section", "Field", "Selected option", "Generated sentence"].map(q).join(",")];
for (const s of sections) for (const g of s.groups) for (const r of g.rows) csv.push([s.title, g.field, r.option, r.same ? "(no change to the wording)" : r.sentence].map(q).join(","));
for (const r of result.defects) csv.push(["Defects (all categories)", r.situation, r.option, r.sentence].map(q).join(","));
for (const r of result.notes) csv.push(["Notes & Post Project", r.situation, r.option, r.sentence].map(q).join(","));
writeFileSync(`${outBase}.csv`, csv.join("\n"));

const rowsCount = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.rows.length, 0), 0) + result.defects.length + result.notes.length;
console.log(`${rowsCount} rows -> ${outBase}.json / .csv`);
for (const s of sections) console.log(`  ${s.title}: ${s.groups.length} fields shown, ${s.unused.length} unused (${s.unused.join("; ")})`);
await server.close();
