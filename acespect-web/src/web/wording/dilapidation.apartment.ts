// Dilapidation / Apartment -- the wording for this report type, and only this one.
//
// Written from Houspect's "Dilapidation Residential Apartment / Infrastructure Project" report template (May 2025) and from the
// Apartment form itself. The report template is short: a Description, four elevations, a chimney, the rooms by floor and Notes.
// The Apartment form is a longer checklist of the unit and the building (external walls, cladding, car space, doors, balconies,
// roof, ceilings, floors, plumbing, electrical, common areas, ...). So:
//   * where the template has a sentence its wording is used -- the property description ("The property is a single-storey apartment in a
//     multi-level complex ... "), "No visible significant cracking.", "There is significant cracking / damage. The most significant items
//     are:", "This elevation is on the boundary and could not be inspected.", "Sections were obscured by ...";
//   * every other answer on the form is written as a plain sentence in the same style, under a heading for the part of the building it is
//     about -- never as "Label: value" -- so nothing recorded is dropped;
//   * a part in satisfactory condition says "satisfactory ... with typical wear and tear / weathering", any other grade just states the grade;
//   * the defects themselves are worded as in Houspect's real reports ("At the entry door architrave mitre there is a diagonal crack
//     approximately 0.4 millimetres wide and approximately 70 millimetres long.").
import type { AnswerTree, ConditionSummaryRow, TemplateField } from "../templateFields";
import { asString, buildDefectNote, isGateSatisfied, withPeriod } from "../templateFields";
import { gradeOf } from "../conditionGrades";
import type { Composer } from "./shared";
import { article, capitalize, conditionOf, defectOffsets, joinClauses, joinList, lower, many, one } from "./shared";
import { houseDamageSentences, residentialHouseComposers as house, typically, wallsOf } from "./dilapidation.residential_house";
import type { ReportWording } from "./types";

const clean = (v: unknown): string =>
  asString(v as string)
    .trim()
    .replace(/\s*\n+\s*/g, " ");
/** A typed answer, as the inspector wrote it, as a sentence. */
const typed = (v: unknown): string => {
  const text = clean(v);
  return text ? capitalize(withPeriod(text)) : "";
};

// ---- Description and Overview --------------------------------------------------------------

/** The scope as the template words it ("external and internal to all structures"), from the form's four choices. */
function scopePhrase(label: string): string {
  const l = lower(label);
  if (/^external only/.test(l)) return "external only to all areas";
  if (/^internal only/.test(l)) return "internal only to all areas";
  if (/^external & internal \(full\)|^external and internal \(full\)/.test(l)) return "external and internal to all structures";
  if (/^partial/.test(l)) return "external and internal to part of the property";
  return l;
}

/** "Windows are constructed of aluminium." (the form says "Aluminium frame"); double glazing and louvres are what the windows are, not what they are made of. */
function windowsSentence(windows: string): string {
  if (/^double[- ]glazed$/.test(windows)) return "Windows are double glazed.";
  if (/^louvre/.test(windows)) return "Windows are louvre style.";
  return `Windows are constructed of ${windows.replace(/\s+frames?$/, "")}.`;
}

/** What kind of complex the form's building type says it is. */
const COMPLEX: Record<string, string> = {
  "apartment block": "an apartment block",
  "walk-up apartments": "a walk-up apartment building",
  "high-rise apartments": "a high-rise apartment building",
  "mixed-use residential": "a mixed-use residential building",
  "townhouse complex": "a townhouse complex",
  "serviced apartments": "a serviced apartment building",
};

const STOREYS: Record<string, string> = { "1": "single-storey", one: "single-storey", "2": "double-storey", two: "double-storey" };

/**
 * "The property is a single-storey apartment in a multi-level complex, on a flat block of land and estimated to have been constructed
 * around 2010. It is constructed of brick walls on concrete slab with a flat roof and a covering of tiles. Windows are constructed of aluminium frame."
 */
const description: Composer = (inst, itemFields) => {
  const buildingType = lower(one(itemFields, inst, ["buildingType"]));
  const storeysRaw = lower(asString(inst.storeys).trim());
  const slope = one(itemFields, inst, ["slope"]);
  const year = asString(inst.constructedYear).trim();
  const walls = lower(one(itemFields, inst, ["cladding"]));
  const foundations = lower(one(itemFields, inst, ["foundations"]));
  const roofDesign = lower(one(itemFields, inst, ["roofDesign"]));
  const roofCovering = lower(one(itemFields, inst, ["roofCovering"]));
  const windows = lower(one(itemFields, inst, ["windows"]));
  const works = lower(one(itemFields, inst, ["worksType"]));

  const storeys = STOREYS[storeysRaw] ?? (storeysRaw ? `${storeysRaw}-storey` : "");
  const opening: string[] = [];
  if (slope) opening.push(/^flat$/i.test(slope) ? "on a flat block of land" : `on a block of land with a ${lower(slope)}`);
  if (year) opening.push(`estimated to have been constructed around ${year}`);
  const subject = `The property is ${storeys ? `${article(storeys)} ${storeys}` : "an"} apartment in a multi-level complex`;
  const parts: string[] = [opening.length ? `${subject}, ${joinClauses(opening)}.` : `${subject}.`];
  if (buildingType) parts.push(`The complex is ${COMPLEX[buildingType] ?? `${article(buildingType)} ${buildingType}`}.`);

  const build: string[] = [];
  if (walls) build.push(`constructed of ${wallsOf([walls])}`);
  if (foundations) build.push(`on ${foundations}`);
  if (roofDesign) build.push(`with a ${roofDesign} roof`);
  if (roofCovering) build.push(`${roofDesign ? "and " : "with "}a covering of ${roofCovering}`);
  if (build.length) parts.push(`It is ${build.join(" ")}.`);
  if (windows) parts.push(windowsSentence(windows));

  const paragraphs = [parts.join(" ")];
  if (works) paragraphs.push(`The proposed works are ${works}.`);
  // Limitations to the scope and safety issues, as the inspector recorded them.
  if (asString(inst.limitations) === "yes")
    paragraphs.push(`There were limitations to the scope of the inspection.${clean(inst.limitationsNotes) ? ` ${typed(inst.limitationsNotes)}` : ""}`);
  if (asString(inst.safetyIssues) === "yes")
    paragraphs.push(`There were safety issues at the property.${clean(inst.safetyIssuesNotes) ? ` ${typed(inst.safetyIssuesNotes)}` : ""}`);
  return paragraphs.filter(Boolean).join("\n\n");
};

