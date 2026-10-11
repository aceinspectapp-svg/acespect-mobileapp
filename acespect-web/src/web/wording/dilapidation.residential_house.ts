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
 * constructed of {material}. It is in {condition} condition [with typical
 * wear and tear -- satisfactory only]. Sections of the driveway were obscured by {obstructions}."
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

// ---- Defects, in the Houspect report's own form ---------------------------------------------------
// "At the right corner there is a diagonal crack approximately 1.4 millimetres wide and approximately 500 millimetres long."
// "At the porch there is a chip to the rendered pier."

/** What each defect type / sub-type is called in a sentence ("there is a chip", "there is rot"). `count`: takes "a". */
const DEFECT_NOUNS: Record<string, { noun: string; count?: boolean }> = {
  chips: { noun: "chip", count: true },
  scratches: { noun: "scratch", count: true },
  "impact damage": { noun: "impact damage" },
  abrasion: { noun: "abrasion" },
  "corrosion/rust": { noun: "corrosion" },
  rot: { noun: "rot" },
  spalling: { noun: "spalling" },
  "concrete cancer": { noun: "concrete cancer" },
  decay: { noun: "decay" },
  weathering: { noun: "weathering" },
  leaning: { noun: "leaning" },
  "settlement indicators": { noun: "settlement indicators" },
  separation: { noun: "separation" },
  bulging: { noun: "bulging" },
  misalignment: { noun: "misalignment" },
  "water staining": { noun: "water staining" },
  dampness: { noun: "dampness" },
  efflorescence: { noun: "efflorescence" },
  mould: { noun: "mould" },
  "crack patching": { noun: "previous crack patching" },
  repainting: { noun: "previous repainting" },
  "replacement materials": { noun: "previous replacement materials" },
  "structural repairs": { noun: "previous structural repairs" },
  "tripping hazard": { noun: "tripping hazard", count: true },
  "leaning wall": { noun: "leaning wall", count: true },
  "unsafe pool safety barrier": { noun: "unsafe pool safety barrier", count: true },
  "missing balustrades/rails": { noun: "missing balustrades or rails" },
};
const DEFECT_TYPE_NOUNS: Record<string, string> = {
  surface_damage: "surface damage",
  material_deterioration: "material deterioration",
  movement_displacement: "movement or displacement",
  moisture_evidence: "moisture-related evidence",
  operational_defects: "operational defects",
  previous_repairs: "previous repairs",
  safety_issues: "safety issues",
};
const RUNS: Record<string, string> = { vertical: "vertical", diagonal: "diagonal", horizontal: "horizontal" };

/** "At the porch there is" / "Near the garage door there is" / "There is" -- the lead of a defect sentence, with no comma. */
function defectLead(location: string, plural: boolean): string {
  const be = plural ? "there are" : "there is";
  const loc = location.trim();
  if (!loc) return capitalize(be);
  if (LOCATION_STARTS_WITH_PREPOSITION_RE.test(loc)) return `${capitalize(loc)} ${be}`;
  if (/^the\s/i.test(loc)) return `At ${loc} ${be}`;
  return `At the ${loc} ${be}`;
}

const num = (n: number): string => String(Number(n.toFixed(2)));

