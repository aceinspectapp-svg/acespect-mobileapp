// The Construction Stage report's Notes and General Description, in every stage (Pre-pour, Slab Down, Slab and Frame, Frame, Lock-up,
// Lock-up and Fixing, Fixing, PCI/Handover; House and Apartment), as the Nov 2026 office templates word them:
//   1. the ground-falls note ends with the template's "Soil may erode and potentially block stormwater pipes – …" sentence;
//   2. a "see notes" answer prints a full sentence of its own, never "<row name> — <answer>" ("Ceiling insulation installed — no."):
//      every field and every answer is tried, and only the answer that asks for a note prints it; what the inspector typed is kept;
//   3. "The street frontage is to the north." for every direction;
//   4. the Report Purpose's "a licensed builder / a building consultant / a building practitioner" from the inspector's registration,
//      agreeing with the cover's registration line.
// Built from the real templates (templates-snapshot.json) through the shared report code (compose.ts, reportModel.ts).
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
const { composeConstructionSection, TAGS, GROUND_FALLS } = await server.ssrLoadModule("/src/web/construction/compose.ts");
const { buildConstructionReport, uniqueNotes } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { ConstructionReportBody } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { SECTION_ORDER, kindOfKey } = await server.ssrLoadModule("/src/web/construction/stages.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const latest = new Map();
for (const t of SNAP) {
  if (t.inspectionType !== "construction_stage") continue;
  const k = `${t.propertyType}|${t.sectionKey}`;
  if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
}
const STAGES = [
  ["pp_", "Pre-pour"], ["sd_", "Slab Down"], ["sf_", "Slab and Frame"], ["fr_", "Frame"],
  ["lu_", "Lock-up"], ["lf_", "Lock-up and Fixing"], ["fx_", "Fixing"], ["pci_", "PCI/Handover"],
];
const PROPS = [["residential_house", "House"], ["apartment", "Apartment"]];
const OK = "#1FA463";
const TYPED = "Timber sleeper retaining wall along the rear boundary is leaning; the builder should confirm it is engineered";

const gatesOf = (f) => (f.gate ? f.gate.equalsAny ?? [f.gate.equals] : []);
const gateOk = (f, a) => !f.gate || gatesOf(f).some((v) => (Array.isArray(a[f.gate.fieldKey]) ? a[f.gate.fieldKey].includes(v) : a[f.gate.fieldKey] === v));
/** Every answer OK (the first green choice), with a measurement's plan and site filled in. */
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
/** The answers that make a gated field show (its gate's first value, all the way up). */
function opened(f, fields, a = {}) {
  if (!f.gate) return a;
  const g = fields.find((x) => x.key === f.gate.fieldKey);
  if (!g) return a;
  opened(g, fields, a);
  const w = gatesOf(f)[0];
  a[g.key] = g.type === "chip-multiselect" || g.type === "tile-multiselect" ? [...new Set([...(a[g.key] ?? []), w])] : w;
  return a;
}
/** What a section adds to the report's Notes: its NOTE lines (checklists), or every line of the Summary. */
function notesOf(key, fields, a, apt) {
  const lines = composeConstructionSection(key, fields, a, apt).text.split(/\n+/);
  return kindOfKey(key) === "summary" ? lines.filter((l) => !l.includes("::")) : lines.filter((l) => l.startsWith(TAGS.note)).map((l) => l.slice(TAGS.note.length));
}
/** Every section of every stage and property, with its template. */
const SECTIONS = [];
for (const [prop, propName] of PROPS) for (const [prefix, stageName] of STAGES) {
  for (const key of SECTION_ORDER.filter((k) => k.startsWith(prefix) && latest.has(`${prop}|${k}`))) {
    SECTIONS.push({ prop, propName, stageName, key, fields: latest.get(`${prop}|${key}`).fields, apt: prop === "apartment" });
  }
}
/** Every answer of every field, one at a time on an all-OK section: the notes it adds. */
function* everyAnswer() {
  for (const s of SECTIONS) {
    if (["description", "client", "previous", "defects", "typical"].includes(kindOfKey(s.key))) continue;
    for (const f of s.fields) {
      const base = okAnswers(s.fields, opened(f, s.fields));
      const before = new Set(notesOf(s.key, s.fields, base, s.apt));
      const tries =
        f.type === "pill-select" ? f.options.map((o) => [o, o.value])
        : f.type === "yesno" ? [[{ label: "Yes", value: "yes" }, "yes"], [{ label: "No", value: "no" }, "no"]]
        : f.type === "chip-multiselect" || f.type === "tile-multiselect" ? (f.options ?? []).map((o) => [o, [o.value]])
        : f.type === "text" || f.type === "textarea" ? [[{ label: "(typed)", value: TYPED }, TYPED]]
        : [];
      for (const [option, v] of tries) {
        const added = notesOf(s.key, s.fields, { ...base, [f.key]: v }, s.apt).filter((n) => !before.has(n));
        yield { ...s, field: f, option, added };
      }
    }
  }
}
const ALL = [...everyAnswer()];
const where = (r) => `${r.stageName} ${r.propName} ${r.key}.${r.field.key} = "${r.option.label}"`;

// ───────────────────────── 1. Ground falls ─────────────────────────

const SOIL = "Soil may erode and potentially block stormwater pipes – some protection may be advisable until landscaping/retaining works are done.";

describe("the ground-falls note ends with the template's full sentence", () => {
  it("is the template's two paragraphs' wording, ending with the soil sentence", () => {
    assert.ok(GROUND_FALLS.startsWith("Due to ground falls towards the slab stormwater may pond and affect the footings."));
    assert.ok(GROUND_FALLS.endsWith(` – refer to Codes 2. Footings and to Site Drainage requirements. ${SOIL}`));
  });
  const asking = ALL.filter((r) => r.added.some((n) => n.startsWith("Due to ground falls")));
  it("is asked for by the drainage answers and the Summary tick, in every stage that has them", () => {
    const stages = new Set(asking.map((r) => r.stageName));
    for (const s of ["Pre-pour", "Slab Down", "Slab and Frame", "Frame", "Lock-up", "Lock-up and Fixing", "Fixing"]) assert.ok(stages.has(s), s);
  });
  for (const r of asking) {
    it(`prints in full: ${where(r)}`, () => assert.deepEqual(r.added.filter((n) => n.startsWith("Due to ground falls")), [GROUND_FALLS]));
  }
  it("prints in full on the Frame report's Notes page", () => {
    const html = renderFrame({ fr_summary: { notesToInclude: ["ground_falls"] } });
    assert.ok(text(html).includes(SOIL));
  });
});

// ───────────────────────── 2. Notes as sentences ─────────────────────────

/** Each field whose answer leads to a note: the answer that does (by its label) and the sentence it prints. Every other answer prints none. */
const EXPECTED = [
  { field: "powerSupply", answer: /^No — see notes$/, note: "There is no power supply to the site." },
  { field: "waterSupply", answer: /^No( — see notes)?$/, note: "There is no water supply to the site." },
  { field: "siteToilet", answer: /^No — see notes$/, note: "There is no site toilet in position." },
  { field: "ceilingInsulation", answer: /^No — see notes$/, note: "Ceiling insulation has not yet been installed." },
  { field: "manhole", answer: /^Not yet — see notes$/, note: "The manhole has not yet been installed." },
  { field: "garageSlab", answer: /^Infill later — refer notes$/, note: "The garage slab is to be infilled later." },
  { field: "porchSlab", answer: /^Infill later — refer notes$/, note: "The porch slab is to be infilled later." },
  { field: "alfrescoSlab", answer: /^Infill later — refer notes$/, note: "The alfresco slab is to be infilled later." },
  { field: "poolFormed", answer: /^Refer notes$/, note: "The inground pool is noted for attention." },
  { field: "inGroundPool", answer: /^Refer notes$/, note: "The inground pool is noted for attention." },
  { field: "footingDepths", answer: /^Could not see$/, note: "The footing depths could not be seen at the time of inspection." },
  { field: "excessWater", answer: /^Could not see$/, note: "The footings could not be seen to check for excess water at the time of inspection." },
  { field: "polythene", answer: /^Covered in backfill$/, note: "The polyethylene could not be checked as it is covered in backfill." },
  { field: "adviseRetaining", answer: /^Yes — recommend, see notes$/, note: "Retaining walls are advised." },
  { field: "frontResult", answer: /^Builder to re-check$/, note: /^The front setback is to be re-checked by the builder\. As estimated (from|using) [^,]+, setbacks on plan are 1,?500 (mm|millimetres) and on site are approximately 1,?500 (mm|millimetres)\.$/ },
  { field: "rearResult", answer: /^Builder to re-check$/, note: /^The rear setback is to be re-checked by the builder\. As estimated .+\.$/ },
  { field: "leftResult", answer: /^Builder to re-check$/, note: /^The left side setback is to be re-checked by the builder\. As estimated .+\.$/ },
  { field: "rightResult", answer: /^Builder to re-check$/, note: /^The right side setback is to be re-checked by the builder\. As estimated .+\.$/ },
  { field: "slabDimensions", answer: /^Builder to re-check$/, note: "The slab dimensions are to be re-checked by the builder." },
  { field: "slabLengthResult", answer: /^Builder to re-check$/, note: "The slab length is to be re-checked by the builder. On plan it is 12 and on site it is approximately 12." },
  { field: "slabWidthResult", answer: /^Builder to re-check$/, note: "The slab width is to be re-checked by the builder. On plan it is 12 and on site it is approximately 12." },
  { field: "garageSlabStepResult", answer: /^Builder to re-check$/, note: /^The garage slab step down is to be re-checked by the builder\. On plan it is 1,?500 (mm|millimetres) and on site it is 1,?500 (mm|millimetres)\.$/ },
  { field: "porchSlabStepResult", answer: /^Builder to re-check$/, note: /^The porch slab step down is to be re-checked by the builder\. On plan it is .+ and on site it is .+\.$/ },
  { field: "alfrescoSlabStepResult", answer: /^Builder to re-check$/, note: /^The alfresco slab step down is to be re-checked by the builder\. On plan it is .+ and on site it is .+\.$/ },
  { field: "upperRoofAppears", answer: /^Refer notes$/, note: "The upper roof covering was inspected from the scaffold. The upper roof covering is noted for attention. Lower level roofing was checked and is satisfactory." },
  { field: "lowerRoofLadder", answer: /^Refer notes$/, note: "The upper roof covering was inspected from the scaffold. The upper roof covering is satisfactory. Lower level roofing was checked and is noted for attention." },
  { field: "upperGutteringGround", answer: /^Refer notes$/, note: "Due to OH&S constraints the upper guttering could not be safely accessed. Observations from the ground indicate that the guttering is noted for attention. Lower level guttering was checked and is satisfactory." },
  { field: "lowerGutteringLadder", answer: /^Refer notes$/, note: /^(Due to OH&S constraints the upper guttering could not be safely accessed\. Observations from the ground indicate that the guttering is satisfactory\. )?Lower level guttering was checked and is noted for attention\.$/ },
  // The Summary's ticks, and the inspector's words after them.
  { field: "retainingWallsDetail", answer: /^\(typed\)$/, note: `Retaining walls are advised. ${TYPED}.` },
  { field: "agiDrainsDetail", answer: /^\(typed\)$/, note: `Agi drains are advised. ${TYPED}.` },
  { field: "roofAccessDetail", answer: /^\(typed\)$/, note: `Roof access was limited. ${TYPED}.` },
  { field: "plasterworkPartDone", answer: /^\(typed\)$/, note: `Plasterwork is part done to ${TYPED.charAt(0).toLowerCase()}${TYPED.slice(1)}.` },
];
/** The row each "Other" box belongs to, printed before the inspector's words ("Hebel: Some sheets cracked."). */
const OTHER_ROW = {
  generalOther: "General", qualityOther: "Slab quality", fitOutOther: "Painting", kerbOther: "Site and facilities", hebelOther: "Hebel",
  boardOther: "Blueboard, weatherboard, styrene foam, timber", stairwellOther: "Stairwell/s", finishes_other_note: "Finishes",
  internal_other_note: "Internal", walls_other_note: "Walls", doors_other_note: "Windows and Doors", garage_other_note: "Garage",
  balconies_other_note: "Balconies", site_other_note: "Site", common_other_note: "Common areas", roof_other_note: "Roof",
  other_other_note: "Services and other",
};
/** Lock-up & Fixing: the "Other" boxes' names as its report prints them (the row's own name; none for a plain "Other"). */
const LF_OTHER_ROW = { fitOutOther: "", kerbOther: "", hebelOther: "Hebel", boardOther: "Blueboard, weatherboard, styrene foam, timber", stairwellOther: "Stairwell/s" };
/** The inspector's own words: an "Other" box (and its "Other" row's note), "Any other concerns", the ground falls detail. */
const TYPED_AS_IS = /(^|_)other(_note)?$|Other$|^otherConcerns$|^groundFallsDetail$|^kerbOther$/;

describe("every note the checklists and the Summary print is a full sentence", () => {
  const notes = ALL.flatMap((r) => r.added.map((n) => ({ r, n })));
  it("tries every answer of every field, in every stage (House and Apartment)", () => {
    assert.ok(ALL.length > 4000, `${ALL.length} answers`);
    assert.equal(new Set(ALL.map((r) => `${r.stageName}|${r.propName}`)).size, 16);
  });
  it("never prints a row's name and the answer ('Ceiling insulation installed — no.')", () => {
    const raw = notes.filter(({ n }) => / — /.test(n) || /\brefer (to )?notes\b|\(see notes\)/i.test(n));
    assert.deepEqual(raw.map(({ r, n }) => `${where(r)}: ${n}`), []);
  });
  it("starts with a capital and ends with a full stop", () => {
    const bad = notes.filter(({ n }) => !/^[A-Z]/.test(n) || !/[.!?]$/.test(n));
    assert.deepEqual(bad.map(({ r, n }) => `${where(r)}: ${n}`), []);
  });
  it("has an expected sentence for every answer that prints a note (none left to a generic wording)", () => {
    const own = /^(Due to ground falls|Sections of the security fence|Security fencing is|Site appears to be well managed\.$|Site needs a clean-up|Final builder's clean|Damage was noted to the footpath|The (finish and )?workmanship|The works are|The inspector contacted|Agi drains are advised\.$|Roof access was limited\.$|Retaining walls are advised\.$)/;
    const unknown = ALL.filter((r) => r.added.some((n) => !own.test(n)) && !EXPECTED.some((e) => e.field === r.field.key) && !TYPED_AS_IS.test(r.field.key));
    assert.deepEqual(unknown.map((r) => `${where(r)}: ${r.added.join(" | ")}`), []);
  });
});

describe("each field prints the right sentence for each answer, and none for the others", () => {
  for (const e of EXPECTED) {
    const runs = ALL.filter((r) => r.field.key === e.field);
    it(`${e.field}: found in the templates`, () => assert.ok(runs.length > 0));
    for (const r of runs) {
      const asks = e.answer.test(r.option.label);
      // Lock-up & Fixing: the gutters' OH&S sentence (the upper guttering seen from the ground) is printed once, under the Roof gutters row,
      // not again in Notes (report-lf-template-wording.test.mjs checks it is under the row).
      const lfUnderRow = /^lf_/.test(r.key) && e.field === "upperGutteringGround";
      it(`${where(r)} -> ${asks && !lfUnderRow ? "its note" : "no note"}`, () => {
        if (lfUnderRow) { assert.ok(!r.added.some((n) => /guttering/i.test(n)), r.added.join(" | ")); return; }
        if (asks) {
          assert.equal(r.added.length, 1, r.added.join(" | "));
          if (typeof e.note === "string") assert.equal(r.added[0], e.note);
          else assert.match(r.added[0], e.note);
        } else {
          // Another answer (OK, a defect, N/A, "not yet") prints none of the field's notes.
          const sentence = typeof e.note === "string" ? (n) => n === e.note : (n) => e.note.test(n);
          assert.ok(!r.added.some(sentence), r.added.join(" | "));
          if (!["notesToInclude"].includes(e.field)) assert.deepEqual(r.added.filter((n) => !/^Due to ground falls/.test(n)), []);
        }
      });
    }
  }
  it("'Yes' and 'No' give different notes, and 'Yes' none, for the site's power, water and toilet and the ceiling insulation", () => {
    for (const key of ["powerSupply", "waterSupply", "siteToilet", "ceilingInsulation"]) {
      for (const r of ALL.filter((x) => x.field.key === key)) {
        if (/^yes/i.test(r.option.label)) assert.deepEqual(r.added, [], where(r));
        if (/^no\b/i.test(r.option.label)) assert.ok(r.added.length === 1 && /\bno\b|not yet/.test(r.added[0]), where(r));
      }
    }
  });
  it("prints what the inspector typed in an 'Other' box after the row it belongs to, in their words exactly", () => {
    const typed = ALL.filter((r) => TYPED_AS_IS.test(r.field.key) && r.option.label === "(typed)" && !/^(groundFallsDetail|otherConcerns)$/.test(r.field.key));
    assert.ok(typed.length > 10);
    for (const r of typed) {
      // Lock-up & Fixing: only the row's own name in front ("Hebel — other" -> "Hebel"), none for a plain "Other" box (the fit-out's
      // "Other?", the site's box after the kerb row), never the group's name ("Painting: …").
      const lockFix = /^lf_/.test(r.key);
      const name = lockFix ? LF_OTHER_ROW[r.field.key] : OTHER_ROW[r.field.key];
      assert.ok(name !== undefined, `a row name is expected for ${where(r)}`);
      // A house PCI report leaves the unit form's Common Areas out, its "Other" box too.
      const houseCommonArea = r.field.key === "common_other_note" && /House/.test(r.propName);
      assert.deepEqual(r.added, houseCommonArea ? [] : [name ? `${name}: ${TYPED}.` : `${TYPED[0].toUpperCase()}${TYPED.slice(1)}.`], where(r));
    }
  });
  it("keeps the inspector's capitals and punctuation ('Hebel: some sheets cracked at the NE corner!')", () => {
    const s = SECTIONS.find((x) => x.key === "lf_external_walls" && !x.apt);
    const f = s.fields.find((x) => x.key === "hebelOther");
    const a = okAnswers(s.fields, opened(f, s.fields));
    const before = notesOf(s.key, s.fields, a, false);
    for (const [typed, note] of [["some sheets cracked at the NE corner!", "Hebel: some sheets cracked at the NE corner!"], ["Some sheets cracked", "Hebel: Some sheets cracked."]]) {
      assert.deepEqual(notesOf(s.key, s.fields, { ...a, hebelOther: typed }, false).filter((n) => !before.includes(n)), [note]);
    }
  });
  it("prints the Summary's 'Retaining walls are advised.' once, with the inspector's detail when they gave one", () => {
    assert.deepEqual(uniqueNotes(["Retaining walls are advised.", `Retaining walls are advised. ${TYPED}.`]), [`Retaining walls are advised. ${TYPED}.`]);
    assert.deepEqual(uniqueNotes(["Retaining walls are advised.", "Retaining walls are advised."]), ["Retaining walls are advised."]);
  });
});

// ───────────────────────── 3. General Description ─────────────────────────

describe("General Description: 'The street frontage is to the …'", () => {
  const descs = SECTIONS.filter((s) => kindOfKey(s.key) === "description" && s.fields.some((f) => f.key === "frontage"));
  it("is asked in every stage", () => assert.equal(new Set(descs.map((s) => s.stageName)).size, 8));
  for (const s of descs) {
    it(`${s.stageName} ${s.propName}: every direction`, () => {
      const f = s.fields.find((x) => x.key === "frontage");
      for (const o of f.options) {
        const lines = composeConstructionSection(s.key, s.fields, { frontage: o.value }, s.apt).text.split(/\n+/);
        const dir = o.label.charAt(0).toLowerCase() + o.label.slice(1);
        assert.ok(lines.includes(`The street frontage is to the ${dir}.`), `${o.label}: ${lines.join(" | ")}`);
        assert.ok(!lines.some((l) => l.startsWith("Street frontage")));
      }
    });
  }
});

// ───────────────────────── The Frame report as printed ─────────────────────────

const HEADER = { reportDate: "16 Nov 2026", clientName: "C", yourReference: "", ourReference: "TEST", property: "P", inspectionDate: "16 Nov 2026", weather: "Dry", inspector: "I", inspectorRegistration: "", purpose: "" };
const INSPECTION = { id: "i", jobNo: "TEST", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const renderFrame = (patch = {}) => renderStage("fr_", HEADER, patch);
function renderStage(prefix, header, patch = {}) {
  const profile = { inspectionType: "construction_stage", propertyType: "residential_house" };
  const sections = SECTION_ORDER.filter((k) => k.startsWith(prefix) && latest.has(`residential_house|${k}`)).map((key) => {
    const t = latest.get(`residential_house|${key}`);
    const answers = okAnswers(t.fields, patch[key] ?? {});
    const d = flattenSectionToDraft(t.fields, answers, key, profile);
    return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
  });
  const model = buildConstructionReport(sections, null);
  return renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header }));
}

