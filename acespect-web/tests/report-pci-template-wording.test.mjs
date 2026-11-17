// The PCI / Handover report's wording against "ACESPECT PCI-Handover House & Unit Office Template Nov 2026.dotm" (fix/pci-template-wording):
// typed text inside sentences, the joining words, the "Windows and Doors" heading, Common Areas only on a unit, the progress line, item
// spelling, where the Part 2 ticks and the Defects list print, the construction line, the kerb note and the template's standard lines.
// Shared code, so the checks that apply to other stages run on every stage that has the same field.
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
const { buildConstructionReport, pciProgress, pciTopicOrder } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { ConstructionReportBody } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { KERB, KERB_PCI, TYPICAL_DEFECTS, placeOf } = await server.ssrLoadModule("/src/web/construction/compose.ts");
const { headingMap, headingOf, inline } = await server.ssrLoadModule("/src/web/construction/words.ts");
const { SECTION_ORDER, stageOfKey } = await server.ssrLoadModule("/src/web/construction/stages.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const templateOf = (key, prop) => SNAP.filter((t) => t.inspectionType === "construction_stage" && t.sectionKey === key && t.propertyType === prop).sort((a, b) => b.version - a.version)[0];
const keysOf = (prefix, prop) => SECTION_ORDER.filter((k) => k.startsWith(prefix) && templateOf(k, prop));

/** Every answer OK (the first green choice), so a test changes only what it is about. */
function okAnswers(fields) {
  const a = {};
  for (const f of fields) {
    if (f.type === "pill-select") a[f.key] = (f.options.find((o) => o.color === "#1FA463") ?? f.options[0]).value;
    if (f.type === "yesno") a[f.key] = "no";
  }
  return a;
}
const DESCRIPTION = {
  constructedBy: "simonds", design: "double_storey", constructionIs: "double_storey", foundations: "concrete_slab", groundCladding: ["brick_veneer"], firstCladding: ["not_applicable"],
  windowsAre: "aluminium", roofDesign: "pitched", roofCoveringIs: "concrete_tile", frontage: "east", blockSlope: "gently_sloping", supervisorOnSite: "yes", ownersOnSite: "yes", safetyIssues: "no",
};

function build({ prefix = "pci_", prop = "residential_house", patch = {}, jobInfo = { stageOptionPci: "handover_appliances_installed_or_some_installed" } } = {}) {
  const profile = { inspectionType: "construction_stage", propertyType: prop };
  const sections = keysOf(prefix, prop).map((key) => {
    const t = templateOf(key, prop);
    const answers = { ...okAnswers(t.fields), ...(key.endsWith("_description") ? DESCRIPTION : {}), ...(patch[key] ?? {}) };
    const d = flattenSectionToDraft(t.fields, answers, key, profile);
    return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
  });
  return buildConstructionReport(sections, jobInfo);
}
const HEADER = { reportDate: "1 Nov 2026", clientName: "C", yourReference: "", ourReference: "V1", property: "P", inspectionDate: "1 Nov 2026", weather: "Dry", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
const INSPECTION = { id: "i", jobNo: "V1", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Residential House", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const html = (model) => renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header: HEADER }));
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const defects = (m) => m.defectGroups.flatMap((g) => g.defects.map((d) => ({ ...d, group: g.heading })));
const defect = (key, value) => ({ [key]: "defect", [`${key}__defect`]: { location: "Rear", category: ["non_compliant_ncc_as"], severity: ["minor"], photos: ["/d.jpg"], comments: "probe comment" } });

/** Every stage and property type whose Description asks the field. */
const STAGES = [["pp_", "Pre-pour"], ["sd_", "Slab Down"], ["sf_", "Slab and Frame"], ["fr_", "Frame"], ["lu_", "Lock-up"], ["lf_", "Lock-up and Fixing"], ["fx_", "Fixing"], ["pci_", "PCI"]];
const PROPS = [["residential_house", "House"], ["apartment", "Apartment"]];
const withField = (field) => STAGES.flatMap(([prefix, name]) => PROPS.flatMap(([prop, propName]) => {
  const t = templateOf(`${prefix}description`, prop);
  return t?.fields.some((f) => f.key === field) ? [{ prefix, prop, label: `${name} ${propName}` }] : [];
}));

describe("1. what the inspector typed reads as part of the sentence", () => {
  it("inline(): no full stop of its own and a small first letter, except a name ('AAC', 'Bed 3 window')", () => {
    assert.equal(inline("Rendered foam cladding to the sides and rear."), "rendered foam cladding to the sides and rear");
    assert.equal(inline("  The front porch piers.  "), "the front porch piers");
    assert.equal(inline("AAC panels;"), "AAC panels");
    assert.equal(inline("Bed 3 window, left jamb."), "Bed 3 window, left jamb");
    assert.equal(inline("Level 1 balcony!"), "Level 1 balcony");
  });
  for (const s of withField("firstCladdingCombo")) {
    it(`${s.label}: the first floor's "combination of …" sits inside the cladding sentence`, () => {
      const m = build({ ...s, patch: { [`${s.prefix}description`]: { firstCladding: ["combination_of"], firstCladdingCombo: "Rendered foam cladding to the front elevation and painted fibre cement sheet to the sides and rear." } } });
      assert.ok(m.description.includes("Wall cladding is constructed of brick veneer to the ground floor and rendered foam cladding to the front elevation and painted fibre cement sheet to the sides and rear to the first floor."), m.description.join("\n"));
    });
  }
  for (const s of withField("groundCladdingCombo")) {
    it(`${s.label}: the ground floor's "combination of …" too`, () => {
      const m = build({ ...s, patch: { [`${s.prefix}description`]: { groundCladding: ["combination_of"], groundCladdingCombo: "Brick veneer and Hebel panels." } } });
      assert.ok(m.description.some((l) => l.startsWith("Wall cladding is constructed of brick veneer and Hebel panels")), m.description.join("\n"));
      assert.ok(!m.description.some((l) => /\.\s+to the|\.\./.test(l)));
    });
  }
  for (const s of withField("safetyDescribe")) {
    it(`${s.label}: the safety matters carry on the sentence after the dash`, () => {
      const m = build({ ...s, patch: { [`${s.prefix}description`]: { safetyIssues: "yes", safetyDescribe: "The rear sliding door opens onto a 550 mm drop. The door was taped off" } } });
      assert.ok(m.description.includes("Safety issues were noted on site — the rear sliding door opens onto a 550 mm drop. The door was taped off."), m.description.join("\n"));
    });
  }
  it("the security fencing detail sits inside its sentence (Pre-pour)", () => {
    const m = build({ prefix: "pp_", jobInfo: null, patch: { pp_summary: { notesToInclude: ["security_fencing"], securityFencingDetail: "Partly down at the rear." } } });
    assert.ok(m.notes.includes("Security fencing is partly down at the rear and needs to be reinstated."), m.notes.join("\n"));
  });
  it("a defect's comments, a Defects-list row, the Summary's other concerns and the previous / client updates start with a capital", () => {
    const m = build({ patch: {
      pci_roof: defect("roof_gutters"), pci_defects: { defects: [{ location: "Study", description: "door binds on the frame", photos: ["/x.jpg"] }] },
      pci_summary: { otherConcerns: "owners asked about the step" },
      pci_previous_defects: { previousDefectsStatus: "attached", previousDefectsUpdates: "all done", previousDefectsPhotos: [] },
      pci_client_issues: { clientListStatus: "attached", clientListUpdates: "items 1–3 checked", clientListPhotos: [] },
    } });
    const ds = defects(m);
    assert.match(ds.find((d) => d.sectionKey === "pci_roof").description, /Probe comment\.$/);
    assert.equal(ds.find((d) => d.sectionKey === "pci_defects").description, "Door binds on the frame.");
    assert.ok(m.notes.includes("Owners asked about the step."));
    assert.equal(m.previous.text, "All done");
    assert.equal(m.clientConcerns.text, "Items 1–3 checked");
  });
});

describe("2. the joining word between a Part 2 tick and what the inspector typed", () => {
  for (const [prop, propName] of PROPS) {
    const t = templateOf("pci_typical_defects", prop);
    const follow = t.fields.filter((f) => /_at$/.test(f.key) && f.type === "text");
    it(`${propName}: every "… at …" follow-up is found`, () => assert.ok(follow.length >= (prop === "apartment" ? 2 : 3), follow.map((f) => f.key).join()));
    for (const f of follow) {
      const opt = f.key.replace(/_at$/, "");
      const tick = t.fields.find((x) => x.type === "chip-multiselect" && x.options.some((o) => o.value === opt));
      const label = tick.options.find((o) => o.value === opt).label;
      it(`${propName} ${opt}: "${label} at …", and "at" is not written twice`, () => {
        const one = (typed) => defects(build({ prop, patch: { pci_typical_defects: { [tick.key]: [opt], [f.key]: typed, [`${opt}_pics`]: ["/p.jpg"] } } })).find((d) => d.sectionKey === "pci_typical_defects").description;
        assert.equal(one("The front porch piers."), `${label} at the front porch piers.`);
        assert.equal(one("at the rear corner"), `${label} at the rear corner.`);
        assert.equal(one("Bed 3 window, left jamb"), `${label} at Bed 3 window, left jamb.`);
      });
    }
  }
});

describe("3. the PCI house form's 'Doors, etc' prints as 'Windows and Doors'", () => {
  const m = build({ patch: { pci_walls_doors: defect("doors_sliding_doors_bi_fold_tracks_clean_loc") } });
  const h = html(m);
  it("in the checklist and in Identified Defects", () => {
    const groups = m.tables.find((t) => t.sectionKey === "pci_walls_doors").groups.map((g) => g.heading);
    assert.ok(groups.includes("Windows and Doors"), groups.join());
    assert.ok(m.defectGroups.some((g) => g.heading === "Windows and Doors"));
    assert.doesNotMatch(text(h), /Doors, etc/i);
  });
});

describe("4. Common Areas print only on a unit / apartment report", () => {
  it("House: no COMMON AREAS checks", () => {
    const m = build();
    assert.ok(!m.tables.some((t) => t.groups.some((g) => /common area/i.test(g.heading ?? ""))));
    assert.doesNotMatch(text(html(m)), /common areas/i);
  });
  it("House: a defect recorded against a common area still prints", () => {
    const m = build({ patch: { pci_garage_site: defect("common_driveway_carpark") } });
    assert.equal(defects(m).length, 1);
  });
  it("Apartment: the Common Areas checks print", () => {
    const m = build({ prop: "apartment" });
    assert.ok(m.tables.some((t) => t.groups.some((g) => /common area/i.test(g.heading ?? ""))));
  });
});

describe("5. the progress line, as the PCI template words it, for each Stage choice", () => {
  const cases = [
    ["practical_completion_appliances_not_yet_installed", "Progress of the works to date is approaching practical completion."],
    ["handover_appliances_installed_or_some_installed", "Progress of the works to date is approaching handover."],
    ["off_the_plan_handover_appliances_are_installed", "Progress of the works to date is approaching handover."],
    ["defects_liability_after_handover_and_now_occupied", "The works are within the defects liability period."],
  ];
  for (const [choice, line] of cases) it(choice, () => assert.ok(build({ jobInfo: { stageOptionPci: choice } }).description.includes(line)));
  it("no choice: the template's line as it is", () => {
    assert.ok(build({ jobInfo: null }).description.includes("Progress of the works to date is approaching practical completion / handover / defects liability."));
    assert.equal(pciProgress("something else"), "Progress of the works to date is approaching practical completion / handover / defects liability.");
  });
});

describe("6. item names are spelled as the template spells them", () => {
  it("'Eave linings / soffit' (the form: 'sofitt'), and no 'finsishes'", () => {
    assert.equal(headingOf("Eave linings / sofitt; holes filled, painted"), "Eave linings / soffit");
    const h = text(html(build({ patch: { pci_roof: defect("roof_eave_linings_sofitt_holes_filled_paint") } })));
    assert.match(h, /Eave Linings \/ Soffit/);
    assert.doesNotMatch(h, /sofitt|finsishes/i);
  });
  it("no checklist name in any Construction stage carries either misspelling", () => {
    const names = SNAP.filter((t) => t.inspectionType === "construction_stage" && stageOfKey(t.sectionKey)).flatMap((t) => [...headingMap(t.fields).values()]);
    assert.ok(names.length > 500);
    assert.deepEqual(names.filter((n) => /sofitt|finsishes/i.test(n)), []);
  });
});

describe("7. the Part 2 ticks and the Defects list print under their place, with no repeated heading", () => {
  const house = templateOf("pci_typical_defects", "residential_house");
  const apartment = templateOf("pci_typical_defects", "apartment");
  const options = [...house.fields, ...apartment.fields].filter((f) => f.type === "chip-multiselect").flatMap((f) => f.options.map((o) => o.value));
  it("every tick on the house and unit forms has a place", () => assert.deepEqual([...new Set(options)].filter((o) => !TYPICAL_DEFECTS[o]), []));
  it("each tick prints under its place, with its sentence as the numbered line and no bold line of its own", () => {
    const ticks = Object.fromEntries(house.fields.filter((f) => f.type === "chip-multiselect").map((f) => [f.key, f.options.map((o) => o.value)]));
    const pics = Object.fromEntries(Object.values(ticks).flat().map((o) => [`${o}_pics`, ["/p.jpg"]]));
    const m = build({ patch: { pci_typical_defects: { ...ticks, ...pics } } });
    const ds = defects(m).filter((d) => d.sectionKey === "pci_typical_defects");
    assert.equal(ds.length, Object.values(ticks).flat().length);
    for (const d of ds) {
      assert.equal(d.heading, "", d.description);
      assert.ok(!/^General$/.test(d.group) || /^All /.test(d.description), `${d.description} -> ${d.group}`);
    }
    const under = (start) => ds.find((d) => d.description.startsWith(start))?.group;
    assert.equal(under("Building debris to be cleaned from gutter"), "Roof");
    assert.equal(under("Downpipe connectors"), "Roof");
    assert.equal(under("Sections of brickwork"), "Walls");
    assert.equal(under("Ensure gaps at pipe penetrations"), "Walls");
    assert.equal(under("Excess paint to be cleaned from front door"), "Front door");
    assert.equal(under("Caulking to be completed at kitchen benches"), "Kitchen & Pantry");
    assert.equal(under("Bed 2 marks"), "Bedroom 2");
    assert.equal(under("Sliding doors tracks"), "Windows and Doors");
    assert.equal(under("Scrape and clean garage hardstand."), "Garage / Carport");
    assert.equal(under("Clean porch slab."), "Porch");
    assert.equal(under("Grouting is poorly finished"), "Finishes");
    assert.equal(under("Floor coverings are marked"), "Finishes");
    // The rendered report: no tick's name printed above its own sentence.
    const h = text(html(m));
    assert.doesNotMatch(h, /Bed 2 marks and blemishes need clean and paint touch ups \d+ Bed 2 marks/);
  });
  it("a tick joins the checklist's own heading for the same place (one Roof, one Walls)", () => {
    const m = build({ patch: { pci_roof: defect("roof_gutters"), pci_typical_defects: { typicalExternal: ["gutter_debris"], gutter_debris_pics: ["/p.jpg"] } } });
    assert.deepEqual(m.defectGroups.map((g) => g.heading), ["Roof"]);
    assert.deepEqual(m.defectGroups[0].defects.map((d) => d.no), [1, 2]);
  });
  it("a Defects-list row goes under the place its location names first; a row that names none stays under General", () => {
    const rows = [
      { location: "Garage, internal access door", description: "Door not self-closing", photos: ["/a.jpg"] },
      { location: "Kitchen", description: "Bench chipped", photos: [] },
      { location: "Somewhere", description: "Something", photos: [] },
    ];
    const alone = build({ patch: { pci_defects: { defects: rows } } });
    assert.deepEqual(alone.defectGroups.map((g) => g.heading), ["Garage / Carport", "Kitchen & Pantry", "General"]);
    // With a garage defect in the checklist, it joins that heading.
    const withGarage = build({ patch: { pci_garage_site: defect("garage_driveway_concrete_ok_drains_correct"), pci_defects: { defects: rows.slice(0, 1) } } });
    assert.deepEqual(withGarage.defectGroups.map((g) => g.heading), ["Garage"]);
    assert.equal(placeOf("Level 1, Bed 2 robe"), "Bedroom 2");
    assert.equal(placeOf("Roof space above Bed 3"), "Manhole, Roof Cavity, Insulation");
  });
  it("the headings print in the checklist's order (rooms after Internal, in the Rooms order), General last", () => {
    const ticks = Object.fromEntries(house.fields.filter((f) => f.type === "chip-multiselect").map((f) => [f.key, f.options.map((o) => o.value)]));
    const m = build({ patch: {
      pci_roof: defect("roof_gutters"), pci_walls_doors: defect("walls_mortar_perps_beds_too_wide_narrow_crac"), pci_garage_site: defect("site_landscaping"),
      pci_internal: defect("internal_laundry"), pci_finishes: defect("finishes_carpets_stretched_and_fitted"), pci_services: { ...defect("services_water_supply_on"), ...defect("other_party_walls") },
      pci_typical_defects: ticks, pci_defects: { defects: [{ location: "Study desk nook", description: "Shelf loose", photos: [] }, { location: "Somewhere", description: "Something", photos: [] }] },
    } });
    assert.deepEqual(m.defectGroups.map((g) => g.heading), [
      "Roof", "Walls", "Windows and Doors", "Porch", "Garage / Carport", "Alfresco / Balcony", "Site", "Internal", "Front door", "Hallway & Entry", "Kitchen & Pantry",
      "Bedroom 1 & Ensuite", "Bedroom 2", "Bedroom 3", "Study", "Finishes", "Utilities - Services", "Other", "General",
    ]);
    // Numbered in the order they print.
    assert.deepEqual(m.defectGroups.flatMap((g) => g.defects.map((d) => d.no)), Array.from({ length: m.defectCount }, (_, i) => i + 1));
    // A heading the order does not know stays after the one printed before it; General is last.
    assert.deepEqual(pciTopicOrder(["General", "Roof", "Something new", "Bedroom 2", "Internal"]), ["Roof", "Something new", "Internal", "Bedroom 2", "General"]);
  });
  it("other stages keep their Defects list under General", () => {
    const m = build({ prefix: "fr_", jobInfo: null, patch: { fr_defects: { defects: [{ location: "Garage", description: "Plate cut", photos: [] }] } } });
    assert.deepEqual(m.defectGroups.map((g) => g.heading), ["General"]);
  });
});

describe("8. the construction line", () => {
  it("PCI house: '… double storey residential house.' then 'Foundations are …'", () => {
    const d = build().description;
    assert.ok(d.includes("The construction is a double storey residential house."), d.join("\n"));
    assert.ok(d.includes("Foundations are concrete slab."));
  });
  it("PCI apartment and the other stages keep their own templates' line", () => {
    assert.ok(build({ prop: "apartment" }).description.some((l) => /^The construction is a .+ apartment/.test(l)));
    assert.ok(build({ prefix: "fr_", jobInfo: null }).description.includes("The construction is a double storey on a concrete slab."));
  });
});

describe("9. the kerb damage note", () => {
  it("PCI: the PCI template's wording", () => {
    const m = build({ patch: { pci_site_facilities: { kerbDamage: "see_notes" } } });
    assert.ok(m.notes.includes(KERB_PCI));
    assert.equal(KERB_PCI, "Damage was noted to the footpath/kerbs/vehicle crossover/nature strip. Usually, such damage is attended to at the end of the project and arranged between the construction company and the local authority.");
  });
  it("Frame: its own template's wording, unchanged", () => {
    const t = templateOf("fr_site_facilities", "residential_house");
    const kerb = t.fields.find((f) => f.key === "kerbDamage");
    const bad = kerb.options.find((o) => o.color !== "#1FA463").value;
    const m = build({ prefix: "fr_", jobInfo: null, patch: { fr_site_facilities: { kerbDamage: bad } } });
    assert.ok(m.notes.includes(KERB));
    assert.ok(!m.notes.includes(KERB_PCI));
  });
});

describe("10. the template's standard lines, word for word", () => {
  const lines = {
    pipe_penetrations: "Ensure gaps at pipe penetrations are sealed/caulked when appliances are fitted off.",
    garage_slab: "Scrape and clean garage hardstand.",
    porch_slab: "Clean porch slab.",
    windows_doors_cleaned: "All windows and doors to be cleaned and detailed.",
    windows_floor_cleaned: "All windows, tiles and floor coverings to be cleaned and detailed.",
    benchtops_cleaned: "All benchtops and vanities to be cleaned and detailed.",
  };
  const t = templateOf("pci_typical_defects", "residential_house");
  for (const [opt, line] of Object.entries(lines)) {
    it(opt, () => {
      const tick = t.fields.find((f) => f.type === "chip-multiselect" && f.options.some((o) => o.value === opt));
      const d = defects(build({ patch: { pci_typical_defects: { [tick.key]: [opt] } } }));
      assert.equal(d.length, 1);
      assert.equal(d[0].description, line);
      assert.match(text(html(build({ patch: { pci_typical_defects: { [tick.key]: [opt] } } }))), new RegExp(line.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
    });
  }
});
