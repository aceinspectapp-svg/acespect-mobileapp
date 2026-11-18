// The PCI / Handover Apartment report against "ACESPECT PCI-Handover Apartment_multi storey Office Template Nov 2026.dotm"
// (fix/pci-apartment-wording): the construction line, brand names, the full stop after an item's name, Part 2 tick sentences, the
// windows line, common-area defects, the BASEMENT grouping, the Multi-level Complex row and the template's Apartment sentences. Points
// 1, 7, 8 and 9 apply to Apartment reports only; the House report is checked to be as it was.
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
const { buildConstructionReport, pciTopicOrder, APARTMENT_ROOF_NOTE, APARTMENT_COMMON_AREAS_NOTE, APARTMENT_COMMON_AREA_NOTES } = await server.ssrLoadModule("/src/web/construction/reportModel.ts");
const { ConstructionReportBody } = await server.ssrLoadModule("/src/web/construction/ConstructionReport.tsx");
const { TILES_CLEANED, TYPICAL_DEFECTS, placeOf } = await server.ssrLoadModule("/src/web/construction/compose.ts");
const { inline, PROPER_NAMES } = await server.ssrLoadModule("/src/web/construction/words.ts");
const { withItemName } = await server.ssrLoadModule("/src/web/construction/printCase.ts");
const { SECTION_ORDER } = await server.ssrLoadModule("/src/web/construction/stages.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");

const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
const templateOf = (key, prop) => SNAP.filter((t) => t.inspectionType === "construction_stage" && t.sectionKey === key && t.propertyType === prop).sort((a, b) => b.version - a.version)[0];
const keysOf = (prop) => SECTION_ORDER.filter((k) => k.startsWith("pci_") && templateOf(k, prop));

function okAnswers(fields) {
  const a = {};
  for (const f of fields) {
    if (f.type === "pill-select") a[f.key] = (f.options.find((o) => o.color === "#1FA463") ?? f.options[0]).value;
    if (f.type === "yesno") a[f.key] = "no";
  }
  return a;
}
const DESCRIPTION = {
  apartment: { constructedBy: "mirvac", design: "split_level", foundations: "concrete_slab", groundCladding: ["concrete_panels", "hebel"], firstCladding: ["not_applicable"], windowsAre: "aluminium", frontage: "north", supervisorOnSite: "yes", ownersOnSite: "no", safetyIssues: "no" },
  residential_house: { constructedBy: "simonds", design: "double_storey", foundations: "concrete_slab", groundCladding: ["brick_veneer"], firstCladding: ["not_applicable"], windowsAre: "aluminium", roofDesign: "pitched", roofCoveringIs: "concrete_tile", frontage: "east", blockSlope: "gently_sloping", supervisorOnSite: "yes", ownersOnSite: "yes", safetyIssues: "no" },
};
const defect = (key, location = "Rear", comments = "probe comment") => ({ [key]: "defect", [`${key}__defect`]: { location, category: ["non_compliant_ncc_as"], severity: ["minor"], photos: ["/d.jpg"], comments } });

