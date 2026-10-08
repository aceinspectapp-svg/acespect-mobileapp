// Every answer on the website form must change the printed report.
//
// For each report type that has its own wording, every field of every section is flipped through its options (or
// a different typed value) with the field's gates -- and those of the groups it sits in -- switched on, and the
// report text is compared. A field whose answer changes nothing is an answer that would be saved but never printed.
// (Photos are laid out separately, and the Description page itself prints the project-works and scope answers.)
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { WORDING_BY_PROFILE } = await server.ssrLoadModule("/src/web/wording/registry.ts");
const snap = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));

const SELECT = new Set(["pill-select", "select-tiles", "color-select"]);
const MULTI = new Set(["chip-multiselect", "tile-multiselect"]);

function fill(fields) {
  const a = {};
  for (const f of fields) {
    if (f.type === "photos") continue;
    if (f.type === "yesno") a[f.key] = "yes";
    else if (SELECT.has(f.type)) a[f.key] = f.options?.[1]?.value ?? f.options?.[0]?.value ?? "x";
    else if (MULTI.has(f.type)) a[f.key] = (f.options ?? []).slice(0, 2).map((o) => o.value);
    else if (f.type === "numeric") a[f.key] = 5;
    else if (f.type === "text" || f.type === "textarea") a[f.key] = "sampletext";
    else if (f.type === "damage-list") a[f.key] = [fill(f.itemFields ?? [])];
    else if (f.type === "repeating-group") {
      const fixed = f.repeat?.fixedInstances;
      a[f.key] = fixed?.length ? Object.fromEntries(fixed.slice(0, 2).map((i) => [i.key, fill(f.itemFields ?? [])])) : [fill(f.itemFields ?? [])];
    }
  }
  return a;
}
function allFields(fields, trail = []) {
  const out = [];
  for (const f of fields) {
    out.push({ f, trail });
    if (f.itemFields) out.push(...allFields(f.itemFields, [...trail, f.key]));
  }
  return out;
}
function atTrail(node, trail, cb) {
  if (!trail.length) return cb(node);
  const child = node?.[trail[0]];
  if (Array.isArray(child)) child.forEach((c) => atTrail(c, trail.slice(1), cb));
  else if (child && typeof child === "object") {
    // a record of fixed instances, or a single object
    const vals = Object.values(child);
    if (vals.length && vals.every((v) => v && typeof v === "object" && !Array.isArray(v))) vals.forEach((c) => atTrail(c, trail.slice(1), cb));
    else atTrail(child, trail.slice(1), cb);
  }
}
function setAt(root, trail, key, value, gate) {
  atTrail(root, trail, (node) => {
    if (!node || typeof node !== "object" || !(key in node)) return;
    node[key] = value;
    if (gate && gate.fieldKey !== "__instanceKey") node[gate.fieldKey] = gate.equals !== undefined ? gate.equals : gate.equalsAny?.[0];
  });
}
const gateChain = (fields, f) => { const chain = []; let cur = f; while (cur?.gate) { chain.push(cur.gate); cur = allFields(fields).find((x) => x.f.key === cur.gate.fieldKey)?.f; } return chain; };
// What the reader sees: the saved text, the Condition Summary rows, and (Description) the two sentences the report type words on the Description page.
const render = (fields, answers, sectionKey, profile) => {
  const d = flattenSectionToDraft(fields, JSON.parse(JSON.stringify(answers)), sectionKey, profile);
  const w = Object.values(WORDING_BY_PROFILE).find((x) => x.profile && x.profile.inspectionType === profile.inspectionType && x.profile.propertyType === profile.propertyType);
  const blocks = sectionKey === "description" && w?.descriptionBlocks ? JSON.stringify(w.descriptionBlocks({ fields: d.fields, areaCount: 2 })) : "";
  return d.reportText + "\n#" + JSON.stringify(d.fields.conditionSummary ?? []) + "\n#" + blocks;
};


// Answers the REAL Houspect report does not print (see "Dilapidation Residential Example Apr 2025.pdf"): the kind of works
// is only used to choose the project-works sentence ("... to the property at X" or "... are the X"), never printed.
const NOT_PRINTED_BY_DESIGN = {
  "dilapidation/residential_house": ["description: proposedWorksTypeOther"],
  "dilapidation/commercial_properties": ["description: proposedWorksTypeOther"],
  "dilapidation/apartment": ["description: proposedWorksTypeOther"],
};