/** The two Description-page sentences, in the template's wording. */
function descriptionBlocks({ fields }: { fields: Record<string, unknown>; areaCount: number }): { works?: string; scope?: string } {
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const address = text(fields.projectAddr);
  const direction = lower(text(fields.direction));
  const scope = text(fields.scopeType);
  let works: string | undefined;
  if (address) {
    if (/^adjacent/.test(direction)) works = `The project works are to the property at ${address}, which is adjacent to the site of this inspection.`;
    else if (/^multiple/.test(direction)) works = `The project works are to the property at ${address}, which is at multiple sides of the site of this inspection.`;
    else if (direction) works = `The project works are to the property at ${address}, which is at the ${direction} of the site of this inspection.`;
    else works = `The project works are to the property at ${address}.`;
  }
  return { works, scope: scope ? `The scope for inspection is ${scopePhrase(scope)}.` : undefined };
}

// ---- Items the form lists one by one: driveway, fences, retaining walls, pool / spa ---------

const flagSentences = (inst: AnswerTree, flags: [string, string][]): string[] => flags.filter(([key]) => asString(inst[key]) === "yes").map(([, say]) => say);

/** An item composed by the House wording, then the form's own flags ("Notable damage was observed."). */
const withFlags =
  (compose: Composer, flags: [string, string][]): Composer =>
  (inst, itemFields, label) =>
    [compose(inst, itemFields, label), ...flagSentences(inst, flags)].filter(Boolean).join("\n\n");

const driveway = withFlags(house.driveway!, [
  ["notableDamage", "Notable damage was observed."],
  ["safetyHazard", "A safety hazard was identified."],
]);
/** "The front fence is a timber paling fence constructed of timber and is in fair condition." / "There is a masonry retaining wall to the left, constructed of brick." */
function structureComposer(kind: "fence" | "retaining wall", flags: [string, string][]): Composer {
  return (inst, itemFields) => {
    const location = lower(one(itemFields, inst, ["location"]));
    const structure = lower(one(itemFields, inst, ["structureType"]));
    const material = lower(one(itemFields, inst, ["material"]));
    const cond = conditionOf(itemFields, inst);
    const obscured = many(itemFields, inst, ["obstructions"]).map(lower);
    const parts: string[] = [];
    if (cond.tag) parts.push(cond.tag);
    const grade = cond.word ? `in ${cond.word} condition${typically(cond.word, "weathering")}` : "";
    const noun = kind === "fence" ? "fence" : "wall";
    let text: string;
    if (kind === "fence") {
      const subject = `The ${location ? `${location} ` : ""}fence`;
      const built = [structure ? `is ${article(structure)} ${structure} fence` : "", material ? `constructed of ${material}` : ""].filter(Boolean).join(" ");
      const predicates = [built, grade ? `is ${grade}` : ""].filter(Boolean);
      text = predicates.length ? `${subject} ${predicates.join(" and ")}.` : `${subject} was inspected.`;
    } else {
      text = `There is ${article(structure || "retaining")} ${structure ? `${structure} ` : ""}retaining wall${location ? ` to the ${location}` : ""}${material ? `, constructed of ${material}` : ""}.${grade ? ` It is ${grade}.` : ""}`;
    }
    if (obscured.length) text += ` Sections of the ${noun} were obscured by ${joinList(obscured)}.`;
    parts.push(text);
    const notes = clean(inst.notes);
    return [...parts, ...flagSentences(inst, flags), houseDamageSentences(inst, itemFields), notes ? capitalize(withPeriod(notes)) : ""].filter(Boolean).join("\n\n");
  };
}
const fences = structureComposer("fence", [
  ["notableDamage", "Notable damage was observed."],
  ["notableCracking", "Notable cracking was observed."],
]);
const retainingWalls = structureComposer("retaining wall", [
  ["notableDamage", "Notable damage was observed."],
  ["notableCracking", "Notable cracking was observed."],
]);
const poolSpa = withFlags(house.pool_spa!, [["hasDamage", "Damage was present."]]);

// ---- The checklist sections ------------------------------------------------------------------

