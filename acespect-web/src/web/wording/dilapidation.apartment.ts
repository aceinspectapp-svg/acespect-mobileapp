// Dilapidation / Apartment -- the wording for this report type, and only this one.
//
// Written line by line from Houspect's Nov 2026 office template "ACESPECT Dilapidation Multi Level Office Building _Office Template
// Nov 2026.dotm". The report prints the template's headings, in the template's order, with the template's sentences under them:
//
//   DESCRIPTION AND OVERVIEW   "The property is a [unit in a 10-storey apartment block] signed as [Unit 7], facing [north] on a [flat]
//                              block of land. It is of a [contemporary] design and estimated to have been constructed around the [2010]s.
//                              It is constructed of [concrete panel] walls on [concrete slab] with a [flat] roof and a covering of
//                              [membrane]. Windows are constructed of [aluminium]."  (+ the Photographs and Scope sentences)
//   EXTERNAL
//   Driveway                   "There is no driveway." / "The driveway is constructed of [concrete]. It is in satisfactory condition with
//                              typical wear and tear."  (the form records no location or obstruction for the common driveway)
//   Paving / Parking areas / Basement car parks
//                              "There is paving, constructed of [pavers]. It is in satisfactory condition with typical wear and tear."
//   Fences and Retaining Walls "There are no fences surrounding this property."
//   Garage/Carport/Loading Bay "There is a garage located in the basement, constructed of [concrete] with a [concrete slab] roof, and is
//                              generally in [fair] state of repair."
//   Any other free standing Structures
//                              "There is a [pool], constructed of [concrete]." / an added structure: "There is a [water tank],
//                              constructed of [metal], which is generally in [satisfactory] state of repair."
//   Main structure             ([Left] Elevation when one side was inspected) "Satisfactory condition with typical wear and tear." /
//                              "The left elevation is a party wall abutting the next property at No. [12]. It is constructed of [brick]
//                              which is in [fair] condition." / "Downpipe is not connected to the stormwater system."
//   Roof Covering              "The roof could not be inspected as the building is a multi-level building complex. Roof coverings in a
//                              building complex are common property and need to be maintained through the Owners Corporation."
//   INTERNAL
//   Unit Areas / Common Areas  each part of the unit, and the common rooms ("Reception / Foyer", "Meeting Room"), under its own heading:
//                              "Satisfactory condition with typical wear and tear."
//   NOTES                      the inspector's notes, as the template's bullet points
//
// Every defect is the template's line: "At the [hallway wall], there is a crack starting at [the door head] and running to [the cornice].
// The crack is [2] millimetres wide and [600] millimetres long." ("approximately" inside) -- anything that is not a crack: "There is
// [weathering] to the [sheet joints] at the [stairwell cladding]." (the template's "There is damage to the ... at ...").
// Each item's photos print under it (the template's "Please refer to Photographs ..."). A grade other than satisfactory: "It is in fair
// condition." Nothing else is printed: no comment lines, no defect notes, no condition tags, no Condition Summary page -- the template has
// none -- and none of the form's Pre-Purchase checklist questions (see apartmentLeavesOut).
import type { AnswerTree, ConditionSummaryRow, TemplateField } from "../templateFields";
import { asString, asStringArray, buildDefectNote, isGateSatisfied, otherAnswerText, withPeriod } from "../templateFields";
import { gradeOf } from "../conditionGrades";
import type { Composer } from "./shared";
import { article, capitalize, conditionOf, defectOffsets, handedSide, isNotPresent, joinList, lower, many, obstructionsSentence, one, typedCase, withThe } from "./shared";
import { houseDamageSentences, type DefectStyle, MULTI_LEVEL, NOV2026, NOV2026_FENCE, NOV2026_INTERNAL, repairState, typically, wallsOf } from "./dilapidation.residential_house";
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

/** The template's defect lines (MULTI_LEVEL): outside, "The crack is 2 millimetres wide ..."; inside, "approximately"; a fence's "A ... at ...". */
const EXTERNAL: DefectStyle = { ...NOV2026, ...MULTI_LEVEL };
const INTERNAL: DefectStyle = { ...NOV2026_INTERNAL, ...MULTI_LEVEL };
const FENCE: DefectStyle = { ...NOV2026_FENCE, ...MULTI_LEVEL };

/** The template's grade under an item's heading: "Satisfactory condition with typical wear and tear." -- another grade: "It is in fair condition." */
function gradeSentence(word: string, plural: boolean): string {
  if (!word) return "";
  if (word === "satisfactory") return "Satisfactory condition with typical wear and tear.";
  return `${plural ? "They are" : "It is"} in ${word} condition.`;
}

/** The template's roof of a multi-level building. */
const COMPLEX_ROOF =
  "The roof could not be inspected as the building is a multi-level building complex. Roof coverings in a building complex are common property and need to be maintained through the Owners Corporation.";
const OWNERS_CORPORATION = "Roof coverings in a building complex are common property and need to be maintained through the Owners Corporation.";

/** The template's headings, in the order it prints them. */
const PART = {
  driveway: "Driveway",
  paving: "Paving / Parking areas / Basement car parks",
  fences: "Fences and Retaining Walls",
  garage: "Garage/Carport/Loading Bay",
  structures: "Any other free standing Structures",
  main: "Main structure",
  roofChimney: "Roof Covering and Chimney",
  roof: "Roof Covering",
  internal: "INTERNAL",
  // the first Apartment form's element-based internal parts
  unit: "Unit Areas",
  common: "Common Areas",
} as const;

/** Report-text marks (see reportParts.ts): where one of the template's headings starts, and where an item's photos print. */
const part = (title: string): string => `PART::${title}`;
const photosOf = (keys: string[]): string => (keys.length ? `PHOTOS::${keys.join(",")}` : "");

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

/** What kind of building the unit is in, from the form's building type (the template's "The property is a ..."). */
const BUILDING: Record<string, string> = {
  "apartment block": "apartment block",
  "walk-up apartments": "walk-up apartment building",
  "high-rise apartments": "high-rise apartment building",
  "mixed-use residential": "mixed-use residential building",
  "townhouse complex": "townhouse complex",
  "serviced apartments": "serviced apartment building",
};

const STOREYS: Record<string, string> = { "1": "single-storey", one: "single-storey", "2": "double-storey", two: "double-storey" };

/** The template's "on a ... block of land", from the form's block slope. */
const SLOPE: Record<string, string> = { flat: "flat", "slight fall": "gently sloping", "moderate fall": "moderately sloping", "steep fall": "steeply sloping" };

/** "around 2010", or the template's "around the 1990s" when the inspector gave a decade. */
function constructedAround(year: string): string {
  // The template only has "around the [1990]s": a decade ("2000s") as typed, and an exact year ("2008") as the decade it falls in.
  const decade = /^(\d{3}0)'?s$/i.exec(year)?.[1] ?? (/^\d{4}$/.test(year) ? `${year.slice(0, 3)}0` : undefined);
  return decade ? `around the ${decade}s` : `around ${year}`;
}

