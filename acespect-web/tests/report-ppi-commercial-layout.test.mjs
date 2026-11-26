// Pre-Purchase / Commercial ("ACESPECT Building (Pre-Purchase)_House and Commercial Nov 2026"): laid out as the Pre-Purchase / Apartment
// report is -- the shared cover ("PRE-PURCHASE REPORT", "Commercial", the template's purpose, General and the Summary (the sentence a field decides plus the template's fixed sentences)),
// SCOPE, DEFECTS, Condition Definitions, the Condition Summary and Site Access Conditions, then the template's order (GENERAL DESCRIPTION,
// PHOTOGRAPHS, ROOF, EXTERNAL, INTERNAL, STRUCTURAL DEFECTS, MAJOR DEFECTS, SAFETY HAZARDS, NOTES, GLOSSARY, MAINTENANCE, Terms and
// Conditions), every main title on a new page and none empty; no option code anywhere in the printed report; the Pool/Spa paragraph only
// with a pool; and the "-pre-purchase-report" file name. Pre-Purchase / House is not touched (report-other-stages-unchanged.test.mjs).
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const R = await server.ssrLoadModule("/src/web/prepurchase/PrePurchaseReport.tsx");
const { NO_MOISTURE } = await server.ssrLoadModule("/src/web/wording/pre_purchase.apartment.ts");
const { PPI_POOL_SPA_TEXT } = await server.ssrLoadModule("/src/web/prepurchase/scopeText.ts");
const { PPI_TERMS_TITLE } = await server.ssrLoadModule("/src/web/prepurchase/termsText.ts");
const { reportFileName } = await server.ssrLoadModule("/src/web/reportFile.ts");

