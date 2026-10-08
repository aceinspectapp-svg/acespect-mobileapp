// Dilapidation / Residential House -- the wording for this report type, and only this one.
import type { AnswerTree, TemplateField } from "../templateFields";
import { asString, asStringArray, otherAnswerText, withPeriod } from "../templateFields";
import { gradeOf, shortConditionLabel } from "../conditionGrades";
import type { Composer } from "./shared";
import {
  DAMAGE_TYPE_PHRASES,
  DIRECTION_ADVERBS,
  LOCATION_STARTS_WITH_PREPOSITION_RE,
  article,
  atLocation,
  capitalize,
  conditionOf,
  damageLeadIn,
  damageOverviewSentence,
  damageSentences,
  damageWording,
  defectsSentence,
  handedSide,
  hasAnswer,
  isNotPresent,
  joinClauses,
  joinList,
  keyOf,
  labelFor,
  lower,
  many,
  observationLine,
  observedSentence,
  obstructionsSentence,
  one,
  optionLabel,
  tail,
  typicalCondition,
  proposedWorksParagraph,
  scopeAndSafetyParagraphs,
  yesNo,
} from "./shared";
import type { ReportWording } from "./types";

/**
 * Per-section sentence composers matching Houspect Victoria's own master
 * report template's exact fill-in-the-blank wording ("Draft Report.docx.pdf")
 * -- e.g. driveway: "The driveway is to the {location} of the block and is
 * constructed of {material}. It is in {condition} condition with typical
 * wear and tear. Sections of the driveway were obscured by {obstructions}."
 *
 * Wired into `flattenSectionToDraft` (templateFields.ts): when a section's
 * key has a composer here, its auto-generated draft paragraph uses this
 * exact wording instead of the generic "Label: value." fallback. Only runs
 * on the web inspector editor's save path -- a section drafted on mobile
 * keeps the generic wording until a reviewer re-saves it here.
 *
 * Two generations of template field names exist in the wild -- the original
 * seed (`location`, `obstructions`, `condition`, `cracks`, ...) and the
 * published Dilapidation templates (`locatedAt`, `obscuredBy`, `wallsCondition`,
 * `present` yes/no, ...) -- so every field is read through a list of
 * accepted keys (see `keyOf`) rather than one hardcoded name. Whichever the
 * inspector actually answered wins; the wording is identical either way.
 */

const driveway: Composer = (inst, itemFields, label) => {
  // A driveway divided into parts (Front left / Front right / Rear / Side) is called with the part's name as `label` and
  // has no "Located at" question of its own; the older single-item form is called with no label.
  const part = label && itemFields.some((f) => f.key === "present") ? label : "";
  if (isNotPresent(inst)) return part ? "" : "There is no driveway.";
  const location = one(itemFields, inst, ["location", "locatedAt"]) || part;
  const material = one(itemFields, inst, ["material"]);
  const cond = conditionOf(itemFields, inst);
  if (!location && !material && !cond.word) return "There is no driveway.";
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);

  let first = "";
  if (location || material) {
    const semiCircle = /^semi-circle/i.test(location);
    const base = location
      ? semiCircle
        ? `The driveway is a ${lower(location)}`
        : `The driveway is to the ${lower(location)} of the block`
      : "The driveway";
    const made = material ? `${location ? " and is" : " is"} constructed of ${lower(material)}` : "";
    first = `${base}${made}.`;
  }
  const second = cond.word
    ? `${first ? "It" : "The driveway"} is in ${cond.word} condition with typical wear and tear.`
    : "";
  const cracking = one(itemFields, inst, ["crackingSummary"]);
  parts.push(
    `${[first, second].filter(Boolean).join(" ")}${cracking ? ` ${observedSentence(cracking)}` : ""}${obstructionsSentence(itemFields, inst, "driveway")}`,
  );
  return tail(parts, itemFields, inst);
};