/**
 * The template's line 14: "The property is a [unit in a double-storey apartment block] signed as [Unit 7], facing [north] on a [flat]
 * block of land. It is of a [contemporary] design and estimated to have been constructed around the [1990]s. It is constructed of
 * [brick veneer] walls on [concrete slab] with a [flat] roof and a covering of [membrane]. Windows are constructed of [aluminium]." --
 * and nothing else (its extension sentence has no question on the form).
 */
const description: Composer = (inst, itemFields) => {
  const buildingType = lower(one(itemFields, inst, ["buildingType"]));
  const storeysRaw = lower(asString(inst.storeys).trim());
  const slope = lower(one(itemFields, inst, ["slope"]));
  const year = asString(inst.constructedYear).trim();
  const walls = lower(one(itemFields, inst, ["cladding"]));
  const foundations = lower(one(itemFields, inst, ["foundations"]));
  const roofDesign = lower(one(itemFields, inst, ["roofDesign"]));
  const roofCovering = lower(one(itemFields, inst, ["roofCovering"]));
  const windows = lower(one(itemFields, inst, ["windows"]));
  const signedAs = clean(inst.signedAs);
  const facing = lower(one(itemFields, inst, ["facing"]));
  const design = lower(one(itemFields, inst, ["design"]));

  const storeys = STOREYS[storeysRaw] ?? (storeysRaw ? `${storeysRaw.replace(/\s*-?\s*storeys?$/, "")}-storey` : "");
  const building = [storeys, BUILDING[buildingType] ?? (buildingType || "apartment building")].filter(Boolean).join(" ");
  const where = `${signedAs ? ` signed as ${signedAs}` : ""}${facing ? `, facing ${facing}` : ""}`;
  const land = slope ? `${facing ? " " : ", "}on ${article(SLOPE[slope] ?? slope)} ${SLOPE[slope] ?? slope} block of land` : "";
  const subject = `The property is a unit in ${article(building)} ${building}${where}${land}`;
  const built = year ? `estimated to have been constructed ${constructedAround(year)}` : "";
  const parts: string[] = [];
  if (design) parts.push(`${subject}.`, `It is of ${article(design)} ${design} design${built ? ` and ${built}` : ""}.`);
  else parts.push(built ? `${subject}${slope ? " and" : ","} ${built}.` : `${subject}.`);

  const build: string[] = [];
  if (walls) build.push(`constructed of ${wallsOf([walls])}`);
  if (foundations) build.push(`on ${foundations}`);
  if (roofDesign) build.push(`with a ${roofDesign} roof`);
  if (roofCovering) build.push(`${roofDesign ? "and " : "with "}a covering of ${roofCovering}`);
  if (build.length) parts.push(`It is ${build.join(" ")}.`);
  if (windows) parts.push(windowsSentence(windows));
  const paragraphs = [parts.join(" ")];
  // Line 15: "There is an extension to the [rear] built around [2005]. It is constructed of [brick veneer] walls on [concrete slab] with a
  // [flat] roof and a covering of [colorbond]."
  if (asString(inst.extension) === "yes") {
    const to = lower(one(itemFields, inst, ["extensionTo"]));
    const around = clean(inst.extensionYear);
    const eWalls = lower(one(itemFields, inst, ["extensionWalls"]));
    const eOn = lower(one(itemFields, inst, ["extensionFoundations"]));
    const eRoof = lower(one(itemFields, inst, ["extensionRoofDesign"]));
    const eCover = lower(one(itemFields, inst, ["extensionRoofCovering"]));
    const eBuild = [eWalls ? `constructed of ${wallsOf([eWalls])}` : "", eOn ? `on ${eOn}` : "", eRoof ? `with a ${eRoof} roof` : "", eCover ? `${eRoof ? "and " : "with "}a covering of ${eCover}` : ""].filter(Boolean);
    paragraphs.push(`There is an extension${to ? ` to the ${to}` : ""}${around ? ` built around ${around}` : ""}.${eBuild.length ? ` It is ${eBuild.join(" ")}.` : ""}`);
  }
  return paragraphs.join("\n\n");
};

/** The template's lines 21-22: "The project works are to the property at [..], which is at the [left] - approximately [east] - of the site of this inspection." and the scope. */
function descriptionBlocks({ fields }: { fields: Record<string, unknown>; areaCount: number }): { works?: string; scope?: string } {
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const address = text(fields.projectAddr);
  const direction = lower(text(fields.direction));
  const compass = lower(text(fields.directionCompass));
  const scope = text(fields.scopeType);
  const partAt = text(fields.scopePartAt);
  let works: string | undefined;
  if (address) {
    const approx = compass ? ` - approximately ${compass} -` : "";
    if (/^adjacent/.test(direction)) works = `The project works are to the property at ${address}, which is adjacent to the site of this inspection.`;
    else if (/^multiple/.test(direction)) works = `The project works are to the property at ${address}, which is at multiple sides${approx} of the site of this inspection.`;
    else if (direction) works = `The project works are to the property at ${address}, which is at the ${direction}${approx} of the site of this inspection.`;
    else works = `The project works are to the property at ${address}.`;
  }
  const phrase = scope ? `${scopePhrase(scope)}${/^partial/i.test(scope) && partAt ? ` at ${partAt}` : ""}` : "";
  return { works, scope: phrase ? `The scope for inspection is ${phrase}.` : undefined };
}

// ---- The form in the template's shape (acespect-backend restructure-apartment-form-template.ts), template line by line ----------

const has = (fields: TemplateField[], key: string): boolean => fields.some((f) => f.key === key);
/** An item's own photos, printed under it: the template's "Please refer to Photographs ..." (see reportParts.ts). */
const itemPhotos = (inst: AnswerTree, key = "photos"): string => {
  const urls = asStringArray(inst[key]).map((u) => u.split("?")[0] ?? u);
  return urls.length ? `PHOTOS::${urls.join(",")}` : "";
};
/** "the front of the block" / "the left-hand side of the block" -- the template's driveway and paving. */
function blockSide(side: string): string {
  const s = lower(side).replace(/\s+side$/, "");
  return s === "left" || s === "right" ? `the ${s}-hand side of the block` : `the ${s} of the block`;
}
const lines = (...parts: string[]): string => parts.filter(Boolean).join("\n\n");

/** Lines 31-35: "There is no driveway." / "The driveway is to the [front] of the block and is constructed of [concrete]. It is in satisfactory condition with typical wear and tear. Sections of the driveway were obscured by [a parked vehicle]." */
const drivewayLine: Composer = (inst, f) => {
  if (asString(inst.present) === "no") return "There is no driveway.";
  if (asString(inst.present) !== "yes") return "";
  const where = lower(one(f, inst, ["location"]));
  const material = lower(one(f, inst, ["material"]));
  const word = conditionOf(f, inst).word;
  const first = `The driveway${where ? ` is to ${blockSide(where)}${material ? " and" : ""}` : ""}${material ? ` is constructed of ${material}` : ""}.`;
  const second = word ? ` It is in ${word} condition${typically(word, "wear and tear")}.` : "";
  return lines(`${first}${second}${obstructionsSentence(f, inst, "driveway")}`, houseDamageSentences(inst, f, { style: EXTERNAL }), itemPhotos(inst));
};

