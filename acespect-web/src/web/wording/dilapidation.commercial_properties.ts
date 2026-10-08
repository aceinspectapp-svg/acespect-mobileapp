// Dilapidation / Commercial Properties -- the wording for this report type, and only this one.
//
// Written from the Houspect "Dilapidation Industrial-Commercial / Infrastructure Project" Word template. That
// template is lean: each item gets one short line (a cracking / damage overview, or the condition grade for
// fences and retaining walls), then "Sections were obscured by ...", then -- only if there is something to
// say -- "There is significant cracking / damage. The most significant items are:" followed by the defects.
// What an item is made of, where it is and how it is attached are recorded on the form but are not reported
// in the Word template's own sentences, but they ARE on the website form, so they are written in the same plain style
// as the Residential House report ("The driveway is to the front left of the block and is constructed of concrete.").
// Wherever the template has a sentence, its wording is used; the form's other answers add sentences, never replace them.
import type { AnswerTree, ConditionSummaryRow, TemplateField } from "../templateFields";
import { asString, buildDefectNote, isGateSatisfied, withPeriod } from "../templateFields";
import { gradeOf } from "../conditionGrades";
import type { Composer } from "./shared";
import {
  article,
  capitalize,
  conditionOf,
  damageSentences,
  defectOffsets,
  isNotPresent,
  joinClauses,
  joinList,
  lower,
  many,
  observationLine,
  one,
  proposedWorksParagraph,
  scopeAndSafetyParagraphs,
  yesNo,
} from "./shared";
import type { ReportWording } from "./types";

const COMPASS: Record<string, string> = { NE: "north-east", NW: "north-west", SE: "south-east", SW: "south-west" };
const compassPhrase = (label: string): string => COMPASS[label] ?? lower(label);

/** "Front" / "Left" / "Rear" / "Right" as the report says it: "left-hand", "right-hand". */
function handed(label: string): string {
  const l = lower(label).trim();
  return l === "left" ? "left-hand" : l === "right" ? "right-hand" : l;
}

/** "Sections were obscured by vegetation and stored goods." (or "Sections of the walls and hardstand were obscured by ...") */
function obscured(itemFields: TemplateField[], inst: AnswerTree, key = "obscuredBy", of = ""): string {
  const labels = many(itemFields, inst, [key]).map(lower);
  return labels.length ? `Sections ${of ? `of the ${of} ` : ""}were obscured by ${joinList(labels)}.` : "";
}

/** Is a defect a crack? (A defect with no type recorded is treated as a crack, as everywhere else.) */
const isCrack = (d: AnswerTree): boolean => {
  const type = asString(d.damageType);
  return !type || type === "cracking";
};

/**
 * "There is significant cracking / damage. The most significant items are:" -- the template's alternatives, chosen from
 * what was actually recorded: cracks only, damage only, or both. Said only when defects were recorded.
 */
function defectLead(inst: AnswerTree, key: string, plural = false): string {
  const list = Array.isArray(inst[key]) ? (inst[key] as AnswerTree[]) : [];
  if (list.length === 0) return "";
  const cracks = list.filter(isCrack).length;
  const what =
    cracks === list.length
      ? plural
        ? "There are significant cracks."
        : "There is significant cracking."
      : cracks === 0
        ? "There is significant damage."
        : plural
          ? "There are significant cracks and damage."
          : "There is significant cracking and damage.";
  return `${what} The most significant items are:`;
}

/** The defect list's own paragraphs, tagged so each defect's photos print under it. */
const defectParagraphs = (inst: AnswerTree, itemFields: TemplateField[], key: string, indexOffset = 0): string =>
  damageSentences(inst, itemFields, { key, indexOffset });

const hasDefects = (inst: AnswerTree, key: string): boolean => Array.isArray(inst[key]) && (inst[key] as unknown[]).length > 0;
const NO_CRACKING = "No visible significant cracking";

// ---- Description and Overview --------------------------------------------------------------