const pavingPaths: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  const name = asString(inst.name);
  const materials = many(itemFields, inst, ["pathType", "material"]).map(lower);
  const cond = conditionOf(itemFields, inst);
  // A fixed-instance template (Front / Left / Rear / Right) names the area by its tab; the original seed had a free-text name instead.
  const isFixedArea = itemFields.some((f) => f.key === "present");
  const side = isFixedArea && label ? handedSide(label) : "";
  const where = name
    ? `to the ${lower(name)}`
    : side
      ? `to the ${side}${/-hand$/.test(side) ? " side" : ""} of the block`
      : "to the block";
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const first =
    materials.length === 1 && materials[0] === "grass only"
      ? `There is grass only ${where}.`
      : materials.length
        ? `There is paving ${where}, constructed of ${joinList(materials)}.`
        : `There is paving ${where}.`;
  const second = cond.word ? ` It is in ${cond.word} condition with typical wear and tear.` : "";
  parts.push(`${first}${second}${defectsSentence(itemFields, inst)}${obstructionsSentence(itemFields, inst, "paving")}`);
  const drainage = one(itemFields, inst, ["drainage"]);
  if (drainage) {
    const drainageNote = asString(inst.drainageNote);
    const lowerDrainage = lower(drainage);
    // "Adequate" reads fine as a bare adjective ("Drainage is adequate"), but "Minor Issue"/"Major Issue" are noun phrases and need their own article ("Drainage is a minor issue").
    const drainagePhrase = /issue$/.test(lowerDrainage) ? `${article(lowerDrainage)} ${lowerDrainage}` : lowerDrainage;
    parts.push(`Drainage is ${drainagePhrase}.${drainageNote ? ` ${drainageNote}` : ""}`);
  }
  return tail(parts, itemFields, inst);
};

const fences: Composer = (inst, itemFields, label) => {
  const isFixedSide = itemFields.some((f) => f.key === "present");
  // One side ticked "not present": the report says so ("There is no front fence.") -- the walk drops these lines when no side has a fence, and the section's own "There are no fences surrounding this property." stands in instead.
  if (isNotPresent(inst)) return isFixedSide && label ? `There is no ${handedSide(label)} fence.` : "";
  const location = one(itemFields, inst, ["location"]) || (isFixedSide ? handedSide(label) : "");
  const structure = many(itemFields, inst, ["structureType", "material"]).map(lower);
  const cond = conditionOf(itemFields, inst);
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const predicates = [
    structure.length ? `is constructed of ${joinList(structure)}` : "",
    cond.word ? `is in ${cond.word} condition with typical weathering` : "",
  ].filter(Boolean);
  const subject = `The ${location ? `${lower(location)} ` : ""}fence`;
  parts.push(
    `${predicates.length ? `${subject} ${predicates.join(" and ")}.` : `${subject} was inspected.`}${obstructionsSentence(itemFields, inst, "fence")}`,
  );
  return tail(parts, itemFields, inst);
};

const retainingWalls: Composer = (inst, itemFields) => {
  const location = one(itemFields, inst, ["location"]);
  const materials = many(itemFields, inst, ["material", "materials"]).map(lower);
  const cond = conditionOf(itemFields, inst);
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const first = `There is a retaining wall${location ? ` to the ${lower(location)}` : ""}${
    materials.length ? `, constructed of ${joinList(materials)}` : ""
  }.`;
  const second = cond.word ? ` It is in ${cond.word} condition with typical weathering.` : "";
  parts.push(`${first}${second}${obstructionsSentence(itemFields, inst, "wall")}`);
  return tail(parts, itemFields, inst);
};