/** Lines 38-45, one side of the block: "There is paving to the [front] of the block, constructed of [pavers]. It is in satisfactory condition with typical wear and tear. Sections of the paving were obscured by [..]." */
const pavingLine: Composer = (inst, f, label) => {
  if (asString(inst.present) !== "yes") return ""; // none, or not inspected
  const materials = many(f, inst, ["material"]).map(lower);
  const word = conditionOf(f, inst).word;
  const lead = `There is paving to ${blockSide(label)}${materials.length ? `, constructed of ${joinList(materials)}` : ""}.${word ? ` It is in ${word} condition${typically(word, "wear and tear")}.` : ""}${obstructionsSentence(f, inst, "paving")}`;
  return lines(lead, houseDamageSentences(inst, f, { style: EXTERNAL }), itemPhotos(inst));
};

/** Lines 49-57, one side: "There is no front fence." / "The front fence is constructed of [..] and is in satisfactory condition with typical weathering. Sections of the fence are obscured by [vegetation]." / "A [crack] at [the gate]." */
const fenceLine: Composer = (inst, f, label) => {
  const side = handedSide(label);
  if (isNotPresent(inst)) return `There is no ${side} fence.`;
  if (asString(inst.present) !== "yes") return ""; // not inspected
  const materials = many(f, inst, ["material"]).map(lower);
  const word = conditionOf(f, inst).word;
  const said = [materials.length ? `is constructed of ${joinList(materials)}` : "", word ? `is in ${word} condition${typically(word, "weathering")}` : ""].filter(Boolean);
  const lead = `The ${side} fence ${said.length ? said.join(" and ") : "was inspected"}.${obstructionsSentence(f, inst, "fence").replace(" were obscured", " are obscured")}`;
  return lines(lead, houseDamageSentences(inst, f, { style: FENCE }), itemPhotos(inst));
};

/** Line 59, one wall: "There is a retaining wall on the [left] side of the [property], running from the [front] to the [rear]. It is constructed of [..]. It is in satisfactory condition with typical weathering. There is some decay. The wall is bowed." */
const retainingWallLine: Composer = (inst, f) => {
  const side = lower(one(f, inst, ["side"]));
  const of = lower(one(f, inst, ["of"])) || "property";
  const from = lower(one(f, inst, ["runningFrom"]));
  const to = lower(one(f, inst, ["runningTo"]));
  const materials = many(f, inst, ["material"]).map(lower);
  const word = conditionOf(f, inst).word;
  const details = many(f, inst, ["details"]).map((d) => capitalize(withPeriod(lower(d))));
  const lead = `There is a retaining wall${side ? ` on the ${side} side of the ${of}` : ""}${from && to ? `, running from the ${from} to the ${to}` : ""}.${materials.length ? ` It is constructed of ${joinList(materials)}.` : ""}${word ? ` It is in ${word} condition${typically(word, "weathering")}.` : ""}${details.length ? ` ${details.join(" ")}` : ""}`;
  return lines(lead, houseDamageSentences(inst, f, { style: EXTERNAL }), itemPhotos(inst));
};

/**
 * Lines 62-71, one structure, under its heading (a garage, carport or loading bay under "Garage/Carport/Loading Bay", a shed under "Any
 * other free standing Structures"): "There is a [garage] located [in the basement], constructed of [concrete] with a [concrete slab]
 * roof, and is generally in [fair] state of repair. [There is no visible significant damage.] Sections of the walls were obscured by
 * [shelving]. A parked car obscured part of the hardstand."
 */
const structureLine: Composer = (inst, f, label) => {
  if (asString(inst.present) !== "yes") return ""; // none, or not inspected
  const name = lower(label);
  const located = lower(one(f, inst, ["locatedAt"]));
  const walls = many(f, inst, ["walls"]).map(lower);
  const roofs = many(f, inst, ["roof"]).map(lower).map((r) => (r === "tile" ? "tiled" : r));
  const word = conditionOf(f, inst).word;
  const roofed = roofs.length ? ` with ${article(roofs[0]!)} ${joinList(roofs)} roof` : "";
  const built = walls.length ? `, constructed of ${joinList(walls)}${roofed}` : roofed ? `,${roofed}` : "";
  let lead = `There is ${article(name)} ${name}${located ? ` located ${located}` : ""}${built}${word ? `, and is ${repairState(word)}` : ""}.`;
  const significant = asString(inst.significantDamage);
  if (significant) lead += significant === "yes" ? " There is visible significant damage." : " There is no visible significant damage.";
  const obscured = many(f, inst, ["obscuredBy"]).map(lower);
  const car = obscured.some((o) => /parked car/.test(o));
  const rest = obscured.filter((o) => !/parked car/.test(o));
  if (rest.length) lead += ` Sections of the walls were obscured by ${joinList(rest)}.`;
  if (car) lead += " A parked car obscured part of the hardstand.";
  return lines(part(/shed/.test(name) ? PART.structures : PART.garage), lead, houseDamageSentences(inst, f, { style: EXTERNAL }), itemPhotos(inst));
};

/** Line 80: "Eaves have water stains/mould most likely due to overflowing gutters." -- and lines 78-79 as they are. */
function alsoNotedLines(f: TemplateField[], inst: AnswerTree): string {
  const noted = many(f, inst, ["alsoNoted"]).map(lower);
  const out: string[] = [];
  if (noted.some((n) => /^paint is peeling/.test(n))) out.push("Paint is peeling from weatherboards.");
  if (noted.some((n) => /^downpipe is not connected/.test(n))) out.push("Downpipe is not connected to the stormwater system.");
  const stains = noted.some((n) => /water stains/.test(n));
  const mould = noted.some((n) => /mould/.test(n));
  if (stains || mould) out.push(`Eaves have ${[stains ? "water stains" : "", mould ? "mould" : ""].filter(Boolean).join(" and ")} most likely due to overflowing gutters.`);
  for (const typedNote of noted.filter((n) => !/^paint is peeling|^downpipe is not connected|water stains|mould/.test(n))) out.push(capitalize(withPeriod(typedNote)));
  return out.join(" ");
}

/**
 * Lines 73-110, one elevation, under the Main structure: "Front Elevation (north)" / "Satisfactory condition with typical wear and tear."
 * or, for a party wall, "The left elevation is a party wall abutting the next property at No. [12]. It is constructed of [brick] which is
 * in [satisfactory] condition." -- then its defects ("approximately" on a party wall, as the template has it), then the paint, downpipe
 * and eaves lines.
 */