/** One part of the building the checklist asks about: its heading, what to call it in a sentence, and what its "nothing visible" line says. */
type Group = { prefix: string; title: string; subject: string; plural?: boolean; good?: string };

const CRACKING = "No visible significant cracking.";
const CRACKS = "No visible significant cracks.";

const GROUPS: Record<string, Group[]> = {
  elevations: [
    { prefix: "elev_overview", title: "Elevations overview", subject: "The elevations", plural: true },
    { prefix: "ext_walls", title: "External walls", subject: "The external walls", plural: true, good: CRACKING },
    { prefix: "cladding", title: "Cladding", subject: "The cladding", good: CRACKING },
    { prefix: "garage", title: "Car space", subject: "The car space" },
    { prefix: "front_door", title: "Front door", subject: "The front door" },
    { prefix: "other_doors_ext", title: "Other external doors", subject: "The other external doors", plural: true },
    { prefix: "balconies", title: "Balconies", subject: "The balconies", plural: true },
  ],
  garage_carport_sheds: [{ prefix: "carspace", title: "Car space", subject: "The car space" }],
  roof_chimneys: [
    { prefix: "roof_covering", title: "Roof covering", subject: "The roof covering" },
    { prefix: "eaves", title: "Eaves", subject: "The eaves", plural: true },
    { prefix: "fascia", title: "Fascia", subject: "The fascia" },
    { prefix: "gutters", title: "Gutters", subject: "The gutters", plural: true },
    { prefix: "downpipes", title: "Downpipes", subject: "The downpipes", plural: true },
  ],
  internal_areas: [
    { prefix: "int_roof", title: "Roof space", subject: "The roof space" },
    { prefix: "party_walls", title: "Party walls", subject: "The party walls", plural: true },
    { prefix: "ceilings", title: "Ceilings", subject: "The ceilings", plural: true, good: CRACKS },
    { prefix: "int_walls", title: "Internal walls", subject: "The internal walls", plural: true, good: CRACKS },
    { prefix: "floors", title: "Floors", subject: "The floors", plural: true, good: CRACKS },
    { prefix: "int_stairs", title: "Stairs", subject: "The stairs", plural: true },
    { prefix: "int_windows", title: "Windows (internal)", subject: "The internal windows", plural: true },
    { prefix: "int_doors", title: "Internal doors", subject: "The internal doors", plural: true },
    { prefix: "cabinets", title: "Cabinets", subject: "The cabinets", plural: true },
    { prefix: "plumbing", title: "Plumbing", subject: "The plumbing" },
    { prefix: "gas", title: "Gas", subject: "The gas supply" },
    { prefix: "electrical", title: "Electrical", subject: "The electrical installation" },
    { prefix: "fireplace", title: "Fireplace", subject: "The fireplace" },
  ],
  paving_paths: [
    { prefix: "foyer", title: "Foyer", subject: "The foyer" },
    { prefix: "lifts", title: "Lifts", subject: "The lifts", plural: true },
    { prefix: "driveway_common", title: "Common driveway", subject: "The common driveway" },
    { prefix: "ext_paving", title: "External paving", subject: "The external paving" },
    { prefix: "pool", title: "Pool / spa", subject: "The pool / spa" },
    { prefix: "meeting_room", title: "Meeting room", subject: "The meeting room" },
    { prefix: "gym", title: "Gym", subject: "The gym" },
    { prefix: "roof_terrace", title: "Roof terrace", subject: "The roof terrace" },
    { prefix: "fences_common", title: "Common fences", subject: "The common fences", plural: true },
  ],
  notes: [
    { prefix: "structural", title: "Structural", subject: "The unit" },
    { prefix: "major_defects", title: "Major defects", subject: "The unit" },
    { prefix: "safety", title: "Safety", subject: "The unit" },
    { prefix: "post_project", title: "Notes and areas not accessed", subject: "The unit" },
  ],
};

/** Says one answer in a sentence: the answer's text (lower case), whether a yes/no was "yes", and the part of the building it is about. */
type Say = (value: string, yes: boolean, subject: string, be: string) => string;
const flag =
  (yes: string, no = ""): Say =>
  (_v, isYes) =>
    isYes ? yes : no;
const numberOf = (v: string): number => (/^\d+$/.test(v.trim()) ? Number(v) : NaN);
const alarmCount =
  (kind: string): Say =>
  (v) => {
    const n = numberOf(v);
    return n === 1 ? `There is 1 ${kind} smoke alarm.` : `There are ${v} ${kind} smoke alarms.`;
  };