function unprintedFields(w) {
  const profile = w.profile;
  const unprinted = [];
  for (const t of snap.filter((x) => x.inspectionType === profile.inspectionType && x.propertyType === profile.propertyType)) {
    if (["job-info", "custom_structure"].includes(t.sectionKey)) continue;
    const fields = t.fields;
    for (const { f, trail } of allFields(fields)) {
      if (f.type === "photos" || f.type === "damage-list" || f.type === "repeating-group") continue;
      if (f.key === "__instanceKey") continue;
      // an old separate "If Other" box whose gate names a choice the form no longer has (Public Assets): a typed Other is stored inline instead
      if (f.gate && f.gate.equals !== undefined) {
        const gating = allFields(fields).find((x) => x.f.key === f.gate.fieldKey && JSON.stringify(x.trail) === JSON.stringify(trail))?.f;
        if (gating?.options && f.gate.equals !== "other" && !gating.options.some((o) => o.value === f.gate.equals)) continue;
      }
      // printed on the Description page itself (ReportDescription), not in the saved text
      if (t.sectionKey === "description" && ["projectSiteAddress", "siteSide", "siteSideOther", "siteDirection", "siteDirectionOther", "scopeForInspection", "scopeDetail", "scopePartDetail", "scopeConfirmed", "underConstructionStage"].includes(f.key)) continue;
      // only for the report types whose app flow includes the section (Public Assets surveys only job info, description and survey parts)
      if (profile.propertyType === "public_assets" && !["description", "elevations"].includes(t.sectionKey)) continue;
      let variants = [];
      if (f.type === "yesno") variants = ["yes", "no"];
      else if (SELECT.has(f.type)) variants = (f.options ?? []).map((o) => o.value);
      else if (MULTI.has(f.type)) variants = [[], ...(f.options ?? []).map((o) => [o.value])];
      else if (f.type === "numeric") variants = [3, 9];
      else variants = ["alpha token", "beta token"];
      const outs = new Set();
      for (const v of variants) {
        const a = fill(fields);
        // satisfy this field's gates (and those of the gate fields) wherever it lives
        // satisfy the gates of this field and of every group / list it sits inside
        const everything = allFields(fields);
        const lookup = (key, tr) => everything.find((x) => x.f.key === key && JSON.stringify(x.trail) === JSON.stringify(tr))?.f;
        const gateFields = [{ f, tr: trail }];
        for (let i = 0; i < trail.length; i++) { const anc = lookup(trail[i], trail.slice(0, i)); if (anc) gateFields.push({ f: anc, tr: trail.slice(0, i) }); }
        for (const { f: gf, tr } of gateFields.reverse()) {
          let cur = gf; let curTr = tr; const chain = [];
          while (cur?.gate) { chain.push({ g: cur.gate, tr: curTr }); cur = lookup(cur.gate.fieldKey, curTr); }
          for (const { g, tr: gtr } of chain.reverse()) setAt(a, gtr, g.fieldKey, g.equals !== undefined ? g.equals : g.equalsAny?.[0], null);
        }
        setAt(a, trail, f.key, v, null);
        try { outs.add(render(fields, a, t.sectionKey, profile)); } catch (e) { outs.add("ERR" + v); }
      }
      if (outs.size <= 1 && variants.length > 1) unprinted.push(`${t.sectionKey}: ${[...trail, f.key].join(".")}  "${(f.label || "").slice(0, 60)}"`);
    }
  }
  return unprinted;
}

describe("every answer on the website form is printed", () => {
  for (const w of Object.values(WORDING_BY_PROFILE).filter((x) => x.status === "final")) {
    it(`${w.profile.inspectionType} / ${w.profile.propertyType}`, () => {
      const skip = NOT_PRINTED_BY_DESIGN[`${w.profile.inspectionType}/${w.profile.propertyType}`] ?? [];
      assert.deepEqual(unprintedFields(w).filter((x) => !skip.some((s) => x.startsWith(s))), []);
    });
  }
});