const elevationLine: Composer = (inst, f, label) => {
  if (asString(inst.present) !== "yes") return "";
  const side = lower(label);
  const faces = lower(one(f, inst, ["orientation"]));
  const word = conditionOf(f, inst).word;
  const party = asString(inst.partyWall) === "yes";
  let lead = gradeSentence(word, false);
  if (party) {
    const no = clean(inst.partyWallNo).replace(/^no\.?\s*/i, "");
    const material = lower(typedCase(clean(inst.partyWallMaterial)));
    lead = `The ${side} elevation is a party wall abutting the next property${no ? ` at No. ${no}` : ""}.${material && word ? ` It is constructed of ${material} which is in ${word} condition.` : word ? ` ${gradeSentence(word, false)}` : ""}`;
  }
  return lines(
    `ROOMHEAD::${capitalize(side)} Elevation${faces ? ` (${faces})` : ""}`,
    lead,
    houseDamageSentences(inst, f, { style: party ? INTERNAL : EXTERNAL }),
    alsoNotedLines(f, inst),
    itemPhotos(inst),
  );
};

/**
 * Lines 111-118, under "Roof Covering and Chimney" ("Roof Covering" when there is no chimney): "The roof covering of [tiles] appears to be
 * in [satisfactory] condition with [typical weathering]. Comments are based on limited observations from the ground only and using a
 * camera zoom." / the OH&S and multi-level complex lines / "The chimney is constructed of [brick] and appears to be in [fair] condition
 * with [..]."
 */
const roofLines: Composer = (inst, f) => {
  const status = lower(one(f, inst, ["status"]));
  if (!status) return "";
  const chimney = asString(inst.chimney) === "yes";
  const covering = many(f, inst, ["covering"]).map(lower);
  const word = conditionOf(f, inst).word;
  const withs = many(f, inst, ["with"]).map(lower);
  const lead: string[] = [];
  if (/multi-level/.test(status)) lead.push(COMPLEX_ROOF);
  else if (/oh\s*&\s*s/i.test(status)) {
    const lowerWord = conditionOf(f, inst, ["lowerCondition"]).word;
    lead.push(`Due to OH & S constraints the upper roof could not be accessed safely.${word ? ` Observations from the ground indicate that the roof covering is in ${word} condition.` : ""}${lowerWord ? ` The lower level roofing generally appears to be in ${lowerWord} condition.` : ""}`);
  } else {
    if (covering.length || word) lead.push(`The roof covering${covering.length ? ` of ${joinList(covering)}` : ""} appears to be in ${word || "satisfactory"} condition${withs.length ? ` with ${joinList(withs)}` : ""}.`);
    lead.push(/ladder/.test(status) ? "Comments are based on limited observations standing on a ladder to the lower roof and from the ground using a camera zoom." : "Comments are based on limited observations from the ground only and using a camera zoom.");
  }
  let chimneyLine = "";
  if (chimney) {
    const material = many(f, inst, ["chimneyMaterial"]).map(lower);
    const cw = conditionOf(f, inst, ["chimneyCondition"]).word;
    const cWith = many(f, inst, ["chimneyWith"]).map(lower);
    chimneyLine = `The chimney${material.length ? ` is constructed of ${joinList(material)} and` : ""} appears to be in ${cw || "satisfactory"} condition${cWith.length ? ` with ${joinList(cWith)}` : ""}.`;
  }
  return lines(part(chimney ? PART.roofChimney : PART.roof), lead.join(" "), chimneyLine, houseDamageSentences(inst, f, { style: EXTERNAL }), itemPhotos(inst));
};

/** Lines 122-220, one room, under its floor: "[Living Room]" / "Satisfactory condition with typical wear and tear. Sections were obscured by [furniture]." / its defects, "approximately". */
const roomLines: Composer = (inst, f, label) => {
  if (asString(inst.present) !== "yes") return "";
  const named = clean(inst.roomName);
  const name = named ? capitalize(named) : label;
  const word = conditionOf(f, inst).word;
  return lines(`ROOMHEAD::${name}`, `${gradeSentence(word, false)}${obstructionsSentence(f, inst, "")}`.trim(), houseDamageSentences(inst, f, { style: INTERNAL }), itemPhotos(inst));
};

/** Line 225, the NOTES: "There was no access to the [study] due to [a locked door].", squeaky or unlevel flooring, photographs restricted, and the inspector's other notes. */
const notesLines: Composer = (inst) => {
  const out: string[] = [];
  const list = Array.isArray(inst.noAccess) ? (inst.noAccess as AnswerTree[]) : [];
  for (const a of list) {
    const area = clean(a.area);
    const reason = clean(a.reason);
    if (area) out.push(`There was no access to ${withThe(area)}${reason ? ` due to ${reason}` : ""}.`);
  }
  if (asString(inst.squeakyFloors) === "yes") out.push(`Squeaky flooring was noted${clean(inst.squeakyWhere) ? ` to ${withThe(clean(inst.squeakyWhere))}` : ""}.`);
  if (asString(inst.unlevelFloors) === "yes") out.push(`Unlevel flooring was noted${clean(inst.unlevelWhere) ? ` to ${withThe(clean(inst.unlevelWhere))}` : ""}.`);
  if (asString(inst.photosRestricted) === "yes") out.push(`The owner restricted the number of photographs${clean(inst.photosRestrictedTo) ? ` to ${withThe(clean(inst.photosRestrictedTo))}` : ""}.`);
  for (const line of asString(inst.additionalNotes).split(/\n+/)) if (line.trim()) out.push(capitalize(withPeriod(line.trim())));
  return out.join("\n\n");
};

/** Line 71, an added structure: "There is a [water tank] located [at the rear of the property], constructed of [metal], which is generally in [satisfactory] state of repair. There is no visible significant damage." */
const addedStructureLine: Composer = (inst, f) => {
  const name = lower(typedCase(asString(inst.description).trim()));
  const located = lower(one(f, inst, ["locatedAt"]));
  const materials = many(f, inst, ["material"]).map(lower);
  const word = conditionOf(f, inst).word;
  const significant = asString(inst.significantDamage);
  const lead = `There is ${name ? `${article(name)} ${name}` : "an additional structure"}${located ? ` located ${located}` : ""}${materials.length ? `, constructed of ${joinList(materials)}` : ""}${word ? `, which is ${repairState(word)}` : ""}.${significant ? (significant === "yes" ? " There is visible significant damage." : " There is no visible significant damage.") : ""}`;
  return lines(lead, houseDamageSentences(inst, f, { style: EXTERNAL }));
};

// ---- Items the form lists one by one (sections the phone does not show for an apartment; worded the template's way if ever filled) ----