/** The sentence for each question that is not simply a material, a grade, a list of findings, defects or a comment. */
const SAY: Record<string, Say> = {
  // Elevations
  elev_overview_elevations: (v) => (/^all/.test(v) ? "All accessible faces were inspected." : `The ${v} elevation was inspected.`),
  // The template's own sentence for a party wall / limited access elevation.
  elev_overview_partyWall: flag("This elevation is on the boundary and could not be inspected."),
  elev_overview_claddingCond: (v) => (/^damage/.test(v) ? "Damage was recorded to the cladding." : `The cladding is ${v}.`),
  elev_overview_openings: (v) =>
    /^damage/.test(v)
      ? "Damage was recorded to the windows and doors."
      : /^deterioration/.test(v)
        ? "Deterioration was noted to the windows and doors."
        : `The windows and doors are ${v}.`,
  elev_overview_guttersCond: (v) =>
    /^damage/.test(v) ? "Damage was recorded to the gutters and downpipes." : `The gutters and downpipes are ${v.replace(/\s*\/\s*/g, " or ")}.`,
  ext_walls_rendered: flag("The external walls are rendered.", "The external walls are not rendered."),
  ext_walls_majorCracking: flag("There are signs of major cracking to the external walls."),
  ext_walls_sigWeathering: flag("There are signs of significant weathering to the external walls."),
  ext_walls_generallyStable: flag("The external walls are generally stable.", "The external walls are not generally stable."),
  cladding_rendered: flag("The cladding is rendered.", "The cladding is not rendered."),
  cladding_sigCracking: flag("There are signs of significant cracking to the cladding."),
  cladding_sigWeathering: flag("There are signs of significant weathering to the cladding."),
  cladding_requires: (v) => `The cladding requires ${v}.`,
  garage_type: (v) => (/^no car space/.test(v) ? "No car space is allocated to this apartment." : `There is a ${v.replace(/\bin basement$/, "in the basement")}.`),
  garage_reqAttention: flag("The car space requires attention."),
  carspace_type: (v) => SAY.garage_type!(v, false, "", ""),
  carspace_reqAttention: flag("The car space requires attention."),
  front_door_requires: (v) => `The front door requires ${v}.`,
  front_door_secScreen: flag("The front door has a security screen.", "The front door does not have a security screen."),
  front_door_deadlocks: flag("Deadlocks are fitted to the front door.", "Deadlocks are not fitted to the front door."),
  front_door_doorCloser: (v) => (/^yes/.test(v) ? "The front door closer is working." : /^no$/.test(v) ? "The front door closer is not working." : ""),
  other_doors_ext_style: (v) => (/^variety/.test(v) ? "The other external doors are a variety of styles." : `The other external doors are ${v}.`),
  other_doors_ext_requires: (v) => `The other external doors generally require ${v}.`,
  balconies_adequatelyFixed: flag("The balconies appear to be adequately fixed to the building.", "The balconies do not appear to be adequately fixed to the building."),
  balconies_handRails: (v) =>
    /^not required/.test(v)
      ? "Hand rails are not required to the balconies."
      : /yes$/.test(v)
        ? "The hand rails to the balconies are adequate."
        : "The hand rails to the balconies are not adequate.",
  balconies_handRailCond: (v) => `The hand rails to the balconies are in ${v} condition.`,
  // Roof
  gutters_gutterType: (v) => (/^both/.test(v) ? "The gutters are both perimeter and boxed gutters." : `The gutters are ${v}.`),
  // Internal
  party_walls_location: (v) => `The party walls are at ${v.replace(/[.\s]+$/, "")}.`,
  party_walls_extendsToRoof: flag(
    "The party wall extends to the underside of the roof covering.",
    "The party wall does not extend to the underside of the roof covering.",
  ),
  party_walls_fireBarrier: flag(
    "The party wall appears to be appropriately constructed as a fire barrier.",
    "The party wall does not appear to be appropriately constructed as a fire barrier.",
  ),
  ceilings_cornices: (v) => (/^varying/.test(v) ? "The cornices vary." : `The cornices are ${v}.`),
  ceilings_adequatelyFixed: flag("The ceilings are adequately fixed.", "The ceilings are not adequately fixed."),
  floors_coverings: (v) => `The floor coverings are ${v}.`,
  int_stairs_handrails: (v) =>
    /^not required/.test(v)
      ? "Hand rails are not required to the stairs."
      : /yes$/.test(v)
        ? "The hand rails to the stairs are adequate."
        : "The hand rails to the stairs are not adequate.",
  int_windows_locksGeneral: flag("Locks are generally fitted to the internal windows.", "Locks are not generally fitted to the internal windows."),
  int_windows_flywire: (v) => (/^none/.test(v) ? "No flywire screens are fitted to the windows." : `Flywire screens are fitted to ${v}.`),
  int_windows_flywireCondition: (v) =>
    /^satisfactory with typical wear and tear$/.test(v) ? "The flywire screens are in satisfactory condition with typical wear and tear." : `The flywire screens are in ${v} condition.`,
  int_doors_style: (v) => (/^several/.test(v) ? "The internal doors are of several styles." : `The internal doors are generally ${v}.`),
  plumbing_waterSupplyOn: flag("The water supply was on.", "The water supply was off."),
  plumbing_tapsNormal: flag("All taps, showers and toilets operated normally.", "Not all taps, showers and toilets operated normally."),
  plumbing_waterHammer: flag("Water hammer is present."),
  plumbing_drainsNormal: flag("All sinks, vanities and showers drained normally.", "Not all sinks, vanities and showers drained normally."),
  plumbing_waterLeaks: flag("There are water leaks to taps, waste pipes or showers."),
  gas_supplyType: (v) => (/^mains/.test(v) ? "The gas supply is mains gas." : `The gas supply is ${v}.`),
  gas_gasSupplyOn: flag("The gas supply was on.", "The gas supply was off."),
  gas_detectedLeaks: flag("Gas leaks were detected."),
  gas_appliancesOperated: flag("The gas appliances operated correctly.", "The gas appliances did not operate correctly."),
  electrical_powerOn: flag("The power supply was on.", "The power supply was off."),
  electrical_appliancesOperated: flag("The lights, fans and appliances operated correctly.", "Not all the lights, fans and appliances operated correctly."),
  electrical_rcdCount: (v) => (/^nil$/.test(v) ? "There are no RCDs installed." : numberOf(v) === 1 ? "There is 1 RCD." : `There are ${v} RCDs.`),
  electrical_batteryAlarms: flag("Battery smoke alarms are installed.", "Battery smoke alarms are not installed."),
  electrical_batteryAlarmsCount: alarmCount("battery"),
  electrical_hardwiredAlarms: flag("Hardwired smoke alarms are installed.", "Hardwired smoke alarms are not installed."),
  electrical_hardwiredCount: alarmCount("hardwired"),
  electrical_alarmsLocated: flag("Smoke alarms are within 1.5 metres of each sleeping area.", "Smoke alarms are not within 1.5 metres of each sleeping area."),
  fireplace_type: (v) => `The fireplace has ${article(v)} ${v}.`,
  fireplace_count: (v) => (numberOf(v) === 1 ? "There is 1 fireplace." : `There are ${v} fireplaces.`),
  fireplace_operating: flag("The fireplace was operating at the time of the inspection.", "The fireplace was not operating at the time of the inspection."),
  // Common areas
  pool_type: (v) => `There is a ${v}.`,
  pool_fencingAdequate: flag("The pool / spa fencing appears adequate.", "The pool / spa fencing does not appear adequate."),
  // Notes
  structural_structurallySound: flag("The unit is considered structurally sound.", "The unit is not considered structurally sound."),
  major_defects_freeOfMajorDefects: flag("The unit is free of major defects in relation to its age.", "The unit is not free of major defects in relation to its age."),
  safety_safetyMatters: flag("Safety matters are evident."),
};

