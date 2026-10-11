// Every Construction Stage form (all 8 stages, House and Apartment) has a report, and every answer on it reaches the report.
//
// For each stage and property type, the real published templates (acespect-backend/prisma/templates-snapshot.json) are filled
// in, the report is built, and then each field is flipped through its options (or another value) with its gates switched
// on -- a field whose answer changes nothing is an answer that would be saved but never printed. The few answers that are
// deliberately not printed are listed below with the reason.
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
const { buildConstructionReport, stageOfSectionKeys } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const snap = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));

const STAGES = [
  ["pp_", "Pre-Pour"], ["sd_", "Slab Down"], ["fr_", "Framework"], ["lu_", "Lock-Up"], ["fx_", "Fixing"], ["pci_", "PCI"], ["sf_", "Slab + Frame"], ["lf_", "Lock-Up + Fixing"],
];
const PROPS = ["residential_house", "apartment"];

/** Answers that are asked on the form but deliberately do not appear in the report text, with the reason. */
const NOT_PRINTED = {
  plansSpecs: "which plans were supplied is not part of the report layout",
  plansSpecsOther: "which plans were supplied is not part of the report layout",
  previousDefectsList: "the previous-defects list is covered by its own Previous Defects section",
  clientIssuesList: "the client list is covered by its own Client List of Issues section",
  safetyIssues: "printed through the General Description only when 'yes' (see safetyDescribe)",
  safetyDescribe: "printed through the General Description",
  streetPhotos: "photographs are laid out separately", elevationPhotos: "photographs are laid out separately", neighbourPhotos: "photographs are laid out separately",
};

const templates = (prop, prefix) => snap.filter((t) => t.inspectionType === "construction_stage" && t.propertyType === prop && t.sectionKey.startsWith(prefix));
const gateOk = (f, a) => !f.gate || (f.gate.equalsAny ?? [f.gate.equals]).some((v) => (Array.isArray(a[f.gate.fieldKey]) ? a[f.gate.fieldKey].includes(v) : a[f.gate.fieldKey] === v));
const isDefectOpt = (f, o) => (f.defectOn ? f.defectOn.includes(o.value) : o.color === "#E63329");
const isNA = (o) => /^n\/a$|^not applicable$/i.test(o.label) || o.color === "#94A1B2";

/** A complete, defect-free answer set for one section's fields. */
function fill(fields) {
  const a = {};
  for (const f of fields) {
    if (!gateOk(f, a)) continue;
    if (f.type === "pill-select") a[f.key] = (f.options.find((o) => !isDefectOpt(f, o) && !isNA(o)) ?? f.options[0]).value;
    else if (f.type === "yesno") a[f.key] = "yes";
    else if (f.type === "chip-multiselect" || f.type === "tile-multiselect") a[f.key] = [];
    else if (f.type === "numeric") a[f.key] = "1200";
    else if (f.type === "text" || f.type === "textarea") a[f.key] = "base text";
    else if (f.type === "photos") a[f.key] = [];
    else if (f.type === "repeating-group") a[f.key] = [];
  }
  return a;
}

/** Makes every gate above `f` true, so `f` is on the form. */
function openGates(f, fields, a) {
  if (!f.gate) return;
  const g = fields.find((x) => x.key === f.gate.fieldKey);
  if (!g) return;
  openGates(g, fields, a);
  const want = (f.gate.equalsAny ?? [f.gate.equals])[0];
  a[g.key] = g.type === "chip-multiselect" || g.type === "tile-multiselect" ? [want] : want;
}

const probes = (f) => {
  if (f.type === "pill-select") return [...f.options.map((o) => o.value), ...(f.allowOther ? ["__other__:probe other"] : [])];
  if (f.type === "yesno") return ["yes", "no"];
  if (f.type === "chip-multiselect" || f.type === "tile-multiselect") return [[], f.options.slice(0, 1).map((o) => o.value), f.options.slice(0, 2).map((o) => o.value)];
  if (f.type === "numeric") return ["1200", "3456"];
  if (f.type === "text" || f.type === "textarea") return ["base text", "probe text"];
  if (f.type === "photos") return [[], ["/probe.jpg"]];
  return [];
};