/** The template's line 34: "The driveway is to the [front] of the block and is constructed of [concrete]. It is in satisfactory condition with typical wear and tear. Sections of the driveway were obscured by [a parked vehicle]." */
const legacyDriveway: Composer = (inst, itemFields) => {
  if (asString(inst.present) === "no" || asString(inst.available) === "no") return "There is no driveway.";
  const location = lower(one(itemFields, inst, ["location", "locatedAt"]));
  const material = lower(one(itemFields, inst, ["material"]));
  const cond = conditionOf(itemFields, inst);
  if (!location && !material && !cond.word) return "There is no driveway.";
  const first = location || material ? `The driveway${location ? ` is to the ${location.replace(/\s+side$/, "")} of the block and` : ""} is constructed of ${material || "concrete"}.` : "";
  const second = cond.word ? `${first ? "It" : "The driveway"} is in ${cond.word} condition${typically(cond.word, "wear and tear")}.` : "";
  const lead = `${[first, second].filter(Boolean).join(" ")}${obstructionsSentence(itemFields, inst, "driveway")}`.trim();
  return [lead, houseDamageSentences(inst, itemFields, { style: EXTERNAL })].filter(Boolean).join("\n\n");
};

/**
 * The template's lines 50-59: "The left-hand fence is constructed of [timber paling] and is in satisfactory condition with typical
 * weathering. Sections of the fence are obscured by [vegetation]." / "A [crack] at [the gate]." -- and its retaining wall: "There is a
 * [besser block] retaining wall on the left side of the property. It is constructed of [brick]. It is in satisfactory condition with
 * typical weathering."
 */
function structureComposer(kind: "fence" | "retaining wall"): Composer {
  return (inst, itemFields) => {
    const location = lower(one(itemFields, inst, ["location"]));
    const structure = lower(one(itemFields, inst, ["structureType"]));
    const material = lower(one(itemFields, inst, ["material"]));
    const cond = conditionOf(itemFields, inst);
    const grade = cond.word ? `in ${cond.word} condition${typically(cond.word, "weathering")}` : "";
    let text: string;
    if (kind === "fence") {
      const subject = `The ${location ? `${handedSide(location)} ` : ""}fence`;
      // The form's type and material are both what the fence is constructed of ("timber paling", "timber"); one is said once.
      const built = [structure, material].filter((m, i, all) => m && !(i === 1 && all[0]!.includes(m)));
      const predicates = [built.length ? `is constructed of ${joinList(built)}` : "", grade ? `is ${grade}` : ""].filter(Boolean);
      text = predicates.length ? `${subject} ${predicates.join(" and ")}.` : "";
      text += obstructionsSentence(itemFields, inst, "fence").replace(" were obscured", " are obscured");
    } else {
      const side = location ? (/^(front|rear)$/.test(location) ? ` at the ${location} of the property` : ` on the ${location.replace(/\s+side$/, "")} side of the property`) : "";
      text = `There is ${article(structure || "retaining")} ${structure ? `${structure} ` : ""}retaining wall${side}.${material ? ` It is constructed of ${material}.` : ""}${grade ? ` It is ${grade}.` : ""}`;
    }
    return [text.trim(), houseDamageSentences(inst, itemFields, { style: kind === "fence" ? FENCE : EXTERNAL })].filter(Boolean).join("\n\n");
  };
}
const legacyFences = structureComposer("fence");
const legacyRetainingWalls = structureComposer("retaining wall");

/** The template's line 71 for a pool or spa (the template has no pool section, and no pool disclaimer): "There is an [in-ground pool], constructed of [concrete], which is generally in [fair] state of repair." */
const poolSpa: Composer = (inst, itemFields) => {
  if (asString(inst.available) === "no") return "";
  const type = lower(one(itemFields, inst, ["poolType"]));
  const name = !type ? "pool" : /^spa$/.test(type) ? "spa" : `${type} pool`;
  const materials = many(itemFields, inst, ["construction"]).map(lower);
  const cond = conditionOf(itemFields, inst);
  const lead = `There is ${article(name)} ${name}${materials.length ? `, constructed of ${joinList(materials)}` : ""}${cond.word ? `, which is ${repairState(cond.word)}` : ""}.${obstructionsSentence(itemFields, inst, "")}`;
  return [lead, houseDamageSentences(inst, itemFields, { style: EXTERNAL })].filter(Boolean).join("\n\n");
};

/** An added structure, the template's line 71: "There is a [water tank], constructed of [metal], which is generally in [satisfactory] state of repair." */
const legacyCustomStructure: Composer = (inst, itemFields) => {
  const name = lower(typedCase(asString(inst.description).trim()));
  const materials = many(itemFields, inst, ["material"]).map(lower);
  const cond = conditionOf(itemFields, inst);
  const lead = `There is ${name ? `${article(name)} ${name}` : "an additional structure"}${materials.length ? `, constructed of ${joinList(materials)}` : ""}${cond.word ? `, which is ${repairState(cond.word)}` : ""}.`;
  return [lead, houseDamageSentences(inst, itemFields, { style: EXTERNAL })].filter(Boolean).join("\n\n");
};

// ---- The checklist sections ------------------------------------------------------------------

/**
 * How the template words one part of the building the form asks about:
 *   elevation -- the Main structure's lines (with the external walls' grade, defects and photos);
 *   element   -- a part of the outside the template has no heading for (cladding, doors, balconies): its defects and photos go under
 *                the Main structure;
 *   garage    -- the Garage/Carport/Loading Bay line;
 *   roof      -- the Roof Covering lines;  roofPart -- eaves, fascia, gutters, downpipes: their defects and photos go under the Roof Covering;
 *   room      -- a room of the template's INTERNAL: its heading, "Satisfactory condition with typical wear and tear.", its defects, photos;
 *   area      -- a common room the form gives no grade: its heading and photos;
 *   driveway, paving, fences, pool -- the template's Driveway, Paving, Fences and free-standing structure lines;
 *   notes     -- the template's NOTES.
 */
type Kind = "elevation" | "element" | "garage" | "roof" | "roofPart" | "room" | "area" | "driveway" | "paving" | "fences" | "pool" | "notes";
type Group = { prefix: string; title: string; kind: Kind; plural?: boolean; with?: string };