const PPI = { inspectionType: "pre_purchase", propertyType: "commercial_properties" };
const latest = new Map();
for (const t of JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"))) {
  if (t.inspectionType !== PPI.inspectionType || t.propertyType !== PPI.propertyType) continue;
  if (!latest.has(t.sectionKey) || latest.get(t.sectionKey).version < t.version) latest.set(t.sectionKey, t);
}
// The Commercial form's sections, in the app's order (Offices & Staff Facilities is the pool_spa slot).
const KEYS = ["job-info", "description", "driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "elevations", "roof_chimneys", "internal_areas", "pool_spa", "notes"];
const NAMES = { "job-info": "Job Information", description: "Description & Overview", paving_paths: "Paving / Car Park", garage_carport_sheds: "Garage & Other Structures", roof_chimneys: "Roof & Chimneys", internal_areas: "Warehouse & Production", pool_spa: "Offices & Staff Facilities" };

/** Answers that walk through every option (3 sets), with typed words that end with and without a full stop. */
function answersFor(fields, v, depth = 0) {
  const a = {};
  (fields ?? []).forEach((f, i) => {
    const opts = (f.options ?? []).map((o) => o.value);
    switch (f.type) {
      case "pill-select": case "color-select": case "select-tiles":
        if (opts.length) a[f.key] = opts[(i + v) % opts.length];
        break;
      case "chip-multiselect": case "tile-multiselect":
        if (opts.length) a[f.key] = v === 2 ? [...opts] : opts.slice(v % opts.length, (v % opts.length) + 3);
        break;
      case "yesno": a[f.key] = (i + v) % 2 ? "yes" : "no"; break;
      case "text": a[f.key] = v === 1 ? "" : "Typed words"; break;
      case "textarea": a[f.key] = v === 1 ? "" : v === 0 ? "Typed note (owners corporation)." : "Typed note without a stop"; break;
      case "numeric": a[f.key] = v === 1 ? "" : 3 + i + v; break;
      case "date": a[f.key] = "2026-11-01"; break;
      case "photos": a[f.key] = [`/api/v1/media/p-${f.key}-${v}-${depth}`]; break;
      case "damage-list": if (depth < 3) a[f.key] = [answersFor(f.itemFields, v, depth + 1)]; break;
      case "repeating-group": {
        if (depth >= 3) break;
        const repeat = f.repeat ?? { presentation: "strip" };
        if (repeat.presentation === "strip") a[f.key] = [answersFor(f.itemFields, v, depth + 1), answersFor(f.itemFields, v + 1, depth + 1)];
        else a[f.key] = Object.fromEntries((repeat.fixedInstances ?? []).map((fi, j) => [fi.key, answersFor(f.itemFields, v + j, depth + 1)]));
        break;
      }
    }
  });
  return a;
}

/** The phone's own text for a section, as it is saved: "Question: option_code" lines (the website composes the report from the answers). */
const PHONE_TEXT = "Applicability: na. Count: item1. Observations: item0, item1. Comments: Typed (owners corporation)..";

const photosOf = (v, out = []) => {
  if (typeof v === "string" && v.startsWith("/api/v1/media/")) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => photosOf(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => photosOf(x, out));
  return out;
};

function report(v, { patch = {}, occupied = "yes" } = {}) {
  const sections = KEYS.map((key, i) => {
    const t = latest.get(key);
    const answers = key === "job-info" ? { occupied } : { ...answersFor(t.fields, v), ...(patch[key] ?? {}) };
    return { id: `s${i}`, key, name: NAMES[key] ?? t.name, reviewStatus: "approved", reportText: PHONE_TEXT, answers, fields: {}, photos: photosOf(answers), damages: [] };
  });
  const insp = { id: "i", jobNo: "Yasiru-Test-9-PPI-COM", address: "14 Test Industrial Drive", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "2026-11-25", submittedAt: null, type: "Pre-Purchase", propertyType: "Commercial Properties", status: "submitted", overallProgress: 0, sections, notes: "", photoArchiveUrl: null };
  const printed = sections.flatMap((s) => (s.key === "job-info" ? [s] : s.key === "notes" ? R.splitCommercialNotes(s, latest.get(s.key).fields, PPI) : [R.prePurchaseSectionText(s, latest.get(s.key).fields, PPI)]));
  const header = { reportDate: "Wednesday, 25 November 2026", clientName: "C", clientEmail: "c@example.com", yourReference: "YR-1", ourReference: "Yasiru-Test-9-PPI-COM", property: "14 Test Industrial Drive", propertyOwner: "Owner Name", inspectionDate: "Wednesday, 25 November 2026", weather: "Sunny", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "old purpose" };
  const html = renderToStaticMarkup(createElement(R.PrePurchaseReportBody, { inspection: insp, sections: printed, header }));
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return { html, text };
}
const titles = (html) => [...html.matchAll(/data-ppi-title="([^"]+)"/g)].map((m) => m[1]);

describe("PPI Commercial: the shared construction-style cover", () => {
  const { text } = report(0);
  const cover = text.slice(0, text.indexOf("SCOPE"));
  it("small 'Pre-Purchase Report', big title 'Commercial', the template's rows", () => {
    assert.match(cover, /Pre-Purchase Report\nCommercial\n/);
    for (const row of ["Property", "Inspection Date", "Occupied", "Weather Conditions", "Inspector", "Report Purpose", "General"]) assert.ok(cover.includes(`\n${row}\n`), row);
    assert.match(cover, /The purpose of this report is to identify the action required to rectify major defects or structural faults in the building, insofar as a licensed builder can reasonably identify those defects or faults\./);
    assert.match(cover, /This report is the result of a visual inspection only and is intended to be read as a whole\./);
  });
  it("no Property Owner, no Your reference, no dilapidation purpose; the signature on page 1", () => {
    assert.ok(!/\nProperty Owner\n|Owner Name|\nYour [Rr]eference\n|YR-1|old purpose/.test(text));
    assert.ok(!/dilapidation/i.test(cover) && !/This dilapidation report|purpose of this dilapidation/i.test(text), "no dilapidation purpose");
    assert.match(cover, /Dinuke De Coonghe\nDirector – Houspect Victoria/);
  });
  it("Summary: the field-decided sentence (is / is not structurally sound and free of major defects), then the template's fixed sentences", () => {
    const summary = (a, b) => report(0, { patch: { notes: { structural_structurallySound: a, majordefects_freeOfMajorDefects: b } } }).text;
    const FIXED = "With any dwelling of a similar vintage, due to its age and general wear and tear, the property will require a degree of maintenance. With a decision to include a program of general maintenance and the repairs mentioned in this report, the property is considered satisfactory for future use. Properties built prior to 1983 may contain asbestos.";
    const flat = (t) => t.replace(/\s+/g, " ");
    assert.ok(flat(summary("yes", "yes")).includes(`Summary In consideration of its age, it is structurally sound and free of major defects. ${FIXED}`));
    for (const [a, b] of [["yes", "no"], ["no", "yes"], ["no", "no"]]) assert.ok(flat(summary(a, b)).includes(`Summary In consideration of its age, it is not structurally sound and free of major defects. ${FIXED}`), `${a}/${b}`);
    const open = flat(summary(undefined, "yes"));
    assert.ok(open.includes(`Summary ${FIXED}`) && !/In consideration of its age/.test(open), "a question unanswered: the fixed sentences only");
    assert.ok(!/constructed around the/.test(summary("yes", "yes")), "no field holds the year");
  });
  it("Terms: 'WHEREAS:' (the template's 'HEREAS:' corrected)", () => {
    const t = report(0).text;
    assert.match(t, /WHEREAS: The Client has requested the Inspector/);
    assert.ok(!/(^|[^W])HEREAS:/.test(t));
  });
});

describe("PPI Commercial: the template's order, every main title on a new page, none empty", () => {
  it("order", () => {
    for (const v of [0, 1, 2]) {
      const t = titles(report(v).html);
      const want = ["SCOPE", "DEFECTS", "Condition Definitions", "Condition Summary", "Site Access Conditions", "General Description", "Photographs", "Roof", "External", "Internal", "Structural Defects", "Major Defects", "Safety Hazards", "Notes", "Glossary", "Maintenance", "Terms and Conditions"];
      assert.deepEqual(t.filter((x) => want.includes(x)), want.filter((x) => t.includes(x)), `v${v}`);
      for (const must of ["SCOPE", "DEFECTS", "Condition Definitions", "Photographs", "Roof", "External", "Internal", "Notes", "Glossary", "Maintenance", "Terms and Conditions"]) assert.ok(t.includes(must), `${must} (v${v})`);
    }
  });
  it("each main title starts a new page and has something under it", () => {
    const { html } = report(0);
    for (const m of html.matchAll(/<div class="report-page-break"[^>]*data-ppi-title="([^"]+)"[^>]*>([\s\S]*?)(?=<div class="report-page-break"|$)/g)) {
      const inner = m[2].replace(/<img[^>]*>/g, " [photo] ").replace(/<[^>]+>/g, " ").replace(/↑ Back to summary/g, "").replace(/\s+/g, " ").trim();
      assert.ok(inner.length > m[1].length + 5, `"${m[1]}" has content`);
    }
  });
  it("Warehouse & Production under INTERNAL with its name; the other sections under EXTERNAL / ROOF", () => {
    const { html } = report(0);
    const part = (title) => html.slice(html.indexOf(`data-ppi-title="${title}"`), html.indexOf('data-ppi-title="', html.indexOf(`data-ppi-title="${title}"`) + 10));
    assert.match(part("Internal"), /data-ppi-section="Warehouse &amp; Production"/);
    for (const name of ["Elevations", "Garage &amp; Other Structures", "Driveway", "Paving / Car Park", "Fences", "Retaining Walls"]) assert.ok(part("External").includes(`data-ppi-section="${name}"`), name);
    assert.match(part("Roof"), /Roof/);
  });
  it("the Notes print under STRUCTURAL DEFECTS, MAJOR DEFECTS, SAFETY HAZARDS and NOTES by their questions", () => {
    const { text } = report(0);
    const between = (a, b) => text.slice(text.indexOf(`\n${a}\n`), text.indexOf(`\n${b}\n`));
    assert.match(between("Structural Defects", "Major Defects"), /structurally sound/);
    assert.match(between("Major Defects", "Safety Hazards"), /free of major defects/);
    assert.match(between("Safety Hazards", "Notes"), /safety matters/i);
    assert.match(text.slice(text.lastIndexOf("\nNotes\n"), text.indexOf("\nGLOSSARY\n")), /No access was granted|observed/);
  });
  it("GLOSSARY, MAINTENANCE and the template's Terms and Conditions close the report", () => {
    const { text } = report(0);
    assert.equal(PPI_TERMS_TITLE, "Terms and Conditions – Pre-Purchase Building Inspection");
    assert.ok(text.indexOf("\nGLOSSARY\n") < text.indexOf("\nMAINTENANCE\n") && text.indexOf("\nMAINTENANCE\n") < text.indexOf(`\n${PPI_TERMS_TITLE}\n`));
    assert.match(text, /AG LINE\n- A perforated pipe/);
    assert.match(text, /DEFINITIONS & INTERPRETATION/);
    assert.ok(!/CONDITIONS FOR THE PROVISION OF THE REPORT/.test(text), "not the dilapidation conditions");
  });
});

