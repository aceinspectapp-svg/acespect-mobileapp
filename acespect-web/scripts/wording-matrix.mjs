#!/usr/bin/env node
// Wording matrix: every selectable answer of a report type -> the exact sentence(s) the report prints for it, so each
// wording can be reviewed (and signed off) as a table instead of by reading whole reports.
//
//   node scripts/wording-matrix.mjs [--type residential_house] [--inspection dilapidation] [--out <dir>]
//
// Everything is derived from the published templates (acespect-backend/prisma/templates-snapshot.json) and the real wording
// code (src/web/wording/), so the sheet cannot drift from what the report prints. Writes <dir>/wording-matrix-<type>.json;
// build the spreadsheet from it with scripts/wording-matrix-xlsx.py.
//
// How a row is made: the section is run with only what the answer needs to be visible (the gating answers, e.g. "present =
// yes") and then with the one answer added; the sentences that appear are the row's wording. A defect is the same, built
// from every defect type and sub-type. "Section samples" run a whole section with every field answered, so the reviewer sees
// how the sentences join up. Rooms/sides/areas that word identically are merged into one row ("Applies to").
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const INSPECTION = args.inspection ?? "dilapidation";
const TYPE = args.type ?? "residential_house";
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(args.out ?? ".");
const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const templates = snapshot.filter((t) => t.inspectionType === INSPECTION && t.propertyType === TYPE);
if (!templates.length) throw new Error(`no templates for ${INSPECTION}/${TYPE}`);
const PROFILE = { inspectionType: INSPECTION, propertyType: TYPE };

const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { wordingFor } = await server.ssrLoadModule("/src/web/wording/registry.ts");
const { scopeOfInspectionSentences } = await server.ssrLoadModule("/src/web/descriptionScope.ts");
const wording = wordingFor({ inspectionType: INSPECTION, propertyType: TYPE });

const SAMPLE = "Typed example";
const SELECT = new Set(["pill-select", "select-tiles", "color-select"]);
const MULTI = new Set(["chip-multiselect", "tile-multiselect"]);
const TEXT = new Set(["text", "textarea"]);
const OTHER = "__other__:";

// Sections that are not report text (cover details) are left out.
const SKIP_SECTIONS = new Set(["job-info"]);
const SECTION_TITLES = {
  description: "Description & Overview", driveway: "Driveway", paving_paths: "Paving & Paths", fences: "Fences", retaining_walls: "Retaining Walls",
  garage_carport_sheds: "Garage / Carport / Sheds", pool_spa: "Pool / Spa", elevations: "Elevations", roof_chimneys: "Roof Covering & Chimneys",
  internal_areas: "Internal Areas", notes: "Notes & Post Project", custom_structure: "Other structure (custom)",
};
const SECTION_ORDER = Object.keys(SECTION_TITLES);
// The sections the mobile app offers for a report type (acespect-mobile/src/constants/inspectionSections.ts); the others stay in the
// published templates but are never filled in, so they are not part of what a reader of that report can see.
const SECTIONS_SHOWN = {
  public_assets: ["description", "elevations", "custom_structure"],
  apartment: ["description", "elevations", "roof_chimneys", "internal_areas", "paving_paths", "notes", "custom_structure"],
};
const orderOf = (k) => (SECTION_ORDER.includes(k) ? SECTION_ORDER.indexOf(k) : 99);