/** The parts of the building each checklist section prints, in the form's order. Groups not listed here are the Pre-Purchase checklist's. */
const GROUPS: Record<string, Group[]> = {
  elevations: [
    { prefix: "elev_overview", title: "Elevations", kind: "elevation", plural: true, with: "ext_walls" },
    { prefix: "cladding", title: "Cladding", kind: "element" },
    { prefix: "garage", title: PART.garage, kind: "garage" },
    { prefix: "front_door", title: "Front Door", kind: "element" },
    { prefix: "other_doors_ext", title: "Other External Doors", kind: "element" },
    { prefix: "balconies", title: "Balconies", kind: "element" },
  ],
  garage_carport_sheds: [{ prefix: "carspace", title: PART.garage, kind: "garage" }],
  roof_chimneys: [
    { prefix: "roof_covering", title: PART.roof, kind: "roof" },
    { prefix: "eaves", title: "Eaves", kind: "roofPart" },
    { prefix: "fascia", title: "Fascia", kind: "roofPart" },
    { prefix: "gutters", title: "Gutters", kind: "roofPart" },
    { prefix: "downpipes", title: "Downpipes", kind: "roofPart" },
  ],
  internal_areas: [
    { prefix: "ceilings", title: "Ceilings", kind: "room", plural: true },
    { prefix: "int_walls", title: "Internal Walls", kind: "room", plural: true },
    { prefix: "floors", title: "Floors", kind: "room", plural: true },
    { prefix: "int_stairs", title: "Stairs", kind: "room", plural: true },
    { prefix: "int_windows", title: "Windows", kind: "room", plural: true },
    { prefix: "int_doors", title: "Internal Doors", kind: "room", plural: true },
    { prefix: "cabinets", title: "Cabinets", kind: "room", plural: true },
  ],
  paving_paths: [
    { prefix: "foyer", title: "Reception / Foyer", kind: "room" },
    { prefix: "lifts", title: "Lifts", kind: "room", plural: true },
    { prefix: "driveway_common", title: PART.driveway, kind: "driveway" },
    { prefix: "ext_paving", title: PART.paving, kind: "paving" },
    { prefix: "pool", title: PART.structures, kind: "pool" },
    { prefix: "meeting_room", title: "Meeting Room", kind: "area" },
    { prefix: "gym", title: "Gym", kind: "area" },
    { prefix: "roof_terrace", title: "Roof Terrace", kind: "area" },
    { prefix: "fences_common", title: PART.fences, kind: "fences" },
  ],
  notes: [{ prefix: "post_project", title: "Notes", kind: "notes" }],
};

/** The questions each kind of part prints (by the part of the key after the group's prefix); every other question is left out. */
const SAID: Record<Kind, string[]> = {
  elevation: ["elevations", "partyWall", "partyWallSide", "partyWallNo", "guttersCond", "photos"],
  element: ["applicable", "damages", "photos"],
  garage: ["type", "walls", "roof", "condition", "damages", "photos"],
  roof: ["applicable", "naReason", "checks", "photos"],
  roofPart: ["applicable", "damages", "photos"],
  room: ["applicable", "condition", "damages", "photos"],
  // A common room with no grade has no sentence: whether it is there only decides whether its photos print.
  area: ["photos"],
  driveway: ["applicable", "material", "materialOther", "condition", "damages", "photos"],
  paving: ["applicable", "material", "materialOther", "condition", "damages", "photos"],
  fences: ["applicable", "photos"],
  pool: ["applicable", "type", "material", "materialOther", "photos"],
  notes: ["describe", "comments"],
};
/** What the Main structure says of the external walls. */
const SAID_WITH = ["condition", "material", "damages", "photos"];

/** The group a checklist question belongs to, and the rest of its key ("ext_walls_condition" -> elevations, "condition", from "ext_walls"). */
function placeOf(key: string, groups: Group[]): { group: Group; rest: string; fromWith: boolean } | undefined {
  let best: { group: Group; rest: string; fromWith: boolean; length: number } | undefined;
  for (const group of groups) {
    for (const [prefix, fromWith] of [[group.prefix, false], [group.with, true]] as [string | undefined, boolean][]) {
      if (prefix && key.startsWith(`${prefix}_`) && (!best || prefix.length > best.length)) best = { group, rest: key.slice(prefix.length + 1), fromWith, length: prefix.length };
    }
  }
  return best && { group: best.group, rest: best.rest, fromWith: best.fromWith };
}

/** The first Apartment form's Pre-Purchase checklist groups: the template has no line for any of their questions. */
const PRE_PURCHASE_GROUPS = ["int_roof", "party_walls", "plumbing", "gas", "electrical", "fireplace", "structural", "major_defects", "safety"];

/** The Description form's questions that the template's description does not say. */
const DESCRIPTION_LEFT_OUT = new Set(["worksType", "worksTypeOther", "limitations", "limitationsNotes", "safetyIssues", "safetyIssuesNotes"]);
/** The one-by-one items' questions that have no line in the template. */
const ITEMS_LEFT_OUT: Record<string, string[]> = {
  driveway: ["notableDamage", "safetyHazard", "notes"],
  fences: ["notableDamage", "notableCracking", "notes"],
  retaining_walls: ["notableDamage", "notableCracking", "obstructions", "notes"],
  pool_spa: ["name", "fenceType", "fenceSafety", "hasDamage", "notes"],
};

/**
 * True for a question of the Apartment form that the report leaves out on purpose: the template has no line for it -- the form's
 * Pre-Purchase checklist questions, the inspector's comment boxes, and a defect's notes. `path` is the question's key, or its dotted
 * path inside a group ("items.notableDamage", "ext_walls_damages.notes").
 */
export function apartmentLeavesOut(sectionKey: string, path: string): boolean {
  const keys = path.split(".");
  const last = keys[keys.length - 1]!;
  if (keys.length > 1 && last === "notes") return true; // a defect's (or an item's) notes
  if (sectionKey === "description") return DESCRIPTION_LEFT_OUT.has(keys[0]!);
  if (ITEMS_LEFT_OUT[sectionKey]) return ITEMS_LEFT_OUT[sectionKey]!.includes(last);
  const groups = GROUPS[sectionKey];
  if (!groups) return false;
  const place = placeOf(keys[0]!, groups);
  // A group of the first form's Pre-Purchase checklist (plumbing, gas, electrical, ...); any other question is the rebuilt form's, which
  // the template words.
  if (!place) return PRE_PURCHASE_GROUPS.some((p) => keys[0]!.startsWith(`${p}_`));
  return !(place.fromWith ? SAID_WITH : SAID[place.group.kind]).includes(place.rest);
}

const hasAnswer = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v !== "" : typeof v === "number");

/**
 * The template's line 62: "There is a garage located at [the basement], constructed of [concrete] with a [concrete slab roof], and is
 * generally in [fair] state of repair." `ans` reads the car space's other answers. No car space: nothing (the template has no line for it).
 */
function carSpaceSentence(prefix: string, type: string, ans: (key: string) => string): string {
  if (!type || /^no car space/.test(type)) return "";
  const thing = type.replace(/\s+in basement$/, "");
  const where = /\bin basement$/.test(type) ? " located in the basement" : "";
  const walls = ans(`${prefix}_walls`);
  const roof = ans(`${prefix}_roof`).replace(/\s*roof$/, "");
  const roofed = roof && !/^no roof/.test(roof) ? ` with ${article(roof)} ${roof} roof` : "";
  const built = walls ? `, constructed of ${walls}${roofed}` : roofed ? `,${roofed}` : "";
  const condition = ans(`${prefix}_condition`);
  const grade = /^satisfactory/.test(condition) ? "satisfactory" : condition;
  const state = grade === "new" ? ", and is new" : grade ? `, and is generally in ${grade} state of repair` : "";
  return `There is ${article(thing)} ${thing}${where}${built}${state}.`;
}