/** Free-text questions: the inspector's own words, printed as written. */
const TYPED = /(_comments|_describe)$/;

/** Does this report type's wording have a sentence for the checklist question `key`? (Tested for every question on the form.) */
export function apartmentSaysField(key: string, type: string): boolean {
  if (type === "photos" || type === "damage-list") return true;
  if (/_(applicable|naReason|condition)$/.test(key)) return true;
  if (/_materialOther$|Other$/.test(key)) return true; // read with the question it belongs to
  if (/_material$/.test(key)) return true;
  if (type === "chip-multiselect" || type === "tile-multiselect") return true;
  if (TYPED.test(key) || key === "post_project_describe") return true;
  return key in SAY;
}

const groupOf = (key: string, groups: Group[]): Group | undefined =>
  groups.filter((g) => key.startsWith(`${g.prefix}_`)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
const hasAnswer = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v !== "" : typeof v === "number");
/**
 * What each checklist observation says as a full sentence. The form words them as the inspector's shorthand ("Loose bricks",
 * "Drummy render", "Typical wear and tear"); the report says each as a sentence of its own, advice split off into a second one.
 * Keyed by the option's label, lower case.
 */
const OBSERVATION_SENTENCES: Record<string, string> = {
  // External walls
  "minor cracking visible consistent with age – not structural": "Minor cracking is visible, consistent with age, and is not structural.",
  "cracking over window/door heads – typical, not structural unless bricks loose": "There is cracking over the window and door heads, which is typical and not structural unless the bricks are loose.",
  "major cracking requiring repairs – not yet structural but attend soon": "There is major cracking requiring repairs. It is not yet structural but should be attended to soon.",
  "immediate repairs required – consider consulting structural engineer": "Immediate repairs are required. Consider consulting a structural engineer.",
  "loose bricks": "There are loose bricks.",
  "drummy render": "The render is drummy.",
  "fretting mortar requires repointing": "There is fretting mortar that requires repointing.",
  "evidence of rising damp": "There is evidence of rising damp.",
  "patching and re-pointing where appliances/fittings removed": "There is patching and re-pointing where appliances or fittings have been removed.",
  "mortar out of joints at lower courses – needs repointing": "There is mortar missing from the joints at the lower courses, which needs repointing.",
  "spalling to some bricks": "There is spalling to some bricks.",
  "weep holes not visible": "The weep holes are not visible.",
  "weep holes covered or partly covered – keep clear": "The weep holes are covered or partly covered and should be kept clear.",
  "sub-floor vents covered or partly covered – keep clear": "The sub-floor vents are covered or partly covered and should be kept clear.",
  // Cladding
  "some weathering visible – requires maintenance or replacement": "There is some weathering visible, which requires maintenance or replacement.",
  "breakage visible to cement sheet wall cladding": "There is breakage visible to the cement sheet wall cladding.",
  "cladding may contain asbestos": "The cladding may contain asbestos.",
  // Car space
  "cracking to walls": "There is cracking to the walls.",
  "repairs required": "Repairs are required.",
  "damp visible to external walls": "There is damp visible to the external walls.",
  "minor cracking to hardstand – monitor from time to time": "There is minor cracking to the hardstand, which should be monitored from time to time.",
  "storage cage in basement": "There is a storage cage in the basement.",
  // Other external doors
  "doors are binding – require 2mm clearance": "The doors are binding and require 2mm clearance.",
  "edges of door require sealing to avoid water damage": "The edges of the doors require sealing to avoid water damage.",
  "door latch not engaging": "A door latch is not engaging.",
  // Balconies
  "there is decay to hand rails": "There is decay to the hand rails.",
  "hand rails do not comply with current australian standards": "The hand rails do not comply with current Australian Standards.",
  "balustrade is loose and requires maintenance": "The balustrade is loose and requires maintenance.",
  "handrail/balustrade height is less than 1000mm – non-compliant": "The handrail or balustrade height is less than 1000mm, which is non-compliant.",
  "balustrade spacing between railings more than 125mm – non-compliant": "The spacing between the balustrade railings is more than 125mm, which is non-compliant.",
  "water appears to pond on balcony floor – floor falls not channelling to drain": "Water appears to pond on the balcony floor because the floor falls are not channelling to the drain.",
  "balcony floor drainage may be blocked – recommend cleaning as maintenance": "The balcony floor drainage may be blocked. Cleaning is recommended as maintenance.",
  // Party walls, ceilings, internal walls, floors
  "roof timbers passing through party wall – brickwork does not go to underside of roof covering": "Roof timbers pass through the party wall because the brickwork does not extend to the underside of the roof covering.",
  "ceiling not adequately attached to ceiling frame – has deflected significantly": "The ceiling is not adequately attached to the ceiling frame and has deflected significantly.",
  "minor imperfections / hairline cracks consistent with age – not a significant defect": "There are minor imperfections and hairline cracks consistent with age, which are not a significant defect.",
  "flaking / mould / mildew to paintwork from excessive moisture in wet areas – install mechanical ventilation": "There is flaking, mould or mildew to the paintwork from excessive moisture in the wet areas. Mechanical ventilation should be installed.",
  "minor paint flaking": "There is minor paint flaking.",
  "watermarks and staining visible due to a water leak": "There are watermarks and staining visible due to a water leak.",
  "minor cracking over doorways and/or windows consistent with age – not a structural concern": "There is minor cracking over the doorways or windows, consistent with age, which is not a structural concern.",
  "minor cracking consistent with age, due to normal settlement/movement": "There is minor cracking consistent with age, due to normal settlement or movement.",
  "structural cracks requiring investigation by a structural engineer": "There are structural cracks requiring investigation by a structural engineer.",
  "drummy / loose / flaking plaster": "The plaster is drummy, loose or flaking.",
  "damp from shower/bath in adjacent room to the base of the wall": "There is damp to the base of the wall from the shower or bath in the adjacent room.",
  "floor tiling drummy": "The floor tiling is drummy.",
  "concrete floor has minor cracking caused by rate of drying – not of a structural nature": "The concrete floor has minor cracking caused by the rate of drying, which is not of a structural nature.",
  "timber floors are creaking / bouncy and require refixing": "The timber floors are creaking or bouncy and require refixing.",
  "floors unlevel": "The floors are unlevel.",
  // Stairs
  "handrail/balustrade height is less than 1000mm – does not comply with aust standards": "The handrail or balustrade height is less than 1000mm and does not comply with Australian Standards.",
  "balustrade spacing between railings is more than 125mm – does not comply with aust standards": "The spacing between the balustrade railings is more than 125mm and does not comply with Australian Standards.",
  "balustrade has horizontal rails that may be climbable by a child – add to safety matters": "The balustrade has horizontal rails that may be climbable by a child. This has been added to Safety Matters.",
  "stair treads / risers are not equal – do not comply with current aust standards": "The stair treads or risers are not equal and do not comply with current Australian Standards.",
  "stair risers are higher than the maximum 190mm – do not comply with current aust standards": "The stair risers are higher than the maximum 190mm and do not comply with current Australian Standards.",
  "stair treads are less than the minimum 240mm – do not comply with current aust standards": "The stair treads are less than the minimum 240mm and do not comply with current Australian Standards.",
  // Windows, doors, cabinets
  "at upper windows, restrictors need to be fitted to maximum opening of 125mm – safety concern": "At the upper windows, restrictors need to be fitted to limit the opening to a maximum of 125mm, which is a safety concern.",
  "doors binding and need maintenance": "The doors are binding and need maintenance.",
  "door furniture is loose / not latching": "The door furniture is loose or not latching.",
  "cabinet drawers are binding and need adjustment": "The cabinet drawers are binding and need adjustment.",
  "cabinet / robe doors are binding and need adjustment": "The cabinet and robe doors are binding and need adjustment.",
  "cabinet / robe doors do not close properly – need adjustment": "The cabinet and robe doors do not close properly and need adjustment.",
  "water damage / swelling to cabinet": "There is water damage or swelling to the cabinet.",
  // Gas, electrical, fireplace
  "consult a licensed gas fitter": "A licensed gas fitter should be consulted.",
  "add to safety matters": "This has been added to Safety Matters.",
  "nil rcds installed – add to safety matters": "There are no RCDs installed. This has been added to Safety Matters.",
  "smoke alarms not correctly located – refer to safety matters": "The smoke alarms are not correctly located. Please refer to Safety Matters.",
  "recommend urgent servicing": "Urgent servicing of the fireplace is recommended.",
  // Safety
  "smoke alarms not installed in required locations per as 3.7.2.3": "Smoke alarms are not installed in the required locations as per AS 3.7.2.3.",
  "insulation touching/covering recessed light fittings – fire hazard": "Insulation is touching or covering the recessed light fittings, which is a fire hazard.",
  "fibre cement sheeting that may contain asbestos (construction 1930s–mid 1980s)": "There is fibre cement sheeting that may contain asbestos (construction 1930s–mid 1980s).",
  "refer to pool safety concerns": "Please refer to the Pool safety concerns.",
  "refer to stairs safety concerns": "Please refer to the Stairs safety concerns.",
  "refer to trip hazard concerns": "Please refer to the Trip hazard concerns.",
  // Common areas
  "minor cracking": "There is minor cracking.",
  "major cracking or subsidence – may cause tripping hazard": "There is major cracking or subsidence, which may cause a tripping hazard.",
  "significant cracking or subsidence – may cause tripping hazard": "There is significant cracking or subsidence, which may cause a tripping hazard.",
  "pool safety barrier is compromised": "The pool safety barrier is compromised.",
  "pool gates are not self-latching – do not meet pool regulations": "The pool gates are not self-latching and do not meet pool regulations.",
  "pool gate does not swing in the correct direction": "The pool gate does not swing in the correct direction.",
  "latch height of pool gate is too low": "The latch height of the pool gate is too low.",
  // Roof
  "visible damage to roof covering": "There is visible damage to the roof covering.",
  "refer to strata/body corporate for roof maintenance": "Please refer to the strata or body corporate for roof maintenance.",
  "evidence of overflowing gutters – engage a licensed plumber": "There is evidence of overflowing gutters. A licensed plumber should be engaged.",
  "the downpipes are leaking – engage a licensed plumber": "The downpipes are leaking. A licensed plumber should be engaged.",
};

