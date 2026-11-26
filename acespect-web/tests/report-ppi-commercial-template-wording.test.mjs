// Pre-Purchase / Commercial: every section written from the office template "ACESPECT_Building_Pre-Purchase_House_and_Commercial_Nov_2026"
// (wording/pre_purchase.commercial_properties.ts), on the Commercial form as align-ppi-commercial-areas.ts leaves it (Warehouse & Production
// and Offices & Staff Facilities areas, Pool / Spa in External) and on the earlier form (an inspection started before it):
//   - each element's template sentence, filled from its question; a sentence whose blank no question answers is left out;
//   - the template's order and headings: the roof space under INTERNAL, not ROOF; the areas' defects under their element ("At the Warehouse");
//   - no "Label: value" line, no empty blank, no admin note, no option code anywhere; each defect's photos printed once.
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
const server = await createServer({ root: webRoot, server: { middlewareMode: true, fs: { strict: false } }, logLevel: "error" });
after(() => server.close());
const R = await server.ssrLoadModule("/src/web/prepurchase/PrePurchaseReport.tsx");
const W = await server.ssrLoadModule("/src/web/wording/pre_purchase.commercial_properties.ts");
const { flattenSectionToDraft } = await server.ssrLoadModule("/src/web/templateFields.ts");
const A = await server.ssrLoadModule(`/@fs${resolve(webRoot, "../acespect-backend/src/scripts/align-ppi-commercial-areas.ts").replaceAll("\\", "/").replace(/^(?!\/)/, "/")}`);

const PPI = { inspectionType: "pre_purchase", propertyType: "commercial_properties" };
const SNAP = JSON.parse(readFileSync(resolve(webRoot, "../acespect-backend/prisma/templates-snapshot.json"), "utf8"));
/** The Commercial form: "old" as published, "new" after align-ppi-commercial-areas.ts. */
function form(which) {
  const latest = new Map();
  for (const t of SNAP) if (t.inspectionType === PPI.inspectionType && t.propertyType === PPI.propertyType && (!latest.has(t.sectionKey) || latest.get(t.sectionKey).version < t.version)) latest.set(t.sectionKey, JSON.parse(JSON.stringify(t)));
  if (which === "new") A.alignCommercialAreas(Object.fromEntries(["internal_areas", "pool_spa", "elevations"].map((k) => [k, latest.get(k)])));
  return latest;
}
const NEW = form("new"), OLD = form("old");
const KEYS = ["job-info", "description", "driveway", "paving_paths", "fences", "retaining_walls", "garage_carport_sheds", "elevations", "roof_chimneys", "internal_areas", "pool_spa", "notes"];