/** The checklist sections, each printed under the template's headings (marked with PART::) in the template's order. */
function checklistComposer(sectionKey: string): Composer {
  const groups = GROUPS[sectionKey]!;
  return (inst, itemFields) => {
    const offsets = defectOffsets(itemFields, inst);
    const field = (key: string): TemplateField | undefined => itemFields.find((f) => f.key === key);
    const reached = (key: string): boolean => {
      const f = field(key);
      return !!f && isGateSatisfied(f, inst) && hasAnswer(inst[key]);
    };
    /** An answer as its (lower-case) label, "" when not given. */
    const label = (key: string): string => (reached(key) ? lower(one(itemFields, inst, [key])) : "");
    const grade = (key: string): string => (field(key) && isGateSatisfied(field(key)!, inst) ? conditionOf(itemFields, inst, [key]).word : "");
    const defects = (key: string, inside: boolean): string => {
      const f = field(key);
      if (!f || f.type !== "damage-list" || !isGateSatisfied(f, inst)) return "";
      return houseDamageSentences(inst, itemFields, { key, indexOffset: offsets[key] ?? 0, style: inside ? INTERNAL : EXTERNAL });
    };
    const photos = (prefixes: string[]): string[] => prefixes.map((p) => `${p}_photos`).filter((k) => reached(k));
    const notApplicable = (prefix: string): boolean => asString(inst[`${prefix}_applicable`]) === "no";
    const answered = (prefix: string): boolean => itemFields.some((f) => f.key.startsWith(`${prefix}_`) && f.type !== "photos" && reached(f.key));
    const kinds = (kind: Kind): Group[] => groups.filter((g) => g.kind === kind && !notApplicable(g.prefix));

    /** One of the template's headings with what is printed under it; nothing at all when nothing is. */
    const out: string[] = [];
    const print = (title: string, lines: string[]): void => {
      const body = lines.filter(Boolean);
      if (body.length) out.push(part(title), ...body);
    };

    // Driveway (the template's lines 31-35): "There is no driveway." when there is none.
    for (const g of groups.filter((x) => x.kind === "driveway" && answered(x.prefix))) {
      if (notApplicable(g.prefix)) {
        print(g.title, ["There is no driveway.", photosOf(photos([g.prefix]))]);
        continue;
      }
      const material = label(`${g.prefix}_material`);
      const word = grade(`${g.prefix}_condition`);
      const first = material ? `The driveway is constructed of ${material}.` : "";
      const second = word ? `${first ? "It" : "The driveway"} is in ${word} condition${typically(word, "wear and tear")}.` : "";
      print(g.title, [[first, second].filter(Boolean).join(" "), defects(`${g.prefix}_damages`, false), photosOf(photos([g.prefix]))]);
    }
    // Paving / Parking areas / Basement car parks (lines 36-45).
    for (const g of kinds("paving")) {
      const material = label(`${g.prefix}_material`);
      const word = grade(`${g.prefix}_condition`);
      const first = material ? `There is paving, constructed of ${material}.` : "";
      const second = word ? `${first ? "It" : "The paving"} is in ${word} condition${typically(word, "wear and tear")}.` : "";
      print(g.title, [[first, second].filter(Boolean).join(" "), defects(`${g.prefix}_damages`, false), photosOf(photos([g.prefix]))]);
    }
    // Fences and Retaining Walls (lines 46-59): "There are no fences surrounding this property." when there are none.
    for (const g of groups.filter((x) => x.kind === "fences" && answered(x.prefix))) {
      print(g.title, [notApplicable(g.prefix) ? "There are no fences surrounding this property." : "", photosOf(photos([g.prefix]))]);
    }
    // Garage/Carport/Loading Bay (lines 60-66).
    for (const g of groups.filter((x) => x.kind === "garage")) {
      const sentence = carSpaceSentence(g.prefix, label(`${g.prefix}_type`), label);
      print(g.title, sentence ? [sentence, defects(`${g.prefix}_damages`, false), photosOf(photos([g.prefix]))] : [defects(`${g.prefix}_damages`, false)]);
    }
    // Any other free standing Structures (lines 67-71): the pool or spa.
    for (const g of kinds("pool")) {
      const type = label(`${g.prefix}_type`);
      const material = label(`${g.prefix}_material`);
      const name = type || "pool";
      print(g.title, [type || material ? `There is ${article(name)} ${name}${material ? `, constructed of ${material}` : ""}.` : "", photosOf(photos([g.prefix]))]);
    }
    // Main structure (lines 72-110): the elevations, with every outside part's defects and photos.
    for (const g of groups.filter((x) => x.kind === "elevation")) {
      const side = label("elev_overview_elevations");
      const oneSide = /^(front|left|rear|right)$/.test(side) ? side : "";
      const word = grade(`${g.with}_condition`);
      const lead: string[] = [];
      if (asString(inst.elev_overview_partyWall) === "yes") {
        const which = label("elev_overview_partyWallSide") || oneSide;
        const no = clean(inst.elev_overview_partyWallNo).replace(/^no\.?\s*/i, "");
        const next = `abutting the next property${no ? ` at No. ${no}` : ""}`;
        const material = label(`${g.with}_material`) || lower(clean(inst[`${g.with}_material`]));
        if (which && which === oneSide) {
          // Line 84: the inspected elevation is the party wall -- "... It is constructed of [brick] which is in [fair] condition."
          lead.push(`The ${which} elevation is a party wall ${next}.${material && word ? ` It is constructed of ${material} which is in ${word} condition.` : ""}`);
        } else {
          lead.push(gradeSentence(word, false), which ? `The ${which} elevation is a party wall ${next}.` : `There is a party wall ${next}.`);
        }
      } else lead.push(gradeSentence(word, false));
      if (/^disconnected/.test(label("elev_overview_guttersCond"))) lead.push("Downpipe is not connected to the stormwater system.");
      const elements = kinds("element");
      print(PART.main, [
        ...(oneSide && lead.some(Boolean) ? [`ROOMHEAD::${capitalize(oneSide)} Elevation`] : []),
        lead.filter(Boolean).join(" "),
        defects(`${g.with}_damages`, false),
        ...elements.map((e) => defects(`${e.prefix}_damages`, false)),
        photosOf(photos([g.prefix, g.with!, ...elements.map((e) => e.prefix)])),
      ]);
    }
    // Roof Covering (lines 111-118), with the eaves', fascia's, gutters' and downpipes' defects and photos.
    for (const g of groups.filter((x) => x.kind === "roof")) {
      const lead: string[] = [];
      if (notApplicable(g.prefix)) {
        if (/complex/.test(label(`${g.prefix}_naReason`))) lead.push(COMPLEX_ROOF);
      } else if (reached(`${g.prefix}_checks`)) {
        const checks = many(itemFields, inst, [`${g.prefix}_checks`]).map(lower);
        if (checks.some((c) => /^visible damage/.test(c))) lead.push("There is damage to the roof covering.");
        if (checks.some((c) => /strata|body corporate/.test(c))) lead.push(OWNERS_CORPORATION);
      }
      const roofParts = kinds("roofPart");
      print(g.title, [lead.join(" "), ...roofParts.map((r) => defects(`${r.prefix}_damages`, false)), photosOf(photos([g.prefix, ...roofParts.map((r) => r.prefix)]))]);
    }
    // INTERNAL (lines 119-220): the unit's parts, then the common rooms, each under its own heading.
    const rooms: string[] = [];
    for (const g of groups.filter((x) => (x.kind === "room" || x.kind === "area") && !notApplicable(x.prefix))) {
      const lines = [gradeSentence(g.kind === "room" ? grade(`${g.prefix}_condition`) : "", !!g.plural), defects(`${g.prefix}_damages`, true), photosOf(photos([g.prefix]))].filter(Boolean);
      if (lines.length) rooms.push(`ROOMHEAD::${g.title}`, ...lines);
    }
    if (rooms.length) print(sectionKey === "paving_paths" ? PART.common : PART.unit, rooms);
    // NOTES (lines 222-224): the inspector's notes, as a plain list.
    for (const g of groups.filter((x) => x.kind === "notes")) out.push(typed(inst[`${g.prefix}_describe`]), typed(inst[`${g.prefix}_comments`]));

    return out.filter(Boolean).join("\n\n");
  };
}