/** The observations whose subject is the part of the building they are ticked under ("Need normal maintenance" under Gutters). */
function observationAbout(option: string, subject: string, plural: boolean): string | undefined {
  const s = capitalize(subject.startsWith("The ") ? subject : `The ${lower(subject)}`);
  const need = plural ? "need" : "needs";
  const require = plural ? "require" : "requires";
  const o = option.toLowerCase().replace(/\s+$/, "");
  if (o === "typical wear and tear") return `${s} ${plural ? "show" : "shows"} typical wear and tear.`;
  if (o === "need normal maintenance") return `${s} ${need} normal maintenance.`;
  if (o === "decayed and need repair") return `${s} ${plural ? "are" : "is"} decayed and ${need} repair.`;
  if (o === "require repair" || o === "require replacement" || o === "require partial replacement" || o === "require normal maintenance" || o === "require maintenance to the joints")
    return `${s} ${require} ${o.slice("require ".length)}.`;
  if (o === "requires normal maintenance") return `${s} ${require} normal maintenance.`;
  if (o === "no attention required") return `${s} ${require} no attention.`;
  return undefined;
}

/** One ticked observation, as the full sentence(s) the report says. */
const sentenceOf = (option: string, subject = "", plural = false): string => {
  const key = option.toLowerCase().replace(/\s+$/, "");
  return OBSERVATION_SENTENCES[key] ?? observationAbout(option, subject, plural) ?? capitalize(withPeriod(option.replace(/\s+$/, "")));
};