/** "The property is a warehouse, facing north on a flat block of land and estimated to have been constructed around 1990. It is constructed of ..." */
const description: Composer = (inst, itemFields) => {
  const constructionType = many(itemFields, inst, ["constructionIs"]).map(lower);
  const streetFrontage = one(itemFields, inst, ["streetFrontage"]);
  const blockSlope = one(itemFields, inst, ["blockSlope"]);
  const constructedYear = asString(inst.constructedYear).trim();
  const underConstructionStage = asString(inst.underConstructionStage).trim();
  // "Not applicable" is the first-floor cladding's way of saying there is no first floor -- it isn't a material.
  const wallGround = many(itemFields, inst, ["wallCladdingGround"]).map(lower);
  const wallFirst = many(itemFields, inst, ["wallCladdingFirst"])
    .map(lower)
    .filter((w) => w !== "not applicable");
  const foundations = one(itemFields, inst, ["foundations"]);
  const roofDesign = one(itemFields, inst, ["roofDesign"]);
  const roofCovering = many(itemFields, inst, ["roofCovering"]).map(lower);
  const windows = one(itemFields, inst, ["windows"]);

  const parts: string[] = [];
  const opening: string[] = [];
  if (streetFrontage) opening.push(`facing ${compassPhrase(streetFrontage)}`);
  if (blockSlope) opening.push(`on a ${lower(blockSlope)} block of land`);
  if (constructedYear) opening.push(`estimated to have been constructed around ${constructedYear}`);
  else if (underConstructionStage) {
    opening.push(`currently under construction at ${lower(underConstructionStage)}${/\bstage\b/i.test(underConstructionStage) ? "" : " stage"}`);
  }
  if (constructionType.length) {
    const kind = joinList(constructionType);
    const subject = `The property is ${article(kind)} ${kind}`;
    parts.push(opening.length ? `${subject}, ${joinClauses(opening)}.` : `${subject}.`);
  } else if (opening.length) {
    parts.push(`The property is ${joinClauses(opening)}.`);
  }

  const wallsBit = wallGround.length
    ? `${joinList(wallGround)} walls${wallFirst.length ? ` to the ground floor and ${joinList(wallFirst)} to the first floor` : ""}`
    : wallFirst.length
      ? `${joinList(wallFirst)} walls to the first floor`
      : "";
  const build: string[] = [];
  if (wallsBit) build.push(`constructed of ${wallsBit}`);
  if (foundations) build.push(`on ${lower(foundations)}`);
  if (roofDesign) build.push(`with a ${lower(roofDesign)} roof`);
  if (roofCovering.length) build.push(`a covering of ${joinList(roofCovering)}`);
  if (build.length) parts.push(`It is ${joinClauses(build)}.`);
  if (windows) parts.push(`Windows are constructed of ${lower(windows)}.`);
  // The scope and safety answers follow the property description, each as its own paragraph.
  return [parts.join(" "), proposedWorksParagraph(itemFields, inst), ...scopeAndSafetyParagraphs(inst)].filter(Boolean).join("\n\n");
};

// ---- External ------------------------------------------------------------------------------

/** "Driveway: No visible significant cracking." */
const driveway: Composer = (inst, itemFields) => {
  if (isNotPresent(inst)) return "There is no driveway.";
  const parts: string[] = [];
  const cond = conditionOf(itemFields, inst);
  if (cond.tag) parts.push(cond.tag);
  // What the form records about the driveway itself: where it is, what it is made of, its condition.
  const location = one(itemFields, inst, ["locatedAt"]);
  const material = one(itemFields, inst, ["material"]);
  if (location || material || cond.word) {
    const semiCircle = /^semi-circle/i.test(location);
    const base = location ? (semiCircle ? `The driveway is a ${lower(location)}` : `The driveway is to the ${lower(location)} of the block`) : "The driveway";
    const made = material ? `${location ? " and is" : " is"} constructed of ${lower(material)}` : "";
    const first = location || material ? `${base}${made}.` : "";
    const second = cond.word ? `${first ? "It" : "The driveway"} is in ${cond.word} condition with typical wear and tear.` : "";
    parts.push([first, second].filter(Boolean).join(" "));
  }
  const summary = one(itemFields, inst, ["crackingSummary"]);
  parts.push([`Driveway: ${summary || NO_CRACKING}.`, obscured(itemFields, inst)].filter(Boolean).join(" "));
  const lead = defectLead(inst, "damages", true);
  if (lead) parts.push(lead, defectParagraphs(inst, itemFields, "damages"));
  const notes = asString(inst.notes).trim();
  if (notes) parts.push(withPeriod(notes));
  return parts.filter(Boolean).join("\n\n");
};

