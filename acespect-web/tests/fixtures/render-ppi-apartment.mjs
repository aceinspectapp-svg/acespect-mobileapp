// Prints the whole Pre-Purchase / Apartment report body (cover to Terms) for tests/report-ppi-apartment-unchanged.test.mjs, from the
// same made-up answers as tests/report-ppi-apartment-layout.test.mjs: 3 sets of answers that walk through every option, each with four
// covers (a builder, an architect, not occupied, no registration).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export async function renderPpiApartment(webRoot, server) {
  const { createElement } = await import(resolve(webRoot, "node_modules/react/index.js"));
  const { renderToStaticMarkup } = await import(resolve(webRoot, "node_modules/react-dom/server.node.js"));
  const R = await server.ssrLoadModule("/src/web/prepurchase/PrePurchaseReport.tsx");
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


  const out = {};
  for (const v of [0, 1, 2]) for (const [name, o] of [["builder", {}], ["architect", { registration: "ARBV 13238", inspector: "Trevor Scott" }], ["not-occupied", { occupied: "no" }], ["no-registration", { registration: "" }]]) {
    out[`v${v}|${name}`] = report(v, o).html;
  }
  return out;
}
