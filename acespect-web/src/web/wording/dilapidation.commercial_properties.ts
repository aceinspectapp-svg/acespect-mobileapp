// Dilapidation / Commercial Properties -- the wording for this report type, and only this one.
//
// Written from the Houspect "Dilapidation Industrial / Commercial Structures" inspector template (1 May 2024) and the
// Industrial-Commercial Word template, in the sentence style of Houspect's real reports (see the Residential House wording):
// every part of the property is described from what the inspector recorded -- where it is, what it is made of, its
// condition -- and then what was found:
//   * a part in satisfactory condition gets the "satisfactory ... with typical wear and tear / weathering" sentence, any other
//     grade just states the grade ("It is in fair condition.");
//   * the cracking / damage overview ("Several minor cracks", "Items of damage throughout") is said only when it records an
//     issue -- "No visible significant damage" says nothing;
//   * the defects themselves are always said, each with its photos.
// Where a Commercial section is the same question as the House one (driveway, paving, fences, retaining walls, structures,
// elevations, offices and staff rooms) it is worded by the House composers; the parts only a commercial building has
// (description, roof, warehouse and production areas) are worded here.
import type { AnswerTree, ConditionSummaryRow, TemplateField } from "../templateFields";
import { asString, buildDefectNote, isGateSatisfied, withPeriod } from "../templateFields";
import { gradeOf } from "../conditionGrades";
import type { Composer } from "./shared";
import { article, capitalize, conditionOf, defectOffsets, isNotPresent, joinClauses, joinList, lower, many, one, scopeAndSafetyParagraphs, typedCase, yesNo } from "./shared";
import {
  derivedFields,
  descriptionBlocks,
  houseDamageSentences,
  amp,
  materialWords,
  overviewIfIssue,
  PRESENCE,
  residentialHouseComposers as house,
  roofStatusSentence,
  typically,
  wallNoun,
  wallsOf,
} from "./dilapidation.residential_house";
import { templateDamageSentences } from "./templateDamage";
import type { ReportWording } from "./types";

const COMPASS: Record<string, string> = {
  NE: "north-east",
  NW: "north-west",
  SE: "south-east",
  SW: "south-west",
};
const compassPhrase = (label: string): string => COMPASS[label] ?? lower(label);

/** "Front" / "Left" / "Rear" / "Right" as the report says it: "left-hand", "right-hand". */
function handed(label: string): string {
  const l = lower(label).trim();
  return l === "left" ? "left-hand" : l === "right" ? "right-hand" : l;
}

/** "Sections were obscured by vegetation and stored goods." (or "Sections of the walls were obscured by ...") */
function obscured(itemFields: TemplateField[], inst: AnswerTree, key = "obscuredBy", of = ""): string {
  const labels = many(itemFields, inst, [key])
    .map(lower)
    .map((l) => l.replace(/\bcar\/s\b/g, "cars"));
  return labels.length ? `Sections ${of ? `of the ${of} ` : ""}were obscured by ${joinList(labels)}.` : "";
}

const hasDefects = (inst: AnswerTree, key: string): boolean => Array.isArray(inst[key]) && (inst[key] as unknown[]).length > 0;

/** The template's defect sentences: external ones state the size plainly, internal ones say "approximately". */
const external = templateDamageSentences({ approximately: false });
const internal = templateDamageSentences({ approximately: true });

/**
 * A House composer for the part's description, with the defects and notes said the template's way after it:
 * "At the corner, there is a crack starting at the gate and running to the north. The crack is 3 millimetres wide and 500 millimetres long."
 */
const withDefects =
  (compose: Composer, damageSentences: typeof external, extra?: (inst: AnswerTree) => string): Composer =>
  (inst, itemFields, label) => {
    const body = compose({ ...inst, damages: [], notes: "" }, itemFields, label);
    if (!body) return body;
    const notes = asString(inst.notes).trim();
    return [body, extra?.(inst) ?? "", damageSentences(inst, itemFields, { key: "damages" }), notes ? withPeriod(notes) : ""].filter(Boolean).join("\n\n");
  };

// ---- Description and Overview --------------------------------------------------------------

/** "concrete panels" walls read "concrete panel walls". */
const wallMaterial = (m: string): string => m.replace(/\bpanels$/, "panel");

/**
 * "The property is a warehouse, facing north on a flat block of land and estimated to have been constructed around 1990. It is
 * constructed of ..." -- `kindOf` words what the building is (the Apartment report says "commercial office building").
 */