/** What a ticked observation reads as in the report (tested for every option on the form). */
export function apartmentObservation(sectionKey: string, fieldKey: string, option: string): string {
  const group = groupOf(fieldKey, GROUPS[sectionKey] ?? []);
  return sentenceOf(option, group?.subject, !!group?.plural);
}

/** "There is significant cracking / damage. The most significant items are:" in whichever of the template's words fits what was recorded. */
function significantLead(list: AnswerTree[]): string {
  const cracks = list.filter((d) => !asString(d.damageType) || asString(d.damageType) === "cracking").length;
  return `There is significant ${cracks === list.length ? "cracking" : cracks === 0 ? "damage" : "cracking and damage"}. The most significant items are:`;
}

/** The checklist sections: each group of questions under its heading, with the grade, what was found and the defects. */
function checklistComposer(sectionKey: string): Composer {
  const groups = GROUPS[sectionKey]!;
  // The Notes section prints as a plain numbered list, with no headings or grade tags.
  const plain = sectionKey === "notes";
  return (inst, itemFields) => {
    const offsets = defectOffsets(itemFields, inst);
    const blocks: string[] = [];
    for (const group of groups) {
      const fields = itemFields.filter((f) => groupOf(f.key, groups) === group && isGateSatisfied(f, inst));
      if (!fields.some((f) => f.type !== "photos" && hasAnswer(inst[f.key]))) continue; // this group was not visited
      const be = group.plural ? "are" : "is";
      if (!plain) blocks.push(`ROOMHEAD::${group.title}`);
      // The grade comes straight under the heading, and is said.
      const condField = fields.find((f) => f.key === `${group.prefix}_condition`);
      const applicable = fields.find((f) => f.key === `${group.prefix}_applicable`);
      const notApplicable = !!applicable && asString(inst[applicable.key]) === "no";
      const cond = condField && !notApplicable ? conditionOf(itemFields, inst, [condField.key]) : undefined;
      if (cond?.tag && !plain) blocks.push(cond.tag);
      // Not applicable / not accessible: say so (and why) and keep only what the inspector added.
      if (notApplicable) {
        const reason = lower(one(itemFields, inst, [`${group.prefix}_naReason`]));
        blocks.push(`${group.subject} ${be} not applicable${reason && reason !== "not applicable" ? ` (${reason})` : ""}.`);
        const comment = typed(inst[`${group.prefix}_comments`]);
        if (comment) blocks.push(comment);
        continue;
      }
      const sentences: string[] = [];
      const list = Array.isArray(inst[`${group.prefix}_damages`]) ? (inst[`${group.prefix}_damages`] as AnswerTree[]) : [];
      // The grade is said where the form asks for it, then the template's "no visible significant cracking" line when nothing is wrong with this part.
      const flagged = fields.some((f) => /_(majorCracking|sigCracking)$/.test(f.key) && asString(inst[f.key]) === "yes");
      const sayGrade = (): void => {
        if (cond?.word) sentences.push(`${group.subject} ${be} in ${cond.word} condition${typically(cond.word, "wear and tear")}.`);
        if (group.good && list.length === 0 && !flagged) sentences.push(group.good);
      };
      if (!condField) sayGrade();
      for (const field of fields) {
        const key = field.key;
        if (field.type === "photos" || key === `${group.prefix}_applicable` || key === `${group.prefix}_naReason`) continue;
        if (/Other$/.test(key) && fields.some((f) => f.key === key.slice(0, -5))) continue; // the typed "Other" is read with its question
        if (key === `${group.prefix}_condition`) {
          sayGrade();
          continue;
        }
        if (field.type === "damage-list") {
          if (sentences.length) blocks.push(sentences.splice(0).join(" "));
          if (list.length) blocks.push(significantLead(list), houseDamageSentences(inst, itemFields, { key, indexOffset: offsets[key] ?? 0 }));
          continue;
        }
        if (!hasAnswer(inst[key])) continue;
        if (field.type === "textarea" || TYPED.test(key)) {
          if (sentences.length) blocks.push(sentences.splice(0).join(" "));
          const text = typed(inst[key]);
          if (text) blocks.push(text);
          continue;
        }
        if (/_material$/.test(key)) {
          const material = lower(one(itemFields, inst, [key]));
          if (material) sentences.push(`${group.subject} ${be} constructed of ${material}.`);
          continue;
        }
        if (field.type === "chip-multiselect" || field.type === "tile-multiselect") {
          for (const item of many(itemFields, inst, [key])) sentences.push(sentenceOf(item, group.subject, !!group.plural));
          continue;
        }
        const say = SAY[key];
        if (!say) continue;
        const value = lower(one(itemFields, inst, [key])).replace(/\bpaneled\b/g, "panelled");
        // A choice of "Other" with nothing typed says nothing (rather than a sentence with a gap in it).
        if (field.type !== "yesno" && (!value || value === "other")) continue;
        const sentence = say(value, asString(inst[key]) === "yes", group.subject, be);
        if (sentence) sentences.push(sentence);
      }
      if (sentences.length) blocks.push(sentences.join(" "));
    }
    return blocks.filter(Boolean).join("\n\n");
  };
}