function build({ prop = "apartment", patch = {}, apartment = prop === "apartment" } = {}) {
  const profile = { inspectionType: "construction_stage", propertyType: prop };
  const sections = keysOf(prop).map((key) => {
    const t = templateOf(key, prop);
    const answers = { ...okAnswers(t.fields), ...(key === "pci_description" ? DESCRIPTION[prop] : {}), ...(patch[key] ?? {}) };
    const d = flattenSectionToDraft(t.fields, answers, key, profile);
    return { key, name: t.name, fields: t.fields, answers, approved: true, reportText: d.reportText, damages: d.damages };
  });
  return buildConstructionReport(sections, { stageOptionPci: "off_the_plan_handover_appliances_are_installed" }, { apartment });
}
const HEADER = { reportDate: "1 Nov 2026", clientName: "C", yourReference: "", ourReference: "V1", property: "P", inspectionDate: "1 Nov 2026", weather: "Dry", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
const INSPECTION = { id: "i", jobNo: "V1", address: "", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "", submittedAt: null, type: "Construction Stage", propertyType: "Apartment", status: "submitted", overallProgress: 0, sections: [], notes: "", photoArchiveUrl: null };
const html = (model) => renderToStaticMarkup(createElement(ConstructionReportBody, { inspection: INSPECTION, model, header: HEADER }));
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const defects = (m) => m.defectGroups.flatMap((g) => g.defects.map((d) => ({ ...d, group: g.heading })));
const table = (m, key) => m.tables.find((t) => t.sectionKey === key);
const groupsOf = (t) => t.groups.map((g) => ({ heading: g.heading, items: g.items.map((i) => i.heading) }));

describe("1. Apartment construction line", () => {
  it("as the template: '… apartment in a multi-level complex.', then 'Foundations are concrete slab.' as its own line", () => {
    const m = build();
    assert.ok(m.description.includes("The construction is a split level apartment in a multi-level complex."), m.description.join("\n"));
    assert.ok(m.description.includes("Foundations are concrete slab."), m.description.join("\n"));
    assert.ok(!m.description.some((l) => /on a concrete slab/.test(l)));
  });
  it("the House line is as it was", () => {
    const m = build({ prop: "residential_house" });
    assert.ok(m.description.includes("The construction is a double storey residential house."));
    assert.ok(m.description.includes("Foundations are concrete slab."));
  });
});

describe("2. brand and builder names keep their capital", () => {
  it("'Hebel' in the cladding line, and every brand in the forms' choices", () => {
    const m = build();
    assert.ok(m.description.includes("Wall cladding is constructed of concrete panels and Hebel."), m.description.join("\n"));
    for (const name of ["Hebel", "Colorbond", "Zincalume", "Kliplock", "Simonds", "Mirvac", "Hacer"]) assert.equal(inline(name), name);
    assert.equal(inline("Hebel panels to the rear."), "Hebel panels to the rear");
    assert.equal(inline("Rendered brick"), "rendered brick");
  });
  it("every option label in the construction forms that starts with a brand is on the list", () => {
    const brands = new Set();
    for (const t of SNAP.filter((x) => x.inspectionType === "construction_stage")) for (const f of t.fields) for (const o of f.options ?? []) {
      const first = o.label.split(/\s+/)[0].replace(/[^A-Za-z]/g, "");
      if (/^(hebel|colorbond|zincalume|kliplock|simonds|mirvac|hacer)$/i.test(first)) brands.add(first.toLowerCase());
    }
    for (const b of brands) assert.ok(PROPER_NAMES.has(b), b);
  });
  it("the House roof covering keeps 'Colorbond' too", () => {
    const t = templateOf("pci_description", "residential_house");
    const colorbond = t.fields.find((f) => f.key === "roofCoveringIs")?.options.find((o) => /^colorbond/i.test(o.label));
    if (!colorbond) return;
    const m = build({ prop: "residential_house", patch: { pci_description: { roofCoveringIs: colorbond.value } } });
    assert.ok(m.description.some((l) => /constructed of Colorbond/.test(l)), m.description.join("\n"));
  });
});

describe("3. a full stop after the item's name in every defect line", () => {
  it("'Private Roof Terrace. Waterproof membrane …'", () => {
    const m = build({ patch: { pci_roof: defect("roof_private_roof_terrace_if_so_provide_det", "Private roof terrace of apartment 3.04", "Waterproof membrane upturn is about 40 mm") } });
    const d = defects(m).find((x) => /Waterproof membrane/.test(x.description));
    const printed = withItemName(d.description, d.item);
    assert.match(printed, /^Private Roof Terrace\. Waterproof membrane upturn is about 40 mm\.$/);
    assert.match(text(html(m)), /Private Roof Terrace\. Waterproof membrane/);
  });
  it("withItemName keeps the name's own full stop, and adds none where the line has one", () => {
    assert.equal(withItemName("Flashings. Parapet capping laps …", "Flashings"), "Flashings. Parapet capping laps …");
    assert.equal(withItemName("Private Roof Terrace? If so, provide details. Membrane …", "Private Roof Terrace? If so, provide details."), "Private Roof Terrace. Membrane …");
  });
  it("every checklist defect of the Apartment report prints its item name with a closing mark before the comment", () => {
    const patch = {};
    for (const key of keysOf("apartment")) {
      const t = templateOf(key, "apartment");
      for (const f of t.fields) if (f.defectOn?.length && !/_other$/.test(f.key)) Object.assign((patch[key] ??= {}), defect(f.key, "Somewhere", "Probe comment"));
    }
    const m = build({ patch });
    const all = defects(m).filter((d) => d.item);
    assert.ok(all.length > 50, String(all.length));
    for (const d of all) assert.match(withItemName(d.description, d.item), /[.!?] Probe comment\.$/, d.description);
  });
});

describe("4. Part 2 tick sentences: no capital in the middle of a sentence", () => {
  it("'Screws missing from front door hinges.'", () => {
    assert.equal(TYPICAL_DEFECTS.screws_door_hinges.text, "Screws missing from front door hinges.");
    const m = build({ patch: { pci_typical_defects: { typicalEntry: ["screws_door_hinges"], screws_door_hinges_pics: ["/s.jpg"] } } });
    assert.ok(defects(m).some((d) => d.description === "Screws missing from front door hinges." && d.group === "Front door"));
  });
  it("no other tick (House or Apartment) prints a capital mid-sentence, except a numbered room ('Bed 1')", () => {
    for (const prop of ["apartment", "residential_house"]) {
      const t = templateOf("pci_typical_defects", prop);
      for (const f of t.fields.filter((x) => x.type === "chip-multiselect")) for (const o of f.options) {
        const printed = TYPICAL_DEFECTS[o.value]?.text ?? o.label;
        const mid = printed.split(/\s+/).slice(1).filter((w, i, ws) => /^[A-Z][a-z]/.test(w) && !/^\(?Bed$/.test(w) && !/[.]$/.test(ws[i - 1] ?? ""));
        assert.deepEqual(mid, [], `${prop} ${o.value}: ${printed}`);
      }
    }
  });
});

describe("5. 'windows' is not said twice in General", () => {
  const ticks = (list) => ({ pci_typical_defects: { typicalBeds: list } });
  it("with 'All windows and doors …' the tiles line is the template's", () => {
    const m = build({ patch: ticks(["windows_doors_cleaned", "windows_floor_cleaned"]) });
    const general = defects(m).filter((d) => d.group === "General").map((d) => d.description);
    assert.deepEqual(general, ["All windows and doors to be cleaned and detailed.", TILES_CLEANED]);
    assert.equal(TILES_CLEANED, "All tiles and floor coverings to be cleaned and detailed.");
  });
  it("on its own it keeps the windows", () => {
    const m = build({ patch: ticks(["windows_floor_cleaned"]) });
    assert.deepEqual(defects(m).filter((d) => d.group === "General").map((d) => d.description), ["All windows, tiles and floor coverings to be cleaned and detailed."]);
  });
  it("the House report the same way", () => {
    const m = build({ prop: "residential_house", patch: ticks(["windows_doors_cleaned", "windows_floor_cleaned"]) });
    assert.ok(defects(m).some((d) => d.description === TILES_CLEANED));
  });
});

describe("6. a Defects-list item in a common area prints under Common areas", () => {
  it("'Common corridor, level 3' -> Common areas, not General", () => {
    assert.equal(placeOf("Common corridor, level 3"), "Common areas");
    assert.equal(placeOf("Ground floor foyer"), "Common areas");
    assert.equal(placeOf("Apartment 3.04, laundry cupboard"), "Laundry");
    const m = build({ patch: { pci_defects: { defects: [{ location: "Common corridor, level 3", description: "Fire hose reel cupboard door does not close fully.", photos: ["/f.jpg"] }] }, pci_garage_site: defect("common_gym_sauna", "Gym", "Treadmill guard missing") } });
    const d = defects(m).find((x) => /Fire hose reel/.test(x.description));
    assert.equal(d.group, "Common areas");
    // The same heading as the checklist's Common areas defects: one group, not two.
    assert.equal(m.defectGroups.filter((g) => /^common areas$/i.test(g.heading)).length, 1);
  });
});

describe("7. Apartment checklist grouping as the template", () => {
  it("Flyscreens under Windows and Doors; Car Bay & Storage Cage and Car Stacker under BASEMENT; no 'Flyscreens and car bay'", () => {
    const t = table(build({ patch: { pci_walls_doors: { carbay_garage_vehicle_doors_roller_door_and_m: "n_a" } } }), "pci_walls_doors");
    const g = groupsOf(t);
    assert.ok(!g.some((x) => /flyscreens and car bay/i.test(x.heading ?? "")), JSON.stringify(g));
    const windows = g.find((x) => /^windows and doors$/i.test(x.heading ?? ""));
    assert.equal(windows.items.at(-1), "Flyscreens");
    const basement = g.find((x) => x.heading === "Basement");
    assert.deepEqual(basement.items, ["Basement car bay & storage cage", "Car stacker"]);
  });
  it("no garage row when it is N/A; printed (under BASEMENT) when answered otherwise", () => {
    const na = groupsOf(table(build({ patch: { pci_walls_doors: { carbay_garage_vehicle_doors_roller_door_and_m: "n_a" } } }), "pci_walls_doors"));
    assert.ok(!na.flatMap((x) => x.items).some((h) => /garage/i.test(h)));
    const ok = groupsOf(table(build(), "pci_walls_doors"));
    assert.ok(ok.find((x) => x.heading === "Basement").items.some((h) => /^garage vehicle doors/i.test(h)));
  });
  it("defects keep the printed order and their sentences: Windows and Doors (with Flyscreens), then Basement", () => {
    const m = build({
      patch: {
        pci_walls_doors: { ...defect("doors_sliding_doors_bi_fold_tracks_clean_loc", "Living", "Slider binds"), ...defect("carbay_flyscreens_required_windows_and_doors", "Bed 2", "Flyscreen missing"), ...defect("carbay_car_stacker", "B1", "Stacker gate sticks") },
      },
    });
    const list = defects(m).map((d) => [d.no, d.group, d.description]);
    const at = (re) => list.find((x) => re.test(x[2]));
    const slider = at(/Slider binds/), fly = at(/Flyscreen missing/), stacker = at(/Stacker gate/);
    assert.equal(fly[1], slider[1], "flyscreens sits with windows and doors");
    assert.equal(stacker[1], "Basement");
    assert.ok(slider[0] < fly[0] && fly[0] < stacker[0], JSON.stringify(list));
    assert.equal(fly[2], "Flyscreens. Flyscreen missing.");
    // The checklist rows link to the same numbers.
    const items = table(m, "pci_walls_doors").groups.flatMap((g) => g.items);
    assert.equal(items.find((i) => i.heading === "Car stacker").defectNo, stacker[0]);
    assert.ok(pciTopicOrder(["Basement", "Roof", "Windows and doors"]).join() === "Roof,Windows and doors,Basement");
  });
  it("the House walls and doors table is grouped as before", () => {
    const g = groupsOf(table(build({ prop: "residential_house" }), "pci_walls_doors")).map((x) => x.heading);
    assert.ok(!g.includes("Basement"), JSON.stringify(g));
  });
});

describe("8. 'Multi-level Complex' is not a Roof row", () => {
  it("left out of the Apartment Roof checklist", () => {
    const rows = table(build(), "pci_roof").groups.flatMap((g) => g.items.map((i) => i.heading));
    assert.ok(!rows.some((h) => /multi-level/i.test(h)), rows.join(", "));
    assert.ok(rows.length > 5);
  });
  it("still printed (with its defect) if it was answered Defect, so the defect keeps its row", () => {
    const m = build({ patch: { pci_roof: defect("roof_multi_level_complex_could_you_access_r", "Roof", "No access hatch to the roof") } });
    const rows = table(m, "pci_roof").groups.flatMap((g) => g.items);
    const row = rows.find((i) => /multi-level/i.test(i.heading));
    assert.equal(row.status, "defect");
    assert.ok(row.defectNo);
  });
});

describe("9. the Apartment template's own sentences", () => {
  const m = build();
  const out = text(html(m));
  it("under the Roof checklist: the Owners Corporation note", () => {
    assert.deepEqual(table(m, "pci_roof").closing, [APARTMENT_ROOF_NOTE]);
    assert.equal(APARTMENT_ROOF_NOTE, "Roof coverings in an apartment complex are common property and need to be maintained through the Owners Corporation.");
    assert.ok(out.includes(APARTMENT_ROOF_NOTE));
  });
  it("after the Common Areas checklist: the full 'Any comments regarding Common Areas …' paragraph", () => {
    assert.deepEqual(table(m, "pci_garage_site").closing, [APARTMENT_COMMON_AREAS_NOTE]);
    assert.match(APARTMENT_COMMON_AREAS_NOTE, /^Any comments regarding Common Areas are general only\. The Inspector is not providing a pool safety barrier certification .* basements and foyers\.$/);
    assert.ok(out.includes("such as pools, gyms, BBQ's, fire and security systems, basements and foyers.") || out.includes("BBQ’s, fire and security systems, basements and foyers."));
    // Printed after the last Common Areas row, before the next table.
    assert.ok(out.indexOf("Any comments regarding Common Areas") > out.indexOf("Common Roof Top"), "after the Common Areas rows");
  });
  it("Common Areas notes: the Owners Corporation maintenance note and the 'Houspect’s inspection is focussed …' paragraph", () => {
    assert.deepEqual(m.commonAreaNotes, APARTMENT_COMMON_AREA_NOTES);
    assert.match(APARTMENT_COMMON_AREA_NOTES[0], /^Regular maintenance or repair work to the common areas of the apartment complex, .* through the Owners Corporation\.$/);
    assert.match(APARTMENT_COMMON_AREA_NOTES[1], /^Houspect’s inspection is focussed on the specific Apartment in scope, .* any general facilities\.$/);
    assert.match(out, /NOTES .* COMMON AREAS .*Regular maintenance or repair work .*Houspect’s inspection is focussed/i);
  });
  it("none of them in a House report", () => {
    const house = build({ prop: "residential_house" });
    assert.deepEqual(house.commonAreaNotes, []);
    assert.ok(house.tables.every((t) => !t.closing));
    const h = text(html(house));
    assert.ok(!h.includes("Owners Corporation") && !h.includes("Any comments regarding Common Areas"));
  });
});

describe("kept as they are", () => {
  it("'Terrace Is Common' and the wall cladding line", () => {
    const m = build();
    assert.ok(table(m, "pci_roof").groups.flatMap((g) => g.items.map((i) => i.heading)).includes("If terrace is Common, adds notes and photos to Common Area section"));
    assert.ok(text(html(m)).includes("Terrace Is Common"));
    assert.ok(m.description.some((l) => /^Wall cladding is constructed of /.test(l)));
  });
});