export const makeDescription =
  (kindOf: (label: string) => string = (l) => l): Composer =>
  (inst, itemFields) => {
    const constructionType = many(itemFields, inst, ["constructionIs"]).map(lower).map(amp).map(kindOf);
    const streetFrontage = one(itemFields, inst, ["streetFrontage"]);
    const blockSlope = one(itemFields, inst, ["blockSlope"]);
    const constructedYear = asString(inst.constructedYear).trim();
    const underConstructionStage = asString(inst.underConstructionStage).trim();
    // "Not applicable" is the first-floor cladding's way of saying there is no first floor -- it isn't a material.
    const wallGround = materialWords(many(itemFields, inst, ["wallCladdingGround"]).map(lower).map(wallMaterial));
    const wallFirst = materialWords(
      many(itemFields, inst, ["wallCladdingFirst"])
        .map(lower)
        .filter((w) => w !== "not applicable")
        .map(wallMaterial),
    );
    const foundations = one(itemFields, inst, ["foundations"]);
    const roofDesign = one(itemFields, inst, ["roofDesign"]);
    const roofCovering = materialWords(many(itemFields, inst, ["roofCovering"]).map(lower));
    const windows = materialWords(many(itemFields, inst, ["windows"]).map(lower));

    const parts: string[] = [];
    const opening: string[] = [];
    if (streetFrontage) opening.push(`facing ${compassPhrase(streetFrontage)}`);
    if (blockSlope) opening.push(`on a ${lower(blockSlope)} block of land`);
    if (constructedYear) opening.push(`estimated to have been constructed around ${constructedYear}`);
    else if (underConstructionStage) {
      opening.push(`currently under construction at ${lower(typedCase(underConstructionStage))}${/\bstage\b/i.test(underConstructionStage) ? "" : " stage"}`);
    }
    if (constructionType.length) {
      const kind = joinList(constructionType);
      const subject = `The property is ${article(kind)} ${kind}`;
      parts.push(opening.length ? `${subject}, ${joinClauses(opening)}.` : `${subject}.`);
    } else if (opening.length) {
      parts.push(`The property is ${joinClauses(opening)}.`);
    }

    const wallsBit = wallGround.length
      ? `${wallsOf(wallGround)}${wallFirst.length ? ` to the ground floor and ${joinList(wallFirst.map(wallNoun))} to the first floor` : ""}`
      : wallFirst.length
        ? `${wallsOf(wallFirst)} to the first floor`
        : "";
    const build: string[] = [];
    if (wallsBit) build.push(`constructed of ${wallsBit}`);
    if (foundations) build.push(`on ${lower(foundations)}`);
    if (roofDesign)
      build.push(
        /^combo (of )?/i.test(roofDesign) ? `with a combination of ${lower(roofDesign).replace(/^combo (of )?/, "")} roofs` : `with a ${lower(roofDesign)} roof`,
      );
    if (roofCovering.length) build.push(`a covering of ${joinList(roofCovering)}`);
    if (build.length) parts.push(`It is ${joinClauses(build)}.`);
    if (windows.length) parts.push(`Windows are constructed of ${joinList(windows)}.`);
    // What the project works are, and the scope, are said on the Description page itself (descriptionBlocks); safety and limitations follow here.
    return [parts.join(" "), ...scopeAndSafetyParagraphs(inst)].filter(Boolean).join("\n\n");
  };

const description = makeDescription();

// ---- External ------------------------------------------------------------------------------

/** "The driveway is to the front left of the block and is constructed of concrete. It is in fair condition. ..." */
const driveway: Composer = withDefects((inst, itemFields, label) => house.driveway!(inst, itemFields, label), external);

/** "There is paving to the front of the block, constructed of concrete. ..." / "There is no paving to the front of property." */
const pavingPaths: Composer = withDefects((inst, itemFields, label) => {
  const named = asString(inst.areaName).trim();
  const side = named || handed(label);
  if (isNotPresent(inst)) return `There is no paving to the ${/-hand$/.test(side) ? `${side} side` : side} of property.`;
  return house.paving_paths!({ ...inst, name: named }, itemFields, label);
}, external);

/** The inspector's own description of the worst item, as a sentence of its own after what the form says. */
const worstItem = (inst: AnswerTree): string => {
  const worst = asString(inst.worstItem)
    .trim()
    .replace(/\s*\n+\s*/g, " ");
  return worst ? withPeriod(worst) : "";
};

/** "The front fence is constructed of timber palings and is in satisfactory condition with typical weathering. ..." / "There is no front fence." */
const fences: Composer = withDefects(
  (inst, itemFields, label) => {
    // A renamed fence ("Main boundary fence") is said by its own name.
    const named = asString(inst.fenceName)
      .trim()
      .replace(/\s+fence$/i, "");
    return house.fences!(inst, itemFields, named || label);
  },
  external,
  worstItem,
);