const garageCarportSheds: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  const isFixedSlot = itemFields.some((f) => f.key === "present");
  let name = asString(inst.name) || (isFixedSlot ? label : "") || "structure";
  // The fixed "Shed / other" tab reads as just "shed" mid-sentence; an inspector-added extra tab is labelled "Structures 5", which isn't a name at all.
  name = name.replace(/\s*\/\s*other$/i, "");
  if (/^structures?\s+\d+$/i.test(name)) name = "structure";
  const lowerName = lower(name);
  const attachment = one(itemFields, inst, ["attachment"]);
  // "Attached to house" / "Separate to house" / "Basement" (published) or plain "Attached" / "Separate" (original seed).
  const attachPhrase = attachment
    ? /basement/i.test(attachment)
      ? "in the basement"
      : /house/i.test(attachment)
        ? lower(attachment).replace(/\bto house\b/, "to the house")
        : `${lower(attachment)} to the house`
    : "to the house";
  const position = one(itemFields, inst, ["position"]);
  const walls = many(itemFields, inst, ["wallConstruction", "walls"]).map(lower);
  const roof = many(itemFields, inst, ["roofConstruction", "roof"]).map(lower);
  const floor = many(itemFields, inst, ["floorType", "floor"]).map(lower);
  const cond = conditionOf(itemFields, inst);

  const withBits = [
    roof.length ? `${article(roof[0])} ${joinList(roof)} roof` : "",
    floor.length ? `${article(floor[0])} ${joinList(floor)} floor` : "",
  ].filter(Boolean);
  const constructionText =
    walls.length || withBits.length
      ? `, constructed of ${[
          walls.length ? joinList(walls) : "",
          withBits.length ? `${walls.length ? "with " : ""}${withBits.join(" and ")}` : "",
        ]
          .filter(Boolean)
          .join(" ")}`
      : "";
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  parts.push(
    `There is ${article(lowerName)} ${lowerName} ${attachPhrase}${position ? ` at the ${lower(position)}` : ""}${constructionText}${
      cond.word ? `, and is generally in ${cond.word} state of repair.` : "."
    }${obstructionsSentence(itemFields, inst, /carport/i.test(name) ? "structure" : "walls and hardstand")}${observationLine(itemFields, inst, ["cladding"], "Cladding")}${observationLine(
      itemFields,
      inst,
      ["windowsDoors"],
      "Windows and doors",
    )}${observationLine(itemFields, inst, ["eaves"], "Eaves")}${observationLine(itemFields, inst, ["downpipesGutters"], "Downpipes and gutters")}`,
  );
  return tail(parts, itemFields, inst);
};

const poolSpa: Composer = (inst, itemFields, label) => {
  // A pool / spa divided into parts (Pool, Spa) is called with the part's name as `label`; the older single-item form is called with no label.
  const part = label && itemFields.some((f) => f.key === "present") ? label : "";
  if (isNotPresent(inst)) return part ? "" : "There is no pool or spa to the property.";
  const name = asString(inst.name) || part || "pool/spa";
  const poolType = one(itemFields, inst, ["poolType"]);
  const position = one(itemFields, inst, ["position"]);
  const construction = many(itemFields, inst, ["construction", "constructed"]).map(lower);
  const paving = many(itemFields, inst, ["paving"]).map(lower);
  const cond = conditionOf(itemFields, inst);
  const fenceType = many(itemFields, inst, ["fenceType", "poolFence"]).map(lower);
  const fenceSafety = lower(one(itemFields, inst, ["fenceSafety"]));
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const lowerPoolName = lower(name);
  const lowerPoolType = lower(poolType);
  parts.push(
    `There is ${article(lowerPoolName)} ${lowerPoolName} located at the ${position ? `${lower(position)} of the ` : ""}property${
      poolType ? `, ${article(lowerPoolType)} ${lowerPoolType}` : ""
    }${construction.length ? `, constructed of ${joinList(construction)}` : ""}${
      cond.word ? `, which is generally in ${cond.word} state of repair` : ""
    }.${paving.length ? ` The surrounds are paved with ${joinList(paving)}.` : ""}${obstructionsSentence(itemFields, inst, "pool/spa area")}`,
  );
  if (fenceType.length || fenceSafety) {
    // "Compliant" needs "appears to be ___"; the published templates' own options are already full phrases ("Appears to be okay", "No, does not appear to be safe").
    const safetyPhrase = /^appears/.test(fenceSafety)
      ? fenceSafety
      : /^no, /.test(fenceSafety)
        ? fenceSafety.slice(4)
        : `appears to be ${fenceSafety || "not observed"}`;
    parts.push(
      `The ${part ? lower(part) : "pool"} fence is constructed of ${fenceType.length ? joinList(fenceType) : "the surrounding boundary"} and ${safetyPhrase}.`,
    );
  }
  return tail(parts, itemFields, inst);
};