/** Answers that walk through every option (3 sets); each photo its own. */
let photoNo = 0;
function answersFor(fields, v, depth = 0) {
  const a = {};
  (fields ?? []).forEach((f, i) => {
    const opts = (f.options ?? []).map((o) => o.value);
    switch (f.type) {
      case "pill-select": case "color-select": case "select-tiles": if (opts.length) a[f.key] = opts[(i + v) % opts.length]; break;
      case "chip-multiselect": case "tile-multiselect": if (opts.length) a[f.key] = v === 2 ? [...opts] : opts.slice(v % opts.length, (v % opts.length) + 3); break;
      case "yesno": a[f.key] = (i + v) % 2 ? "yes" : "no"; break;
      case "text": a[f.key] = v === 1 ? "" : "Typed words"; break;
      case "textarea": a[f.key] = v === 1 ? "" : v === 0 ? "Typed note (owners corporation)." : "Typed note without a stop"; break;
      case "numeric": a[f.key] = v === 1 ? "" : 3 + i + v; break;
      case "date": a[f.key] = "2026-11-01"; break;
      case "photos": a[f.key] = [`/api/v1/media/p-${f.key}-${v}-${depth}-${i}-${photoNo++}`]; break;
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
const photosOf = (v, out = []) => {
  if (typeof v === "string" && v.startsWith("/api/v1/media/")) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => photosOf(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => photosOf(x, out));
  return out;
};

/** The report's body, from `answers` per section (a section not given is left out). */
function report(answers, latest = NEW) {
  const sections = KEYS.filter((k) => answers[k]).map((key, i) => ({ id: `s${i}`, key, name: latest.get(key).name, reviewStatus: "approved", reportText: "", answers: answers[key], fields: {}, photos: photosOf(answers[key]), damages: [] }));
  const printed = sections.flatMap((s) => {
    if (s.key === "job-info") return [s];
    let fields = latest.get(s.key).fields;
    if (s.key === "notes") return R.splitCommercialNotes(s, fields, PPI);
    if (s.key === "pool_spa" && Object.keys(s.answers).some((k) => k.startsWith("pool_")) && !fields.some((f) => f.key === "pool_applicability")) fields = latest.get("elevations").fields.filter((f) => f.key.startsWith("pool_"));
    return [R.prePurchaseSectionText(s, fields, PPI)];
  });
  const gd = W.commercialGeneralDescription(answers["job-info"] ?? {}, latest.get("job-info").fields, answers.elevations ?? {}, latest.get("elevations").fields);
  const withGd = printed.map((s) => (s.key === "description" ? { ...s, reportText: gd.join("\n\n") } : s));
  const insp = { id: "i", jobNo: "J", address: "1 Test Drive", suburb: "", client: "C", inspectorId: "u", reviewerId: null, date: "2026-11-26", submittedAt: null, type: "Pre-Purchase", propertyType: "Commercial Properties", status: "submitted", overallProgress: 0, sections, notes: "", photoArchiveUrl: null };
  const header = { reportDate: "Thursday, 26 November 2026", clientName: "C", clientEmail: "", yourReference: "", ourReference: "J", property: "1 Test Drive", propertyOwner: "", inspectionDate: "Thursday, 26 November 2026", weather: "Sunny", inspector: "Joe Briffa", inspectorRegistration: "DBU 58070", purpose: "" };
  const html = renderToStaticMarkup(createElement(R.PrePurchaseReportBody, { inspection: insp, sections: withGd, header }));
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return { html, text, body: text.slice(text.indexOf("\nPhotographs\n"), text.indexOf("\nGLOSSARY\n")) };
}
/** One section's text alone. */
const sectionText = (key, answers, latest = NEW) => flattenSectionToDraft(latest.get(key).fields, answers, key, PPI).reportText;
/** The text under one main title (ROOF / EXTERNAL / INTERNAL / ...). */
const mainPart = (html, title) => {
  const at = html.indexOf(`data-ppi-title="${title}"`);
  const next = html.indexOf('data-ppi-title="', at + 10);
  return html.slice(at, next < 0 ? undefined : next).replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
};
const has = (text, sentence) => assert.ok(text.replace(/\s+/g, " ").includes(sentence), `missing: ${sentence}\n---\n${text.slice(0, 3000)}`);
const hasNot = (text, re) => assert.ok(!re.test(text), `${re} in: ${text.slice(0, 2000)}`);

describe("PPI Commercial: ROOF -- the template's sentences, in its order", () => {
  const roof = {
    roofcov_covering: "item2", roofcov_condition: "fair", roofcov_requires: "item0", roofcov_checks0: ["item1"], roofcov_comments: "Sheets are dull",
    eaves_applicability: "applicable", eaves_material: "item0", eaves_condition: "average", eaves_requires: "item2",
    fascia_applicability: "applicable", fascia_finish: "item0", fascia_material: "item0", fascia_condition: "poor", fascia_requiresAttention: "yes",
    gables_applicability: "applicable", gables_painted: "no", gables_material: "Fibre cement sheet",
    flashings_applicability: "applicable", flashings_material: "item1",
    guttersvalleys_applicability: "applicable", guttersvalleys_gutterType: "item0", guttersvalleys_material: "item1", guttersvalleys_condition: "fair", guttersvalleys_requires: "item2", guttersvalleys_valleys: "item3", guttersvalleys_valleysCondition: "average",
    downpipes_material: "item2", downpipes_condition: "fair", downpipes_requires: "item4",
    chimneys_applicability: "applicable", chimneys_type: "item1", chimneys_condition: "average", chimneys_operating: "no",
  };
  const { html } = report({ roof_chimneys: roof });
  const text = mainPart(html, "Roof");
  it("Roof Covering", () => {
    has(text, "The roof covering is constructed of Colorbond material. The condition of the covering appears to be fair in relation to its age and it does not require attention. Consult a licensed plumber.");
    has(text, "Rusted roof needs replacing.");
    has(text, "Sheets are dull.");
    has(text, "The materials of roofing, flashing, gutters and downpipes will be affected by weathering");
  });
  it("Eaves, Fascias, Gables, Flashings", () => {
    has(text, "The eaves are boxed with painted fibre cement. They are in average condition and do not require attention.");
    has(text, "The fascias are painted and constructed of timber. They are in poor condition and do require attention.");
    has(text, "The gables are unpainted and constructed of fibre cement sheet.");
    has(text, "The flashings are constructed of sheet metal.");
  });
  it("Valleys/Gutters, Downpipes, Chimney", () => {
    has(text, "The perimeter gutters are constructed of Zincalume and are in fair condition and require normal maintenance. Valleys are constructed of Colorbond steel and are in average condition.");
    has(text, "Roof guttering and downpipes can be blocked by tree litter");
    has(text, "The downpipes are fabricated of PVC material and are in fair condition. They do not require repairs. Ensure downpipes are cleaned of tree litter regularly to avoid storm water overflows.");
    has(text, "The chimney is constructed of brick and is in average structural condition. It was not operating at the time of inspection.");
    has(text, "It is recommended that before lighting a fire in the fireplace, a professional chimney sweep inspects the fireplace.");
  });
  it("the template's order", () => {
    const order = ["Roof Covering", "Eaves", "Fascias", "Gables", "Flashings", "Valleys/Gutters", "Downpipes", "Chimney"].map((h) => text.indexOf(`\n${h}\n`));
    assert.ok(order.every((x) => x > 0), String(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });
  it("a sentence with a blank no question answers is left out (the ridges, the gables' attention, the upper flashings)", () => {
    hasNot(text, /ridges and capping are in|upper flashings|Lower level flashings|gables are .* require attention/i);
  });
});

describe("PPI Commercial: the roof space prints under INTERNAL, not ROOF", () => {
  const roofSpace = {
    roofcov_covering: "item2", roofcov_condition: "fair", roofcov_requires: "item0",
    roofcavity_applicability: "applicable", roofcavity_condition: "average", roofcavity_failureIndications: "no",
    sarking_applicability: "applicable", sarking_effective: "yes",
    roofframe_applicability: "applicable", roofframe_frameType: "item1", roofframe_supportAdequate: "yes", roofframe_constructedOf: "item0",
    insulation_applicability: "applicable", insulation_visibility: "item2", insulation_effective: "no",
  };
  const { html } = report({ roof_chimneys: roofSpace });
  const roof = mainPart(html, "Roof"), internal = mainPart(html, "Internal");
  it("Roof Covering (underside), Sarking, Roof Frame, Ceiling Insulation under INTERNAL", () => {
    has(internal, "The underside of the roof appears to be in average condition. To sections observed from the manhole, there are no points to indicate the failure of the covering surface. Consult a licensed plumber.");
    has(internal, "The underside of the roof was inspected from the manhole and only limited sections");
    has(internal, "Sarking is in place and appears to be effective.");
    has(internal, "It is a conventional truss construction and the support system appears to be adequate.");
    has(internal, "Insulation is in place and is not considered effective.");
    has(internal, W.COMMERCIAL_INTERNAL_INTRO);
    for (const h of W.COMMERCIAL_ROOF_SPACE_PARTS) assert.ok(internal.includes(`\n${h}\n`) && !roof.includes(`\n${h}\n`), h);
  });
  it("first under INTERNAL, after its opening sentence", () => {
    assert.ok(internal.indexOf(W.COMMERCIAL_INTERNAL_INTRO) < internal.indexOf("\nRoof Covering (underside)\n"));
  });
  it("no manhole: the template's sentence; no sarking: 'Sarking is not in place.'", () => {
    const t = mainPart(report({ roof_chimneys: { roofcavity_applicability: "na-manhole", sarking_applicability: "na-none", roofframe_applicability: "na", insulation_applicability: "na" } }).html, "Internal");
    has(t, "Roof cavity not accessible due to no manhole.");
    has(t, "Sarking is not in place.");
  });
});

describe("PPI Commercial: EXTERNAL -- the template's sentences, in its order", () => {
  const elevations = {
    sides: { front: { available: "yes", orientation: "east", condition: "fair", claddingObs: ["paint_flaking"], windowDoorObs: ["sticking"], hasDamage: "yes", notes: "Render patched", damages: [{ location: "beside the entry", element: "Front window frame", damageType: "surface_damage", sub_surface: "chips", notes: "Chipped frame" }] }, left: { available: "no" } },
    extwalls_material: "Precast concrete panels", extwalls_condition: "average", extwalls_majorCracking: "no", extwalls_sigWeathering: "no", extwalls_generallyStable: "yes", extwalls_checks0: ["item0"],
    cladding_applicability: "applicable", cladding_material: "Metal sheeting", cladding_condition: "fair",
    subfloor_applicability: "na-slab",
    lintels_material: "item0", lintels_condition: "fair", lintels_signsOfFailure: "item1",
    windowsext_material: "item2", windowsext_condition: "fair", windowsext_requires: "item0", windowsext_glazingBeads: "item1", windowsext_securityScreens: "no", windowsext_checks0: ["item3"],
    frontdoor_material: "item1", frontdoor_condition: "fair", frontdoor_requires: "item1", frontdoor_secScreen: "no", frontdoor_deadlocks: "yes", frontdoor_doorCloser: "item1",
    extstairs_applicability: "applicable", extstairs_material: "item1", extstairs_condition: "poor", extstairs_handrails: "item2", extstairs_riseTreadAdequate: "no",
    balconies_applicability: "applicable", balconies_material: "item2", balconies_condition: "fair", balconies_adequatelyFixed: "yes", balconies_handRailCond: "item1",
    verandah_applicability: "applicable", verandah_material: "item0", verandah_condition: "fair", verandah_adequatelyFixed: "yes", verandah_handRails: "item0",
    alfresco_applicability: "applicable", alfresco_material: "Timber", alfresco_adequatelyFixed: "yes", alfresco_covered: "yes", alfresco_adequatelySupported: "yes", alfresco_checks0: ["item1"],
    pool_applicability: "applicable", pool_type: "item0", pool_material: "item0", pool_installation: "item1", pool_signsOfSubsidence: "no", pool_fencingAdequate: "yes", pool_checks0: ["item4"],
  };
  const outbuildings = {
    garage_applicability: "applicable", garage_location: "item2", garage_condition: "fair", garage_requiresAttention: "no",
    studio_applicability: "applicable", studio_condition: "fair", studio_requiresAttention: "no",
    grannyflat_applicability: "applicable", grannyflat_location: "rear", grannyflat_material: "Weatherboard", grannyflat_condition: "average", grannyflat_requiresAttention: "yes",
  };
  const { html } = report({
    elevations, garage_carport_sheds: outbuildings,
    driveway: { pp_driveway_applicability: "applicable", pp_driveway_material: "Concrete" },
    fences: { pp_fences_applicability: "applicable", pp_fences_material: "item3", pp_fences_condition: "average", pp_fences_requires: "item0" },
    retaining_walls: { pp_retaining_applicability: "applicable", pp_retaining_material: "Sleepers", pp_retaining_signsOfMajorCracking: "no" },
  });
  const text = mainPart(html, "External");
  it("Walls, with each elevation's notes, defects and photos", () => {
    has(text, "The external walls are constructed of precast concrete panels material and are in average condition in relation to their age. To sections observed there are no signs of significant cracking or significant weathering. The walls are considered generally stable.");
    has(text, "At the front elevation, render patched.");
    has(text, "There is some movement in the foundations which is causing mortar and brickwork to crack.");
    has(text, "The materials of walls and cladding will be affected by weathering");
  });
  it("Cladding (the walls' paragraph not said twice), Sub-Floor, Lintels", () => {
    has(text, "The cladding is constructed of metal sheeting material and to sections observed is in fair condition.");
    has(text, "Paint flaking noted to the front elevation.");
    assert.equal(text.split("The materials of walls and cladding will be affected").length, 2);
    has(text, "The property is constructed on a concrete slab.");
    has(text, "The external steel lintels are in fair condition with no obvious signs of rust. Lintels should be kept in good condition to avoid costly repairs.");
  });
  it("Windows/Window Frames: an elevation's window defect under it", () => {
    has(text, "The window frames are constructed of aluminium and are in fair condition. They require normal maintenance.");
    has(text, "The glazing beads appear serviceable and there are no broken panels. Security screens are not installed.");
    has(text, "Sticking noted to the windows and doors at the front elevation.");
    has(text, "At the front elevation (beside the entry), there is surface damage (chips) to the Front window frame.");
    has(text, "Current Building Codes require that safety glass be installed");
  });
  it("Front Door, Stairs, Balconies, Verandah, Alfresco", () => {
    has(text, "The front door and door frame is constructed of aluminium and its condition is generally fair, requiring normal maintenance. A security screen door is not installed. Deadlocks are fitted.");
    has(text, "Door closer is working.");
    has(text, "The external stairs on the property are constructed of steel and are in poor condition. The handrails, rise and tread are not adequate.");
    has(text, "The balconies are constructed of concrete and are in fair condition. They appear to be adequately fixed to the building. The handrails are in satisfactory condition.");
    has(text, "The verandah is constructed of steel and in fair condition. It appears to be adequately fixed to the building.");
    has(text, "Handrails are not required.");
    has(text, "The pergola is timber-framed and adequately fixed to the house. It is covered and adequately supported, with no signs of sagging or movement.");
    has(text, "External structures, especially timber structures exposed to weather elements will deteriorate over time");
  });
  it("Pool/Spa in EXTERNAL, with the template's paragraph", () => {
    has(text, "The pool on the property is constructed of concrete and situated below ground. There are no signs of subsidence around the pool. The pool appears adequately fenced. The gates are not self-latching and do not appear to meet pool regulations. The windows are self-latching and appear to meet pool regulations.");
    has(text, "The Houspect building inspector’s comments are general observations only");
  });
  it("Carport/Garage, Studio, Granny Flat, Driveway, Fences, Retaining Walls", () => {
    has(text, "There is a freestanding garage to the side of the house.");
    has(text, "It is in fair condition and does not require attention.");
    has(text, "There is a granny flat at the rear side of the house constructed of weatherboard. It is in average condition and does require attention.");
    has(text, "The driveway is constructed of concrete.");
    has(text, "The fences on the property are constructed of colourbond sheets and are in average condition, requiring repairs.");
    has(text, "The retaining walls are constructed of sleepers, with no signs of significant cracking.");
  });
  it("the template's order", () => {
    const order = ["Walls", "Cladding", "Sub-Floor", "Lintels", "Windows/Window Frames", "Front Door / Door Frames", "Stairs", "Balconies", "Verandah or Front Porch or Decking", "Alfresco or Pergola", "Pool/Spa", "Carport/Garage", "Studio", "Granny Flat", "Driveway", "Fences", "Retaining Walls"].map((h) => text.indexOf(`\n${h}\n`));
    assert.ok(order.every((x) => x > 0), String(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });
  it("no pool: no Pool/Spa and no pool paragraph", () => {
    const t = mainPart(report({ elevations: { ...elevations, pool_applicability: "na" } }).html, "External");
    hasNot(t, /Pool\/Spa|pool safety barriers/);
  });
  it("an elevation answered not available prints nothing of its own", () => hasNot(text, /left elevation/));
});

describe("PPI Commercial: INTERNAL -- by element, the areas' defects under them", () => {
  const area = (extra) => ({ available: "yes", floorLevel: "ground", generalCondition: "fair", hasDamage: "no", ...extra });
  const internalAreas = {
    rooms: {
      warehouse: area({ general_damages: [{ location: "aisle 2", element: "Concrete floor slab", damageType: "cracking", sub_cracking: "fine", notes: "Shrinkage crack" }], notes: "Racking to the north wall" }),
      mezzanine: area({ hasDamage: "yes", damages: [{ location: "", element: "Signage bracket", damageType: "operational_defects", sub_operational: "other_movable_elements", notes: "Bracket loose" }] }),
      loading_dock: { available: "no" },
    },
    partywalls_applicability: "applicable", partywalls_location: "north", partywalls_extendsToRoof: "yes", partywalls_fireBarrier: "no",
    ceilings_material: "item0", ceilings_cornices: "item2", ceilings_condition: "fair", ceilings_adequatelyFixed: "yes", ceilings_checks0: ["item1"],
    walls_material: "item0", walls_condition: "average", walls_checks0: ["item1"],
    floors_material: "item1", floors_coverings: "item1", floors_checks0: ["item0", "item1"],
    intstairs_applicability: "applicable", intstairs_material: "item0", intstairs_condition: "fair", intstairs_handrails: "item1",
    intwindows_condition: "fair", intwindows_locksGeneral: "yes", intwindows_flywire: "item2", intwindows_flywireCondition: "fair", intwindows_checks0: ["item1"],
    cabinets_condition: "fair",
    plumbing_waterSupplyOn: "yes", plumbing_waterHammer: "no", plumbing_tapsNormal: "yes", plumbing_waterLeaks: "yes",
    gas_applicability: "applicable", gas_supplyType: "item0", gas_gasSupplyOn: "yes",
    fireplace_applicability: "applicable", fireplace_type: "item1", fireplace_operating: "yes", fireplace_checks0: ["item0"],
    electrical_powerOn: "yes", electrical_rcdCount: "item2", electrical_batteryAlarms: "yes", electrical_batteryAlarmsCount: "item1", electrical_hardwiredAlarms: "no", electrical_alarmsLocated: "yes",
  };
  const offices = { rooms: { reception_foyer: area({ hasDamage: "yes", damages: [{ location: "front desk", element: "Door handle", damageType: "operational_defects", sub_operational: "doors_tight_not_closing", notes: "Handle loose" }] }) } };
  const { html } = report({ internal_areas: internalAreas, pool_spa: offices });
  const text = mainPart(html, "Internal");
  it("Party Walls, Ceilings, Walls, Floors, Stairs", () => {
    has(text, "The property has a party wall on the north side of the property. The party wall does extend to the underside of the roof cover. The party wall is not appropriately constructed as a fire barrier according to current regulations.");
    has(text, "The ceilings are constructed of generally plasterboard with traditional cornices, which are generally in fair condition. There are no signs of minor cornice cracks and the ceilings are generally adequately fixed.");
    has(text, "The walls are constructed of plasterboard on timber studs, with no signs of serious cracks or movement. They are generally in an average condition.");
    has(text, "The floors are constructed of polished concrete and covered in tiles. The tiled areas do not require attention. No significant cracks were seen.");
    has(text, "The internal stairs on the property are constructed of steel and are in fair structural condition. The handrails are adequate.");
  });
  it("Windows, Cabinets, Plumbing, Gas, Fireplace / Heater, Electrical", () => {
    has(text, "The windows are in fair condition. Generally locks are in place.");
    has(text, "Window restrictors are not fitted. This is a safety concern.");
    has(text, "Flyscreens are installed in all of the windows and are in fair condition.");
    has(text, "The general condition of the cabinets is considered to be fair.");
    has(text, "There are no signs of water hammer. All toilets were tested and are operational.");
    has(text, "A licensed plumber may need to be engaged to identify the source of the water and advise on appropriate repairs.");
    has(text, "As the Houspect Building Inspector is not a licensed plumber");
    has(text, "Mains gas is connected to the property.");
    has(text, "There is an electric heater installed which was operating at time of inspection. It requires normal maintenance.");
    has(text, "The circuit board has 2 RCD (residual current device) safety switches.");
    has(text, "2 battery smoke alarms are installed and the locations are appropriate.");
    has(text, "As the Houspect Building Inspector is not a licensed electrician");
  });
  it("an area's defect under its element, as 'At the <area>'", () => {
    const floors = text.slice(text.indexOf("\nFloors\n"), text.indexOf("\nStairs\n"));
    has(floors, "At the Warehouse (aisle 2), there is a fine crack to the Concrete floor slab.");
    const doors = text.slice(text.indexOf("\nDoors\n"));
    has(doors, "At the Reception/Foyer (front desk), there are operational defects (doors tight/not closing) to the Door handle.");
  });
  it("a defect whose element names no template element, and an area's own notes, print at the end of INTERNAL with no heading", () => {
    const end = text.slice(text.lastIndexOf("As the Houspect Building Inspector is not a licensed electrician"));
    has(end, "At the Mezzanine, there are operational defects (other movable elements) to the Signage bracket.");
    has(end, "At the Warehouse, racking to the north wall.");
    hasNot(text, /~unplaced/);
  });
  it("an area's own overall sentence is not printed; an area not present prints nothing", () => {
    hasNot(text, /Warehouse is in|Loading Dock|ground floor/i);
  });
  it("the template's order", () => {
    const order = ["Party Walls", "Ceilings", "Walls", "Floors", "Stairs", "Windows", "Doors", "Cabinets", "Plumbing", "Gas", "Fireplace / Heater", "Electrical"].map((h) => text.indexOf(`\n${h}\n`));
    assert.ok(order.every((x) => x > 0), String(order));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });
});

describe("PPI Commercial: GENERAL DESCRIPTION", () => {
  it("the direction (front elevation) and the block; the council-approval sentence only with additions / extensions", () => {
    const t = (job) => mainPart(report({ "job-info": job, elevations: { sides: { front: { available: "yes", orientation: "north" } } }, description: { front_elevation: [] } }).html, "General Description");
    const yes = t({ blockSlope: "item1", additionsExtensions: "yes" });
    has(yes, "The front of the building is facing approximately North, on a gently sloping block of land.");
    has(yes, "The inspector recommends if the property has renovations or extensions, that you confirm if they have been approved by the local council.");
    hasNot(t({ blockSlope: "item1", additionsExtensions: "no" }), /local council/);
  });
  it("no question for the storeys, the design or the extension's design: those sentences are left out", () => {
    const gd = W.commercialGeneralDescription({ blockSlope: "item0", additionsExtensions: "yes", additionsExtensionsAt: "2012 at the rear" }, NEW.get("job-info").fields, {}, NEW.get("elevations").fields);
    assert.ok(!gd.some((l) => /The building is a|The design of the|There is an addition|extension is/.test(l)), gd.join(" | "));
  });
});

describe("PPI Commercial: STRUCTURAL DEFECTS, MAJOR DEFECTS, SAFETY HAZARDS and NOTES in the template's words", () => {
  const { text } = report({ notes: { structural_structurallySound: "yes", majordefects_freeOfMajorDefects: "no", majordefects_comments: "Dock wall", safety_safetyMatters: "yes", safety_checks0: ["item2", "item3"], additionalNotes: "Ask for permits" } });
  const between = (a, b) => text.slice(text.indexOf(`\n${a}\n`), text.indexOf(`\n${b}\n`));
  it("each part", () => {
    has(between("Structural Defects", "Major Defects"), "There are no structural defects evident at the time of inspection.");
    has(between("Major Defects", "Safety Hazards"), "There are major defects evident at the time of inspection.");
    has(between("Major Defects", "Safety Hazards"), "Whether or not a defect should be regarded as major, may depend upon the age of the building being inspected.");
    const safety = between("Safety Hazards", "Notes");
    has(safety, "There is fibre cement sheeting that may contain asbestos");
    has(safety, "It is recommended that a smoke detector is located within 1.5 metres outside each bedroom/sleeping area.");
    has(safety, "Due to the age of the property, asbestos may be present.");
    hasNot(safety, /Refer to pool concerns/);
    const notes = text.slice(text.lastIndexOf("\nNotes\n"), text.indexOf("\nGLOSSARY\n"));
    has(notes, "Ensure downpipes and gutters are cleaned of tree litter regularly to avoid storm water overflows.");
    has(notes, "Ask for permits.");
  });
});

describe("PPI Commercial: no 'Label:' line, no empty blank, no admin note, no code -- on every answer set, both forms", () => {
  const labels = new Set();
  for (const t of NEW.values()) { const walk = (fs) => fs.forEach((f) => { if (f.label) labels.add(f.label.trim()); walk(f.itemFields ?? []); }); walk(t.fields); }
  for (const [name, latest] of [["the new form", NEW], ["the earlier form", OLD]]) {
    for (const v of [0, 1, 2]) {
      it(`${name}, answers set ${v + 1}`, () => {
        const answers = Object.fromEntries(KEYS.map((k) => [k, k === "job-info" ? { blockSlope: "item0", additionsExtensions: "yes" } : answersFor(latest.get(k).fields, v)]));
        const { body, html } = report(answers, latest);
        for (const line of body.split("\n")) {
          const m = /^([^:]{2,80}):\s/.exec(line);
          assert.ok(!m || !labels.has(m[1].trim()), `a "Label:" line: ${line}`);
        }
        for (const re of [/\[[^\]]*\]/, /\bitem\d+\b/, /__other__/, /\bundefined\b/, /\bnull\b/, /PART::|PHOTOS::|DEFECT::|~unplaced/, /\.\./, /noted noted/i, /\[HL/, / {2,}/, /\s[.,]/, /\b(a|an|the|of|in|and|with) (\.|,|and\b)/i, /\ba [aeiou]\w* condition\b/i]) {
          const hit = re.exec(body);
          assert.ok(!hit, `${re} in v${v}: ${hit ? body.slice(Math.max(0, hit.index - 80), hit.index + 60) : ""}`);
        }
        // Every photo printed once (a defect's photos with its sentence, not again with the section's last part).
        const srcs = [...html.matchAll(/<img src="([^"]+)"/g)].map((x) => x[1]);
        const twice = srcs.filter((x, i) => srcs.indexOf(x) !== i);
        assert.deepEqual(twice, []);
      });
    }
  }
});

describe("PPI Commercial: each defect sentence names its own defect record", () => {
  it("the numbering matches the report's defect list, section by section", () => {
    for (const v of [0, 1, 2]) {
      for (const key of ["roof_chimneys", "elevations", "garage_carport_sheds", "fences", "internal_areas", "pool_spa"]) {
        const fields = NEW.get(key).fields, answers = answersFor(fields, v);
        const d = flattenSectionToDraft(fields, answers, key, PPI);
        const order = W.defectOrder(fields, answers).list;
        assert.equal(order.length, d.damages.length, `${key} v${v}`);
        order.forEach((x, i) => assert.equal(x.notes ?? "", d.damages[i].notes, `${key} v${v} #${i}`));
        const named = new Set([...d.reportText.matchAll(/DEFECT::(\d+)::/g)].map((m) => Number(m[1])));
        assert.deepEqual([...named].sort((a, b) => a - b), d.damages.map((_x, i) => i), `${key} v${v}: every defect has its sentence`);
      }
    }
  });
});

describe("PPI Commercial: an inspection started on the earlier form", () => {
  it("its rooms keep their names ('At the Kitchen'), its Pool / Spa prints under EXTERNAL", () => {
    const answers = {
      internal_areas: { rooms: { kitchen: { available: "yes", generalCondition: "fair", hasDamage: "yes", damages: [{ location: "Staff kitchenette", element: "Sink cupboard door", damageType: "operational_defects", sub_operational: "doors_tight_not_closing", notes: "Swollen" }] } } },
      pool_spa: { pool_applicability: "applicable", pool_type: "item1", pool_material: "item1", pool_installation: "item0", pool_signsOfSubsidence: "no", pool_fencingAdequate: "no" },
    };
    const { html } = report(answers, NEW);
    has(mainPart(html, "Internal"), "At the Kitchen (Staff kitchenette), there are operational defects (doors tight/not closing) to the Sink cupboard door.");
    has(mainPart(html, "External"), "The spa on the property is constructed of fibreglass and situated above ground. There are no signs of subsidence around the spa. The spa appears inadequately fenced.");
    hasNot(html, /Warehouse &amp; Production Areas \d/);
  });
});

describe("PPI Commercial: where an area's defect goes, by its element (the office's decisions)", () => {
  const defect = (element) => ({ available: "yes", generalCondition: "fair", hasDamage: "yes", damages: [{ location: "", element, damageType: "operational_defects", sub_operational: "other_movable_elements", notes: "Recorded" }] });
  // Offices & Staff Facilities areas (the pool_spa slot), printed under INTERNAL's elements.
  const internal = (rooms) => mainPart(report({ pool_spa: { rooms } }).html, "Internal");
  const under = (text, heading) => {
    const at = text.indexOf(`\n${heading}\n`);
    assert.ok(at >= 0, `no ${heading} heading`);
    const next = W.COMMERCIAL_INTERNAL_PARTS.slice(W.COMMERCIAL_INTERNAL_PARTS.indexOf(heading) + 1).map((h) => text.indexOf(`\n${h}\n`, at + 1)).filter((x) => x > at);
    return text.slice(at, next.length ? Math.min(...next) : undefined);
  };
  it("a rangehood under Cabinets, as 'At the <area>'", () => {
    const t = internal({ staff_room_kitchen: defect("Rangehood") });
    assert.equal(W.internalElementOf("Rangehood"), "Cabinets");
    assert.equal(W.internalElementOf("range hood fan"), "Cabinets");
    has(under(t, "Cabinets"), "At the Staff Room/Kitchen, there are operational defects (other movable elements) to the Rangehood.");
  });
  it("a waste, drain, grate or trap under Plumbing, even in a floor", () => {
    for (const e of ["Floor waste grate", "Shower drain", "Sink trap", "Waste pipe"]) assert.equal(W.internalElementOf(e), "Plumbing", e);
    assert.equal(W.internalElementOf("Shower floor tiles"), "Floors");
    const t = internal({ toilets_amenities: defect("Floor waste grate") });
    has(under(t, "Plumbing"), "At the Toilets/Amenities, there are operational defects (other movable elements) to the Floor waste grate.");
    hasNot(t.slice(t.indexOf("\nFloors\n") >= 0 ? t.indexOf("\nFloors\n") : t.length, t.indexOf("\nPlumbing\n")), /Floor waste grate/);
  });
});

describe("PPI Commercial: report polish (from the Test-9 PDF)", () => {
  const part = (html, main, heading) => {
    const t = mainPart(html, main);
    const at = t.indexOf(`\n${heading}\n`);
    assert.ok(at >= 0, `no ${heading} under ${main}`);
    const list = main === "External" ? W.COMMERCIAL_EXTERNAL_PARTS : W.COMMERCIAL_INTERNAL_PARTS;
    const next = list.slice(list.indexOf(heading) + 1).map((h) => t.indexOf(`\n${h}\n`, at + 1)).filter((x) => x > at);
    return t.slice(at, next.length ? Math.min(...next) : undefined);
  };
  it("1. an elevation's defect goes under Walls (or Cladding), unless it is a window or a door", () => {
    for (const e of ["Precast concrete panel base", "Precast panel joint", "Painted panel faces", "Panel base"]) assert.equal(W.externalElementOf(e), "Walls", e);
    assert.equal(W.externalElementOf("Metal cladding sheet"), "Cladding");
    for (const e of ["Broken glass pane", "Window frame", "Glazing seal"]) assert.equal(W.externalElementOf(e), "Windows/Window Frames", e);
    const d = (element) => ({ location: "", element, damageType: "moisture_evidence", sub_moisture: "efflorescence", notes: "Recorded" });
    const sides = { rear: { available: "yes", windowDoorObs: ["seal_failure"], hasDamage: "yes", damages: [d("Precast panel joint"), d("Window seal")] } };
    const { html } = report({ elevations: { sides, extwalls_material: "Precast concrete panels", extwalls_condition: "fair" } });
    has(part(html, "External", "Walls"), "At the rear elevation, there is moisture-related evidence (efflorescence) to the Precast panel joint.");
    const windows = part(html, "External", "Windows/Window Frames");
    has(windows, "Seal failure noted to the windows and doors at the rear elevation.");
    has(windows, "to the Window seal.");
    assert.ok(!windows.includes("Precast panel joint"));
  });
  it("2. smoke alarms: the counts, singular or plural; 'the locations are appropriate' only when they are", () => {
    const alarms = (x) => part(report({ internal_areas: { electrical_powerOn: "yes", electrical_rcdCount: "item1", ...x } }).html, "Internal", "Electrical");
    has(alarms({ electrical_batteryAlarms: "yes", electrical_batteryAlarmsCount: "item0", electrical_hardwiredAlarms: "yes", electrical_hardwiredCount: "item2", electrical_alarmsLocated: "yes" }), "1 battery smoke alarm and 3 hardwired smoke alarms are installed and the locations are appropriate.");
    const no = alarms({ electrical_batteryAlarms: "yes", electrical_batteryAlarmsCount: "item0", electrical_hardwiredAlarms: "no", electrical_alarmsLocated: "no" });
    has(no, "1 battery smoke alarm is installed.");
    assert.ok(!/locations are appropriate/.test(no));
    has(alarms({ electrical_hardwiredAlarms: "yes", electrical_hardwiredCount: "item1" }), "2 hardwired smoke alarms are installed.");
  });
  it("3. area names as their labels: 'At the Other Area', 'Staining noted at the Other Area.'", () => {
    const { html } = report({ internal_areas: { rooms: { other: { available: "yes", generalCondition: "fair", hasDamage: "yes", notes: "Racking", moistureObservations: ["staining"], damages: [{ location: "", element: "Signage bracket", damageType: "operational_defects", sub_operational: "other_movable_elements", notes: "Loose" }] } } } });
    const t = mainPart(html, "Internal");
    has(t, "At the Other Area, racking.");
    has(t, "Staining noted at the Other Area.");
    has(t, "At the Other Area, there are operational defects (other movable elements) to the Signage bracket.");
    assert.ok(!/the other area/.test(t));
  });
  it("4. an area or a side marked not present: its notes and photos print with its name -- no lone photos at the end of INTERNAL", () => {
    const rooms = { bedroom: { available: "no", notes: "There are no bedrooms in this commercial building.", photos: ["/api/v1/media/bedroom-photo"] }, warehouse: { available: "yes", generalCondition: "fair", hasDamage: "no" } };
    const sides = { left: { available: "no", notes: "Not accessible", photos: ["/api/v1/media/left-photo"] } };
    const { html } = report({ internal_areas: { rooms, ceilings_condition: "fair" }, elevations: { sides, extwalls_material: "Brick", extwalls_condition: "fair" } });
    const internal = mainPart(html, "Internal");
    const at = internal.indexOf("At the Bedroom, there are no bedrooms in this commercial building.");
    assert.ok(at > 0, internal);
    assert.match(internal.slice(at), /^At the Bedroom, there are no bedrooms in this commercial building\.\nPlease refer to Photograph \d+\./);
    const lines = internal.trim().split("\n");
    assert.ok(!/^Please refer to Photograph/.test(lines[lines.length - 3] ?? "") || /At the/.test(lines[lines.length - 4] ?? ""), "the last photos follow their area's line");
    has(part(html, "External", "Walls"), "At the left elevation, not accessible.");
    const srcs = [...html.matchAll(/<img src="([^"]+)"/g)].map((x) => x[1]);
    for (const p of ["bedroom-photo", "left-photo"]) assert.equal(srcs.filter((x) => x.endsWith(p)).length, 1, p);
  });
});