/** One Condition Summary row per graded part (kept with the saved section; the Multi Level Office template prints no summary page). */
function summaryRows(sectionKey: string, inst: AnswerTree, itemFields: TemplateField[]): ConditionSummaryRow[] | undefined {
  const groups = GROUPS[sectionKey];
  if (!groups) return undefined;
  const rows: ConditionSummaryRow[] = [];
  for (const group of groups) {
    const base = group.kind === "elevation" ? group.with! : group.prefix;
    const field = itemFields.find((f) => f.key === `${base}_condition`);
    if (!field || !isGateSatisfied(field, inst)) continue;
    if (asString(inst[`${group.prefix}_applicable`]) === "no") continue;
    const grade = gradeOf(field.options?.find((o) => o.value === asString(inst[field.key])));
    if (!grade) continue;
    const damageField = itemFields.find((f) => f.key === `${base}_damages`);
    rows.push({ subLabel: group.title, conditionLabel: grade.label, conditionColor: grade.color, defectNote: damageField ? buildDefectNote(damageField, inst) : undefined });
  }
  return rows;
}

/** The template's heading for each section of the form (used when a section's text carries no PART marks of its own). */
function sectionTitle(sectionKey: string): string | undefined {
  if (sectionKey.startsWith("custom_")) return PART.structures; // an added structure: "Any other free standing Structures"
  return {
    driveway: PART.driveway,
    paving_paths: PART.paving,
    fences: PART.fences,
    retaining_walls: PART.fences,
    garage_carport_sheds: PART.garage,
    pool_spa: PART.structures,
    elevations: PART.main,
    roof_chimneys: PART.roofChimney,
    internal_areas: PART.internal,
  }[sectionKey];
}

/** Each section's writer: the form in the template's shape, or -- for an inspection started on the first Apartment form -- its old one. */
const either =
  (oldKey: string, older: Composer, current: Composer): Composer =>
  (inst, itemFields, label) =>
    (has(itemFields, oldKey) ? older : current)(inst, itemFields, label);

// ---- The wording ----------------------------------------------------------------------------

export const dilapidationApartment: ReportWording = {
  profile: { inspectionType: "dilapidation", propertyType: "apartment" },
  status: "final",
  composers: {
    description,
    driveway: either("notableDamage", legacyDriveway, drivewayLine),
    paving_paths: either("foyer_applicable", checklistComposer("paving_paths"), pavingLine),
    fences: either("structureType", legacyFences, fenceLine),
    retaining_walls: either("structureType", legacyRetainingWalls, retainingWallLine),
    garage_carport_sheds: either("carspace_type", checklistComposer("garage_carport_sheds"), structureLine),
    pool_spa: poolSpa,
    elevations: either("elev_overview_elevations", checklistComposer("elevations"), elevationLine),
    roof_chimneys: either("roof_covering_applicable", checklistComposer("roof_chimneys"), roofLines),
    internal_areas: either("ceilings_condition", checklistComposer("internal_areas"), roomLines),
    notes: either("structural_structurallySound", checklistComposer("notes"), notesLines),
    custom_structure: either("notes", legacyCustomStructure, addedStructureLine),
  },
  // Line 48: no fence to any side.
  absence: { fences: "There are no fences surrounding this property." },
  // A section the template words in one go (the description, the driveway, the roof, the notes, an added structure, and the first
  // Apartment form's checklists); the others item by item (each side, structure, elevation, room).
  isFlatComposed: (sectionKey, templateFields) =>
    sectionKey === "description" || sectionKey === "notes" || sectionKey.startsWith("custom_") || !templateFields.some((f) => f.type === "repeating-group"),
  // Lines 122-188: the rooms under their floor -- "GROUND FLOOR", "FIRST FLOOR", or the floor the inspector named ("LEVEL 7").
  floorGrouped: { sectionKey: "internal_areas", heading: (label) => (otherAnswerText(label) ?? label).toUpperCase() },
  // "Are there any retaining walls?" is said by the walls themselves.
  metadataFields: { retaining_walls: ["present"] },
  noSummarySections: ["description"],
  // Line 49: "There is no front fence."
  absentSlotSections: ["fences"],
  damageSentences: (inst, itemFields, options = {}) => houseDamageSentences(inst, itemFields, { ...options, style: INTERNAL }),
  summaryRows,
  descriptionBlocks,
  sectionTitle,
  // The template's headings, in its order (lines 30-221). INTERNAL is printed as its band only.
  reportParts: [
    { title: PART.driveway, band: "EXTERNAL" },
    { title: PART.paving, band: "EXTERNAL" },
    { title: PART.fences, band: "EXTERNAL" },
    { title: PART.garage, band: "EXTERNAL" },
    { title: PART.structures, band: "EXTERNAL", structures: true },
    { title: PART.main, band: "EXTERNAL" },
    { title: PART.roofChimney, band: "EXTERNAL" },
    { title: PART.roof, band: "EXTERNAL" },
    { title: PART.internal, band: "INTERNAL", heading: false },
    { title: PART.unit, band: "INTERNAL" },
    { title: PART.common, band: "INTERNAL" },
  ],
  // The template has no Condition Summary page and no Pool and Spa Safety Disclaimer.
  conditionSummary: false,
  poolSpaDisclaimer: false,
  // Line 16: "Insert photograph of front of property (from street view). Size to fit the page and centre."
  frontPhoto: { placeholder: "Insert photograph of front of property (from street view). Size to fit the page and centre.", fit: "page" },
};