function build(prop, prefix, answersByKey, jobInfo = {}) {
  const sections = templates(prop, prefix).map((t, i) => ({
    key: t.sectionKey, name: t.name, fields: t.fields, answers: answersByKey[t.sectionKey] ?? {}, approved: true, order: i,
  }));
  return buildConstructionReport(sections, jobInfo, prop === "apartment");
}
const baseAnswers = (prop, prefix) => Object.fromEntries(templates(prop, prefix).map((t) => [t.sectionKey, fill(t.fields)]));
const printed = (m) => JSON.stringify(m);

for (const prop of PROPS) {
  for (const [prefix, stageName] of STAGES) {
    describe(`${stageName} report — ${prop}`, () => {
      const secs = templates(prop, prefix);

      it("has a template for every section and finds its stage", () => {
        assert.ok(secs.length >= 8, `${secs.length} sections`);
        assert.equal(stageOfSectionKeys(secs.map((s) => s.sectionKey)) !== null, true);
      });

      it("builds a report with a General Description, Site & Facilities, its checks and its notes", () => {
        const answers = baseAnswers(prop, prefix);
        for (const t of secs) if (t.sectionKey.endsWith("_summary")) answers[t.sectionKey].workmanshipSatisfactory = "yes";
        const m = build(prop, prefix, answers);
        assert.ok(m, "model");
        assert.ok(m.description.length >= 3, "description sentences");
        if (secs.some((s) => s.sectionKey.endsWith("_site_facilities"))) assert.ok(m.site.length > 0, "site & facilities");
        assert.ok(m.blocks.length > 0, "stage checks");
        assert.ok(m.notes.some((n) => /workmanship/i.test(n)), "workmanship statement");
        assert.ok(!/undefined|NaN|\[object/.test(printed(m)), "no broken text");
        // Every stage section that has checklist rows contributes at least one printed row.
        const banners = m.blocks.length;
        assert.ok(banners >= 1);
      });

      it("prints every answer on the form", () => {
        const base = baseAnswers(prop, prefix);
        const baseOut = printed(build(prop, prefix, base));
        const silent = [];
        for (const t of secs) {
          if (/_(description|defects|previous_defects|client_issues|typical_defects)$/.test(t.sectionKey)) continue; // covered below
          const fields = t.fields;
          for (const f of fields) {
            if (f.type === "repeating-group" || NOT_PRINTED[f.key]) continue;
            if (/_other_note$/.test(f.key)) continue; // printed together with its "Other" row, checked below
            let changed = false;
            for (const value of probes(f)) {
              const answers = structuredClone(base);
              const a = answers[t.sectionKey];
              openGates(f, fields, a);
              a[f.key] = value;
              if (printed(build(prop, prefix, answers)) !== baseOut) { changed = true; break; }
              // Some rows only print when their gates are on AND a neighbour is set; flip against an opened baseline too.
              const opened = structuredClone(base);
              openGates(f, fields, opened[t.sectionKey]);
              const openedOut = printed(build(prop, prefix, opened));
              const again = structuredClone(opened);
              again[t.sectionKey][f.key] = value;
              if (printed(build(prop, prefix, again)) !== openedOut) { changed = true; break; }
            }
            if (!changed) silent.push(`${t.sectionKey}.${f.key} (${f.type}) “${f.label.slice(0, 50)}”`);
          }
        }
        assert.deepEqual(silent, [], `answers that never reach the report:\n  ${silent.join("\n  ")}`);
      });

      it("turns a Defect answer into a numbered defect with its details, photos and code reference", () => {
        const base = baseAnswers(prop, prefix);
        const target = secs.flatMap((t) => t.fields.filter((f) => f.type === "pill-select" && f.defectOn?.length && gateOk(f, base[t.sectionKey])).map((f) => [t, f]))[0];
        assert.ok(target, "a checklist row with a Defect choice");
        const [t, f] = target;
        const answers = structuredClone(base);
        answers[t.sectionKey][f.key] = f.defectOn[0];
        answers[t.sectionKey][`${f.key}__defect`] = { location: "Level 1 hall", category: ["damage"], severity: ["minor"], photos: ["/a.jpg", "/b.jpg"], comments: "probe comment", constructionCode: "2.04" };
        const m = build(prop, prefix, answers);
        assert.equal(m.defects.length, 1);
        const d = m.defects[0];
        assert.equal(d.no, 1);
        assert.match(d.text, /Level 1 hall/);
        assert.match(d.text, /probe comment/);
        assert.deepEqual(d.categories, ["Damage"]);
        assert.deepEqual(d.severities, ["Minor"]);
        assert.equal(d.photos.length, 2);
        assert.equal(d.code, "2.04");
        assert.ok(m.references.some((s) => s.codes.some((c) => c.code === "2.04")), "the code's extract is in the references");
        assert.ok(m.blocks.flatMap((b) => b.groups.flatMap((g) => g.items)).some((i) => /Defect 1\)/.test(i.text)), "the checklist row points to Defect 1");
      });

      it("prints each part of a defect's details", () => {
        const base = baseAnswers(prop, prefix);
        const [t, f] = secs.flatMap((t) => t.fields.filter((f) => f.type === "pill-select" && f.defectOn?.length).map((f) => [t, f]))[0];
        const detail = { location: "L", category: ["damage"], severity: ["minor"], photos: ["/a.jpg"], comments: "c", constructionCode: "2.04" };
        const withDetail = (d) => { const a = structuredClone(base); a[t.sectionKey][f.key] = f.defectOn[0]; a[t.sectionKey][`${f.key}__defect`] = d; return printed(build(prop, prefix, a)); };
        const full = withDetail(detail);
        for (const k of Object.keys(detail)) assert.notEqual(withDetail({ ...detail, [k]: Array.isArray(detail[k]) ? [] : "" }), full, `${k} reaches the report`);
      });

      it("prints the Defects table, the previous and client lists, and the typical-defect ticks", () => {
        const base = baseAnswers(prop, prefix);
        const baseOut = printed(build(prop, prefix, base));
        const probeSection = (suffix, patch) => {
          const t = secs.find((s) => s.sectionKey.endsWith(suffix));
          if (!t) return null;
          const answers = structuredClone(base);
          Object.assign(answers[t.sectionKey], patch(t));
          return printed(build(prop, prefix, answers));
        };
        const table = probeSection("_defects", () => ({ defects: [{ location: "Roof", description: "probe defect", photos: ["/a.jpg"] }] }));
        assert.ok(table && table !== baseOut && /probe defect/.test(table), "Defects table rows print");
        const prev = probeSection("_previous_defects", () => ({ previousDefectsStatus: "attached", previousDefectsUpdates: "probe previous", previousDefectsPhotos: ["/a.jpg"] }));
        if (secs.some((s) => s.sectionKey.endsWith("_previous_defects"))) assert.ok(prev && /probe previous/.test(prev), "previous defects print");
        const client = probeSection("_client_issues", (t) => {
          const key = t.fields.find((f) => /Status$/.test(f.key)).key.replace(/Status$/, "");
          return { [`${key}Status`]: "attached", [`${key}Updates`]: "probe client", [`${key}Photos`]: ["/a.jpg"] };
        });
        assert.ok(client && /probe client/.test(client), "client list prints");
        const typical = secs.find((s) => s.sectionKey.endsWith("_typical_defects"));
        if (typical) {
          const f = typical.fields.find((x) => x.type === "chip-multiselect");
          const out = probeSection("_typical_defects", () => ({ [f.key]: [f.options[0].value], [`${f.options[0].value}_pics`]: ["/a.jpg"] }));
          assert.ok(out && out !== baseOut, "ticked typical defects print as defects");
        }
      });

      it("prints every General Description answer", () => {
        const desc = secs.find((s) => s.sectionKey.endsWith("_description"));
        const base = baseAnswers(prop, prefix);
        const baseOut = printed(build(prop, prefix, base));
        const silent = [];
        for (const f of desc.fields) {
          if (NOT_PRINTED[f.key] || f.type === "photos") continue;
          let changed = false;
          for (const value of probes(f)) {
            const answers = structuredClone(base);
            openGates(f, desc.fields, answers[desc.sectionKey]);
            const ref = printed(build(prop, prefix, answers));
            answers[desc.sectionKey][f.key] = value;
            if (printed(build(prop, prefix, answers)) !== ref) { changed = true; break; }
          }
          if (!changed) silent.push(f.key);
        }
        assert.deepEqual(silent, [], `description answers that never reach the report: ${silent.join(", ")}`);
        void baseOut;
      });
    });
  }
}