/** One paragraph per recorded defect, each tagged `DEFECT::<n>::` so its photos print under it. */
export function houseDamageSentences(
  inst: AnswerTree,
  itemFields: TemplateField[],
  options: { key?: string; indexOffset?: number } = {},
): string {
  const damageKey = options.key ?? keyOf(itemFields, inst, ["damages", "cracks"]);
  const damageField = itemFields.find((f) => f.key === damageKey);
  const list = Array.isArray(inst[damageKey]) ? (inst[damageKey] as AnswerTree[]) : [];
  if (!damageField || list.length === 0) return "";
  const subFields = damageField.itemFields ?? [];
  const damageTypeField = subFields.find((f) => f.key === "damageType");
  return list
    .map((d, i) => {
      const location = asString(d.location);
      const element = asString(d.element).trim();
      const width = Number(d.widthMm) || 0;
      const length = Number(d.lengthMm) || 0;
      const rawType = asString(d.damageType);
      const typedType = otherAnswerText(rawType);
      const subField = subFields.find((f) => f.gate?.fieldKey === "damageType" && f.gate.equals === rawType);
      const subRaw = subField ? asString(d[subField.key]) : "";
      const subTyped = otherAnswerText(subRaw);
      // "Hairline (<=0.1mm -- Damage Category 0)" -> "hairline": the bracketed category is not sentence wording.
      const sub =
        subTyped !== undefined
          ? lower(subTyped)
          : subRaw
            ? lower((subField?.options?.find((o) => o.value === subRaw)?.label ?? subRaw).split(" (")[0])
            : "";

      const directionRaw = asString(d.direction);
      const directionTyped = otherAnswerText(directionRaw);
      // "vertical" / "diagonal" / "horizontal" sit before the noun ("a diagonal crack"); anything the inspector typed follows it ("running diagonally down").
      const run = RUNS[directionRaw] ?? "";
      const runTyped = directionTyped ? lower(directionTyped) : "";
      const start = asString(d.crackStartLocation).trim();

      let np: string; // the noun phrase after "there is"
      let plural = false;
      const isCrack = typedType === undefined && (!rawType || rawType === "cracking" || rawType === "crack" || !damageTypeField);
      if (isCrack) {
        // A typed severity that already says "crack" ("stress crack") must not become "a stress crack crack".
        const named = /\bcrack(s|ing)?$/i.test(sub);
        const adjectives = [run, sub].filter(Boolean).join(" ");
        np = `${article(adjectives || "crack")} ${adjectives ? `${adjectives}${named ? "" : " "}` : ""}${named ? "" : "crack"}`.replace(/\s+$/, "");
      } else if (rawType === "leaning") {
        np = "a leaning defect"; // the original seed's types
      } else if (rawType === "other") {
        np = "a defect";
      } else if (typedType !== undefined) {
        const typed = lower(typedType) || "defect";
        np = `${article(typed)} ${typed}`;
      } else {
        const known = DEFECT_NOUNS[sub];
        const noun = known?.noun ?? (sub ? sub : DEFECT_TYPE_NOUNS[rawType] ?? lower(damageTypeField?.options?.find((o) => o.value === rawType)?.label ?? rawType));
        plural = /[^s]s$/.test(noun) && !known?.count;
        np = known?.count ? `${article(noun)} ${noun}` : noun;
      }

      const measure = [width > 0 ? `approximately ${num(width)} millimetres wide` : "", length > 0 ? `approximately ${num(length)} millimetres long` : ""].filter(Boolean).join(" and ");
      const sentence = `${defectLead(location, plural)} ${np}${element ? ` to the ${element}` : ""}${start ? ` starting from ${start}` : ""}${
        !isCrack && run ? `, running ${DIRECTION_ADVERBS[directionRaw] ?? run}` : ""
      }${runTyped ? `, running ${runTyped}` : ""}${measure ? ` ${measure}` : ""}.`;
      const notes = asString(d.notes).replace(/\s*\n+\s*/g, " ").trim();
      return `DEFECT::${(options.indexOffset ?? 0) + i}::${notes ? `${sentence} ${withPeriod(notes)}` : sentence}`;
    })
    .join("\n\n");
}

/** The end of an item's text: its defects, then its notes. */
export function houseTail(parts: string[], itemFields: TemplateField[], inst: AnswerTree): string {
  const damages = houseDamageSentences(inst, itemFields);
  if (damages) parts.push(damages);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
}

/** "Gal steel post & sleepers" reads "gal steel post and sleepers" inside a sentence. */
export const amp = (s: string): string => s.replace(/\s&\s/g, " and ");

/** "Mix of" / "Combo of" read as "a mix of ..." / "a combination of ..." inside a list of materials. */
export function materialWords(labels: string[]): string[] {
  return labels.map((m) => {
    if (/^mix of$/i.test(m)) return "a mix of materials";
    if (/^combo of$/i.test(m)) return "a combination of materials";
    if (/^mix of /i.test(m)) return `a ${m}`;
    if (/^combo of /i.test(m)) return `a combination of ${m.slice(9)}`;
    return m;
  });
}

/**
 * The inspector's cracking / damage overview answer ("Several minor cracks", "Numerous cracking throughout"), as a sentence --
 * only when it records an issue. "No visible significant cracking / damage" prints nothing: a part in good condition is just
 * reported as good.
 */
