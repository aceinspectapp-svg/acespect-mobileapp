// Pre-Purchase / Apartment ("ACESPECT Building (Pre-Purchase)_Apartment Nov 2026"): laid out as the Construction reports are, with the
// template's title, purpose and General on the shared cover; no option codes anywhere in the printed report; a list of sentences as
// bullets; no full stop after a sentence that already has one; and the template's moisture sentence in each room.
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
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const { wordingFor } = await server.ssrLoadModule("/src/web/wording/registry.ts");
const { NO_MOISTURE } = await server.ssrLoadModule("/src/web/wording/pre_purchase.apartment.ts");

const PPI = { inspectionType: "pre_purchase", propertyType: "apartment" };
const latest = new Map();
for (const t of JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"))) {
  if (t.inspectionType !== PPI.inspectionType || t.propertyType !== PPI.propertyType) continue;
  if (!latest.has(t.sectionKey) || latest.get(t.sectionKey).version < t.version) latest.set(t.sectionKey, t);
}
// The sections the Apartment form walks through, in its order.
const KEYS = ["job-info", "description", "elevations", "roof_chimneys", "internal_areas", "paving_paths", "notes"];

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
const PHONE_TEXT = "Applicability: na-apt. Observations: item0, item2. Comments: Balcony soffits only (the roof belongs to the owners corporation)..";

function report(v, { registration = "DBU 58070", inspector = "Joe Briffa", occupied = "yes" } = {}) {
  const sections = KEYS.map((key, i) => {
    const t = latest.get(key);
    const answers = key === "job-info" ? { occupied } : answersFor(t.fields, v);
    return { id: `s${i}`, key, name: t.name, reviewStatus: "approved", reportText: PHONE_TEXT, answers, fields: {}, photos: [], damages: [] };
  });
  const insp = { id: "i", jobNo: "Yasiru-Test-8-PPI-AP", address: "Unit 12, 1 Test Lane", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "2026-11-23", submittedAt: null, type: "Pre-Purchase", propertyType: "Apartment", status: "submitted", overallProgress: 0, sections, notes: "", photoArchiveUrl: null };
  const printed = sections.map((s) => (s.key === "job-info" ? s : R.prePurchaseSectionText(s, latest.get(s.key).fields, PPI)));
  const header = { reportDate: "Monday, 23 November 2026", clientName: "C", clientEmail: "c@example.com", yourReference: "YR-1", ourReference: "Yasiru-Test-8-PPI-AP", property: "Unit 12, 1 Test Lane", propertyOwner: "Owner Name", inspectionDate: "Monday, 23 November 2026", weather: "Overcast", inspector, inspectorRegistration: registration, purpose: "old purpose" };
  const html = renderToStaticMarkup(createElement(R.PrePurchaseReportBody, { inspection: insp, sections: printed, header }));
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return { html, text, printed };
}

describe("PPI Apartment: the shared cover with the property type as its title, the template's purpose and General", () => {
  const { html, text } = report(0);
  it("is the shared cover page", () => assert.match(html, /data-cover="page"/));
  it("is titled with the property type, under PRE-PURCHASE REPORT", () => {
    assert.match(html, /data-cover="kicker"[^>]*>Pre-Purchase Report</);
    assert.match(html, /data-cover="title"[^>]*>Apartment</);
  });
  it("prints the template's Report Purpose", () =>
    assert.ok(text.includes("Report Purpose\nThe purpose of this report is to identify the action required to rectify major defects or structural faults in the building, insofar as a licensed builder can reasonably identify those defects or faults.")));
  it("prints the template's General", () =>
    assert.ok(text.includes("General\nThis report is the result of a visual inspection only and is intended to be read as a whole. Please read the detailed inspection information and the scope section. Whilst all defects have been investigated to confirm cause and significance, some minor defects have not been detailed as they were considered a normal occurrence or general wear and tear for a building of this age.")));
  it("has the Construction cover's lines only (no Property Owner, no Your Reference), with the template's Occupied", () => {
    const labels = [...html.matchAll(/data-cover="row-label"[^>]*>([^<]+)</g)].map((m) => m[1]);
    assert.deepEqual(labels, ["Property", "Inspection Date", "Occupied", "Weather Conditions", "Inspector", "Report Purpose", "General"]);
    assert.ok(!text.includes("Your Reference") && !text.includes("Owner Name") && !text.includes("old purpose"));
    assert.ok(text.includes("Via email: c@example.com"));
  });
  it("says building consultant for an architect", () =>
    assert.ok(report(0, { registration: "ARBV 13238", inspector: "Trevor Scott" }).text.includes("insofar as a licensed building consultant can reasonably identify")));
  it("prints the General Description and the Photographs paragraph as the Construction reports do", () => {
    assert.ok(text.includes("General Description\n"));
    assert.ok(text.includes("Selected photographs are included in the body of this report. For a full download please"));
  });
  it("numbers its photos and refers to them as the template does", () => assert.match(text, /Please refer to Photographs? \d+( to \d+)?\./));
});