describe("the Frame report (as TEST-YK-FR-1116C) prints its notes as sentences", () => {
  const html = renderFrame({
    fr_description: { frontage: "north" },
    fr_wall_floor: { ceilingInsulation: "no_see_notes" },
    fr_summary: { notesToInclude: ["ground_falls", "retaining_walls"], retainingWallsDetail: TYPED },
  });
  const t = text(html);
  const notes = t.slice(t.indexOf("NOTES"));
  it("The street frontage is to the north.", () => assert.ok(t.includes("The street frontage is to the north.")));
  it("the ground falls in full, the retaining walls with the inspector's words, the ceiling insulation as a sentence", () => {
    assert.ok(notes.includes(GROUND_FALLS));
    assert.ok(notes.includes(`Retaining walls are advised. ${TYPED}.`));
    assert.ok(notes.includes("Ceiling insulation has not yet been installed."));
    assert.ok(!/Ceiling insulation installed — no|Retaining walls are advised —/.test(t));
  });
});

// ───────────────────────── Report Purpose ─────────────────────────

const { constructionPurpose, PURPOSE } = await server.ssrLoadModule("/src/web/construction/stages.ts");
const { buildReportHeader, registrationLabel } = await server.ssrLoadModule("/src/web/report.ts");
const purposeWho = (p) => /insofar as (.+) can reasonably identify/.exec(p)?.[1];

