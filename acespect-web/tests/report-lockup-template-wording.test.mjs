// The Lock-up report against the Lock-up office template (ACESPECT Lock Up_Office Template Nov 2026.dotm), in the shared Construction
// report code, so every stage whose template has the same text gets it:
//   1. a defect is headed by the row's name without the form's "inspected from ladder (is)": "Lower Level Roof Covering",
//      "Lower Level Guttering" (the checklist rows keep their names; "Upper Roof — Generally Appears to Be" is unchanged);
//   2. "Is the site well managed?" answered "Can be improved …" (REFER NOTES) adds "Site appears to be well managed." to the Notes,
//      unless the inspector typed a note about it;
//   3. one water-supply sentence: the inspector's typed note when there is one, else "There is no water supply to the site.";
//   4. the upper roof seen from the ground only: the template's OH&S sentences printed under Roof Covering, Roof Flashing,
//      Parapet Flashing / Capping and Roof Gutters, filled in from the form's answers;
//   5. the services disclaimer under the SERVICES rows (Lock-up, Lock-up and Fixing, PCI), and nowhere else.
// Built from the real templates (templates-snapshot.json) through compose.ts, reportModel.ts and the printed page (ConstructionReport.tsx),
// which the PDF prints and the Word file is read from.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { composeConstructionSection, TAGS, OHS, WELL_MANAGED } = await server.ssrLoadModule("/src/web/construction/compose.ts");
const { buildConstructionReport, SERVICES_DISCLAIMER } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { ConstructionReportBody } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { SECTION_ORDER } = await server.ssrLoadModule("/src/web/construction/stages.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { defectItemName } = await server.ssrLoadModule("/src/web/construction/words.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const latest = new Map();
for (const t of SNAP) {
  if (t.inspectionType !== "construction_stage") continue;
  const k = `${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}
const OK = "#1FA463";
const gatesOf = (f) => (f.gate ? f.gate.equalsAny ?? [f.gate.equals] : []);
const gateOk = (f, a) => !f.gate || gatesOf(f).some((v) => (Array.isArray(a[f.gate.fieldKey]) ? a[f.gate.fieldKey].includes(v) : a[f.gate.fieldKey] === v));
function okAnswers(fields, start = {}) {
  const a = { ...start };
  for (const f of fields) {
    if (a[f.key] !== undefined || !gateOk(f, a)) continue;
    if (f.type === "pill-select") a[f.key] = (f.options.find((o) => o.color === OK) ?? f.options[0]).value;
    else if (f.type === "yesno") a[f.key] = "yes";
    else if (f.type === "numeric") a[f.key] = "1500";
    else if (f.type === "text" && /(Plan|Site)$/.test(f.key)) a[f.key] = "12";
  }
  return a;
}
const fieldsOf = (prop, key) => latest.get(`${prop}|${key}`)?.fields ?? [];
/** The option value whose label matches. */
function val(prop, key, field, label) {
  const f = fieldsOf(prop, key).find((x) => x.key === field);
  assert.ok(f, `${prop} ${key}.${field}`);
  const o = f.options.find((x) => label.test(x.label));
  assert.ok(o, `${key}.${field}: no option ${label} in ${f.options.map((x) => x.label).join(" / ")}`);
  return o.value;
}
const linesOf = (prop, key, a) => composeConstructionSection(key, fieldsOf(prop, key), okAnswers(fieldsOf(prop, key), a), prop === "apartment").text.split(/\n+/);
const notesOf = (prop, key, a) => linesOf(prop, key, a).filter((l) => l.startsWith(TAGS.note)).map((l) => l.slice(TAGS.note.length));

const HEADER = { reportDate: "19 Nov 2026", clientName: "C", yourReference: "", ourReference: "TEST", property: "P", inspectionDate: "18 Nov 2026", weather: "Overcast", inspector: "I", inspectorRegistration: "", purpose: "" };
const INSPECTION = { id: "i", jobNo: "TEST", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
function render(prefix, prop, patch = {}) {
  const profile = { inspectionType: "construction_stage", propertyType: prop };
  const sections = SECTION_ORDER.filter((k) => k.startsWith(prefix) && latest.has(`${prop}|${k}`)).map((key) => {
    const t = latest.get(`${prop}|${key}`);
    const answers = okAnswers(t.fields, patch[key] ?? {});
    const d = flattenSectionToDraft(t.fields, answers, key, profile);
    return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
  });
  const model = buildConstructionReport(sections, null, { apartment: prop === "apartment" });
  return { model, html: renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header: HEADER })) };
}
const PROPS = ["residential_house", "apartment"];
/** The two Lock-up stages with the roofing form (Lock-up, Lock-up and Fixing). */
const ROOF_STAGES = [["lu_", "lu_roofing"], ["lf_", "lf_roofing"]].filter(([, k]) => PROPS.some((p) => latest.has(`${p}|${k}`)));

/** The Yasiru-Test-5-LU roofing answers: the upper roof seen from the ground, both roof checks and the lower guttering defective. */
function roofing(prop, key, { upper = /refer defects/i, lower = /refer defects/i, gutterLower = /defect/i } = {}) {
  return {
    upperRoofFrom: val(prop, key, "upperRoofFrom", /ground/i),
    upperRoofAppears: val(prop, key, "upperRoofAppears", upper),
    upperRoofAppears__defect: { location: "Upper roof", comments: "Ridge capping lifted." },
    lowerRoofLadder: val(prop, key, "lowerRoofLadder", lower),
    lowerRoofLadder__defect: { location: "Lower roof above the porch", comments: "Apron flashing is not stepped into the mortar joints." },
    safeAccessGuttering: val(prop, key, "safeAccessGuttering", /^no/i),
    upperGutteringGround: val(prop, key, "upperGutteringGround", /^satisfactory$/i),
    lowerGutteringLadder: val(prop, key, "lowerGutteringLadder", gutterLower),
    lowerGutteringLadder__defect: { location: "Lower gutter at the rear left corner", comments: "Gutter end cap is loose." },
  };
}

// ───────────────────────── 1. Defect names ─────────────────────────

describe("1. a defect is headed by the row's name, without the form's 'inspected from ladder'", () => {
  it("the name: 'Lower level roof covering', 'Lower level guttering'; others unchanged", () => {
    assert.equal(defectItemName("Lower level roof covering inspected from ladder"), "Lower level roof covering");
    assert.equal(defectItemName("Lower level guttering inspected from ladder is"), "Lower level guttering");
    assert.equal(defectItemName("Upper roof — generally appears to be"), "Upper roof — generally appears to be");
    assert.equal(defectItemName("Roof line straight"), "Roof line straight");
  });
  for (const prop of PROPS) for (const [prefix, key] of ROOF_STAGES) {
    if (!latest.has(`${prop}|${key}`)) continue;
    it(`${key} (${prop}): the printed defects read "Lower Level Roof Covering." and "Lower Level Guttering."; the checklist rows keep their names`, () => {
      const { html, model } = render(prefix, prop, { [key]: roofing(prop, key) });
      const t = text(html);
      if (prefix === "lf_") {
        // Lock-up & Fixing: the LF template's line is the inspector's description (no row name in front) -- report-lf-template-wording.test.mjs.
        assert.match(t, /Apron flashing is not stepped into the mortar joints\./);
        assert.doesNotMatch(t, /Lower Level Roof Covering\. Apron/);
        assert.doesNotMatch(t, /Upper Roof — Generally Appears to Be\. Ridge capping lifted/);
      } else {
        assert.match(t, /Lower Level Roof Covering\. Apron flashing is not stepped/);
        assert.match(t, /Lower Level Guttering\. Gutter end cap is loose/);
        assert.match(t, /Upper Roof — Generally Appears to Be\. Ridge capping lifted/, "the upper roof defect keeps its name");
      }
      assert.doesNotMatch(t, /Inspected from Ladder/i);
      const items = model.tables.flatMap((tb) => tb.groups.flatMap((g) => g.items.map((i) => i.heading)));
      assert.ok(items.includes("Roof covering") && items.includes("Roof gutters"), items.join(" | "));
    });
  }
  it("a defect with no location is headed by the short name, in the template's capitals", () => {
    const prop = "residential_house";
    const r = roofing(prop, "lu_roofing");
    r.lowerRoofLadder__defect = { comments: "Apron flashing is not stepped into the mortar joints." };
    const { model, html } = render("lu_", prop, { lu_roofing: r });
    const d = model.defectGroups.flatMap((g) => g.defects).find((x) => /Apron flashing/.test(x.description));
    assert.equal(d.heading, "Lower level roof covering");
    assert.equal(d.item, "Lower level roof covering");
    assert.match(text(html), /Lower Level Roof Covering Apron flashing|Lower Level Roof Covering\s/);
  });
});

// ───────────────────────── 2. Site well managed ─────────────────────────

describe("2. 'Is the site well managed?' REFER NOTES", () => {
  for (const prop of PROPS) for (const key of SECTION_ORDER.filter((k) => latest.has(`${prop}|${k}`) && fieldsOf(prop, k).some((f) => f.key === "siteManaged"))) {
    const improved = fieldsOf(prop, key).find((f) => f.key === "siteManaged").options.find((o) => /can be improved/i.test(o.label));
    if (!improved) continue;
    const typedField = fieldsOf(prop, key).find((f) => f.type === "textarea" || f.type === "text");
    if (/^lf_/.test(key)) {
      // Lock-up & Fixing: one sentence for the answer (report-lf-template-wording.test.mjs has the rest).
      it(`${key} (${prop}): "Can be improved …" -> only the clean-up note; "Yes" -> "${WELL_MANAGED}"`, () => {
        const n = notesOf(prop, key, { siteManaged: improved.value });
        assert.ok(!n.includes(WELL_MANAGED), n.join(" | "));
        assert.equal(n.filter((x) => /clean-up/i.test(x)).length, 1, n.join(" | "));
        assert.ok(notesOf(prop, key, {}).includes(WELL_MANAGED));
      });
      continue;
    }
    it(`${key} (${prop}): no note typed -> "${WELL_MANAGED}" (then the clean-up note, as now)`, () => {
      const n = notesOf(prop, key, { siteManaged: improved.value });
      assert.ok(n.includes(WELL_MANAGED), n.join(" | "));
      assert.ok(n.indexOf(WELL_MANAGED) < n.findIndex((x) => /clean-up|clean to be completed/i.test(x)), "before the clean-up note");
    });
    if (typedField) it(`${key} (${prop}): a typed note about it -> that note, not the sentence`, () => {
      const n = notesOf(prop, key, { siteManaged: improved.value, [typedField.key]: "Rubbish is piled at the rear; the site needs a tidy." });
      assert.ok(!n.includes(WELL_MANAGED), n.join(" | "));
      assert.ok(n.some((x) => /Rubbish is piled at the rear/.test(x)), n.join(" | "));
    });
    it(`${key} (${prop}): "Yes" (CHECKED & OK) adds nothing`, () => {
      assert.ok(!notesOf(prop, key, {}).includes(WELL_MANAGED));
    });
  }
});

// ───────────────────────── 3. Water supply ─────────────────────────

describe("3. one water-supply sentence", () => {
  const TYPED = "No water supply on site (the tap at the meter is disconnected). Security fencing is down along the south boundary for about 6 m.";
  for (const prop of PROPS) for (const key of SECTION_ORDER.filter((k) => latest.has(`${prop}|${k}`) && fieldsOf(prop, k).some((f) => f.key === "waterSupply"))) {
    const no = fieldsOf(prop, key).find((f) => f.key === "waterSupply").options.find((o) => /^no\b/i.test(o.label));
    const typedField = fieldsOf(prop, key).find((f) => f.type === "textarea");
    if (!no) continue;
    it(`${key} (${prop}): no typed note -> "There is no water supply to the site."`, () => {
      assert.ok(notesOf(prop, key, { waterSupply: no.value }).includes("There is no water supply to the site."));
    });
    if (typedField) {
      it(`${key} (${prop}): the inspector's typed note about the water supply -> only theirs`, () => {
        const n = notesOf(prop, key, { waterSupply: no.value, [typedField.key]: TYPED });
        assert.ok(!n.includes("There is no water supply to the site."), n.join(" | "));
        assert.equal(n.filter((x) => /water supply/i.test(x)).length, 1, n.join(" | "));
        assert.ok(n.some((x) => x.includes("No water supply on site (the tap at the meter is disconnected).")));
      });
      it(`${key} (${prop}): a typed note about something else keeps the generated sentence`, () => {
        const n = notesOf(prop, key, { waterSupply: no.value, [typedField.key]: "The concrete crossover has a corner broken off at the kerb." });
        assert.ok(n.includes("There is no water supply to the site."), n.join(" | "));
      });
    }
  }
});