describe("PPI Commercial: no option codes anywhere, no '..', lists of sentences as bullets", () => {
  // Every code an option of this form stores that is not an ordinary word: "item3", "na-slab", "satisfactory_with_typical_wear_and_tear" ...
  const codes = new Set();
  const walk = (fs) => (fs ?? []).forEach((f) => { (f.options ?? []).forEach((o) => { if (/_|^item\d+$|^na(-|$)/.test(o.value)) codes.add(o.value); }); walk(f.itemFields); });
  for (const t of latest.values()) walk(t.fields);
  for (const v of [0, 1, 2]) {
    it(`answers set ${v}`, () => {
      const { text } = report(v);
      // The report's own sentences (the template's Glossary, Maintenance and Terms are its own words, "etc.," included).
      const body = text.slice(0, text.indexOf("\nGLOSSARY\n"));
      for (const re of [/[a-z)]\.\.(?!\.)/, /\.,/]) assert.ok(!re.test(body), `${re} in v${v}: ${body.match(re) ? body.slice(Math.max(0, body.match(re).index - 60), body.match(re).index + 40) : ""}`);
      for (const re of [/\bitem\d+\b/, /__other__/, /::/, /\bundefined\b/, /\[object Object\]/, /\bNaN\b/, /Applicability:/, /\bna\b/]) assert.ok(!re.test(text), `${re} in v${v}: ${text.match(re)?.index !== undefined ? text.slice(Math.max(0, text.match(re).index - 60), text.match(re).index + 40) : ""}`);
      for (const c of codes) assert.ok(!new RegExp(`(^|[^\\w-])${c.replace(/[-]/g, "\\-")}([^\\w-]|$)`).test(text), `code "${c}" printed in v${v}`);
    });
  }
  it("General Comments: one bullet per sentence", () => {
    const { html } = report(2, { patch: { notes: { generalComments: ["maintenance_recommended", "further_investigation_recommended"] } } });
    assert.match(html, /Maintenance recommended\.[\s\S]*Further investigation recommended\./);
    assert.ok(!/Maintenance recommended\.,/.test(html));
  });
  it("moisture: 'None observed' in the template's words", () => {
    const rooms = Object.fromEntries((latest.get("internal_areas").fields[0].repeat.fixedInstances).map((fi) => [fi.key, { available: "yes", floorLevel: "ground", obstruction: ["furniture"], generalCondition: "fair", hasDamage: "no", moistureObservations: ["other", "__other__:None observed"] }]));
    const { text } = report(0, { patch: { internal_areas: { rooms } } });
    assert.ok(text.includes(NO_MOISTURE));
    assert.ok(!/None observed noted/.test(text));
  });
});