/** "Front Paving: No visible significant cracking." / "There is no paving to the front of property." */
const pavingPaths: Composer = (inst, itemFields, label) => {
  const side = asString(inst.areaName).trim() || handed(label);
  const where = /-hand$/.test(side) ? `${side} side` : side;
  if (isNotPresent(inst)) return `There is no paving to the ${where} of property.`;
  const parts: string[] = [];
  const cond = conditionOf(itemFields, inst);
  if (cond.tag) parts.push(cond.tag);
  const defects = hasDefects(inst, "damages");
  const name = asString(inst.areaName).trim() || `${label} Paving`;
  // What the form records about the paving itself: what it is made of and its condition.
  const materials = many(itemFields, inst, ["material"]).map(lower);
  const first =
    materials.length === 1 && materials[0] === "grass only"
      ? `There is grass only to the ${where} of the block.`
      : materials.length
        ? `There is paving to the ${where} of the block, constructed of ${joinList(materials)}.`
        : "";
  const second = cond.word ? `${first ? "It" : `The ${lower(label)} paving`} is in ${cond.word} condition with typical wear and tear.` : "";
  const describe = [first, second].filter(Boolean).join(" ");
  if (describe) parts.push(describe);
  parts.push([`${name}: ${defects ? capitalize(cond.word || "see below") : NO_CRACKING}.`, obscured(itemFields, inst)].filter(Boolean).join(" "));
  const lead = defectLead(inst, "damages", true);
  if (lead) parts.push(lead, defectParagraphs(inst, itemFields, "damages"));
  const notes = asString(inst.notes).trim();
  if (notes) parts.push(withPeriod(notes));
  return parts.filter(Boolean).join("\n\n");
};

/** "Front Fence: Satisfactory." / "There is no front fence." */
const fences: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return `There is no ${asString(inst.fenceName).trim() || `${lower(label)} fence`}.`;
  const parts: string[] = [];
  const cond = conditionOf(itemFields, inst);
  if (cond.tag) parts.push(cond.tag);
  const name = asString(inst.fenceName).trim() || `${label} Fence`;
  // What the form records about the fence itself: what it is made of (the template's line already gives its grade).
  const material = many(itemFields, inst, ["material"]).map(lower);
  if (material.length) {
    const custom = asString(inst.fenceName).trim();
    parts.push(`${custom || `The ${lower(label)} fence`} is constructed of ${joinList(material)}.`);
  }
  parts.push([`${name}: ${cond.word ? `${capitalize(cond.word)}.` : "Inspected."}`, obscured(itemFields, inst)].filter(Boolean).join(" "));
  const worst = asString(inst.worstItem).trim();
  const lead = defectLead(inst, "damages") || (worst ? "There is significant cracking / damage. The most significant items are:" : "");
  if (lead) parts.push(lead);
  if (worst) parts.push(withPeriod(worst.replace(/\s*\n+\s*/g, " ")));
  const defects = defectParagraphs(inst, itemFields, "damages");
  if (defects) parts.push(defects);
  return parts.filter(Boolean).join("\n\n");
};