// ───────────────────────── 4. Roof OH&S sentences ─────────────────────────

describe("4. the upper roof seen from the ground: the template's OH&S sentences under the roof rows", () => {
  for (const prop of PROPS) for (const [prefix, key] of ROOF_STAGES) {
    if (!latest.has(`${prop}|${key}`)) continue;
    const afterOf = (model, heading) => model.tables.flatMap((t) => t.groups.flatMap((g) => g.items)).find((i) => i.heading === heading)?.after;
    it(`${key} (${prop}): filled in from the upper / lower answers (defects)`, () => {
      const { model, html } = render(prefix, prop, { [key]: roofing(prop, key) });
      assert.equal(afterOf(model, "Roof covering"), "Due to OH&S constraints the upper roof could not be safely accessed. Observations from the ground indicate that the roof covering is defective. Lower level roofing was checked and is defective.");
      assert.equal(afterOf(model, "Roof gutters"), "Due to OH&S constraints the upper guttering could not be safely accessed. Observations from the ground indicate that the guttering is satisfactory. Lower level guttering was checked and is defective.");
      assert.equal(afterOf(model, "Roof flashing"), "Due to OH&S constraints the upper roof flashings could not be safely inspected. Observations from the ground indicate that the flashings are satisfactory. Lower level flashings were checked and are satisfactory.");
      const t = text(html);
      for (const s of [OHS.roof, OHS.gutters, OHS.flashings]) assert.ok(t.includes(s), s);
      assert.equal((html.match(/data-row-after=""/g) ?? []).length >= 3, true);
    });
    it(`${key} (${prop}): satisfactory answers read "satisfactory"; a flashing defect points to the defects`, () => {
      const r = roofing(prop, key, { upper: /^satisfactory$/i, lower: /^satisfactory$/i, gutterLower: /^ok$/i });
      r.parapetFlashing = val(prop, key, "parapetFlashing", /defect/i);
      const { model } = render(prefix, prop, { [key]: r });
      assert.equal(afterOf(model, "Roof covering"), [OHS.roof, OHS.roofUpper("satisfactory"), OHS.roofLower("satisfactory")].join(" "));
      assert.equal(afterOf(model, "Roof gutters"), [OHS.gutters, OHS.guttersUpper("satisfactory"), OHS.guttersLower("satisfactory")].join(" "));
      assert.equal(afterOf(model, "Parapet flashing / capping"), `${OHS.flashings} Refer defects.`);
    });
    it(`${key} (${prop}): upper roof from the scaffold, safe gutter access, N/A parapet: no OH&S sentences`, () => {
      const r = { upperRoofFrom: val(prop, key, "upperRoofFrom", /scaffold/i), safeAccessGuttering: val(prop, key, "safeAccessGuttering", /^yes/i), parapetFlashing: val(prop, key, "parapetFlashing", /n\/a/i) };
      const { model, html } = render(prefix, prop, { [key]: r });
      assert.ok(!model.tables.some((t) => t.groups.some((g) => g.items.some((i) => i.after))));
      assert.doesNotMatch(text(html), /OH&S constraints/);
    });
  }
});

