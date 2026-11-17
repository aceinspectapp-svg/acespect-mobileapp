// The Pre-pour report changes, in every Construction Stage report (Pre-pour, Slab Down, Slab and Frame, Frame, Lock-up, Lock-up and
// Fixing, Fixing, PCI/Handover; House and Apartment), from the shared report code:
//   1. the REFERENCES AND GUIDE TO STANDARDS AND TOLERANCES page (standardsText.ts), on a new page after the last section and
//      immediately before the Conditions;
//   2. item names in Title Case and Weather as the template prints it ("Intermittent Showers"), from printCase.ts;
//   3. "Not Yet" wherever the checklist or its key would have said "Not Complete";
//   4. a defect row shows its number of defects in brackets, matching the numbered defects it refers to.
// Each report is built from the real templates (templates-snapshot.json) with real answers, and rendered as the report page.
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
const { buildConstructionReport } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { ConstructionReportBody } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { CONSTRUCTION_AGREEMENT_TITLE } = await server.ssrLoadModule("/src/web/construction/agreementText.ts");
const { STANDARDS_TITLE, STANDARDS_GUIDE_URL, NCC_PORTAL_URL } = await server.ssrLoadModule("/src/web/construction/standardsText.ts");
const { itemName } = await server.ssrLoadModule("/src/web/construction/printCase.ts");
const { SECTION_ORDER } = await server.ssrLoadModule("/src/web/construction/stages.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const latest = new Map();
for (const t of SNAP) {
  if (t.inspectionType !== "construction_stage") continue;
  const k = `${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}

const STAGES = [
  ["pp_", "pre_pour", "Pre-pour"], ["sd_", "slab", "Slab Down"], ["sf_", "slab_frame", "Slab and Frame"], ["fr_", "framework", "Frame"],
  ["lu_", "lock_up", "Lock-up"], ["lf_", "lock_fix", "Lock-up and Fixing"], ["fx_", "fixing", "Fixing"], ["pci_", "pci", "PCI/Handover"],
];
const PROPS = [["residential_house", "House"], ["apartment", "Apartment"]];
const NOT_YET = /\bnot\s+(yet|commenced|complete|compete|sighted|started|installed|fitted|done)\b/i;
const BAD = "#E63329", NA = "#94A1B2";

const gateOk = (f, a) => !f.gate || (f.gate.equalsAny ?? [f.gate.equals]).some((v) => (Array.isArray(a[f.gate.fieldKey]) ? a[f.gate.fieldKey].includes(v) : a[f.gate.fieldKey] === v));
const isDefectOpt = (f, o) => (f.defectOn ? f.defectOn.includes(o.value) : o.color === BAD);
const isNA = (o) => /^n\/a$|^not applicable$/i.test(o.label) || o.color === NA;
const isNotYet = (f, o) => !isDefectOpt(f, o) && NOT_YET.test(o.label);

/** A complete, defect-free answer set: the first answer that is neither a defect, N/A nor "not yet". */
function fill(fields, start = {}) {
  const a = { ...start };
  for (const f of fields) {
    if (a[f.key] !== undefined || !gateOk(f, a)) continue;
    if (f.type === "pill-select") a[f.key] = (f.options.find((o) => !isDefectOpt(f, o) && !isNA(o) && !isNotYet(f, o)) ?? f.options[0]).value;
    else if (f.type === "yesno") a[f.key] = "yes";
    else if (f.type === "chip-multiselect" || f.type === "tile-multiselect") a[f.key] = [];
    else if (f.type === "numeric") a[f.key] = "1200";
    else if (f.type === "text" || f.type === "textarea") a[f.key] = "base text";
    else if (f.type === "photos" || f.type === "repeating-group") a[f.key] = [];
  }
  return a;
}
const detail = (location) => ({ location, category: ["non_compliant_ncc_as"], severity: ["minor"], photos: [], comments: "Test defect.", constructionCode: "" });

/** One stage's report, with up to three defect rows (and in Lock-up, the two-check Roof covering row) and one "not yet" answer. */
function stageReport(prop, prefix, stage) {
  const profile = { inspectionType: "construction_stage", propertyType: prop };
  const keys = SECTION_ORDER.filter((k) => k.startsWith(prefix) && latest.has(`${prop}|${k}`));
  let defectsMade = 0, notYetMade = 0;
  const sections = keys.map((key) => {
    const t = latest.get(`${prop}|${key}`);
    const a = fill(t.fields);
    const checklist = !/_(description|defects|summary|previous_defects|client_issues)$/.test(key);
    if (checklist) {
      for (const f of t.fields) {
        if (f.type !== "pill-select" || f.gate || a[f.key] === undefined) continue;
        const bad = f.options.find((o) => isDefectOpt(f, o));
        // Lock-up's roofing: upper and lower roof both defective, the two checks the "Roof covering" row is made from (two defects).
        const roofPair = /_roofing$/.test(key) && /^(upperRoofAppears|lowerRoofLadder)$/.test(f.key);
        if (bad && f.defectOn && (defectsMade < 3 || roofPair)) { a[f.key] = bad.value; a[`${f.key}__defect`] = detail(`Location ${++defectsMade}`); continue; }
        const later = f.options.find((o) => isNotYet(f, o));
        if (later && notYetMade === 0) { a[f.key] = later.value; notYetMade++; }
      }
    }
    const d = flattenSectionToDraft(t.fields, a, key, profile);
    return { key, name: t.name, fields: t.fields, answers: a, approved: true, reportText: d.reportText, damages: d.damages };
  });
  const job = latest.get(`${prop}|job-info`);
  const jobAnswers = { constructionStage: stage, weather: "intermittent_showers" };
  const jobDraft = flattenSectionToDraft(job.fields, jobAnswers, "job-info", profile);
  const all = [{ key: "job-info", name: "Job Information", fields: job.fields, answers: jobAnswers, approved: true, reportText: jobDraft.reportText, damages: [] }, ...sections];
  return { model: buildConstructionReport(all, jobAnswers), keys, defectsMade, notYetMade };
}

const HEADER = { reportDate: "17 Nov 2026", clientName: "C", yourReference: "", ourReference: "V1", property: "P", inspectionDate: "17 Nov 2026", weather: "intermittent_showers", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
const INSPECTION = { id: "i", jobNo: "V1", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const render = (model) => renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header: HEADER }));
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

let doubleRows = 0, notYetStages = [];

for (const [prop, propName] of PROPS) {
  for (const [prefix, stage, stageName] of STAGES) {
    describe(`${stageName} — ${propName}`, () => {
      const { model, keys, defectsMade, notYetMade } = stageReport(prop, prefix, stage);
      const html = render(model);
      const checklist = html.slice(html.indexOf('id="checklist"'), html.indexOf('id="defects"'));
      const items = model.tables.flatMap((t) => t.groups.flatMap((g) => g.items));

      it("is built for this stage from its real sections", () => {
        assert.equal(model.stage, stage);
        assert.ok(keys.length >= 5, `${keys.length} sections`);
        assert.ok(items.length > 0, "checklist rows");
      });

      it("1. prints the References page once, on a new page, after the last section and immediately before the Conditions", () => {
        assert.equal(html.split(STANDARDS_TITLE).length - 1, 1);
        assert.match(html, /<div class="report-page-break" id="standards">/);
        const standards = html.indexOf('id="standards"');
        const conditions = html.indexOf(CONSTRUCTION_AGREEMENT_TITLE);
        assert.ok(standards > html.indexOf("Client Concerns"), "after Client Concerns");
        if (html.includes("Previous Defects")) assert.ok(standards > html.lastIndexOf("Previous Defects"), "after Previous Defects");
        assert.ok(conditions > standards, "before the Conditions");
        const terms = html.indexOf('<div class="report-page-break">', standards);
        assert.ok(terms > standards && terms < conditions, "the Conditions start on the next page");
        const between = html.slice(standards, terms);
        assert.equal((between.match(/<h2/g) ?? []).length, 1, "nothing but the References page between them");
        assert.ok(between.includes(STANDARDS_GUIDE_URL) && between.includes(NCC_PORTAL_URL), "both links");
      });

      it("2. prints every item name in Title Case and the Weather as 'Intermittent Showers'", () => {
        const names = [...checklist.matchAll(/<span style="font-weight:700;font-size:13px[^"]*">([^<]*)<\/span>/g)].map((m) => unescape(m[1]));
        assert.equal(names.length, items.length, "one printed name per row");
        names.forEach((n, i) => {
          assert.equal(n, itemName(items[i].heading), `row ${i + 1} printed from printCase.itemName`);
          assert.equal(itemName(n), n, `"${n}" is already Title Case`);
        });
        assert.match(html, /Weather Conditions[\s\S]{0,400}Intermittent Showers/);
        assert.doesNotMatch(html, /intermittent_showers|Intermittent showers/);
      });

      it("3. says 'Not Yet', never 'Not Complete', in the checklist and its key", () => {
        assert.doesNotMatch(checklist, /not\s+complete/i);
        assert.match(checklist, />NOT YET</, "the key tile");
        const later = items.filter((i) => i.status === "notcomplete");
        if (notYetMade) {
          notYetStages.push(`${stageName} ${propName}`);
          assert.ok(later.length > 0, "a 'not yet' answer makes a Not Yet row");
          assert.match(checklist, /NOT YET<\/div>/, "the row's right-hand column");
          assert.match(checklist, /\d+ not yet/, "the table's count line");
        }
      });

      it("4. shows each defect row's number of defects in brackets, matching the numbered defects", () => {
        const rows = model.tables.flatMap((t) => t.groups.flatMap((g) => g.items.filter((i) => i.status === "defect").map((i) => ({ ...i, sectionKey: t.sectionKey }))));
        assert.ok(defectsMade > 0 && rows.length > 0, "the stage has defect rows");
        const numbered = model.defectGroups.flatMap((g) => g.defects);
        assert.equal(rows.reduce((n, r) => n + r.defectCount, 0), numbered.length, "the rows' counts add up to the defects listed");
        for (const r of rows) {
          assert.ok(r.defectCount >= 1, `${r.heading} counts its defects`);
          assert.ok(checklist.includes(`REFER DEFECTS (${r.defectCount})`), `${r.heading}: "REFER DEFECTS (${r.defectCount})"`);
          const mine = numbered.filter((d) => d.no >= r.defectNo && d.no < r.defectNo + r.defectCount);
          assert.equal(mine.length, r.defectCount, `${r.heading}: its defects are numbered ${r.defectNo}..`);
          for (const d of mine) assert.equal(d.sectionKey, r.sectionKey, `${r.heading}: defect ${d.no} comes from the same section`);
          if (r.defectCount > 1) doubleRows++;
        }
        assert.doesNotMatch(checklist, /REFER DEFECTS ›|REFER DEFECTS<\/div><\/div>/, "no defect row without its count (the key tile keeps its plain label)");
      });
    });
  }
}

describe("across the stages", () => {
  it("a two-check row with both checks defective prints 'REFER DEFECTS (2)' (Lock-up and Lock-up and Fixing roofing, House and Apartment)", () => assert.ok(doubleRows >= 4, `${doubleRows} rows`));
  it("'Not Yet' rows were exercised in the stages whose forms have a 'not yet' answer", () => assert.ok(notYetStages.length >= 4, notYetStages.join(", ")));
});

// ---- inspector instructions ------------------------------------------------------------------------------------------------
// Some checklist labels carry the form's instruction to the inspector after the item's name ("Roof covering — if cladding and roof
// covering are both done, check with the office before you leave site (Lock-up report)"). The phone keeps them; the report prints only
// the item's name, in the checklist row, its photo caption and its defect -- and the stored section text is not changed.
const { headingOf } = await server.ssrLoadModule("/src/web/construction/words.ts");
const INSTRUCTION = /check with the office|before you leave site|show digital level|should this be a (combined )?lock up|inspector to test all appliances|check at each elevation|is there an ensuite|if so,? provide details|if limited views put|adds notes and photos to common area/i;
const EXPECTED = {
  roofCovering: "Roof Covering", brickworkBowed: "Brickwork Bowed", brickworkPlumb: "Brickwork Plumb", wallsBowed: "Walls Bowed", wallsPlumb: "Walls Plumb",
  combinedInspection: /^Plaster(work)? Completed$/,
};
const openGate = (f, fields, a) => {
  if (!f.gate) return;
  const g = fields.find((x) => x.key === f.gate.fieldKey);
  if (!g) return;
  openGate(g, fields, a);
  const w = (f.gate.equalsAny ?? [f.gate.equals])[0];
  a[g.key] = g.type === "chip-multiselect" || g.type === "tile-multiselect" ? [w] : w;
};

for (const [prop, propName] of PROPS) {
  for (const [prefix, stage, stageName] of STAGES) {
    describe(`${stageName} — ${propName}: inspector instructions`, () => {
      const profile = { inspectionType: "construction_stage", propertyType: prop };
      const keys = SECTION_ORDER.filter((k) => k.startsWith(prefix) && latest.has(`${prop}|${k}`));
      const carried = [];
      const sections = keys.map((key) => {
        const t = latest.get(`${prop}|${key}`);
        const pre = {};
        const marked = t.fields.filter((f) => (f.type === "pill-select" || f.type === "yesno") && INSTRUCTION.test(f.label));
        for (const f of marked) openGate(f, t.fields, pre);
        const a = fill(t.fields, pre);
        for (const f of marked) {
          carried.push({ key: f.key, label: f.label, section: key });
          const bad = f.type === "pill-select" && f.defectOn ? f.options.find((o) => f.defectOn.includes(o.value)) : undefined;
          if (bad) { a[f.key] = bad.value; a[`${f.key}__defect`] = { ...detail(""), photos: ["/d.jpg"] }; }
          const photos = t.fields.find((p) => p.type === "photos" && p.key === `${f.key}Photos`);
          if (photos) a[photos.key] = ["/row.jpg"];
        }
        const d = flattenSectionToDraft(t.fields, a, key, profile);
        return { key, name: t.name, fields: t.fields, answers: a, approved: true, reportText: d.reportText, damages: d.damages };
      });
      const model = buildConstructionReport(sections, { constructionStage: stage });
      const html = unescape(render(model));

      it("prints no instruction to the inspector anywhere in the report", () => {
        const hit = html.match(new RegExp(`.{0,80}(${INSTRUCTION.source}).{0,40}`, "i"));
        assert.equal(hit, null, hit?.[0]);
      });

      it("prints each such row by its item name only, and leaves the stored section text as it was", () => {
        const items = model.tables.flatMap((t) => t.groups.flatMap((g) => g.items));
        for (const c of carried) {
          const want = EXPECTED[c.key];
          const row = items.find((i) => i.heading === headingOf(c.label));
          if (want) {
            assert.ok(row, `${c.key}: its row is printed`);
            const printed = itemName(row.heading);
            assert.ok(typeof want === "string" ? printed === want : want.test(printed), `${c.key}: "${printed}"`);
          }
        }
        const stored = sections.map((s) => s.reportText).join("\n");
        if (carried.some((c) => c.key === "roofCovering")) assert.match(stored, /check with the office before you leave site/i, "stored text keeps the instruction");
      });
    });
  }
}

describe("inspector instructions: the printed names", () => {
  it("strips only the instruction", () => {
    const cases = {
      "Roof covering — if cladding and roof covering are both done, check with the office before you leave site (Lock-up report)": "Roof Covering",
      "Brickwork bowed — show digital level": "Brickwork Bowed",
      "Walls plumb — show digital level": "Walls Plumb",
      "Plaster completed — should this be a combined Lock up and Fixing (Pre-paint) inspection": "Plaster Completed",
      "Plasterwork completed — should this be a Lock up and/or Fixing (Pre-paint) inspection": "Plasterwork Completed",
      "Gas appliances Inspector to test all appliances operate": "Gas Appliances",
      "Damp proof course evident (check at each elevation 4 to 6 weepholes)": "Damp Proof Course Evident",
      "Bedroom 2 (is there an Ensuite?)": "Bedroom 2",
      "Private Roof Terrace? If so, provide details.": "Private Roof Terrace",
      "If accessible is Roof covering OK? If limited views put OK & details to NOTES": "Roof Covering",
      "If terrace is Common, adds notes and photos to Common Area section": "Terrace Is Common",
      // not instructions: kept as they are
      "Electrical — Test all fans, lights, appliances": "Electrical — Test All Fans, Lights, Appliances",
      "Windows at first floor opaque — if specified": "Windows at First Floor Opaque — If Specified",
      "Water supply to site": "Water Supply to Site",
    };
    for (const [label, printed] of Object.entries(cases)) assert.equal(itemName(label), printed, label);
  });
});
