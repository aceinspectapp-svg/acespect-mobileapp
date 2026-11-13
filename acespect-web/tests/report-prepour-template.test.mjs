// The Pre-pour Construction Stage report against the Nov 2026 office template ("ACESPECT Pre-pour_Office Template Nov 2026.dotm"):
// its page breaks, notes (each once, and one for every "Refer notes" row), the template's fixed sentences, "Item — Location." defects,
// no Previous Defects in the first stage, the inspector's registration, and the template's terms.
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
const { buildConstructionReport, uniqueNotes, PRE_POUR_INTRO, SETBACK_NOTE } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { GROUND_FALLS, POWER_SUPPLY_OK, KITCHEN_BENCH_FIXED } = await server.ssrLoadModule("/src/web/construction/compose.ts");
const { ConstructionReportBody, Cover } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { CONSTRUCTION_AGREEMENT_BLOCKS, CONSTRUCTION_AGREEMENT_TITLE } = await server.ssrLoadModule("/src/web/construction/agreementText.ts");
const { AGREEMENT_BLOCKS } = await server.ssrLoadModule("/src/web/reportAgreement.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const templateOf = (key, prop = "residential_house") => SNAP.filter((t) => t.sectionKey === key && t.propertyType === prop).sort((a, b) => b.version - a.version)[0];
const PROFILE = { inspectionType: "construction_stage", propertyType: "residential_house" };

/** Every answer OK (the first green choice), so a test changes only what it is about. */
function okAnswers(fields) {
  const a = {};
  for (const f of fields) {
    if (f.type === "pill-select") a[f.key] = (f.options.find((o) => o.color === "#1FA463") ?? f.options[0]).value;
    if (f.type === "yesno") a[f.key] = "yes";
  }
  return a;
}
const PP = ["pp_description", "pp_site_facilities", "pp_measurements", "pp_formwork", "pp_general", "pp_defects", "pp_summary", "pp_client_issues"];

function build(patch = {}, keys = PP) {
  const sections = keys.map((key) => {
    const t = templateOf(key);
    const answers = { ...okAnswers(t.fields), ...(patch[key] ?? {}) };
    const d = flattenSectionToDraft(t.fields, answers, key, PROFILE);
    return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
  });
  return buildConstructionReport(sections, null);
}
const items = (model) => model.tables.flatMap((t) => t.groups.flatMap((g) => g.items));
const item = (model, re) => items(model).find((i) => re.test(i.heading));

const HEADER = { reportDate: "1 Nov 2026", clientName: "C", yourReference: "", ourReference: "V1", property: "P", inspectionDate: "1 Nov 2026", weather: "Dry", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
const INSPECTION = { id: "i", jobNo: "V1", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const render = (model, header = HEADER) => renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

describe("Pre-pour: page breaks follow the template", () => {
  const defectAnswer = { slabDimensions: "defect", slabDimensions__defect: { location: "Front left", photos: ["/a.jpg"] } };
  const html = render(build({ pp_formwork: defectAnswer, pp_site_facilities: { securityFencing: "no_see_notes" } }));

  it("starts only the General Description (after the cover), the checklist and the terms on a new page", () => {
    const breaks = [...html.matchAll(/<div[^>]*class="report-page-break"[^>]*>([\s\S]{0,1500})/g)].map((m) => text(m[1]).trim().slice(0, 60));
    assert.equal(breaks.length, 3, breaks.join(" | "));
    assert.match(breaks[0], /^General Description/i);
    assert.match(breaks[1], /^Inspection Checklist/i);
    assert.match(breaks[2], /CONDITIONS FOR THE PROVISION OF THE REPORT AND SCOPE/);
  });

  it("does not force a new page for Identified Defects or Notes, and keeps each heading with its first item", () => {
    const keepWith = (heading, first) => {
      // the smallest break-inside: avoid wrapper that holds the heading also holds its first item
      const at = html.indexOf(heading);
      assert.ok(at > 0, heading);
      const open = html.lastIndexOf('<div style="break-inside:avoid"', at);
      assert.ok(open !== -1, `${heading} sits in a keep-together wrapper`);
      const firstAt = html.indexOf(first, at);
      assert.ok(firstAt !== -1, `${first} follows ${heading}`);
      // no closing of that wrapper between the heading and its first item: count the divs opened and closed in between
      const between = html.slice(open, firstAt);
      const depth = (between.match(/<div/g) ?? []).length - (between.match(/<\/div>/g) ?? []).length;
      assert.ok(depth > 0, `${heading} is kept on one page with ${first}`);
    };
    keepWith("Identified Defects Requiring Attention", ">Front left<");
    keepWith(">Front left<", "Slab Formwork Dimensions. Please refer to Photograph");
    keepWith(">Notes<", "The finish and workmanship of the set out for the slab");
    keepWith(">Client Concerns<", "Concerns listed by the client");
    assert.doesNotMatch(html, /report-page-break"[^>]*id="defects"|id="defects"[^>]*report-page-break/);
  });

  it("keeps the checklist's sub-headings and table titles with their first row", () => {
    for (const t of build().tables) {
      const at = html.indexOf(`>${t.title}<`);
      if (at === -1) continue;
      const open = html.lastIndexOf('<div style="break-inside:avoid"', at);
      assert.ok(open !== -1 && html.slice(open, at).split("<div").length - html.slice(open, at).split("</div>").length > 0, `${t.title} is kept with its first row`);
    }
  });
});

describe("Pre-pour: each note once", () => {
  it("prints the security fence note once when Site & Facilities and the Statements & Notes tick both ask for it", () => {
    const model = build({ pp_site_facilities: { securityFencing: "no_see_notes" }, pp_summary: { notesToInclude: ["security_fencing"] } });
    assert.equal(model.notes.filter((n) => /^Sections of the security fence/.test(n)).length, 1, model.notes.join(" | "));
  });

  it("keeps the inspector's own fence detail over the standard sentence", () => {
    const model = build({ pp_site_facilities: { securityFencing: "no_see_notes" }, pp_summary: { notesToInclude: ["security_fencing"], securityFencingDetail: "down at the rear" } });
    assert.deepEqual(model.notes.filter((n) => /^(Security fencing is|Sections of the security fence)/.test(n)), ["Security fencing is down at the rear and needs to be reinstated."]);
  });

  it("prints the ground-falls note once when General Other and the tick both ask for it", () => {
    const model = build({ pp_general: { siteDrainage: "yes_defect", agiDrain: "yes_recommend_refer_to_notes" }, pp_summary: { notesToInclude: ["ground_falls"] } });
    assert.equal(model.notes.filter((n) => n === GROUND_FALLS).length, 1);
  });

  it("drops any sentence repeated from two sources", () => {
    assert.deepEqual(uniqueNotes(["A note.", "B note.", "a note.", "Sections of the security fence are down.", "Security fencing is x and needs to be reinstated."]), ["A note.", "B note.", "Sections of the security fence are down."]);
    // a note that only mentions security fencing in passing is not the fence note
    const standing = "We also inspect the site management to ensure there is security fencing, power and water are onsite.";
    assert.deepEqual(uniqueNotes([standing, "Sections of the security fence are not in position and need to be re-instated."]).length, 2);
  });
});

describe("Pre-pour: the template's fixed sentences", () => {
  const model = build();
  it("prints 'These items were checked for construction and workmanship.' above the first Pre-pour checks, once", () => {
    const withIntro = model.tables.filter((t) => t.intro === PRE_POUR_INTRO);
    assert.equal(withIntro.length, 1);
    assert.equal(withIntro[0].sectionKey, "pp_measurements");
    assert.equal(model.tables.find((t) => t.sectionKey === "pp_site_facilities").intro, undefined, "not on Site & Facilities");
  });

  it("prints the land surveying note, word for word, after the setbacks", () => {
    const t = model.tables.find((x) => x.sectionKey === "pp_measurements");
    assert.equal(t.footnote, SETBACK_NOTE);
    assert.match(SETBACK_NOTE, /^Houspect Building Inspector is not a providing a land surveying service therefore the comments are observations by the inspector only\. Note; pegs on site/);
    assert.match(text(render(model)), /Houspect Building Inspector is not a providing a land surveying service/);
  });

  it("prints the kitchen bench sentence above the inspector's comment, whatever the answer", () => {
    assert.equal(item(model, /^Kitchen bench/i).text, `${KITCHEN_BENCH_FIXED} Checked and okay.`);
    assert.equal(item(build({ pp_formwork: { kitchenBenchPenetrations: "no_defect" } }), /^Kitchen bench/i).text, `${KITCHEN_BENCH_FIXED} Refer defects.`);
  });

  it("prints 'Meter & Pole at Slab' for a power supply in place, the note reference otherwise", () => {
    assert.equal(item(model, /^Power supply/i).text, POWER_SUPPLY_OK);
    assert.equal(item(build({ pp_site_facilities: { powerSupply: "no_see_notes" } }), /^Power supply/i).text, "Refer notes.");
  });

  it("prints 'Boundary survey pegs visible at ….' as the template words it", () => {
    const m = build({ pp_measurements: { boundaryPegs: ["front", "rear"] } });
    assert.equal(item(m, /^Boundary survey pegs/i).text, "Boundary survey pegs visible at front and rear.");
  });

  it("does not print the template's highlighted staff notes", () => {
    assert.doesNotMatch(text(render(model)), /Staff note|Staff Note|Reviewer to|Admin if|Admin;/);
  });
});

describe("Pre-pour: every 'Refer notes' row leads to a note", () => {
  const TEMPLATE_NOTE = {
    "Security fencing in place": /^Sections of the security fence are not in position/,
    "Is the site well managed": /^Site needs a clean-up of rubbish/,
    "Damage to kerb / path / crossover": /^Damage was noted to the footpath/,
    "Recommend agi drain/s": /^Due to ground falls towards the slab/,
  };
  for (const key of ["pp_site_facilities", "pp_measurements", "pp_formwork", "pp_general"]) {
    const t = templateOf(key);
    for (const f of t.fields.filter((x) => x.type === "pill-select")) {
      for (const o of f.options) {
        it(`${key} ${f.key} = ${o.value}`, () => {
          const model = build({ [key]: { [f.key]: o.value } });
          for (const it of items(model).filter((i) => i.status === "note")) {
            const expected = TEMPLATE_NOTE[it.heading];
            const found = expected ? model.notes.some((n) => expected.test(n)) : model.notes.some((n) => n.startsWith(`${it.heading}`));
            assert.ok(found, `"${it.heading}" says Refer notes but no note leads from it: ${model.notes.join(" | ")}`);
          }
        });
      }
    }
  }

  it("prints the ground-falls note for a drainage defect and for 'Recommend agi drain/s'", () => {
    assert.ok(build({ pp_general: { siteDrainage: "yes_defect" } }).notes.includes(GROUND_FALLS));
    assert.ok(build({ pp_general: { agiDrain: "yes_recommend_refer_to_notes" } }).notes.includes(GROUND_FALLS));
    assert.ok(!build().notes.includes(GROUND_FALLS), "not when the site drains and no agi drain is recommended");
  });

  it("words the other notes with the row's name and the inspector's answer", () => {
    assert.ok(build({ pp_formwork: { excessWater: "could_not_see" } }).notes.includes("Excess water to footings — could not see."));
    assert.ok(build({ pp_formwork: { garageSlab: "infill_later_refer_notes" } }).notes.includes("Garage slab formed — infill later."));
    assert.ok(build({ pp_measurements: { frontResult: "builder_to_recheck", frontPlan: "1500", frontSite: "1680", frontDatum: "footpath" } }).notes.some((n) => /^Front setback — as estimated using the footpath\..*Builder to re-check\.$/.test(n)));
  });
});

describe("Defects as the template writes them: the location in bold, then the numbered description and its photographs", () => {
  const defects = (model) => model.defectGroups.flatMap((g) => g.defects);
  const photos = (n, from = 0) => Array.from({ length: n }, (_, i) => `/p${from + i}.jpg`);

  it("prints a Defects-list entry with its location as the heading and its description as the numbered line", () => {
    const model = build({ pp_defects: { defects: [{ location: "Front right corner", description: "There isn't major damage, but it needs to be repaired.", photos: photos(22) }] } });
    const d = defects(model).find((x) => x.sectionKey === "pp_defects");
    assert.equal(d.heading, "Front right corner");
    assert.equal(d.description, "There isn't major damage, but it needs to be repaired.");
    const out = text(render(model));
    assert.match(out, new RegExp(`Front right corner ${d.no} There isn't major damage, but it needs to be repaired\\. Please refer to Photographs \\d+ to \\d+\\.`));
  });

  it("does not make an item name out of the description any more", () => {
    const model = build({ pp_defects: { defects: [{ location: "Porch", description: "Edge beam cracked. Needs repair.", photos: photos(1) }] } });
    const d = defects(model).find((x) => x.sectionKey === "pp_defects");
    assert.deepEqual([d.heading, d.description], ["Porch", "Edge beam cracked. Needs repair."]);
    assert.doesNotMatch(text(render(model)), /Edge beam cracked — Porch/);
  });

  it("prints a checklist row's defect under its location, the row and the inspector's comments as the numbered line", () => {
    const model = build({ pp_formwork: { slabDimensions: "defect", slabDimensions__defect: { location: "Front left", comments: "Overhang too short", photos: photos(2) } } });
    const d = defects(model)[0];
    assert.deepEqual([d.heading, d.description], ["Front left", "Slab formwork dimensions. Overhang too short."]);
  });

  it("uses the checklist item as the heading when no location was recorded", () => {
    const model = build({ pp_formwork: { formworkBowed: "yes_defect", formworkBowed__defect: { comments: "Bowed at the rear", photos: photos(1) } } });
    const d = defects(model)[0];
    assert.deepEqual([d.heading, d.description], ["Formwork bowed", "Bowed at the rear."]);
  });

  it("writes 'Please refer to Photograph X.' for one photo, and has no separate Photographs line", () => {
    const model = build({ pp_defects: { defects: [{ location: "Garage", description: "Pegs loose.", photos: photos(1) }] } });
    const out = text(render(model));
    assert.match(out, /Garage \d+ Pegs loose\. Please refer to Photograph \d+\./);
    assert.doesNotMatch(out, /Photographs: \d/);
  });

  it("numbers each defect's photographs with its own photo numbers", () => {
    const model = build({ pp_defects: { defects: [{ location: "A", description: "First.", photos: photos(3) }, { location: "B", description: "Second.", photos: photos(2, 10) }] } });
    const out = text(render(model));
    const refs = [...out.matchAll(/Please refer to Photographs (\d+) to (\d+)\./g)].map((m) => [+m[1], +m[2]]);
    const [first, second] = refs.slice(-2);
    assert.equal(first[1] - first[0] + 1, 3);
    assert.equal(second[1] - second[0] + 1, 2);
    assert.equal(second[0], first[1] + 1);
    // and the "Photo N" captions under each defect are those same numbers
    assert.match(out, new RegExp(`Photo ${second[0]} .*Photo ${second[1]}`));
  });
});

describe("Previous Defects", () => {
  it("is never printed in the Pre-pour report", () => {
    assert.doesNotMatch(text(render(build())), /Previous Defects/i);
  });

  it("is printed in a later stage only when a previous report's defects are attached", () => {
    const keys = ["sd_description", "sd_site_facilities", "sd_previous_defects"];
    const sd = (patch) => build(patch, keys);
    assert.doesNotMatch(text(render(sd({ sd_previous_defects: { previousDefectsStatus: "n_a" } }))), /Previous Defects/i);
    assert.match(text(render(sd({ sd_previous_defects: { previousDefectsStatus: "attached", previousDefectsUpdates: "Defect 3 rectified." } }))), /Previous Defects.*Defect 3 rectified/i);
  });
});

describe("Cover", () => {
  const cover = (registration) => text(renderToStaticMarkup(createElement(Cover, { r: { ...HEADER, inspectorRegistration: registration }, model: build(), inspection: INSPECTION })));
  it("prints the inspector's registration as the template words it", () => {
    assert.match(cover("DBU 58070"), /Joe Briffa \(Builder Registration No DBU 58070\)/);
    assert.match(cover("ARBV 13238"), /Joe Briffa \(Architect Registration No ARBV 13238\)/);
    assert.doesNotMatch(cover("DBU 58070"), /Registration No\. /);
  });
  it("labels the weather 'Weather Conditions'", () => {
    assert.match(cover("DBU 58070"), /Weather Conditions/i);
  });
});

describe("Terms: the template's Conditions for the Provision of the Report and Scope", () => {
  const B = CONSTRUCTION_AGREEMENT_BLOCKS;
  it("has the four opening paragraphs, then clauses 1 to 19", () => {
    assert.equal(CONSTRUCTION_AGREEMENT_TITLE, "CONDITIONS FOR THE PROVISION OF THE REPORT AND SCOPE");
    assert.deepEqual(B.slice(0, 4).map((b) => [b.kind, b.text.slice(0, 18)]), [["para", "WHEREAS: The Clien"], ["para", "Payment is due by "], ["para", "This Agreement is "], ["para", "Standards and guid"]]);
    const sections = B.filter((b) => b.kind === "section");
    assert.deepEqual(sections.map((s) => s.n), Array.from({ length: 19 }, (_, i) => String(i + 1)));
    assert.equal(sections[3].title, "SCOPE OF INSPECTION");
    assert.equal(sections[18].title, "PRIVACY");
  });
  it("has clause 4's sub-headings", () => {
    assert.deepEqual(B.filter((b) => b.kind === "subheading").map((b) => b.text), ["Structural Defect Inspections", "Standards and Guide", "Construction Stage Inspections", "Progress Inspections", "Pre-Handover and Defects Inspections", "Access and Site Conditions", "Inspection Limits and Exclusions"]);
  });
  it("numbers its clauses as the template's own cross-references do", () => {
    const clause = (n) => B.find((b) => b.kind === "clause" && b.n === n).text;
    assert.match(clause("4.11"), /^AS 4349\.0–2007 states that it does not include assessment of a building under construction/);
    assert.match(clause("5.7"), /^The Guide:/);
    assert.match(clause("17.2"), /^This Agreement is sent to the Client with the Quotation email/);
  });
  it("is not the Dilapidation agreement", () => {
    assert.notDeepEqual(B, AGREEMENT_BLOCKS);
  });
  it("replaces the old SCOPE and 21 conditions in the report, on a page of its own", () => {
    const out = text(render(build()));
    assert.match(out, /CONDITIONS FOR THE PROVISION OF THE REPORT AND SCOPE/);
    assert.doesNotMatch(out, /PURPOSE OF INSPECTION|LIMITATIONS OF STANDARD/);
  });
});

describe("Signature on the first page", () => {
  it("draws the handwritten signature above the director's name on the Construction cover", () => {
    const html = renderToStaticMarkup(createElement(Cover, { r: HEADER, model: build(), inspection: INSPECTION }));
    assert.match(html, /<img data-cover="sig-image" src="\/houspect-signature\.png"/);
    assert.ok(html.indexOf('data-cover="sig-image"') < html.indexOf("Dinuke De Coonghe"), "the signature sits above the name");
  });
  it("draws it on the Dilapidation cover too", async () => {
    const { ReportCover } = await server.ssrLoadModule("/src/web/components/ReportCover.tsx");
    const html = renderToStaticMarkup(createElement(ReportCover, { header: { ...HEADER, signatureName: "Dinuke De Coonghe", signatureTitle: "Director – Houspect Victoria" } }));
    assert.match(html, /<img data-cover="sig-image" src="\/houspect-signature\.png"/);
  });
});