// ───────────────────────── 5. Services disclaimer ─────────────────────────

describe("5. the services disclaimer under the SERVICES rows", () => {
  const STAGES_WITH = [["lu_", "Lock-up"], ["lf_", "Lock-up and Fixing"], ["pci_", "PCI/Handover"]];
  const STAGES_WITHOUT = [["pp_", "Pre-pour"], ["sd_", "Slab Down"], ["sf_", "Slab and Frame"], ["fr_", "Frame"], ["fx_", "Fixing"]];
  for (const prop of PROPS) {
    for (const [prefix, name] of STAGES_WITH) {
      it(`${name} (${prop}): printed once, right after the services group's rows`, () => {
        const { model, html } = render(prefix, prop);
        const groups = model.tables.flatMap((t) => t.groups.map((g) => ({ ...g, title: t.title })));
        const at = groups.filter((g) => g.closing === SERVICES_DISCLAIMER);
        assert.equal(at.length, 1, groups.map((g) => g.heading).join(" | "));
        assert.match(at[0].heading ?? at[0].title, /services/i, "the services group (or a SERVICES table of its own)");
        assert.equal(text(html).split(SERVICES_DISCLAIMER).length - 1, 1);
        // In the page, the sentence follows the group's last row (before the next group's band).
        const last = at[0].items[at[0].items.length - 1];
        const i = html.indexOf(`id="${last.id}"`), j = html.indexOf("data-group-closing");
        assert.ok(i !== -1 && j > i, "after the last services row");
        assert.doesNotMatch(text(html), /SERVICES TO CONSTRUCTION|Services section/i, "no separate Services section");
      });
    }
    for (const [prefix, name] of STAGES_WITHOUT) {
      it(`${name} (${prop}): not printed (its template has no such sentence)`, () => {
        if (!SECTION_ORDER.some((k) => k.startsWith(prefix) && latest.has(`${prop}|${k}`))) return;
        assert.ok(!text(render(prefix, prop).html).includes(SERVICES_DISCLAIMER));
      });
    }
  }
});