/** "There is a retaining wall to the left, constructed of brick. It is in satisfactory condition with typical weathering." */
const retainingWalls: Composer = withDefects(
  (inst, itemFields, label) => {
    const named = asString(inst.wallName).trim();
    const text = house.retaining_walls!(inst, itemFields, label);
    return named ? text.replace(/There is a retaining wall/, `There is a retaining wall (${named})`) : text;
  },
  external,
  worstItem,
);

/** A parked vehicle is said as the template does: "A parked car obscured part of the hardstand." */
const isParked = (value: string): boolean => /^parked/.test(value);

/** A garage, shed or loading dock: its own heading, then the House sentence for a structure. */
const garageCarportSheds: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  const custom = asString(inst.structureName).trim();
  // The form's "Shed/s" slot is the template's "Sheds" heading, and reads as "a shed" mid-sentence.
  const heading = custom || label.replace(/\s*\/\s*other$/i, "").replace(/^shed\/s$/i, "Sheds");
  const name = custom || (/^shed\/s$/i.test(label) ? "Shed" : label);
  // "Not applicable as basement" is the roof choice for a basement garage -- there is no roof to describe.
  const roof = Array.isArray(inst.roof) ? (inst.roof as string[]).filter((r) => !/^not_applicable/.test(r)) : inst.roof;
  // "Basement" as the wall material of a garage in the basement just repeats where it is.
  const walls = Array.isArray(inst.walls) ? (inst.walls as string[]).filter((w) => w !== "basement") : inst.walls;
  const rawObscured = inst.obscuredBy;
  const obscuredBy = Array.isArray(rawObscured) ? (rawObscured as string[]) : typeof rawObscured === "string" && rawObscured ? [rawObscured] : [];
  const parked = obscuredBy.filter(isParked);
  let body = house.garage_carport_sheds!(
    { ...inst, structureName: name, roof, walls, obscuredBy: obscuredBy.filter((v) => !isParked(v)), damages: [], notes: "" },
    itemFields,
    label,
  );
  if (!body) return "";
  // The Commercial template words what gets obscured as "the walls and hardstand" (a carport: "the hardstand").
  const floors = Array.isArray(inst.floor) ? (inst.floor as string[]) : [];
  if (/garage|carport/i.test(name) || floors.some((f) => /hardstand/i.test(f))) {
    body = body.replace(/Sections of the walls and floor were/, "Sections of the walls and hardstand were").replace(/Sections of the floor were/, "Sections of the hardstand were");
  }
  if (parked.length) {
    const sentence = parked.length === 1 && /car/.test(parked[0]!) ? "A parked car obscured part of the hardstand." : "Parked vehicles obscured part of the hardstand.";
    body = body.replace(/^(There is [^\n]*)$/m, `$1 ${sentence}`);
  }
  const notes = asString(inst.notes).trim();
  return [`ROOMHEAD::${heading}`, body, external(inst, itemFields, { key: "damages" }), notes ? withPeriod(notes) : ""].filter(Boolean).join("\n\n");
};

/** "Front Elevation (north)", then the elevation's sentences: "Satisfactory and in typical condition." (any other grade: "It is in poor condition.") and the defects. */
const elevations: Composer = (inst, itemFields, label) => {
  const named = asString(inst.elevationName).trim();
  let body = house.elevations!({ ...inst, damages: [], notes: "" }, itemFields, label);
  if (!body) return "";
  if (named) {
    // A renamed elevation keeps its direction in the heading too.
    const orientation = one(itemFields, inst, ["orientation"]);
    body = body.replace(/^ROOMHEAD::[^\n]*/, `ROOMHEAD::${named}${orientation ? ` (${compassPhrase(orientation)})` : ""}`);
  }
  const notes = asString(inst.notes).trim();
  return [body, external(inst, itemFields, { key: "damages" }), notes ? withPeriod(notes) : ""].filter(Boolean).join("\n\n");
};

// ---- Roof ----------------------------------------------------------------------------------

/**
 * The commercial roof is one roof (no upper / lower): "The roof covering of kliplock decking appears to be in satisfactory
 * condition with typical weathering. Comments are based on limited observations from the ground only and using a camera zoom."
 */