/** North/South/East/West read fine lower-cased mid-sentence ("facing north"); the 4 intercardinal abbreviations don't ("facing ne" reads like a typo) -- this spells them out instead. */
const COMPASS_EXPANSIONS: Record<string, string> = {
  NE: "north-east",
  NW: "north-west",
  SE: "south-east",
  SW: "south-west",
};
function compassPhrase(label: string): string {
  return COMPASS_EXPANSIONS[label] ?? lower(label);
}

const elevations: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  const orientation = one(itemFields, inst, ["orientation"]);
  const cond = conditionOf(itemFields, inst);
  const claddingObs = many(itemFields, inst, ["claddingObs"]).map(lower);
  const windowDoorObs = many(itemFields, inst, ["windowDoorObs"]).map(lower);
  const partyWall = yesNo(inst, "partyWall");
  const partyWallNumber = asString(inst.partyWallNumber).trim();
  const partial = many(itemFields, inst, ["partialInspection"]).map(lower);
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const overview = damageOverviewSentence(itemFields, inst);
  parts.push(
    `The ${lower(label)} elevation${orientation ? ` generally faces ${compassPhrase(orientation)}` : ""}.${
      cond.word ? ` ${typicalCondition(cond.word)}` : ""
    }${overview ? ` ${overview}` : ""}${partial.length ? ` Partial inspection only: ${joinList(partial)}.` : ""}${
      claddingObs.length ? ` ${capitalize(joinList(claddingObs))} noted to the cladding.` : ""
    }${windowDoorObs.length ? ` ${capitalize(joinList(windowDoorObs))} noted to windows/doors.` : ""}${obstructionsSentence(
      itemFields,
      inst,
      "",
    )}${observationLine(itemFields, inst, ["cladding"], "Cladding")}${observationLine(
      itemFields,
      inst,
      ["windowsDoors"],
      "Windows and doors",
    )}${observationLine(itemFields, inst, ["eaves"], "Eaves")}${observationLine(itemFields, inst, ["downpipesGutters"], "Downpipes and gutters")}`,
  );
  if (partyWall) {
    const at = /^\d/.test(partyWallNumber) ? `No. ${partyWallNumber}` : partyWallNumber;
    parts.push(
      `The ${lower(label)} elevation is a party wall abutting the next property${at ? ` at ${at}` : ""}.${
        cond.word ? ` To the sections observed, it appears to be in ${cond.word === "satisfactory" ? "satisfactory and typical" : cond.word} condition.` : ""
      }`,
    );
  }
  return tail(parts, itemFields, inst);
};

const roofChimneys: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  const accessibility = many(itemFields, inst, ["accessibility"]).map(lower);
  const status = many(itemFields, inst, ["inspectionStatus"]);
  const covering = many(itemFields, inst, ["coveringType"])
    .map(lower)
    .map((c) => (c === "mix of" ? "a mix of materials" : c));
  const observations = many(itemFields, inst, ["generalObservations"]).map(lower);
  const cond = conditionOf(itemFields, inst);
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const subject = `The ${lower(label)}`;
  const main = cond.word
    ? `${subject} appears to be in ${cond.word} condition${covering.length ? `, constructed of ${joinList(covering)}` : ""}.`
    : covering.length
      ? `${subject} is constructed of ${joinList(covering)}.`
      : "";
  // The published template's inspection-status options are already full phrases ("Inspected partly from upstairs windows"), each stated as its own sentence.
  const text = `${main}${accessibility.length ? ` Comments are based on ${joinList(accessibility)}.` : ""}${
    status.length ? ` ${status.map((s) => `${capitalize(s)}.`).join(" ")}` : ""
  }${observations.length ? ` ${capitalize(joinList(observations))} noted.` : ""}`.trim();
  if (text) parts.push(text);
  const notes = asString(inst.notes);
  const damages = damageSentences(inst, itemFields);
  if (damages) parts.push(damages);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