/** "Left retaining wall: Satisfactory." */
const retainingWalls: Composer = (inst, itemFields, label) => {
  const parts: string[] = [];
  const cond = conditionOf(itemFields, inst);
  if (cond.tag) parts.push(cond.tag);
  const where = one(itemFields, inst, ["location"]);
  const name = asString(inst.wallName).trim() || (where ? `${where} retaining wall` : label || "Retaining wall");
  // What the form records about the wall itself: where it is and what it is made of (the template's line gives its grade).
  const materials = many(itemFields, inst, ["materials"]).map(lower);
  const wallIntro = `There is a retaining wall${where ? ` to the ${lower(where)}` : ""}${materials.length ? `, constructed of ${joinList(materials)}` : ""}.`;
  if (where || materials.length) parts.push(wallIntro);
  parts.push([`${name}: ${cond.word ? `${capitalize(cond.word)}.` : "Inspected."}`, obscured(itemFields, inst)].filter(Boolean).join(" "));
  const worst = asString(inst.worstItem).trim();
  const lead = defectLead(inst, "damages") || (worst ? "There is significant cracking / damage. The most significant items are:" : "");
  if (lead) parts.push(lead);
  if (worst) parts.push(withPeriod(worst.replace(/\s*\n+\s*/g, " ")));
  const defects = defectParagraphs(inst, itemFields, "damages");
  if (defects) parts.push(defects);
  return parts.filter(Boolean).join("\n\n");
};