// ---- rendering --------------------------------------------------------------
function render(reportText) {
  return reportText
    .split("\n\n")
    .filter(Boolean)
    .map((p) => {
      const cond = p.match(/^COND::#[0-9a-f]{6}::(.+)$/i);
      if (cond) return `[Condition tag: ${cond[1]}]`;
      const room = p.match(/^ROOMHEAD::(.+)$/);
      if (room) return `[Heading: ${room[1]}]`;
      return p.replace(/^DEFECT::\d+::/, "");
    });
}
/** A paragraph's sentences (split at ". " before a capital or digit); a [marker] line stays whole. */
function splitSentences(p) {
  return p.startsWith("[") ? [p] : p.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
}
function summaryOf(d) {
  const rows = d.fields?.conditionSummary;
  return Array.isArray(rows) ? rows.map((r) => [r.subLabel, r.conditionLabel, r.defectNote].filter(Boolean).join(" – ")).join("\n") : "";
}
function run(tpl, answers) {
  try {
    const d = flattenSectionToDraft(tpl.fields, answers, tpl.sectionKey, PROFILE);
    const lines = render(d.reportText);
    // The Description page's "Scope of Inspection and Comments" sentences are built from the section's fields, not its report text.
    if (tpl.sectionKey === "description") {
      const b = scopeOfInspectionSentences(wording, d.fields ?? {}, 0);
      for (const line of [b.works, b.scope]) if (line) lines.push(`[Scope page] ${line}`);
    }
    return { sentences: lines.flatMap(splitSentences), text: lines.join("\n"), summary: summaryOf(d) };
  } catch (e) {
    return { sentences: [`ERROR: ${e.message}`], text: `ERROR: ${e.message}`, summary: "" };
  }
}
/** What an answer added: the sentences not in the baseline (counted, so a repeated sentence still shows). */
function added(base, now) {
  const left = [...base.sentences];
  const fresh = [];
  for (const s of now.sentences) {
    const i = left.indexOf(s);
    if (i >= 0) left.splice(i, 1);
    else fresh.push(s);
  }
  return { fresh, removed: left };
}
const show = (d) => (d.fresh.length ? d.fresh.join("\n") : d.removed.length ? `(removes: ${d.removed.join(" ")})` : "");

/** Mechanical wording problems a reader would notice; a row with any is marked for a closer look. */
function flagsOf(text) {
  const flags = [];
  for (const line of text.split("\n")) {
    if ((line.startsWith("[") && !line.startsWith("[Scope page]")) || line === line.toUpperCase()) continue; // markers and the floor bands (GROUND FLOOR)
    const t = line.replace(/^\[Scope page\]\s*/, "");
    if (/\b(\w{2,})\s+\1\b/i.test(t)) flags.push("repeated word");
    if (/&/.test(t)) flags.push("ampersand (&)");
    if (/\b(to|of|at|in|by|for|with|from)\.$/.test(t)) flags.push("sentence ends on a preposition");
    if (/[a-z]\.\.|,,|\s[.,;]/.test(t)) flags.push("stray punctuation");
    if (/\s{2,}/.test(t)) flags.push("double space");
    if (/^[a-z]/.test(t)) flags.push("starts with a lower-case letter");
    if (!/[.!?:]$/.test(t)) flags.push("no full stop at the end");
    if (/undefined|NaN|\[object|null\b/.test(t)) flags.push("leaked value");
  }
  return [...new Set(flags)].join("; ");
}

// ---- the template as levels ------------------------------------------------------
const byKey = (fields, k) => fields.find((f) => f.key === k);
const optionLabel = (f, v) => f.options?.find((o) => o.value === v)?.label ?? v;
const label = (f) => (f.label || f.key).replace(/\s+/g, " ").trim();

/** The answers that make `field` visible among `fields` (and, recursively, whatever its gate needs). */
function enablersFor(field, fields) {
  const out = {};
  let cur = field;
  for (let guard = 0; cur?.gate && guard < 6; guard++) {
    const { fieldKey, equals, equalsAny } = cur.gate;
    if (fieldKey === "__instanceKey") break;
    const want = equals ?? equalsAny?.[0];
    const gf = byKey(fields, fieldKey);
    if (want === undefined || !gf) break;
    out[fieldKey] = MULTI.has(gf.type) ? [want] : want;
    cur = gf;
  }
  return out;
}
/** Instances a field is shown on: an `__instanceKey` gate limits it, and so does one on a field it depends on (a note shown "if party wall = yes"). */
function instancesFor(field, instances, siblings) {
  let out = instances;
  let cur = field;
  for (let guard = 0; cur?.gate && guard < 6; guard++) {
    if (cur.gate.fieldKey === "__instanceKey") {
      const allowed = cur.gate.equalsAny ?? [cur.gate.equals];
      out = out.filter((i) => allowed.includes(i.key));
      break;
    }
    cur = byKey(siblings, cur.gate.fieldKey);
  }
  return out;
}

/** Everything one section can be asked: the section's own fields, and those inside its group (rooms, sides...). */
function describeSection(tpl) {
  const top = tpl.fields;
  const group = top.find((f) => f.type === "repeating-group");
  let instances = [{ key: undefined, label: "" }];
  let groupMode = null;
  if (group) {
    const fixed = group.repeat?.fixedInstances;
    if (fixed?.length && group.repeat.presentation !== "strip") {
      instances = fixed.map((i) => ({ key: i.key, label: i.label }));
      groupMode = "record";
    } else {
      instances = [{ key: "item", label: "" }];
      groupMode = "list";
    }
  }
  return { top, group, instances, groupMode };
}

/** The answers for a section: `topScope` at the top level and `instScope` inside the group's instance `inst`. */
function buildAnswers(sec, topScope, instScope, inst) {
  const answers = { ...topScope };
  if (sec.group) answers[sec.group.key] = sec.groupMode === "record" ? { [inst.key]: instScope ?? {} } : [instScope ?? {}];
  return answers;
}

// ---- the rows -----------------------------------------------------------------
const matrix = [];
const defectRows = [];
const unused = [];
const nonText = [];
const samples = [];

/** Variations of one non-defect field: [{ answer, patch }] */
function variationsOf(f, siblings) {
  const out = [];
  const otherBox = byKey(siblings, `${f.key}Other`);
  const withOther = (o, patch) => (o.value === "other" && otherBox ? { ...patch, [otherBox.key]: SAMPLE } : patch);
  const name = (o) => (o.value === "other" && otherBox ? `${o.label} (typed: "${SAMPLE}")` : o.label);
  if (f.type === "yesno") {
    out.push({ answer: "Yes", patch: { [f.key]: "yes" } }, { answer: "No", patch: { [f.key]: "no" } });
  } else if (SELECT.has(f.type)) {
    for (const o of f.options ?? []) out.push({ answer: name(o), patch: withOther(o, { [f.key]: o.value }) });
    if (f.allowOther && !f.options?.some((o) => o.value === "other")) out.push({ answer: `Other (typed: "${SAMPLE}")`, patch: { [f.key]: `${OTHER}${SAMPLE}` } });
  } else if (MULTI.has(f.type)) {
    const opts = f.options ?? [];
    for (const o of opts) out.push({ answer: name(o), patch: withOther(o, { [f.key]: [o.value] }) });
    const plain = opts.filter((o) => !o.exclusive && o.value !== "other");
    if (plain.length >= 2) out.push({ answer: `${plain[0].label} + ${plain[1].label}`, patch: { [f.key]: plain.slice(0, 2).map((o) => o.value) } });
    if (plain.length >= 3) out.push({ answer: `${plain[0].label} + ${plain[1].label} + ${plain[2].label}`, patch: { [f.key]: plain.slice(0, 3).map((o) => o.value) } });
    if (plain.length >= 4) out.push({ answer: `All ${plain.length} ticked`, patch: { [f.key]: plain.map((o) => o.value) } });
    if (f.allowOther && !opts.some((o) => o.value === "other")) out.push({ answer: `Other (typed: "${SAMPLE}")`, patch: { [f.key]: [`${OTHER}${SAMPLE}`] } });
  } else if (TEXT.has(f.type)) {
    const v = /year/i.test(f.key) ? "2015" : SAMPLE;
    out.push({ answer: `Typed: "${v}"`, patch: { [f.key]: v } });
  } else if (f.type === "numeric") {
    out.push({ answer: "Number typed: 5", patch: { [f.key]: 5 } });
  }
  return out;
}

/** A realistic baseline for a defect: the container's condition is Average (a defect is recorded when it is). */
function conditionPatch(fields) {
  const c = fields.find((f) => f.type === "color-select" && /condition/i.test(f.key));
  if (!c) return {};
  return { [c.key]: c.options?.find((o) => o.value === "average")?.value ?? c.options?.[0]?.value };
}

function processSection(tpl) {
  const sec = describeSection(tpl);
  const title = tpl.name || SECTION_TITLES[tpl.sectionKey] || tpl.sectionKey; // the section as this report type names it ("Offices & Staff Facilities" is the Commercial form's pool_spa)
  const sectionKey = tpl.sectionKey;
  const levels = [{ level: "top", fields: sec.top.filter((f) => f.type !== "repeating-group") }];
  if (sec.group) levels.push({ level: "inst", fields: sec.group.itemFields ?? [] });
  // the group's own gate (Retaining Walls' items show only when "present = yes")
  const groupEnablers = sec.group ? enablersFor(sec.group, sec.top) : {};

  for (const { level, fields } of levels) {
    for (const f of fields) {
      if (f.key.endsWith("Other") && byKey(fields, f.key.slice(0, -5))) continue; // shown with its option
      if (f.type === "photos") {
        nonText.push({ section: title, field: label(f), key: f.key });
        continue;
      }
      if (f.type === "damage-list" || f.type === "repeating-group") continue;
      const variations = variationsOf(f, fields);
      if (!variations.length) continue;
      const own = enablersFor(f, fields);
      const insts = level === "inst" ? instancesFor(f, sec.instances, fields) : [{ key: undefined, label: "" }];
      const ge = { ...groupEnablers };
      delete ge[f.key];

      // "alone": only what the answer needs to be visible. "context": every other field of the section answered too, for fields
      // whose sentence only exists alongside others (the Description's one flowing paragraph).
      const contextFor = (inst, mode) => {
        if (mode === "alone") return { top: level === "top" ? { ...ge, ...own } : ge, inst: level === "inst" ? { ...own } : {}, deps: {} };
        // everything answered, then this one field (and whatever hangs off it) taken out; the answer being tried puts the dependents back
        let top = fill(sec.top.filter((x) => x.type !== "repeating-group"), 0);
        let instScope = sec.group ? fill(sec.group.itemFields ?? [], 0, inst.key) : {};
        if (level === "top") top = { ...top, ...own };
        else instScope = { ...instScope, ...own };
        const scope = level === "top" ? top : instScope;
        const dependents = new Set();
        for (let grew = true; grew; ) {
          grew = false;
          for (const x of fields) if (x.gate && (x.gate.fieldKey === f.key || dependents.has(x.gate.fieldKey)) && !dependents.has(x.key)) (dependents.add(x.key), (grew = true));
        }
        const deps = Object.fromEntries([...dependents].filter((k) => scope[k] !== undefined).map((k) => [k, scope[k]]));
        for (const k of [f.key, ...dependents]) delete scope[k];
        return { top: { ...top, ...ge }, inst: instScope, deps };
      };
      const compute = (mode) =>
        insts.map((inst) => {
          const c = contextFor(inst, mode);
          const base = run(tpl, buildAnswers(sec, c.top, c.inst, inst));
          const rows = variations.map((v) => {
            const now = run(tpl, buildAnswers(sec, level === "top" ? { ...c.top, ...c.deps, ...v.patch } : c.top, level === "inst" ? { ...c.inst, ...c.deps, ...v.patch } : c.inst, inst));
            return { answer: v.answer, sentence: show(added(base, now)), prints: mode === "alone" && now.sentences.length > 0 && now.sentences.length <= 3 ? now.sentences.join(" ") : "", summary: now.summary !== base.summary ? now.summary : "" };
          });
          return { inst, rows };
        });
      // The Description is one flowing paragraph, so each answer is shown in it, not as a fragment on its own. An answer that
      // prints nothing the first way is tried the other way (e.g. "Yes" to "Is there a driveway?" only shows with the rest answered).
      const hasDependents = (level === "top" ? sec.top : fields).some((x) => x.gate?.fieldKey === f.key);
      const first = (tpl.sectionKey === "description" && level === "top") || (f.type === "yesno" && hasDependents) ? "context" : "alone";
      const second = first === "alone" ? "context" : "alone";
      const results = { [first]: compute(first) };
      const get = (mode) => (results[mode] ??= compute(mode));
      const perInstance = insts.map((inst, ii) => ({
        inst,
        rows: variations.map((v, ri) => {
          // "No" is only ever shown on its own: with the rest answered, the section's stored answers would still be there to print.
          const order = v.answer === "No" ? ["alone"] : [first, second];
          for (const mode of order) {
            const r = get(mode)[ii].rows[ri];
            if (r.sentence) return { ...r, context: mode === "context" };
          }
          const r = get(order[0])[ii].rows[ri];
          return { ...r, context: false };
        }),
      }));

      // merge instances that word identically, after swapping each instance's own name (and its parts: "Granny flat / Studio") for {name}
      const norm = (text, inst) => {
        const s = text.replace(/-hand\b/gi, "");
        const phrases = [inst.label, ...inst.label.split(/[/&,]|\band\b/)].map((x) => x.trim()).filter((x) => x.length > 2);
        return [...new Set(phrases)].sort((a, b) => b.length - a.length).reduce((out, ph) => out.replace(new RegExp(ph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "{name}"), s);
      };
      let anyChange = false;
      for (let i = 0; i < variations.length; i++) {
        const groups = new Map();
        for (const { inst, rows } of perInstance) {
          const r = rows[i];
          const k = `${norm(r.sentence, inst)}||${norm(r.summary, inst)}`;
          if (!groups.has(k)) groups.set(k, { row: r, insts: [] });
          groups.get(k).insts.push(inst);
        }
        for (const { row, insts: members } of groups.values()) {
          if (row.sentence) anyChange = true;
          const named = members[0].label !== "";
          matrix.push({
            section: title,
            sectionKey,
            field: label(f),
            fieldKey: f.key,
            answer: row.answer,
            sentence: row.sentence || (row.prints ? `(adds nothing; the section reads: ${row.prints})` : "(no change to the wording)"),
            summary: row.summary,
            flags: row.sentence ? flagsOf(row.sentence) : "",
            context: !!row.context,
            appliesTo: !named ? "" : members.length === sec.instances.length && members.length > 1 ? `All ${members.length}` : members.map((m) => m.label).join(", "),
          });
        }
      }
      if (!anyChange) unused.push({ section: title, field: label(f), key: f.key });
    }
  }

  const damageHost = [
    ...sec.top.filter((f) => f.type === "damage-list").map((f) => ({ f, level: "top", fields: sec.top })),
    ...(sec.group?.itemFields ?? []).filter((f) => f.type === "damage-list").map((f) => ({ f, level: "inst", fields: sec.group.itemFields })),
  ][0];
  if (damageHost) defectMatrix(tpl, sec, title, damageHost, groupEnablers);
  samplesFor(tpl, sec, title);
}

function defectMatrix(tpl, sec, title, { f: dmg, level, fields }, groupEnablers) {
  const items = dmg.itemFields ?? [];
  const typeF = byKey(items, "damageType");
  const host = { ...enablersFor(dmg, fields), ...conditionPatch(fields) };
  const inst = sec.instances[0];
  const loc = "the centre of the area";
  const answers = (d) => {
    const scope = d ? { ...host, [dmg.key]: [{ location: loc, ...d }] } : host;
    return buildAnswers(sec, level === "top" ? { ...groupEnablers, ...scope } : groupEnablers, level === "inst" ? scope : {}, inst);
  };
  const baseline = run(tpl, answers(null));
  const firstType = typeF?.options?.[0]?.value;
  const row = (situation, answer, d) => {
    const now = run(tpl, answers(d));
    const sentence = show(added(baseline, now)) || "(no change to the wording)";
    defectRows.push({ section: title, sectionKey: tpl.sectionKey, situation, answer, sentence, flags: flagsOf(sentence) });
  };
  if (!typeF) {
    row("Defect", "Location only", {});
  } else {
    for (const t of typeF.options ?? []) {
      const sub = items.find((x) => x.gate?.fieldKey === "damageType" && x.gate.equals === t.value && x.options);
      if (!sub) row("Defect type", t.label, { damageType: t.value });
      else for (const s of sub.options) row(`Defect type: ${t.label}`, s.label, { damageType: t.value, [sub.key]: s.value });
    }
    if (typeF.allowOther) row("Defect type", `Other (typed: "${SAMPLE}")`, { damageType: `${OTHER}${SAMPLE}` });
    const crackSub = items.find((x) => x.key === "sub_cracking");
    const crack = { damageType: "cracking", ...(crackSub ? { sub_cracking: crackSub.options[0].value } : {}) };
    const dir = byKey(items, "direction");
    if (byKey(items, "widthMm")) {
      row("Cracking: size", "Width and length given (4 mm, 250 mm)", { ...crack, widthMm: 4, lengthMm: 250 });
      row("Cracking: size", "Width only (4 mm)", { ...crack, widthMm: 4 });
      row("Cracking: size", "Length only (250 mm)", { ...crack, lengthMm: 250 });
    }
    for (const o of dir?.options ?? []) row("Cracking: direction", o.label, { ...crack, direction: o.value });
    if (byKey(items, "crackStartLocation")) row("Cracking: start point", `Typed: "the front corner"`, { ...crack, crackStartLocation: "the front corner" });
    if (dir && byKey(items, "widthMm") && byKey(items, "crackStartLocation")) {
      row("Cracking: everything given", "Start point, direction, width, length", { ...crack, crackStartLocation: "the front corner", direction: dir.options[0].value, widthMm: 4, lengthMm: 250 });
    }
  }
  if (byKey(items, "element")) row("Element", `Typed: "coping"`, { damageType: firstType, element: "coping" });
  row("Location typed", "Starts with a preposition (above the window)", { damageType: firstType, location: "above the window" });
  row("Location typed", "Left blank", { damageType: firstType, location: "" });
  if (byKey(items, "notes")) row("Defect notes", `Typed: "Monitor at next inspection"`, { damageType: firstType, notes: "Monitor at next inspection" });
}

// ---- whole-section samples ------------------------------------------------------------
const TITLE_KEYS = new Set(["roomName", "structureName", "partName"]);
const isNameField = (f) => TITLE_KEYS.has(f.key) || /^(rename|name this|area name|room name)/i.test(f.label ?? "");
const pick = (arr, k) => arr[k < 0 ? arr.length - 1 : k % arr.length];
function fill(fields, k, instanceKey) {
  // Answer every visible field: the k-th option of each select (wrapping), two consecutive options of each multiselect, text as typed.
  const scope = {};
  const hit = (val, t) => (Array.isArray(val) ? val.includes(t) : val === t);
  for (const f of fields) {
    if (f.gate?.fieldKey === "__instanceKey") {
      if (!(f.gate.equalsAny ?? [f.gate.equals]).includes(instanceKey)) continue;
    } else if (f.gate) {
      const val = scope[f.gate.fieldKey];
      if (!(f.gate.equalsAny ? f.gate.equalsAny.some((t) => hit(val, t)) : hit(val, f.gate.equals))) continue;
    }
    if (isNameField(f)) continue; // a room / structure name typed in would rename every instance in the samples
    if (f.type === "yesno") scope[f.key] = "yes";
    else if (SELECT.has(f.type)) {
      const opts = (f.options ?? []).filter((o) => o.value !== "other");
      if (opts.length) scope[f.key] = pick(opts, k).value;
    } else if (MULTI.has(f.type)) {
      const opts = (f.options ?? []).filter((o) => o.value !== "other" && !o.exclusive);
      if (opts.length) scope[f.key] = [...new Set(k < 0 ? opts.slice(-2).map((o) => o.value) : [opts[k % opts.length].value, opts[(k + 1) % opts.length].value])];
    } else if (TEXT.has(f.type)) scope[f.key] = /year/i.test(f.key) ? "2015" : SAMPLE;
    else if (f.type === "numeric") scope[f.key] = 5;
    else if (f.type === "damage-list") scope[f.key] = [fillDefect(f, k)];
  }
  return scope;
}
function fillDefect(f, k) {
  const items = f.itemFields ?? [];
  const types = byKey(items, "damageType")?.options ?? [];
  const t = types.length ? pick(types, k) : undefined;
  const d = { location: "the centre of the area", ...(t ? { damageType: t.value } : {}) };
  const sub = items.find((x) => x.gate?.fieldKey === "damageType" && x.gate.equals === t?.value && x.options);
  if (sub) d[sub.key] = pick(sub.options, k).value;
  if (t?.value === "cracking") Object.assign(d, { widthMm: 4, lengthMm: 250, crackStartLocation: "the front corner", direction: byKey(items, "direction")?.options?.[0]?.value });
  return d;
}
function describeAnswers(fields, scope) {
  return fields
    .filter((f) => scope[f.key] !== undefined && f.type !== "photos")
    .map((f) => {
      const v = scope[f.key];
      if (f.type === "damage-list") {
        const d = v[0];
        const t = byKey(f.itemFields ?? [], "damageType");
        const sub = (f.itemFields ?? []).find((x) => x.gate?.equals === d.damageType && x.options && d[x.key]);
        return `${label(f)}: ${[t ? optionLabel(t, d.damageType) : "", sub ? optionLabel(sub, d[sub.key]) : ""].filter(Boolean).join(" – ") || "one defect"}`;
      }
      const text = Array.isArray(v) ? v.map((x) => optionLabel(f, x)).join(" + ") : f.options ? optionLabel(f, v) : String(v);
      return `${label(f)}: ${text}`;
    })
    .join("\n");
}
function samplesFor(tpl, sec, title) {
  for (const [name, k] of [["Sample A: first option of everything", 0], ["Sample B: second option of everything", 1], ["Sample C: third option of everything", 2], ["Sample D: last option of everything", -1]]) {
    const topFields = sec.top.filter((f) => f.type !== "repeating-group");
    let top = fill(topFields, k);
    const shown = [describeAnswers(topFields, top)];
    if (sec.group) {
      const gate = sec.group.gate;
      const gateOk = !gate || (gate.equalsAny ? gate.equalsAny.some((t) => (Array.isArray(top[gate.fieldKey]) ? top[gate.fieldKey].includes(t) : top[gate.fieldKey] === t)) : (Array.isArray(top[gate.fieldKey]) ? top[gate.fieldKey].includes(gate.equals) : top[gate.fieldKey] === gate.equals));
      if (gateOk) {
        const insts = sec.groupMode === "record" ? sec.instances : [sec.instances[0]];
        const scopes = insts.map((inst) => fill(sec.group.itemFields ?? [], k, inst.key));
        top = { ...top, [sec.group.key]: sec.groupMode === "record" ? Object.fromEntries(insts.map((inst, i) => [inst.key, scopes[i]])) : scopes };
        insts.forEach((inst, i) => shown.push(`${inst.label || "Item"}:\n${describeAnswers(sec.group.itemFields ?? [], scopes[i]).replace(/^/gm, "   ")}`));
      }
    }
    const out = run(tpl, top);
    samples.push({ section: title, sectionKey: tpl.sectionKey, sample: name, answers: shown.filter(Boolean).join("\n"), text: out.text, summary: out.summary });
  }
}

const shown = SECTIONS_SHOWN[TYPE];
for (const tpl of [...templates].filter((t) => !SKIP_SECTIONS.has(t.sectionKey) && (!shown || shown.includes(t.sectionKey))).sort((a, b) => orderOf(a.sectionKey) - orderOf(b.sectionKey))) processSection(tpl);

// Defect wording is the same in every section: one row per situation, listing the sections it applies to.
const mergedDefects = [];
for (const r of defectRows) {
  const hit = mergedDefects.find((m) => m.situation === r.situation && m.answer === r.answer && m.sentence === r.sentence);
  if (hit) hit.sections.push(r.section);
  else mergedDefects.push({ situation: r.situation, answer: r.answer, sentence: r.sentence, flags: r.flags, sections: [r.section] });
}
const sectionCount = new Set(defectRows.map((r) => r.section)).size;
for (const m of mergedDefects) m.appliesTo = m.sections.length === sectionCount ? `All ${sectionCount} sections` : m.sections.join(", ");

const result = {
  generatedAt: new Date().toISOString(),
  profile: `${INSPECTION} / ${TYPE}`,
  counts: { rows: matrix.length, defects: mergedDefects.length, samples: samples.length, unused: unused.length },
  matrix,
  defects: mergedDefects,
  samples,
  unused,
  nonText,
};
mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, `wording-matrix-${TYPE}.json`);
writeFileSync(file, JSON.stringify(result, null, 2));
console.log(`${matrix.length} answer rows, ${mergedDefects.length} defect rows, ${samples.length} section samples, ${unused.length} fields with no wording -> ${file}`);
await server.close();