/** "1st floor" -> "FIRST FLOOR" etc. -- the band ReportSection.tsx draws above each floor's rooms. */
function floorHeading(label: string): string {
  if (/^1st\b/i.test(label)) return "FIRST FLOOR";
  if (/^2nd\b/i.test(label)) return "SECOND FLOOR";
  if (/^3rd\b/i.test(label)) return "THIRD FLOOR";
  return label.toUpperCase();
}

const internalAreas: Composer = (inst, itemFields, rawLabel) => {
  if (isNotPresent(inst)) return "";
  // An inspector-added extra room with no name typed is labelled "Rooms 11" by the list -- that isn't a heading.
  const label = /^rooms?\b.*\s\d+$/i.test(rawLabel) ? "Other room" : rawLabel;
  const cond = conditionOf(itemFields, inst);
  const moisture = many(itemFields, inst, ["moistureObservations"]).map(lower);
  const parts: string[] = [];
  // Room name as its own bold heading (see ReportSection.tsx's "ROOMHEAD::" handling), matching the reference report's "Bedroom 4" / "Bathroom" style -- rather than folding the name into the sentence itself.
  parts.push(`ROOMHEAD::${label}`);
  if (cond.tag) parts.push(cond.tag);
  const damageOverview = damageOverviewSentence(itemFields, inst);
  const text = `${[typicalCondition(cond.word), damageOverview].filter(Boolean).join(" ")}${obstructionsSentence(
    itemFields,
    inst,
    "",
  )}${moisture.length ? ` ${capitalize(joinList(moisture))} noted.` : ""}${yesNo(inst, "withEnsuite") ? " It has an ensuite." : ""}`.trim();
  if (text) parts.push(text);
  return tail(parts, itemFields, inst);
};

/** Internal Areas' section-level answers (everything above the room list) that are composed into prose by `composeInternalAreasLeadIn` rather than printed as "Label: value." lines. */
const INTERNAL_AREAS_LEAD_IN_KEYS = new Set([
  "renovationsInProgress",
  "renovationsRooms",
  "safetyAdvisories",
  "safetyAdvisoryTypes",
  "safetyAdvisoryTypesOther",
  "safetyAdvisoryNotes",
  "roomsNotAccessed",
  "movementObserved",
  "movementWhere",
]);

function composeInternalAreasLeadIn(scope: AnswerTree, templateFields: TemplateField[]): string {
  const parts: string[] = [];
  if (yesNo(scope, "renovationsInProgress")) {
    const rooms = asString(scope.renovationsRooms).trim();
    parts.push(`Renovations were in progress at the time of the inspection${rooms ? ` (${rooms})` : ""}.`);
  }
  if (yesNo(scope, "safetyAdvisories")) {
    const types = many(templateFields, scope, ["safetyAdvisoryTypes"]).map(lower);
    const notes = asString(scope.safetyAdvisoryNotes).trim();
    parts.push(
      `${types.length ? `Safety advisory given to the owner: ${joinList(types)}.` : "A safety advisory was given to the owner."}${
        notes ? ` ${withPeriod(notes)}` : ""
      }`,
    );
  }
  const notAccessed = asString(scope.roomsNotAccessed).trim();
  if (notAccessed) parts.push(`Rooms not accessed: ${withPeriod(notAccessed)}`);
  if (yesNo(scope, "movementObserved")) {
    const where = asString(scope.movementWhere).trim();
    parts.push(`Movement was observed in the internal areas${where ? `: ${withPeriod(where)}` : "."}`);
  }
  return parts.join("\n\n");
}

/**
 * Description & Overview's property-description fields, composed into the
 * reference template's flowing prose ("The property is a single storey
 * house, facing north on a flat block of land and estimated to have been
 * constructed around 1980s. It is constructed of brick walls on concrete
 * slab with a pitched roof and a covering of concrete tiles. Windows are
 * constructed of aluminium.") instead of one "Label: value." line per field.
 * Unlike every other composer here, this one runs on the section's own flat
 * top-level fields directly (there's no repeating-group / per-instance
 * wrapper for Description) -- see templateFields.ts's `isFlatComposedSection`.
 * The section's other fields (site address, scope, safety) aren't part of
 * this paragraph; they stay in `fields` for the reviewer's own editing view.
 */