/** A garage, shed or loading dock: its own heading, one overview line, what obscured it, then any defects. */
const garageCarportSheds: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  // The form's "Shed/s" slot is the template's "Sheds" heading.
  const name = asString(inst.structureName).trim() || label.replace(/\s*\/\s*other$/i, "").replace(/^shed\/s$/i, "Sheds");
  const parts: string[] = [`ROOMHEAD::${name}`];
  const cond = conditionOf(itemFields, inst, ["wallsCondition", "condition"]);
  if (cond.tag) parts.push(cond.tag);
  const defects = hasDefects(inst, "damages");
  // What the form records about the structure itself: how it is attached, where it is, what it is made of, its state of repair.
  const noun = /^sheds?$/i.test(name) ? "shed" : lower(name);
  const attachment = one(itemFields, inst, ["attachment"]);
  const attachPhrase = attachment ? (/basement/i.test(attachment) ? " in the basement" : ` ${lower(attachment).replace(/\bto building\b/, "to the building")}`) : "";
  const position = one(itemFields, inst, ["position"]);
  const walls = many(itemFields, inst, ["walls"]).map(lower);
  const roof = many(itemFields, inst, ["roof"]).map(lower).filter((r) => !/^not applicable/.test(r));
  const floor = many(itemFields, inst, ["floor"]).map(lower);
  const withBits = [roof.length ? `${article(roof[0])} ${joinList(roof)} roof` : "", floor.length ? `${article(floor[0])} ${joinList(floor)} floor` : ""].filter(Boolean);
  const built = walls.length || withBits.length ? `, constructed of ${[walls.length ? joinList(walls) : "", withBits.length ? `${walls.length ? "with " : ""}${withBits.join(" and ")}` : ""].filter(Boolean).join(" ")}` : "";
  parts.push(`There is ${article(noun)} ${noun}${attachPhrase}${position ? ` at the ${lower(position)}` : ""}${built}${cond.word ? `, and is generally in ${cond.word} state of repair.` : "."}`);
  // The garage's walls and hardstand are what get obscured; a carport's hardstand; any other structure just "sections".
  const of = /^garage/i.test(name) ? "walls and hardstand" : /^carport/i.test(name) ? "hardstand" : "";
  const overview = defects ? capitalize(cond.word || "") : NO_CRACKING;
  parts.push(
    [
      overview ? `${overview}.` : "",
      obscured(itemFields, inst, "obscuredBy", of),
      observationLine(itemFields, inst, ["cladding"], "Cladding").trim(),
      observationLine(itemFields, inst, ["windowsDoors"], "Windows and doors").trim(),
      observationLine(itemFields, inst, ["downpipesGutters"], "Downpipes and gutters").trim(),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const lead = defectLead(inst, "damages");
  if (lead) parts.push(lead, defectParagraphs(inst, itemFields, "damages"));
  const notes = asString(inst.notes).trim();
  if (notes) parts.push(withPeriod(notes));
  return parts.filter(Boolean).join("\n\n");
};

/** "Front Elevation (north)", then "No visible significant damage. Sections were obscured by vegetation." */
const elevations: Composer = (inst, itemFields, label) => {
  const orientation = one(itemFields, inst, ["orientation"]);
  const named = asString(inst.elevationName).trim();
  // A renamed elevation keeps its direction in the heading too.
  const title = `${named || `${label} Elevation`}${orientation ? ` (${compassPhrase(orientation)})` : ""}`;
  const parts: string[] = [`ROOMHEAD::${title}`];
  const cond = conditionOf(itemFields, inst);
  if (cond.tag) parts.push(cond.tag);
  const summary = one(itemFields, inst, ["damageSummary"]);
  const partial = many(itemFields, inst, ["partialInspection"]).map(lower);
  parts.push(
    [
      `${summary || NO_CRACKING}.`,
      obscured(itemFields, inst),
      partial.length ? `Could only be partly inspected to the ${joinList(partial)}.` : "",
      observationLine(itemFields, inst, ["cladding"], "Cladding").trim(),
      observationLine(itemFields, inst, ["windowsDoors"], "Windows and doors").trim(),
      observationLine(itemFields, inst, ["downpipesGutters"], "Downpipes and gutters").trim(),
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (yesNo(inst, "partyWall")) {
    const abutting = asString(inst.partyWallNumber).trim();
    parts.push(`This elevation is on the boundary and could not be inspected.${abutting ? ` The abutting property is ${/^\d/.test(abutting) ? `No. ${abutting}` : abutting}.` : ""}`);
  }
  const lead = defectLead(inst, "damages");
  if (lead) parts.push(lead, defectParagraphs(inst, itemFields, "damages"));
  const notes = asString(inst.notes).trim();
  if (notes) parts.push(withPeriod(notes));
  return parts.filter(Boolean).join("\n\n");
};

// ---- Roof ----------------------------------------------------------------------------------

/** The template has no roof section; this follows the same lean style: grade, covering, how it was observed. */
const roofChimneys: Composer = (inst, itemFields) => {
  const parts: string[] = [];
  const cond = conditionOf(itemFields, inst);
  if (cond.tag) parts.push(cond.tag);
  const covering = many(itemFields, inst, ["coveringType"])
    .map(lower)
    .map((c) => (c === "mix of" ? "a mix of materials" : c));
  const status = many(itemFields, inst, ["inspectionStatus"]);
  const main = cond.word
    ? `The roof covering appears to be in ${cond.word} condition${covering.length ? `, constructed of ${joinList(covering)}` : ""}.`
    : covering.length
      ? `The roof covering is constructed of ${joinList(covering)}.`
      : "";
  const text = [main, ...status.map((s) => `${capitalize(s)}.`)].filter(Boolean).join(" ");
  if (text) parts.push(text);
  const lead = defectLead(inst, "damages");
  if (lead) parts.push(lead, defectParagraphs(inst, itemFields, "damages"));
  const notes = asString(inst.notes).trim();
  if (notes) parts.push(withPeriod(notes));
  return parts.filter(Boolean).join("\n\n");
};

// ---- Internal: office and staff facilities --------------------------------------------------

function floorHeading(label: string): string {
  if (/^1st\b/i.test(label)) return "FIRST FLOOR";
  if (/^2nd\b/i.test(label)) return "SECOND FLOOR";
  if (/^3rd\b/i.test(label)) return "THIRD FLOOR";
  return label.toUpperCase();
}

/** "Reception / Foyer", then "No visible significant damage." and any defects. */
const officesAndStaff: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  const name = asString(inst.areaName).trim() || label;
  const parts: string[] = [`ROOMHEAD::${name}`];
  const cond = conditionOf(itemFields, inst, ["generalCondition"]);
  if (cond.tag) parts.push(cond.tag);
  const summary = one(itemFields, inst, ["damageSummary"]);
  parts.push(`${summary || "No visible significant damage"}.`);
  const lead = defectLead(inst, "damages");
  if (lead) parts.push(lead, defectParagraphs(inst, itemFields, "damages"));
  const notes = asString(inst.notes).trim();
  if (notes) parts.push(withPeriod(notes));
  return parts.filter(Boolean).join("\n\n");
};

// ---- Internal: warehouse and production ------------------------------------------------------

/** The four areas of "Warehouse & Production", in the template's order, each under its heading. */
const WAREHOUSE_GROUPS: { prefix: string; title: string; heading: string }[] = [
  { prefix: "wh", title: "Warehouse", heading: "Warehouse and Production Areas – Walls, Windows and Doors" },
  { prefix: "prod", title: "Production", heading: "Warehouse and Production Areas – Walls, Windows and Doors" },
  { prefix: "hard", title: "Hardstand / floors", heading: "Warehouse and Production Areas – Hardstand and Other Floors" },
  { prefix: "roofin", title: "Underside Roof Covering & Frame", heading: "Warehouse and Production Areas – Roof Underside, Roof Frame" },
];

/** A group has been filled in once its condition has been answered. */
const groupAnswered = (inst: AnswerTree, prefix: string): boolean => asString(inst[`${prefix}_generalCondition`]) !== "";

/** What was recorded about the whole building before the areas: renovations, safety advisories, rooms not accessed, movement. */
function leadIn(inst: AnswerTree, itemFields: TemplateField[]): string[] {
  const parts: string[] = [];
  if (yesNo(inst, "gen_renovationsInProgress")) {
    const rooms = asString(inst.gen_renovationsRooms).trim();
    parts.push(`Renovations were in progress at the time of the inspection${rooms ? ` (${rooms})` : ""}.`);
  }
  if (yesNo(inst, "gen_safetyAdvisories")) {
    const types = many(itemFields, inst, ["gen_safetyAdvisoryTypes"]).map(lower);
    const notes = asString(inst.gen_safetyAdvisoryNotes).trim();
    parts.push(
      `${types.length ? `Safety advisory given to the owner: ${joinList(types)}.` : "A safety advisory was given to the owner."}${notes ? ` ${withPeriod(notes)}` : ""}`,
    );
  }
  const notAccessed = asString(inst.gen_roomsNotAccessed).trim();
  if (notAccessed) parts.push(`Rooms not accessed: ${withPeriod(notAccessed)}`);
  if (yesNo(inst, "gen_movementObserved")) {
    const where = asString(inst.gen_movementWhere).trim();
    parts.push(`Movement was observed in the internal areas${where ? `: ${withPeriod(where)}` : "."}`);
  }
  return parts;
}

const warehouseAndProduction: Composer = (inst, itemFields) => {
  const offsets = defectOffsets(itemFields, inst);
  const blocks: string[] = [...leadIn(inst, itemFields)];
  let lastHeading = "";
  for (const group of WAREHOUSE_GROUPS) {
    const p = group.prefix;
    if (!groupAnswered(inst, p)) continue;
    if (group.heading !== lastHeading) blocks.push(`ROOMHEAD::${group.heading}`);
    lastHeading = group.heading;
    blocks.push(`ROOMHEAD::${group.title}`);
    const cond = conditionOf(itemFields, inst, [`${p}_generalCondition`]);
    if (cond.tag) blocks.push(cond.tag);
    // What the form records about the area itself: which level it is on, and for the roof underside what it is covered with and framed in.
    const level = one(itemFields, inst, [`${p}_floorLevel`]);
    if (level) blocks.push(`It is located on the ${lower(level)}.`);
    if (p === "roofin") {
      const covering = many(itemFields, inst, ["roofin_coveringOf"]).map(lower);
      const frame = one(itemFields, inst, ["roofin_frameOf"]);
      if (covering.length || frame) {
        blocks.push(
          covering.length
            ? `The roof is covered with ${joinList(covering)}${frame ? `, on a ${lower(frame)} frame` : ""}.`
            : `The roof has a ${lower(frame)} frame.`,
        );
      }
    }
    let line: string;
    if (p === "roofin") {
      // "Satisfactory and typical condition." -- the roof underside is graded, then what was observed.
      const observed = many(itemFields, inst, ["roofin_damageSummary"]).map(lower);
      line = [
        cond.word ? (cond.word === "satisfactory" ? "Satisfactory and typical condition." : `It is in ${cond.word} condition.`) : "",
        observed.length ? `${capitalize(joinList(observed))} observed.` : "",
        yesNo(inst, "roofin_sarking") ? "Sections were obscured by sarking." : "",
      ]
        .filter(Boolean)
        .join(" ");
    } else {
      const summary = one(itemFields, inst, [`${p}_damageSummary`]);
      line = [`${summary || "No visible significant damage"}.`, obscured(itemFields, inst, `${p}_obscuredBy`)].filter(Boolean).join(" ");
    }
    if (line) blocks.push(line);
    const key = `${p}_damages`;
    if (hasDefects(inst, key)) {
      // The roof underside is only ever "damage" in the template; the other areas say cracking and/or damage.
      blocks.push(p === "roofin" ? "There is significant damage. The most significant items are:" : defectLead(inst, key));
      blocks.push(defectParagraphs(inst, itemFields, key, offsets[key] ?? 0));
    }
    const notes = asString(inst[`${p}_notes`]).trim();
    if (notes) blocks.push(withPeriod(notes));
  }
  return blocks.filter(Boolean).join("\n\n");
};

/** One Condition Summary row per area of Warehouse & Production. */
function summaryRows(sectionKey: string, inst: AnswerTree, itemFields: TemplateField[]): ConditionSummaryRow[] | undefined {
  if (sectionKey !== "internal_areas") return undefined;
  const rows: ConditionSummaryRow[] = [];
  for (const group of WAREHOUSE_GROUPS) {
    const field = itemFields.find((f) => f.key === `${group.prefix}_generalCondition`);
    if (!field || !isGateSatisfied(field, inst)) continue;
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

// ---- Notes ----------------------------------------------------------------------------------

const notes: Composer = (inst, itemFields, label) => {
  const isChecklistItem = itemFields.some((f) => f.key === "value") && itemFields.some((f) => f.key === "note");
  if (isChecklistItem) {
    if (asString(inst.value) !== "yes") return "";
    const note = asString(inst.note).trim();
    // The published checklist's labels are sentence openers waiting for a detail ("Floors are bouncy / squeaking at…"); the note completes them.
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
    return withPeriod(`No access was available to ${area || "an area of the property"}${reason ? `: ${reason}` : ""}`);
  }
  return "";
};

// ---- The wording ----------------------------------------------------------------------------

export const dilapidationCommercialProperties: ReportWording = {
  profile: { inspectionType: "dilapidation", propertyType: "commercial_properties" },
  status: "final",
  composers: {
    description,
    driveway,
    paving_paths: pavingPaths,
    fences,
    retaining_walls: retainingWalls,
    garage_carport_sheds: garageCarportSheds,
    elevations,
    roof_chimneys: roofChimneys,
    pool_spa: officesAndStaff, // the template's "Offices & Staff Facilities" is served from the pool_spa slot
    internal_areas: warehouseAndProduction,
    notes,
  },
  absence: {
    driveway: "There is no driveway.",
    paving_paths: "There is no paving to the property.",
    fences: "There are no fences surrounding this property.",
    retaining_walls: "There are no retaining walls to the property.",
    garage_carport_sheds: "There is no garage, shed or loading dock to the property.",
  },
  // Description, the driveway, the roof and Warehouse & Production are flat (no repeating group) in this report type's form.
  isFlatComposed: (sectionKey, templateFields) =>
    sectionKey === "description" ||
    (["driveway", "roof_chimneys", "internal_areas"].includes(sectionKey) && !templateFields.some((f) => f.type === "repeating-group")),
  floorGrouped: { sectionKey: "pool_spa", heading: floorHeading },
  metadataFields: { notes: ["hasDamage"] },
  // "Post project?" at the top of Notes is said as a sentence, not dropped.
  leadIn: { sectionKey: "notes", keys: new Set(["postProject"]), compose: (scope) => (yesNo(scope, "postProject") ? "This is a post-project inspection." : "") },
  noSummarySections: ["description"],
  absentSlotSections: ["paving_paths", "fences"],
  summaryRows,
};