/** One Condition Summary row per group that has a grade. */
function summaryRows(sectionKey: string, inst: AnswerTree, itemFields: TemplateField[]): ConditionSummaryRow[] | undefined {
  const groups = GROUPS[sectionKey];
  if (!groups) return undefined;
  const rows: ConditionSummaryRow[] = [];
  for (const group of groups) {
    const field = itemFields.find((f) => f.key === `${group.prefix}_condition`);
    if (!field || !isGateSatisfied(field, inst)) continue;
    const applicable = itemFields.find((f) => f.key === `${group.prefix}_applicable`);
    if (applicable && asString(inst[applicable.key]) === "no") continue;
    const grade = gradeOf(field.options?.find((o) => o.value === asString(inst[field.key])));
    if (!grade) continue;
    const damageField = itemFields.find((f) => f.key === `${group.prefix}_damages`);
    rows.push({
      subLabel: group.title,
      conditionLabel: grade.label,
      conditionColor: grade.color,
      defectNote: damageField ? buildDefectNote(damageField, inst) : undefined,
    });
  }
  return rows;
}

// ---- The wording ----------------------------------------------------------------------------

export const dilapidationApartment: ReportWording = {
  profile: { inspectionType: "dilapidation", propertyType: "apartment" },
  status: "final",
  composers: {
    description,
    driveway,
    fences,
    retaining_walls: retainingWalls,
    pool_spa: poolSpa,
    elevations: checklistComposer("elevations"),
    garage_carport_sheds: checklistComposer("garage_carport_sheds"),
    roof_chimneys: checklistComposer("roof_chimneys"),
    internal_areas: checklistComposer("internal_areas"),
    paving_paths: checklistComposer("paving_paths"),
    notes: checklistComposer("notes"),
    custom_structure: house.custom_structure!,
  },
  absence: {},
  // The description and the checklist sections are flat in the Apartment form (no repeating group).
  isFlatComposed: (sectionKey, templateFields) =>
    sectionKey === "description" || sectionKey.startsWith("custom_") || (sectionKey in GROUPS && !templateFields.some((f) => f.type === "repeating-group")),
  metadataFields: {},
  noSummarySections: ["description"],
  absentSlotSections: [],
  damageSentences: houseDamageSentences,
  summaryRows,
  descriptionBlocks,
};