const description: Composer = (inst, itemFields) => {
  const constructionType = one(itemFields, inst, ["constructionIs"]);
  const streetFrontage = one(itemFields, inst, ["streetFrontage"]);
  const blockSlope = one(itemFields, inst, ["blockSlope"]);
  const constructedYear = asString(inst.constructedYear);
  const underConstructionStage = asString(inst.underConstructionStage);
  // "Not applicable" is the first-floor cladding's way of saying there is no first floor -- it isn't a material.
  const wallGround = many(itemFields, inst, ["wallCladdingGround"]).map(lower);
  const wallFirst = many(itemFields, inst, ["wallCladdingFirst"])
    .map(lower)
    .filter((w) => w !== "not applicable");
  const foundations = one(itemFields, inst, ["foundations"]);
  const roofDesign = one(itemFields, inst, ["roofDesign"]);
  const roofCovering = many(itemFields, inst, ["roofCovering"]).map(lower);
  const windows = many(itemFields, inst, ["windows"]).map(lower);

  const parts: string[] = [];

  const frontageBlockBits: string[] = [];
  if (streetFrontage) frontageBlockBits.push(`facing ${compassPhrase(streetFrontage)}`);
  if (blockSlope) frontageBlockBits.push(`on a ${lower(blockSlope)} block of land`);
  const ageBit = constructedYear
    ? `estimated to have been constructed around ${constructedYear}`
    : underConstructionStage
      ? // If the inspector's own typed stage already says "stage" ("Frame Stage"), appending it again used to produce "frame stage stage".
        `currently under construction at ${lower(underConstructionStage)}${/\bstage\b/i.test(underConstructionStage) ? "" : " stage"}`
      : "";
  const openingClauses = [frontageBlockBits.join(" "), ageBit].filter(Boolean);
  if (constructionType || openingClauses.length) {
    if (constructionType) {
      const lowerConstructionType = lower(constructionType);
      const subject = `The property is ${article(lowerConstructionType)} ${lowerConstructionType}`;
      parts.push(openingClauses.length ? `${subject}, ${joinClauses(openingClauses)}.` : `${subject}.`);
    } else {
      // No stray "The property is, facing..." comma when there's no construction-type clause in front of it to attach to.
      parts.push(`The property is ${joinClauses(openingClauses)}.`);
    }
  }

  const wallsBit = wallGround.length
    ? `${joinList(wallGround)} walls${wallFirst.length ? ` to the ground floor and ${joinList(wallFirst)} to the first floor` : ""}`
    : wallFirst.length
      ? // First-floor cladding recorded with no ground-floor answer used to drop the floor distinction entirely, reading as if the whole building were clad in it.
        `${joinList(wallFirst)} walls to the first floor`
      : "";
  const buildClauses: string[] = [];
  if (wallsBit) buildClauses.push(`constructed of ${wallsBit}`);
  if (foundations) buildClauses.push(`on ${lower(foundations)}`);
  if (roofDesign) buildClauses.push(`with a ${lower(roofDesign)} roof`);
  if (roofCovering.length) buildClauses.push(`a covering of ${joinList(roofCovering)}`);
  if (buildClauses.length) parts.push(`It is ${joinClauses(buildClauses)}.`);

  if (windows.length) parts.push(`Windows are constructed of ${joinList(windows)}.`);

  // The scope and safety answers follow the property description, each as its own paragraph.
  return [parts.join(" "), proposedWorksParagraph(itemFields, inst), ...scopeAndSafetyParagraphs(inst)].filter(Boolean).join("\n\n");
};