describe("Report Purpose: builder / building consultant / building practitioner, from the inspector's registration", () => {
  it("reads the registration's prefix as the other reports do", () => {
    assert.equal(purposeWho(constructionPurpose("DBU 58070")), "a licensed builder");
    assert.equal(purposeWho(constructionPurpose("CDB-U 12345")), "a licensed builder", "any other builder registration");
    assert.equal(purposeWho(constructionPurpose("ARBV 13238")), "a building consultant");
    assert.equal(purposeWho(constructionPurpose("INL 41888")), "a building practitioner");
    assert.equal(purposeWho(constructionPurpose("")), "a licensed builder", "no registration on file");
    assert.equal(purposeWho(constructionPurpose(undefined)), "a licensed builder");
    assert.equal(constructionPurpose("DBU 1"), PURPOSE, "the rest of the paragraph unchanged");
  });

  const job = (registration) => ({ ...INSPECTION, sections: [{ id: "job-info", key: "job-info", fields: registration === undefined ? {} : { inspectorRegistration: registration } }] });
  it("takes the job's Inspector DBU License first, then the inspector's profile", () => {
    assert.equal(buildReportHeader(job("ARBV 13238"), { name: "I", licenseNumber: "DBU 58070" }).inspectorRegistration, "ARBV 13238");
    assert.equal(buildReportHeader(job(undefined), { name: "I", licenseNumber: "INL 41888" }).inspectorRegistration, "INL 41888");
    assert.equal(buildReportHeader(job(undefined), { name: "I", licenseNumber: null }).inspectorRegistration, undefined);
  });

  for (const [prefix, stageName] of STAGES) {
    for (const [registration, who, label] of [
      ["DBU 58070", "a licensed builder", "(Builder Registration No DBU 58070)"],
      ["ARBV 13238", "a building consultant", "(Architect Registration No ARBV 13238)"],
      ["INL 41888", "a building practitioner", "(Inspection Registration No. INL 41888)"],
      ["", "a licensed builder", ""],
    ]) {
      it(`${stageName}: the cover's purpose agrees with its registration line (${registration || "none"})`, () => {
        const html = renderStage(prefix, { ...HEADER, inspector: "Joe Briffa", inspectorRegistration: registration });
        const t = text(html);
        assert.ok(t.includes(`insofar as ${who} can reasonably identify those defects or faults.`), t.slice(0, 600));
        assert.equal(registrationLabel(registration), label);
        if (label) assert.ok(t.includes(`Joe Briffa ${label}`));
        assert.equal((t.match(/insofar as/g) ?? []).length, 1);
      });
    }
  }
});