describe("PPI Commercial: the Pool/Spa paragraph only with a pool or spa", () => {
  it("no pool (Not applicable): no Pool/Spa heading and no pool paragraph", () => {
    const { text, html } = report(0, { patch: { pool_spa: { pool_applicability: "na" } } });
    assert.ok(!text.includes(PPI_POOL_SPA_TEXT));
    assert.ok(!/data-ppi-section="Pool\/Spa"/.test(html));
    assert.ok(!/There is a pool/.test(text));
  });
  it("a pool assessed: under EXTERNAL as Pool/Spa, with the template's paragraph", () => {
    const { text, html } = report(0, { patch: { pool_spa: { pool_applicability: "applicable" } } });
    assert.ok(text.includes(PPI_POOL_SPA_TEXT));
    const ext = html.indexOf('data-ppi-title="External"'), int = html.indexOf('data-ppi-title="Internal"'), pool = html.indexOf('data-ppi-section="Pool/Spa"');
    assert.ok(ext < pool && pool < int, "Pool/Spa is under EXTERNAL");
  });
  it("once the slot asks about offices, it prints under INTERNAL with its own name", () => {
    const office = { key: "pool_spa", answers: { offices_condition: "fair" } };
    const parts = R.commercialParts([{ id: "o", key: office.key, name: "Offices & Staff Facilities", answers: office.answers, reportText: "x", photos: [], damages: [], fields: {} }]);
    assert.deepEqual(parts.map((p) => [p.title, p.sections.map((s) => s.name)]), [["Internal", ["Offices & Staff Facilities"]]]);
  });
});

describe("PPI Commercial: the file name", () => {
  it("<job>-pre-purchase-report.pdf / .docx", () => {
    assert.equal(reportFileName({ id: "i", jobNo: "Yasiru-Test-9-PPI-COM" }, "pre-purchase", "pdf"), "Yasiru-Test-9-PPI-COM-pre-purchase-report.pdf");
    assert.equal(reportFileName({ id: "i", jobNo: "Yasiru-Test-9-PPI-COM" }, "pre-purchase", "docx"), "Yasiru-Test-9-PPI-COM-pre-purchase-report.docx");
  });
  it("Pre-Purchase / House is not laid out here", () => {
    assert.equal(R.isPrePurchaseLayout({ type: "Pre-Purchase", propertyType: "Residential House" }), false);
    assert.equal(R.isPrePurchaseLayout({ type: "Pre-Purchase", propertyType: "Commercial Properties" }), true);
    assert.equal(R.isPrePurchaseLayout({ type: "Pre-Purchase", propertyType: "Apartment" }), true);
  });
});