/**
 * Notes & Post Project's two checklist-style repeating-groups ("Movement /
 * Safety Checklist" -- 6 fixed yes/no items with a gated detail box -- and
 * user-addable "No Access Areas"). Both route through this one composer
 * (templateFields.ts keys every repeating-group inside a section by that
 * section's key, not the field's own key), disambiguated by which fields
 * `itemFields` actually has. Unlike every other section, a checklist item
 * answered "No" -- the common case -- produces NOTHING here instead of a
 * "Bouncy / Squeaking Floors: Observed?: No." line, so an inspection with
 * nothing notable ends up with a genuinely empty reportText. That emptiness
 * is what lets ReportView.tsx hide the whole "NOTES" heading/list, matching
 * the reference report, which omits this section entirely rather than
 * printing a wall of "nothing to report" boilerplate.
 */
const notes: Composer = (inst, itemFields, label) => {
  const isChecklistItem = itemFields.some((f) => f.key === "value") && itemFields.some((f) => f.key === "note");
  if (isChecklistItem) {
    if (asString(inst.value) !== "yes") return "";
    const note = asString(inst.note).trim();
    // The published checklist's labels are sentence openers waiting for a detail ("Floors are bouncy / squeaking at…", "...vibrations. Where?"), not standalone item names -- the note completes them.
    if (/…$|\.\.\.$/.test(label)) {
      const opener = label.replace(/\s*(…|\.\.\.)$/, "");
      if (!note) return withPeriod(opener.replace(/\s+at$/i, ""));
      return /\sat$/i.test(opener) ? `${opener} ${withPeriod(note)}` : `${withPeriod(opener)} ${withPeriod(note)}`;
    }
    if (/\bWhere\?$/.test(label)) {
      const base = label.replace(/\s*Where\?$/, "");
      return `${base}${note ? ` Location: ${withPeriod(note)}` : ""}`;
    }
    return `${label} observed.${note ? ` ${withPeriod(note)}` : ""}`;
  }
  const isNoAccessItem = itemFields.some((f) => f.key === "area") && itemFields.some((f) => f.key === "reason");
  if (isNoAccessItem) {
    const area = asString(inst.area);
    const reason = asString(inst.reason);
    if (!area && !reason) return "";
    const line = `No access was available to ${area || "an area of the property"}${reason ? `: ${reason}` : ""}`;
    return withPeriod(line);
  }
  return "";
};


/** The sentences for Dilapidation / Residential House. */
export const residentialHouseComposers: Record<string, Composer> = {
  description,
  notes,
  driveway,
  paving_paths: pavingPaths,
  fences,
  retaining_walls: retainingWalls,
  garage_carport_sheds: garageCarportSheds,
  pool_spa: poolSpa,
  elevations,
  roof_chimneys: roofChimneys,
  internal_areas: internalAreas,
};

/** What to say when a section that can legitimately not exist at a property has nothing recorded. */
const ABSENCE: Record<string, string> = {
  driveway: "There is no driveway.",
  paving_paths: "There is no paving to the property.",
  fences: "There are no fences surrounding this property.",
  retaining_walls: "There are no retaining walls to the property.",
  garage_carport_sheds: "There is no garage, carport or shed to the property.",
  pool_spa: "There is no pool or spa to the property.",
};

export const dilapidationResidentialHouse: ReportWording = {
  profile: { inspectionType: "dilapidation", propertyType: "residential_house" },
  status: "final",
  composers: residentialHouseComposers,
  absence: ABSENCE,
  // Description is flat (no repeating group). Driveway and Pool / Spa are flat in the published templates, but the original seed wrapped them in a one-item list.
  isFlatComposed: (sectionKey, templateFields) =>
    sectionKey === "description" ||
    ((sectionKey === "driveway" || sectionKey === "pool_spa") && !templateFields.some((f) => f.type === "repeating-group")),
  leadIn: { sectionKey: "internal_areas", keys: INTERNAL_AREAS_LEAD_IN_KEYS, compose: composeInternalAreasLeadIn },
  floorGrouped: { sectionKey: "internal_areas", heading: floorHeading },
  metadataFields: { notes: ["postProject", "hasDamage"] },
  noSummarySections: ["description"],
  absentSlotSections: ["fences"],
};