export function overviewIfIssue(itemFields: TemplateField[], inst: AnswerTree, keys: string[]): string {
  const answer = one(itemFields, inst, keys);
  if (!answer || /^(no|none|nil)\b/i.test(answer.trim())) return "";
  return observedSentence(answer);
}

/**
 * "with typical wear and tear" belongs to the "Satisfactory with typical wear and tear" choice only -- a fair, average or poor
 * item is just reported as fair, average or poor. ("and some gaps" is the inspector's own tick, so it is kept for any grade.)
 */
export function typically(word: string, what: string, someGaps = false): string {
  const typical = word === "satisfactory" ? `with typical ${what}` : "";
  const gaps = someGaps ? (typical ? " and some gaps" : " with some gaps") : "";
  return `${typical ? " " : ""}${typical}${gaps}`;
}

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
    ? `${first ? "It" : "The driveway"} is in ${cond.word} condition${typically(cond.word, "wear and tear")}.`
    : "";
  const cracking = overviewIfIssue(itemFields, inst, ["crackingSummary"]);
  parts.push(`${[first, second, cracking].filter(Boolean).join(" ")}${obstructionsSentence(itemFields, inst, "driveway")}`);
  return houseTail(parts, itemFields, inst);
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
  const second = cond.word ? ` It is in ${cond.word} condition${typically(cond.word, "wear and tear")}.` : "";
  parts.push(`${first}${second}${defectsSentence(itemFields, inst)}${obstructionsSentence(itemFields, inst, "paving")}`);
  const drainage = one(itemFields, inst, ["drainage"]);
  if (drainage) {
    const drainageNote = asString(inst.drainageNote);
    const lowerDrainage = lower(drainage);
    // "Adequate" reads fine as a bare adjective ("Drainage is adequate"), but "Minor Issue"/"Major Issue" are noun phrases and need their own article ("Drainage is a minor issue").
    const drainagePhrase = /issue$/.test(lowerDrainage) ? `${article(lowerDrainage)} ${lowerDrainage}` : lowerDrainage;
    parts.push(`Drainage is ${drainagePhrase}.${drainageNote ? ` ${drainageNote}` : ""}`);
  }
  return houseTail(parts, itemFields, inst);
};

/** "something noted" choices on the form (decayed, leaning, ...), said once the grade is. */
function conditionDetailWords(itemFields: TemplateField[], inst: AnswerTree): { someGaps: boolean; noted: string } {
  const all = many(itemFields, inst, ["conditionDetails"]);
  const someGaps = all.some((d) => /^typical weathering and some gaps$/i.test(d));
  const rest = all.filter((d) => !/^typical weathering and some gaps$/i.test(d)).map(lower);
  return { someGaps, noted: rest.length ? ` ${capitalize(joinList(rest))} noted.` : "" };
}

const fences: Composer = (inst, itemFields, label) => {
  const isFixedSide = itemFields.some((f) => f.key === "present");
  // One side ticked "not present": the report says so ("There is no front fence.") -- the walk drops these lines when no side has a fence, and the section's own "There are no fences surrounding this property." stands in instead.
  if (isNotPresent(inst)) return isFixedSide && label ? `There is no ${handedSide(label)} fence.` : "";
  const location = one(itemFields, inst, ["location"]) || (isFixedSide ? handedSide(label) : "");
  const structure = materialWords(many(itemFields, inst, ["structureType", "material"]).map(lower).map(amp));
  const cond = conditionOf(itemFields, inst);
  const details = conditionDetailWords(itemFields, inst);
  // "Typical weathering and some gaps" is the form's own satisfactory choice: ticked on its own, it still states the condition.
  const grade = cond.word || (details.someGaps ? "satisfactory" : "");
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const predicates = [
    structure.length ? `is constructed of ${joinList(structure)}` : "",
    grade ? `is in ${grade} condition${typically(grade, "weathering", details.someGaps)}` : "",
  ].filter(Boolean);
  const subject = `The ${location ? `${lower(location)} ` : ""}fence`;
  parts.push(
    `${predicates.length ? `${subject} ${predicates.join(" and ")}.` : `${subject} was inspected.`}${details.noted}${obstructionsSentence(itemFields, inst, "fence")}`,
  );
  return houseTail(parts, itemFields, inst);
};

