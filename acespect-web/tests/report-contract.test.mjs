// The report's contract with the form templates.
//
// Every select / tick-box field in every Dilapidation House section the report
// words is tried with EVERY option -- and with the two kinds of "Other" the
// forms can store ("other" with nothing typed, and "__other__:<text>") -- and the
// generated text must never show a raw stored value (front_left, timber_palings,
// __other__:...), "undefined", or a blank gap. This is what stops a change to the
// forms or the stored answer format from quietly breaking the report: it runs
// against the real template snapshot, so a template change that the wording does
// not understand fails here, before it is merged.
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

const snapshot = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
// Every report type that has its own (final) wording, and the sections that wording writes.
const FINAL_TYPES = Object.values(WORDING_BY_PROFILE).filter((w) => w.status === "final");
const templateOf = (profile, k) => snapshot.find((t) => t.inspectionType === profile.inspectionType && t.propertyType === profile.propertyType && t.sectionKey === k)?.fields;

const SELECT = new Set(["pill-select", "select-tiles", "color-select"]);
const MULTI = new Set(["chip-multiselect", "tile-multiselect"]);

// A fully answered baseline: every field answered, selects with their second option, first two fixed slots filled.
function fill(fields) {
  const a = {};
  for (const f of fields) {
    if (f.type === "photos") continue;
    if (f.type === "yesno") a[f.key] = "yes";
    else if (SELECT.has(f.type)) a[f.key] = f.options?.[1]?.value ?? f.options?.[0]?.value ?? "x";
    else if (MULTI.has(f.type)) a[f.key] = (f.options ?? []).slice(0, 2).map((o) => o.value);
    else if (f.type === "numeric") a[f.key] = 5;
    else if (f.type === "text" || f.type === "textarea") a[f.key] = "sample text";
    else if (f.type === "damage-list") a[f.key] = [fill(f.itemFields ?? [])];
    else if (f.type === "repeating-group") {
      const fixed = f.repeat?.fixedInstances;
      a[f.key] = fixed?.length ? Object.fromEntries(fixed.slice(0, 2).map((i) => [i.key, fill(f.itemFields ?? [])])) : [fill(f.itemFields ?? [])];
    }
  }
  return a;
}

// every field that offers a choice, with the path of group keys to reach it
function choiceFields(fields, path = []) {
  const out = [];
  for (const f of fields) {
    if ((SELECT.has(f.type) || MULTI.has(f.type)) && f.options?.length) out.push({ field: f, path });
    if (f.itemFields) out.push(...choiceFields(f.itemFields, [...path, f.key]));
  }
  return out;
}

// set `key` to `value` in every object of the answer tree that has that key (every instance / defect entry)
function setEverywhere(node, key, value, damageSubs) {
  if (Array.isArray(node)) return node.forEach((n) => setEverywhere(n, key, value, damageSubs));
  if (!node || typeof node !== "object") return;
  if (key in node) {
    node[key] = value;
    // changing a defect type: answer that type's own sub-type question too
    if (key === "damageType") {
      for (const sub of damageSubs) {
        if (sub.gate?.equals === (typeof value === "string" ? value : "")) node[sub.key] = sub.options?.[0]?.value;
      }
    }
  }
  Object.values(node).forEach((n) => setEverywhere(n, key, value, damageSubs));
}

const problems = (out, raw) => {
  const found = [];
  if (out.includes("__other__")) found.push("raw __other__");
  if (/\bundefined\b|\[object Object\]|NaN/.test(out)) found.push("undefined / NaN");
  if (/ \.(\s|$)|of \.|in {2,}\w|, ,|\(\)/.test(out.replace(/\n/g, " "))) found.push("blank gap");
  for (const r of raw) if (out.includes(r)) found.push(`raw value "${r}"`);
  return found;
};

for (const wording of FINAL_TYPES) describe(`report contract (${wording.profile.inspectionType} / ${wording.profile.propertyType}): no raw answer values or blank gaps, for every option of every field`, () => {
  for (const sectionKey of Object.keys(wording.composers)) {
    it(sectionKey, () => {
      const fields = templateOf(wording.profile, sectionKey);
      if (!fields) return; // this report type's form has no such section
      const fields2 = choiceFields(fields);
      const damageSubs = [];
      const walkSubs = (fs) => fs.forEach((f) => { if (f.key.startsWith("sub_")) damageSubs.push(f); if (f.itemFields) walkSubs(f.itemFields); });
      walkSubs(fields);
      let tried = 0;
      const failures = [];
      for (const { field } of fields2) {
        // the stored codes (front_left, timber_palings) must never reach the reader; a typed Other
        // only exists on fields the template marks allowOther
        const rawValues = field.options.map((o) => o.value).filter((v) => v.includes("_"));
        const variants = [...field.options.map((o) => o.value), ...(field.allowOther ? ["other", "__other__:Typed detail", "__other__:"] : [])];
        for (const v of variants) {
          const value = MULTI.has(field.type) ? [v] : v;
          const answers = fill(fields);
          setEverywhere(answers, field.key, value, damageSubs);
          const draft = flattenSectionToDraft(fields, answers, sectionKey, wording.profile);
          const out = `${draft.reportText}\n${JSON.stringify(draft.fields)}`;
          tried += 1;
          const bad = problems(out, rawValues);
          if (bad.length) failures.push(`${field.key} = ${JSON.stringify(value)} -> ${bad.join(", ")}`);
        }
      }
      assert.ok(tried > 0);
      assert.deepEqual(failures.slice(0, 8), [], `${failures.length} problem(s) of ${tried} combinations`);
    });
  }
});