describe("PPI Apartment: no option codes anywhere in the report", () => {
  // Every option whose stored value is a code (not the words it shows): "na-apt", "item1", "musty_odour" ...
  const codes = new Set();
  const collect = (fields) => (fields ?? []).forEach((f) => {
    for (const o of f.options ?? []) if (o.value.toLowerCase() !== o.label.toLowerCase() && /[_\d-]/.test(o.value)) codes.add(o.value);
    collect(f.itemFields);
  });
  for (const t of latest.values()) collect(t.fields);
  for (const v of [0, 1, 2]) {
    it(`answers set ${v + 1}`, () => {
      const { text } = report(v);
      const words = new Set(text.split(/[^A-Za-z0-9_-]+/));
      const found = [...codes].filter((c) => words.has(c));
      assert.deepEqual(found, []);
      assert.doesNotMatch(text, /\b[a-z]+_[a-z0-9_]+\b/, "snake_case code");
      assert.doesNotMatch(text, /\bitem\d+\b/);
      assert.doesNotMatch(text, /\bna-[a-z]+\b/);
      assert.doesNotMatch(text, /[A-Z]+::/, "report-text mark");
    });
  }
  it("never prints the phone's own text", () => assert.ok(!report(0).text.includes("Applicability: na-apt")));
});

describe("PPI Apartment: punctuation", () => {
  for (const v of [0, 1, 2]) {
    it(`no ".," and no full stop after a stop (answers set ${v + 1})`, () => {
      // The report's own sentences (the template's Glossary, Maintenance and Terms are its own words, "etc.," included).
      const text = report(v).text.split("\nGLOSSARY\n")[0];
      assert.doesNotMatch(text, /\.,/);
      assert.doesNotMatch(text, /[.!?]\.(\s|$)/m);
    });
  }
  it("General Comments: one bullet per sentence", () => {
    const fields = latest.get("notes").fields;
    const d = flattenSectionToDraft(fields, { generalComments: ["minor_defects_observed_refer_to_individual_sections_for_deta", "maintenance_recommended"] }, "notes", PPI);
    assert.ok(d.reportText.includes("BULLET::Minor defects observed; refer to individual sections for details.\n\nBULLET::Maintenance recommended."), d.reportText);
    assert.ok(!d.reportText.includes("General Comments:"));
    const { html } = report(2);
    assert.match(html, /data-bullet=""[\s\S]*?Minor defects observed; refer to individual sections for details\./);
  });
  it("typed text that ends with a full stop gets no second one", () => {
    const { text } = report(0);
    assert.ok(text.includes("Typed note (owners corporation)."));
    assert.ok(!text.includes("corporation).."));
  });
});

describe("PPI Apartment: moisture observations in rooms", () => {
  const fields = latest.get("internal_areas").fields;
  const rooms = fields.find((f) => f.key === "rooms");
  const room = (moistureObservations) => {
    const key = rooms.repeat?.fixedInstances?.[0]?.key ?? "front_entry";
    const answers = { rooms: rooms.repeat?.presentation === "strip" ? [{ condition: "fair", moistureObservations }] : { [key]: { condition: "fair", moistureObservations } } };
    return flattenSectionToDraft(fields, answers, "internal_areas", PPI).reportText;
  };
  it('"Other: None observed" -> the template\'s sentence', () => {
    const t = room(["other", "__other__:None observed"]);
    assert.ok(t.includes(NO_MOISTURE), t);
    assert.ok(!/None observed/.test(t));
  });
  it("staining and musty odour -> what was found", () => assert.ok(room(["staining", "musty_odour"]).includes("Staining and musty odour noted.")));
  it("staining only", () => assert.ok(room(["staining"]).includes("Staining noted.")));
  it('"None observed" and staining -> the staining', () => {
    const t = room(["staining", "other", "__other__:None observed"]);
    assert.ok(t.includes("Staining noted.") && !t.includes(NO_MOISTURE), t);
  });
});

describe("Only Pre-Purchase / Apartment (and Pre-Purchase / Commercial, laid out the same way) words lists and stops its own way", () => {
  for (const p of ["dilapidation/residential_house", "dilapidation/apartment", "pre_purchase/residential_house", "investigations/apartment", "construction_stage/apartment"]) {
    const [inspectionType, propertyType] = p.split("/");
    it(p, () => {
      const w = wordingFor({ inspectionType, propertyType });
      assert.equal(w.listLine, undefined);
      assert.equal(w.finish, undefined);
    });
  }
  it("is used only for Pre-Purchase / Apartment", () => {
    assert.equal(R.isPrePurchaseApartment({ type: "Pre-Purchase", propertyType: "Apartment" }), true);
    assert.equal(R.isPrePurchaseApartment({ type: "Pre-Purchase", propertyType: "Residential House" }), false);
    assert.equal(R.isPrePurchaseApartment({ type: "Dilapidation", propertyType: "Apartment" }), false);
  });
});