const retainingWalls: Composer = (inst, itemFields) => {
  const location = one(itemFields, inst, ["location"]);
  const materials = materialWords(many(itemFields, inst, ["material", "materials"]).map(lower).map(amp));
  const cond = conditionOf(itemFields, inst);
  const details = conditionDetailWords(itemFields, inst);
  // "Typical weathering and some gaps" is the form's own satisfactory choice: ticked on its own, it still states the condition.
  const grade = cond.word || (details.someGaps ? "satisfactory" : "");
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const first = `There is a retaining wall${location ? ` to the ${lower(location)}` : ""}${
    materials.length ? `, constructed of ${joinList(materials)}` : ""
  }.`;
  const second = grade ? ` It is in ${grade} condition${typically(grade, "weathering", details.someGaps)}.` : "";
  parts.push(`${first}${second}${details.noted}${obstructionsSentence(itemFields, inst, "wall")}`);
  return houseTail(parts, itemFields, inst);
};

/** "tiles" -> "tiled": the roof is described by its covering ("with a tiled roof"). */
const ROOF_WORDS: Record<string, string> = { tile: "tiled", tiles: "tiled" };

/** "generally in fair state of repair" -- but a new structure is just "new" ("generally in new state of repair" reads wrong). */
function repairState(word: string): string {
  return word === "new" ? "new" : `generally in ${word} state of repair`;
}

