// Prints every report type except Pre-Purchase / Apartment from the same made-up answers, for
// tests/report-other-stages-unchanged.test.mjs: each construction stage (house and apartment) as its whole report, and each other
// report type (Dilapidation, Investigations, Pre-Purchase House / Commercial) as its cover and every section's text, defects and printed
// section. Three sets of answers walk through every option, with text and numbers present and empty.
//
// `webRoot` is the acespect-web folder to print with, so the same answers can be printed with main (to make the fixture) and with a branch.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export async function renderOtherReports(webRoot, server) {
  const { createElement } = await import(resolve(webRoot, "node_modules/react/index.js"));
  const { renderToStaticMarkup } = await import(resolve(webRoot, "node_modules/react-dom/server.node.js"));
  const { buildConstructionReport } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
  const { ConstructionReportBody } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
  const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
  const { ReportSection } = await server.ssrLoadModule("/src/web/components/ReportSection.tsx");
  const { ReportCover } = await server.ssrLoadModule("/src/web/components/ReportCover.tsx");
  const { PhotoNumberProvider, ReportWordingStyleContext } = await server.ssrLoadModule("/src/web/components/reportKit.tsx");
  const { buildReportHeader } = await server.ssrLoadModule("/src/web/report.ts");

  const latest = new Map();
  for (const t of JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"))) {
    const k = `${t.inspectionType}|${t.propertyType}|${t.sectionKey}`;
    if (!latest.has(k) || latest.get(k).version < t.version) latest.set(k, t);
  }

  function answersFor(fields, v, depth = 0) {
    const a = {};
    (fields ?? []).forEach((f, i) => {
      const opts = (f.options ?? []).map((o) => o.value);
      switch (f.type) {
        case "pill-select": case "color-select": case "select-tiles":
          if (opts.length) { const val = opts[(i + v) % opts.length]; a[f.key] = val;
            if (/defect/.test(val)) a[`${f.key}__defect`] = { location: `Loc ${i}`, category: ["workmanship_outside_tolerance"], severity: ["minor"], comments: v === 1 ? "" : `Comment ${f.key}`, constructionCode: v === 2 ? "AS 1684" : "", photos: [] }; }
          break;
        case "chip-multiselect": case "tile-multiselect": if (opts.length) a[f.key] = opts.slice(v % opts.length, (v % opts.length) + 2); break;
        case "yesno": a[f.key] = (i + v) % 2 ? "yes" : "no"; break;
        case "text": case "textarea": a[f.key] = v === 1 ? "" : `Text ${f.key}`; break;
        case "numeric": a[f.key] = v === 1 ? "" : 100 + i * 7 + v * 40; break;
        case "date": a[f.key] = "2026-11-01"; break;
        case "photos": a[f.key] = v === 1 ? [] : [`/api/v1/media/${f.key}-${v}-a`, `/api/v1/media/${f.key}-${v}-b`]; break;
        case "damage-list": if (depth < 3) a[f.key] = [answersFor(f.itemFields, v, depth + 1), answersFor(f.itemFields, v + 1, depth + 1)]; break;
        case "repeating-group": {
          if (depth >= 3) break;
          const repeat = f.repeat ?? { presentation: "strip" };
          if (repeat.presentation === "strip") a[f.key] = [answersFor(f.itemFields, v, depth + 1), answersFor(f.itemFields, v + 2, depth + 1)];
          else a[f.key] = Object.fromEntries((repeat.fixedInstances ?? []).map((fi, j) => [fi.key, answersFor(f.itemFields, v + j, depth + 1)]));
          break;
        }
      }
    });
    return a;
  }

  const out = {};

  // Construction Stage: every stage's whole report, house and apartment.
  const HEADER = { reportDate: "1 Nov 2026", clientName: "C", yourReference: "", ourReference: "R", property: "P", inspectionDate: "1 Nov 2026", weather: "Fine", inspector: "I", inspectorRegistration: "", purpose: "" };
  const INSP = { id: "i", jobNo: "R", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "x", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
  for (const prop of ["residential_house", "apartment"]) {
    const keys = [...latest.keys()].filter((k) => k.startsWith(`construction_stage|${prop}|`)).map((k) => k.split("|")[2]);
    const stages = [...new Set(keys.filter((k) => k !== "job-info").map((k) => k.split("_")[0]))];
    for (const st of stages) for (const v of [0, 1, 2]) {
      const sections = keys.filter((k) => k.startsWith(st + "_")).map((key) => {
        const t = latest.get(`construction_stage|${prop}|${key}`);
        // The construction answers as the earlier version of this test made them (no photos, defect lists or groups).
        const answers = answersFor(t.fields, v, 3);
        const d = flattenSectionToDraft(t.fields, answers, key, { inspectionType: "construction_stage", propertyType: prop });
        return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
      });
      const model = buildConstructionReport(sections, null, { apartment: prop === "apartment" });
      out[`construction_stage|${prop}|${st}|v${v}`] = renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSP, model, header: HEADER }));
    }
  }

  // Every other report type, except Pre-Purchase / Apartment: its cover, and each section's text, defects and printed section.
  const TITLES = { dilapidation: "Dilapidation", investigations: "Investigations", pre_purchase: "Pre-Purchase" };
  const PROPS = { residential_house: "Residential House", apartment: "Apartment", commercial_properties: "Commercial Properties", public_assets: "Public Assets" };
  const profiles = [...new Set([...latest.keys()].map((k) => k.split("|").slice(0, 2).join("|")))]
    .filter((p) => !p.startsWith("construction_stage|") && p !== "pre_purchase|apartment")
    .sort();
  for (const p of profiles) {
    const [inspectionType, propertyType] = p.split("|");
    const profile = { inspectionType, propertyType };
    const keys = [...latest.keys()].filter((k) => k.startsWith(`${p}|`)).map((k) => k.split("|")[2]).sort();
    for (const v of [0, 1, 2]) {
      const parts = [];
      const sections = keys.map((key, i) => {
        const t = latest.get(`${p}|${key}`);
        const answers = answersFor(t.fields, v);
        const d = key === "job-info" ? { reportText: "", damages: [], fields: answers } : flattenSectionToDraft(t.fields, answers, key, profile);
        parts.push(JSON.stringify({ key, reportText: d.reportText, damages: d.damages, fields: d.fields }));
        const photos = Object.values(answers).flat().filter((x) => typeof x === "string" && x.startsWith("/api/v1/media/"));
        return { id: `s${i}`, key, name: t.name, reviewStatus: "approved", reportText: d.reportText, answers, fields: d.fields, photos, damages: d.damages.map((x, j) => ({ id: `s${i}-d${j}`, ...x })) };
      });
      const insp = { id: "i", jobNo: "R", address: "1 Test St", suburb: "Testville", client: "C", inspectorId: "u", reviewerId: null, date: "2026-11-01", submittedAt: null, type: TITLES[inspectionType], propertyType: PROPS[propertyType], status: "submitted", overallProgress: 0, sections, notes: "", photoArchiveUrl: null };
      const header = { ...buildReportHeader(insp, { name: "I", licenseNumber: v === 0 ? "DBU 1" : v === 1 ? "" : "ARBV 2" }), reportDate: "1 Nov 2026" };
      parts.push(renderToStaticMarkup(createElement(ReportCover, { header })));
      for (const nov2026 of [false, true]) {
        parts.push(renderToStaticMarkup(createElement(PhotoNumberProvider, null, createElement(ReportWordingStyleContext.Provider, { value: { nov2026 } },
          ...sections.filter((s) => s.key !== "job-info").map((s) => createElement(ReportSection, { key: s.id, section: s }))))));
      }
      out[`${p}|v${v}`] = parts.join("\n");
    }
  }
  return out;
}