const roofChimneys: Composer = (inst, itemFields) => {
  const status = many(itemFields, inst, ["inspectionStatus"]);
  const covering = materialWords(many(itemFields, inst, ["coveringType"]).map(lower));
  const noted = many(itemFields, inst, ["generalObservations"]);
  const satisfactoryToFair = noted.some((n) => /^satisfactory to fair with typical weathering$/i.test(n));
  const others = noted.filter((n) => !/^satisfactory to fair with typical weathering$/i.test(n));
  const chimney = others.filter((n) => /^chimney appears/i.test(n)).map((n) => `${capitalize(n)}.`);
  const observed = others.filter((n) => !/^chimney appears/i.test(n)).map(lower);
  const cond = conditionOf(itemFields, inst, ["generalCondition"]);
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  // "appears to be in {new / poor / aged / satisfactory} condition with {typical weathering / rust spots / gaps at flashings}"
  const gradePhrase = satisfactoryToFair ? "satisfactory to fair condition" : cond.word ? `${cond.word} condition` : "";
  const withBits = [...(satisfactoryToFair || (cond.word === "satisfactory" && observed.length === 0) ? ["typical weathering"] : []), ...observed];
  const material = covering.length ? ` of ${joinList(covering)}` : "";
  const main = gradePhrase
    ? `The roof covering${material} appears to be in ${gradePhrase}${withBits.length ? ` with ${joinList(withBits)}` : ""}.`
    : covering.length
      ? `The roof covering is constructed of ${joinList(covering)}.`
      : "";
  // How the roof was seen: from the ground with a camera zoom, from a ladder, or not at all in a multi-level complex.
  const seen = status.map((s) =>
    /ladder/i.test(s)
      ? "Comments are based on limited observations standing on a ladder to the lower roof and from the ground using a camera zoom."
      : /multi-level building complex/i.test(s)
        ? "The roof could not be inspected as the building is a multi-level building complex. Roof coverings in a building complex are common property and need to be maintained through the Owners Corporation."
        : roofStatusSentence(s),
  );
  const text = [main, ...seen, ...chimney].filter(Boolean).join(" ");
  if (text) parts.push(text);
  const damages = external(inst, itemFields, { key: "damages" });
  if (damages) parts.push(damages);
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

/** "Reception / Foyer", then "The reception and foyer are in satisfactory and typical condition." and any defects. */
const officesAndStaff: Composer = withDefects(
  (inst, itemFields, label) => house.internal_areas!({ ...inst, roomName: asString(inst.areaName) }, itemFields, label),
  internal,
);

// ---- Internal: warehouse and production ------------------------------------------------------

/** The four areas of "Warehouse & Production", in the template's order, each under its heading. */
const WAREHOUSE_GROUPS: {
  prefix: string;
  title: string;
  subject: string;
  plural: boolean;
  heading: string;
}[] = [
  {
    prefix: "wh",
    title: "Warehouse",
    subject: "warehouse",
    plural: false,
    heading: "Warehouse and Production Areas – Walls, Windows and Doors",
  },
  {
    prefix: "prod",
    title: "Production",
    subject: "production area",
    plural: false,
    heading: "Warehouse and Production Areas – Walls, Windows and Doors",
  },
  {
    prefix: "hard",
    title: "Hardstand / floors",
    subject: "hardstand and floors",
    plural: true,
    heading: "Warehouse and Production Areas – Hardstand and Other Floors",
  },
  {
    prefix: "roofin",
    title: "Underside Roof Covering & Frame",
    subject: "underside of the roof covering and frame",
    plural: false,
    heading: "Warehouse and Production Areas – Roof Underside, Roof Frame",
  },
];

/** A group has been filled in once its condition has been answered. */
const groupAnswered = (inst: AnswerTree, prefix: string): boolean => asString(inst[`${prefix}_generalCondition`]) !== "";

/** What was recorded about the whole building before the areas: renovations, safety advisories, rooms not accessed, movement. */
function leadIn(inst: AnswerTree, itemFields: TemplateField[]): string[] {
  const parts: string[] = [];
  if (yesNo(inst, "gen_renovationsInProgress")) {
    const rooms = asString(inst.gen_renovationsRooms).trim();
    parts.push(rooms ? `Renovations in progress to ${lower(rooms)}.` : "Renovations were in progress at the time of the inspection.");
  }
  if (yesNo(inst, "gen_safetyAdvisories")) {
    const types = many(itemFields, inst, ["gen_safetyAdvisoryTypes"]).map(lower);
    const notes = asString(inst.gen_safetyAdvisoryNotes).trim();
    parts.push(
      `${types.length ? `A safety advisory was given to the owner regarding ${joinList(types)}.` : "A safety advisory was given to the owner."}${notes ? ` ${capitalize(withPeriod(notes))}` : ""}`,
    );
  }
  const notAccessed = asString(inst.gen_roomsNotAccessed).trim();
  if (notAccessed) parts.push(`No access granted to ${withPeriod(notAccessed)}`);
  if (yesNo(inst, "gen_movementObserved")) {
    const where = asString(inst.gen_movementWhere).trim();
    parts.push(`Movement was observed in the internal areas${where ? `, at ${where.replace(/[.\s]+$/, "")}` : ""}.`);
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
    const level = one(itemFields, inst, [`${p}_floorLevel`]);
    const sentences: string[] = [];
    if (p === "roofin") {
      const covering = many(itemFields, inst, ["roofin_coveringOf"]).map(lower);
      const frame = one(itemFields, inst, ["roofin_frameOf"]);
      if (covering.length || frame) {
        sentences.push(
          covering.length ? `The roof covering is ${joinList(covering)}${frame ? `, on a ${lower(frame)} frame` : ""}.` : `The roof has a ${lower(frame)} frame.`,
        );
      }
      if (yesNo(inst, "roofin_sarking")) sentences.push("The roof is covered in sarking, obscuring inspection.");
    }
    // The template's own line: "Satisfactory and in typical condition." -- any other grade is just stated.
    // Under sarking: "From these limited observations, the roof underside appears to be in satisfactory and in typical condition."
    if (cond.word) {
      const sarking = p === "roofin" && yesNo(inst, "roofin_sarking");
      const state = cond.word === "satisfactory" ? "satisfactory and in typical condition" : `${cond.word} condition`;
      sentences.push(
        sarking
          ? `From these limited observations, the roof underside appears to be in ${state}.`
          : cond.word === "satisfactory"
            ? "Satisfactory and in typical condition."
            : `It is in ${cond.word} condition.`,
      );
    }
    if (level) sentences.push(`It is located on the ${lower(level)}.`);
    if (p === "roofin") {
      // What was seen on the underside: only what was ticked.
      const observed = many(itemFields, inst, ["roofin_damageSummary"]).map(lower);
      // "Items of damage throughout" is said "Items of damage observed throughout."
      const throughout = observed.some((o) => / throughout$/.test(o));
      if (observed.length) sentences.push(`${capitalize(joinList(observed.map((o) => o.replace(/ throughout$/, ""))))} observed${throughout ? " throughout" : ""}.`);
    } else {
      // The damage overview is said only when it records an issue; the obstructions follow.
      const overview = overviewIfIssue(itemFields, inst, [`${p}_damageSummary`]);
      if (overview) sentences.push(overview);
      const obstruction = obscured(itemFields, inst, `${p}_obscuredBy`);
      if (obstruction) sentences.push(obstruction);
      // Floors: "There are scuff marks from forklifts. The painted line markings are worn."
      if (p === "hard") {
        if (yesNo(inst, "hard_scuffMarks")) sentences.push("There are scuff marks from forklifts.");
        const markings = one(itemFields, inst, ["hard_lineMarkings"]);
        if (markings) sentences.push(`The painted line markings are ${lower(markings)}.`);
      }
    }
    if (sentences.length) blocks.push(sentences.join(" "));
    const key = `${p}_damages`;
    if (hasDefects(inst, key)) blocks.push(internal(inst, itemFields, { key, indexOffset: offsets[key] ?? 0 }));
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

// ---- The wording ----------------------------------------------------------------------------

export const dilapidationCommercialProperties: ReportWording = {
  profile: {
    inspectionType: "dilapidation",
    propertyType: "commercial_properties",
  },
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
    notes: house.notes!,
    custom_structure: withDefects(house.custom_structure!, external),
  },
  presence: PRESENCE,
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
    sectionKey.startsWith("custom_") ||
    (["driveway", "roof_chimneys", "internal_areas"].includes(sectionKey) && !templateFields.some((f) => f.type === "repeating-group")),
  floorGrouped: { sectionKey: "pool_spa", heading: floorHeading },
  metadataFields: { notes: ["hasDamage"] },
  plainFields: { notes: ["additionalNotes"] },
  // "Post project?" at the top of Notes is said as a sentence, not dropped.
  leadIn: {
    sectionKey: "notes",
    keys: new Set(["postProject"]),
    compose: (scope) => (yesNo(scope, "postProject") ? "This is a post-project inspection." : ""),
  },
  noSummarySections: ["description"],
  absentSlotSections: ["paving_paths", "fences"],
  damageSentences: external,
  descriptionBlocks,
  derivedFields,
  summaryRows,
};