const garageCarportSheds: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  const isFixedSlot = itemFields.some((f) => f.key === "present");
  // The inspector's own name for the structure ("Pergola") wins over the fixed tab's.
  let name = asString(inst.structureName).trim() || asString(inst.name) || (isFixedSlot ? label : "") || "structure";
  // The fixed "Shed / other" tab reads as just "shed" mid-sentence; an inspector-added extra tab is labelled "Structures 5", which isn't a name at all.
  name = name.replace(/\s*\/\s*other$/i, "");
  if (/^structures?\s+\d+$/i.test(name)) name = "structure";
  name = name.replace(/\s*\/\s*studio$/i, "");
  const lowerName = lower(name);
  const attachment = one(itemFields, inst, ["attachment"]);
  const position = one(itemFields, inst, ["position"]);
  const at = position ? lower(position) : "";
  // Attached: "attached to the house at the front". Separate: "located at the rear of the property". Basement: "in the basement".
  const where = /basement/i.test(attachment)
    ? " in the basement"
    : /^separate/i.test(attachment)
      ? ` located${at ? ` at the ${at} of` : " at"} the property`
      : attachment
        ? ` ${lower(attachment).replace(/\bto house\b/, "to the house")}${at ? ` at the ${at}` : ""}`
        : at
          ? ` located at the ${at} of the property`
          : "";
  const walls = many(itemFields, inst, ["wallConstruction", "walls"]).map(lower).map(amp);
  const roof = many(itemFields, inst, ["roofConstruction", "roof"]).map((r) => ROOF_WORDS[lower(r)] ?? lower(r));
  const floor = many(itemFields, inst, ["floorType", "floor"]).map(lower).map(amp);
  const cond = conditionOf(itemFields, inst);

  // "with a tiled roof and concrete hardstand" -- a hardstand is not "a hardstand floor".
  const floorBit = floor.length ? (floor.some((f) => /hardstand/.test(f)) ? joinList(floor) : `${article(floor[0])} ${joinList(floor)} floor`) : "";
  // "a tiled roof", but a typed "laserlite roof covering" already says what it is.
  const roofBit = roof.length ? `${article(roof[0])} ${joinList(roof)}${/\broof\b/i.test(roof[roof.length - 1]) ? "" : " roof"}` : "";
  const withBits = [roofBit, floorBit].filter(Boolean);
  // "constructed of brick with a tiled roof and concrete hardstand" -- or, with no walls recorded (a basement garage), just "with a ...".
  const constructionText = walls.length
    ? `, constructed of ${[joinList(walls), withBits.length ? `with ${withBits.join(" and ")}` : ""].filter(Boolean).join(" ")}`
    : withBits.length
      ? `, with ${withBits.join(" and ")}`
      : "";
  // A pergola / verandah / deck reads "which is generally in ...", the others "and is generally in ...".
  const linker = /pergola|verandah|veranda|deck|gazebo/i.test(name) ? ", which is" : ", and is";
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  // What gets obscured: the garage's walls and floor, a shed's walls and hardstand, a carport's floor.
  const obscuredOf = /carport/i.test(name) ? "floor" : /garage|granny/i.test(name) ? "walls and floor" : floor.some((f) => /hardstand/.test(f)) ? "walls and hardstand" : "walls and floor";
  parts.push(
    `There is ${article(lowerName)} ${lowerName}${where}${constructionText}${cond.word ? `${linker} ${repairState(cond.word)}.` : "."}${obstructionsSentence(itemFields, inst, obscuredOf)}${observationLine(
      itemFields,
      inst,
      ["cladding"],
      "Cladding",
    )}${observationLine(itemFields, inst, ["windowsDoors"], "Windows and doors")}${observationLine(itemFields, inst, ["eaves"], "Eaves")}${observationLine(itemFields, inst, ["downpipesGutters"], "Downpipes and gutters")}`,
  );
  return houseTail(parts, itemFields, inst);
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
      cond.word ? `, which from limited views is ${repairState(cond.word)}` : ""
    }.${paving.length ? ` The surrounds are paved with ${joinList(paving)}.` : ""}${obstructionsSentence(itemFields, inst, "pool/spa area")}`,
  );
  if (fenceType.length || fenceSafety) {
    // "Compliant" needs "appears to be ___"; the published templates' own options are already full phrases ("Appears to be okay", "No, does not appear to be safe").
    const safetyPhrase = /^appears/.test(fenceSafety)
      ? fenceSafety
      : /^no, /.test(fenceSafety)
        ? fenceSafety.slice(4)
        : `appears to be ${fenceSafety || "not observed"}`;
    const fenceName = `The ${part ? lower(part) : "pool"} fence`;
    parts.push(fenceType.length ? `${fenceName} is constructed of ${joinList(fenceType)} and ${safetyPhrase}.` : `${fenceName} ${safetyPhrase}.`);
  }
  return houseTail(parts, itemFields, inst);
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
  const side = lower(label);
  // The elevation's own heading, as the report prints it: "Front Elevation (east)".
  const parts: string[] = [`ROOMHEAD::${capitalize(side)} Elevation${orientation ? ` (${compassPhrase(orientation)})` : ""}`];
  if (cond.tag) parts.push(cond.tag);
  const gradeSentence = cond.word ? typicalCondition(cond.word) : "";
  const at = /^\d/.test(partyWallNumber) ? `No. ${partyWallNumber}` : partyWallNumber;
  // A party wall, and what could be seen of it: "The right elevation is a party wall abutting the next property at No. 2 and could only be partly inspected to the rear which is in satisfactory and in typical condition."
  let access = "";
  let gradeSaid = false;
  if (partyWall && partial.length) {
    const grade = cond.word ? ` which is in ${cond.word === "satisfactory" ? "satisfactory and in typical" : cond.word} condition` : "";
    access = `The ${side} elevation is a party wall abutting the next property${at ? ` at ${at}` : ""} and could only be partly inspected to the ${joinList(partial)}${grade}.`;
    gradeSaid = true;
  } else if (partyWall) {
    // Not inspected at all: there is no condition to state.
    access = `The ${side} elevation is a party wall abutting the next property${at ? ` at ${at}` : ""} and could not be inspected.`;
    gradeSaid = true;
  } else if (partial.length) {
    access = `Could only be partly inspected to the ${joinList(partial)}.`;
  }
  parts.push(
    `${[access, gradeSaid ? "" : gradeSentence, overviewIfIssue(itemFields, inst, ["damageSummary"])].filter(Boolean).join(" ")}${
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
    )}${observationLine(itemFields, inst, ["eaves"], "Eaves")}${observationLine(itemFields, inst, ["downpipesGutters"], "Downpipes and gutters")}`.trim(),
  );
  return houseTail(parts, itemFields, inst);
};

/** What the roof status choices say in the report. */
export function roofStatusSentence(status: string): string {
  const s = status.toLowerCase();
  if (/^not applicable/.test(s)) return "";
  if (/^no chimney/.test(s)) return "There are no chimneys visible.";
  if (/limited observations from ground level using camera zoom/.test(s)) return "Comments are based on limited observations from the ground only and using a camera zoom.";
  return `${capitalize(status)}.`;
}

const roofChimneys: Composer = (inst, itemFields, label) => {
  if (isNotPresent(inst)) return "";
  const status = many(itemFields, inst, ["inspectionStatus"]);
  // The roof of a single-storey house has no upper / lower: the first roof is simply "the roof covering".
  const lowerRoof = /lower/i.test(label);
  // Everything on this roof is "not applicable" (single storey, apartment): nothing to say.
  if (status.length > 0 && status.every((x) => /^not applicable/i.test(x)) && !asString(inst.notes) && !many(itemFields, inst, ["generalCondition"]).length) return "";
  const covering = materialWords(many(itemFields, inst, ["coveringType"]).map(lower));
  const noted = many(itemFields, inst, ["generalCondition", "generalObservations"]);
  const satisfactoryToFair = noted.some((n) => /^satisfactory to fair with typical weathering$/i.test(n));
  const others = noted.filter((n) => !/^satisfactory to fair with typical weathering$/i.test(n));
  const chimney = others.filter((n) => /^chimney appears/i.test(n)).map((n) => `${capitalize(n)}.`);
  const observed = others.filter((n) => !/^chimney appears/i.test(n)).map(lower);
  const cond = conditionOf(itemFields, inst);
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const subject = lowerRoof ? "The lower roof covering" : "The roof covering";
  const gradePhrase = satisfactoryToFair ? "satisfactory to fair condition with typical weathering" : cond.word ? `${cond.word} condition` : "";
  const main = gradePhrase
    ? `${subject} appears to be in ${gradePhrase}${covering.length ? `, constructed of ${joinList(covering)}` : ""}.`
    : covering.length
      ? `${subject} is constructed of ${joinList(covering)}.`
      : "";
  const text = [main, ...status.map(roofStatusSentence), observed.length ? `${capitalize(joinList(observed))} noted.` : "", ...chimney].filter(Boolean).join(" ");
  if (text) parts.push(text);
  const notes = asString(inst.notes);
  const damages = houseDamageSentences(inst, itemFields);
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

/** What a room is called inside a sentence: "The entry and hallway are ...", "The bedroom and ensuite are ...", "The bathroom is ...". */
export function roomSubject(label: string): { subject: string; plural: boolean } {
  // "Kitchen / Family / Living" -> "kitchen, family and living"
  const listed = lower(label).split(/\s*\/\s*/);
  let name = (listed.length > 1 ? `${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}` : listed[0])
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+\d+\b/g, "") // "bedroom 1" -> "bedroom"
    .replace(/\s+\(.*\)\s*$/, "")
    .trim();
  // A toilet block ("WC Male / Female") is just "the toilets".
  if (/^wc\b/i.test(name)) return { subject: "toilets", plural: true };
  const parts = name.split(/,\s*|\s+and\s+/).filter(Boolean);
  // "kitchen, family and living" are areas; "entry and hallway" and "bedroom and ensuite" are two rooms; "offices" and "storerooms" are plural by themselves.
  const plural = parts.length > 1 || /[^s]s$/.test(name);
  if (parts.length > 2) name = `${name} areas`;
  return { subject: name, plural };
}

const internalAreas: Composer = (inst, itemFields, rawLabel) => {
  if (isNotPresent(inst)) return "";
  // An inspector-added extra room with no name typed is labelled "Rooms 11" by the list -- that isn't a heading.
  const typedName = asString(inst.roomName).trim();
  const baseLabel = typedName || (/^rooms?\b.*\s\d+$/i.test(rawLabel) ? "Other room" : rawLabel);
  // "Bedroom 1 [x] with Ensuite" is headed and worded "Bedroom 1 and ensuite" / "The bedroom and ensuite are ...".
  const label = yesNo(inst, "withEnsuite") && !/ensuite/i.test(baseLabel) ? `${baseLabel} and ensuite` : baseLabel;
  const cond = conditionOf(itemFields, inst);
  const moisture = many(itemFields, inst, ["moistureObservations"]).map(lower);
  const parts: string[] = [];
  // Room name as its own bold heading (see ReportSection.tsx's "ROOMHEAD::" handling), matching the reference report's "Bedroom 4" / "Bathroom" style.
  parts.push(`ROOMHEAD::${label}`);
  if (cond.tag) parts.push(cond.tag);
  const room = roomSubject(label);
  // "The bathroom is in satisfactory and typical condition." -- other grades: "The kitchen is in fair condition."
  const grade = cond.word ? `The ${room.subject} ${room.plural ? "are" : "is"} in ${cond.word === "satisfactory" ? "satisfactory and typical" : cond.word} condition.` : "";
  const overview = overviewIfIssue(itemFields, inst, ["damageSummary"]);
  const text = `${[grade, overview].filter(Boolean).join(" ")}${obstructionsSentence(itemFields, inst, "")}${moisture.length ? ` ${capitalize(joinList(moisture))} noted.` : ""}`.trim();
  if (text) parts.push(text);
  return houseTail(parts, itemFields, inst);
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
    parts.push(rooms ? `Renovations in progress to ${lower(rooms)}.` : "Renovations were in progress at the time of the inspection.");
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
  if (notAccessed) parts.push(`No access granted to ${withPeriod(notAccessed)}`);
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
  const wallGround = materialWords(many(itemFields, inst, ["wallCladdingGround"]).map(lower));
  const wallFirst = materialWords(
    many(itemFields, inst, ["wallCladdingFirst"])
      .map(lower)
      .filter((w) => w !== "not applicable"),
  );
  const foundations = one(itemFields, inst, ["foundations"]);
  const roofDesign = one(itemFields, inst, ["roofDesign"]);
  const roofCovering = materialWords(many(itemFields, inst, ["roofCovering"]).map(lower));
  const windows = materialWords(many(itemFields, inst, ["windows"]).map(lower));

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
  if (roofDesign) buildClauses.push(/^combo of /i.test(roofDesign) ? `with a combination of ${lower(roofDesign).slice(9)} roofs` : `with a ${lower(roofDesign)} roof`);
  if (roofCovering.length) buildClauses.push(`a covering of ${joinList(roofCovering)}`);
  if (buildClauses.length) parts.push(`It is ${joinClauses(buildClauses)}.`);

  if (windows.length) parts.push(`Windows are constructed of ${joinList(windows)}.`);

  // The scope and safety answers follow the property description, each as its own paragraph.
  return [parts.join(" "), ...scopeAndSafetyParagraphs(inst)].filter(Boolean).join("\n\n");
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
    const line = `No access granted to ${area || "an area of the property"}${reason ? `: ${reason}` : ""}`;
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

/**
 * The project-works sentence on the Description page. For a residential property it is the standard one ("The project works are
 * to the property at {address}, which is at the ..."); for any other kind of works the report says "The project works are the
 * Highlands Estate Stage 450, Mickleham, which is at the rear - approximately west - of the site of this inspection."
 */
export function descriptionBlocks({ fields }: { fields: Record<string, unknown>; areaCount: number }): { works?: string; scope?: string } {
  const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const type = text(fields.worksTypeLabel) || text(fields.proposedWorksType);
  const address = text(fields.projectSiteAddress);
  if (!address || !type) return {};
  const side = lower(text(fields.siteSide));
  const direction = text(fields.siteDirection);
  const where = side && direction ? `, which is at the ${side} - approximately ${compassPhrase(direction)} - of the site of this inspection` : "";
  // Works to a residential property: "to the property at {address}"; any other works: "the {project}".
  return { works: /^residential property$/i.test(type) ? `The project works are to the property at ${address}${where}.` : `The project works are the ${address}${where}.` };
}

/** What kind of works, read the way the sentences read an answer (a typed "Other" in either form included). */
export function derivedFields(sectionKey: string, scope: AnswerTree, templateFields: TemplateField[]): Record<string, unknown> {
  if (sectionKey !== "description") return {};
  const label = one(templateFields, scope, ["proposedWorksType"]);
  return label ? { worksTypeLabel: label } : {};
}

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
  damageSentences: houseDamageSentences,
  descriptionBlocks,
  derivedFields,
};
