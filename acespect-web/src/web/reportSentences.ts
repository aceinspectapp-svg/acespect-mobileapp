import type { AnswerTree, AnswerValue, TemplateField } from "./templateFields";
import { asString, asStringArray, otherAnswerText, withPeriod } from "./templateFields";
import { gradeOf, shortConditionLabel } from "./conditionGrades";

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

type Composer = (inst: AnswerTree, itemFields: TemplateField[], label: string) => string;

function optionLabel(itemFields: TemplateField[], key: string, raw: string): string {
  const field = itemFields.find((f) => f.key === key);
  return field?.options?.find((o) => o.value === raw)?.label ?? raw;
}

function hasAnswer(v: AnswerValue): boolean {
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v !== "";
}

/** The first of `keys` the inspector answered, else the first one this template defines, else the first key -- lets one composer serve every template generation's field names. */
function keyOf(itemFields: TemplateField[], inst: AnswerTree, keys: string[]): string {
  return (
    keys.find((k) => hasAnswer(inst[k])) ?? keys.find((k) => itemFields.some((f) => f.key === k)) ?? keys[0]
  );
}

/**
 * What an answer says in a sentence: the option's display label, or -- for an
 * "Other" -- what the inspector typed. The forms store a typed Other inline as
 * "__other__:<text>"; older templates had an "Other" option plus a separate
 * "<key>Other" box instead. Both print the typed text. An "Other" with nothing
 * typed returns "" (the caller leaves that clause out): the word "other" on
 * its own is not an answer.
 */
function labelFor(itemFields: TemplateField[], inst: AnswerTree, key: string, raw: string): string {
  const typed = otherAnswerText(raw);
  if (typed !== undefined) return typed;
  if (raw === "other") return asString(inst[`${key}Other`]).trim();
  return optionLabel(itemFields, key, raw);
}

/** Single-select answer as its display label ("" when unanswered). */
function one(itemFields: TemplateField[], inst: AnswerTree, keys: string[]): string {
  const key = keyOf(itemFields, inst, keys);
  const raw = asString(inst[key]);
  return raw ? labelFor(itemFields, inst, key, raw) : "";
}

/** Multi-select answer as its display labels -- also accepts a single-select field's one value, since the same sentence slot is a pick-one in some templates ("constructed of concrete") and a tick-any in others. */
function many(itemFields: TemplateField[], inst: AnswerTree, keys: string[]): string[] {
  const key = keyOf(itemFields, inst, keys);
  const answer = inst[key];
  const raws = typeof answer === "string" ? (answer ? [answer] : []) : asStringArray(answer);
  return raws.map((raw) => labelFor(itemFields, inst, key, raw)).filter(Boolean);
}

/**
 * "Timber Paling" -> "timber paling" -- template sentences use the lowercase
 * form mid-sentence. A word with a capital anywhere after its first letter
 * ("uPVC", "PVC", "BBQ") is an acronym or brand spelling the inspector typed
 * deliberately, so it is left as typed instead of being flattened to "upvc".
 */
function lower(s: string): string {
  return s.replace(/[A-Za-z][A-Za-z']*/g, (word) => (/[A-Z]/.test(word.slice(1)) ? word : word.toLowerCase()));
}

/** "paint flaking" -> "Paint flaking" -- for an already-lowercased (mid-sentence-style) phrase that's actually being used to START a new sentence, so it needs its own capital letter back. */
function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "a" or "an", picked from `word`'s first letter -- a plain first-letter check (not true vowel-sound detection), which is fine here since every word it sees comes from this app's own template option labels. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** "a, b, c" with a trailing "and" before the last item, matching the template's list style. */
function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Stitches already-worded clause fragments with a trailing "and" and no comma -- e.g. ["with a pitched roof", "a covering of concrete tiles"] -> "with a pitched roof and a covering of concrete tiles", matching how the reference template's sentences run several prepositional clauses together. */
function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0];
  return `${clauses.slice(0, -1).join(" ")} and ${clauses[clauses.length - 1]}`;
}

function yesNo(inst: AnswerTree, key: string): boolean | undefined {
  const raw = asString(inst[key]);
  if (!raw) return undefined;
  return raw === "yes";
}

/** An instance the inspector marked as not existing ("Is there a driveway? No", "Available: No") -- composers print nothing (or the absence sentence) for it instead of a sentence full of blanks. */
export function isNotPresent(inst: AnswerTree): boolean {
  return asString(inst.present) === "no" || asString(inst.available) === "no";
}

/**
 * The condition grade for an item -- its lower-case word for the sentence
 * ("fair") and the colour-coded tag paragraph (`COND::#hex::Label`, see
 * ReportSection.tsx). The grade can live under `condition`, `generalCondition`
 * (Roof, Internal Areas) or `wallsCondition` (Garage), whichever this template
 * uses. "Satisfactory with typical wear and tear" reads as just "satisfactory"
 * since every template sentence adds the wear-and-tear wording itself.
 */
function conditionOf(itemFields: TemplateField[], inst: AnswerTree): { word: string; tag?: string } {
  const key = keyOf(itemFields, inst, ["condition", "generalCondition", "wallsCondition"]);
  const raw = asString(inst[key]);
  if (!raw) return { word: "" };
  const option = itemFields.find((f) => f.key === key)?.options?.find((o) => o.value === raw);
  const grade = gradeOf(option);
  if (grade) return { word: grade.word, tag: `COND::${grade.color}::${grade.label}` };
  return { word: lower(shortConditionLabel(option?.label ?? raw)) };
}

/** "Several minor cracks" -> "Several minor cracks observed." / "Numerous cracking throughout" -> "Numerous cracking observed throughout." */
function observedSentence(label: string): string {
  const l = lower(label).trim();
  if (l.endsWith(" throughout")) return `${capitalize(l.slice(0, -" throughout".length))} observed throughout.`;
  return `${capitalize(l)} observed.`;
}

/** The yes/no (`hasDamage`) or three-way (`damageSummary`) "is there notable damage" answer, as its sentence. */
function damageOverviewSentence(itemFields: TemplateField[], inst: AnswerTree): string {
  if (itemFields.some((f) => f.key === "hasDamage")) {
    return `There ${yesNo(inst, "hasDamage") ? "were" : "were no"} signs of notable damage.`;
  }
  const summary = one(itemFields, inst, ["damageSummary"]);
  if (!summary) return "";
  if (/^no visible/i.test(summary)) return "There were no signs of notable damage.";
  return observedSentence(summary);
}

/** A typed location starting with its own preposition ("above the front window", "near the meter box") used to get a second one stacked in front of it ("At the above the front window..."); this detects that case so the lead-in can drop "At the" and just capitalise the typed text instead ("Above the front window, there is..."), while a plain noun-phrase location ("centre of the driveway") still gets "At the" as before. */
const LOCATION_STARTS_WITH_PREPOSITION_RE =
  /^(above|below|near|beside|under|over|behind|within|along|across|adjacent to|between|next to|around|at|in|on)\b/i;

/** "at the centre of the driveway" / "above the front window" -- a location phrase that reads right after a noun ("Cracking at ..."), for the one-line Executive Summary notes. */
export function atLocation(location: string): string {
  return LOCATION_STARTS_WITH_PREPOSITION_RE.test(location) ? location : `at ${location}`;
}

/** "At the centre of the driveway, there is" / "Above the front window, there is" / "There is" (no location typed). */
function damageLeadIn(location: string, plural: boolean): string {
  const be = plural ? "there are" : "there is";
  if (!location) return capitalize(be);
  if (LOCATION_STARTS_WITH_PREPOSITION_RE.test(location)) return `${capitalize(location)}, ${be}`;
  return `At the ${location}, ${be}`;
}

const DAMAGE_TYPE_PHRASES: Record<string, { noun: string; plural?: boolean }> = {
  surface_damage: { noun: "surface damage" },
  material_deterioration: { noun: "material deterioration" },
  movement_displacement: { noun: "movement or displacement" },
  moisture_evidence: { noun: "moisture-related evidence" },
  operational_defects: { noun: "operational defects", plural: true },
  previous_repairs: { noun: "previous repairs", plural: true },
  safety_issues: { noun: "safety issues", plural: true },
};

const DIRECTION_ADVERBS: Record<string, string> = {
  vertical: "vertically",
  horizontal: "horizontally",
  diagonal: "diagonally",
};

/** How one recorded defect reads in a sentence -- `phrase` for "there is ___", `noun` for the follow-up "The ___ is approximately 5mm wide". */
function damageWording(rawType: string, typeLabel: string, subLabel: string): { phrase: string; noun: string; plural: boolean } {
  // The original seed's four types: "leaning" and "other" don't read naturally as bare nouns ("there is a leaning", "there is an other"), so they get a noun to sit on.
  if (rawType === "leaning") return { phrase: "a leaning defect", noun: "leaning defect", plural: false };
  if (rawType === "other") return { phrase: "a defect", noun: "defect", plural: false };
  // A defect type the inspector typed themselves ("Other"): their own words are the noun.
  if (rawType === "__custom__") return { phrase: `${article(typeLabel)} ${typeLabel}`, noun: typeLabel, plural: false };
  // A typed crack severity that already says "crack" ("stress crack") must not become "a stress crack crack".
  if (rawType === "cracking" && /\bcrack(s|ing)?$/i.test(subLabel)) return { phrase: `${article(subLabel)} ${subLabel}`, noun: "crack", plural: false };
  // The published templates' AS 4349.1 types: "Cracking" -> "a (severity) crack", the rest read as a description with the specific sub-type in brackets.
  const typed = DAMAGE_TYPE_PHRASES[rawType];
  if (typed) {
    return { phrase: subLabel ? `${typed.noun} (${subLabel})` : typed.noun, noun: typed.noun, plural: !!typed.plural };
  }
  const base = rawType === "cracking" || !rawType ? "crack" : typeLabel;
  const severity = rawType === "cracking" ? subLabel : "";
  return { phrase: `${article(severity || base)} ${severity ? `${severity} ` : ""}${base}`, noun: base, plural: false };
}

/**
 * One paragraph per damage/crack record, each tagged `DEFECT::<n>::` where n is
 * the record's position in the instance's damage list (templateFields.ts turns
 * it into the section-wide position). The report uses that tag to print the
 * defect's own photos directly under its sentence (ReportSection.tsx).
 * Sections whose damage-list has a
 * `damageType` field describe each record as whatever type was actually
 * recorded; sections whose damage-list has no `damageType` at all (Paving &
 * Paths, Fences, Retaining Walls in the original seed -- those only ever
 * track cracks) keep "crack" as a fixed default.
 */
function damageSentences(inst: AnswerTree, itemFields: TemplateField[]): string {
  const damageKey = keyOf(itemFields, inst, ["damages", "cracks"]);
  const damageField = itemFields.find((f) => f.key === damageKey);
  const list = Array.isArray(inst[damageKey]) ? (inst[damageKey] as AnswerTree[]) : [];
  if (!damageField || list.length === 0) return "";
  const subFields = damageField.itemFields ?? [];
  const damageTypeField = subFields.find((f) => f.key === "damageType");
  return list
    .map((d, defectIndex) => {
      const location = asString(d.location);
      const element = asString(d.element).trim();
      const width = Number(d.widthMm) || 0;
      const length = Number(d.lengthMm) || 0;
      const notes = asString(d.notes);
      const rawType = asString(d.damageType);
      // An "Other" type is stored as "__other__:<text>" -- use what was typed ("" typed means nothing was said: a plain "defect").
      const typedType = otherAnswerText(rawType);
      const wordingType = typedType === undefined ? rawType : typedType ? "__custom__" : "other";
      const typeLabel = typedType
        ? lower(typedType)
        : damageTypeField && rawType
          ? lower(damageTypeField.options?.find((o) => o.value === rawType)?.label ?? rawType)
          : "crack";
      const subField = subFields.find((f) => f.gate?.fieldKey === "damageType" && f.gate.equals === rawType);
      const subRaw = subField ? asString(d[subField.key]) : "";
      // "Hairline (≤0.1mm -- Damage Category 0)" -> "hairline": the bracketed category is report-internal detail, not sentence wording.
      const subTyped = otherAnswerText(subRaw);
      const subLabel =
        subTyped !== undefined
          ? lower(subTyped)
          : subRaw
            ? lower((subField?.options?.find((o) => o.value === subRaw)?.label ?? subRaw).split(" (")[0])
            : "";
      const wording = damageWording(wordingType, typeLabel, subLabel);

      const extras: string[] = [];
      if (wording.noun === "crack") {
        const start = asString(d.crackStartLocation).trim();
        const directionRaw = asString(d.direction);
        const directionTyped = otherAnswerText(directionRaw);
        const direction = directionTyped !== undefined ? lower(directionTyped) : DIRECTION_ADVERBS[directionRaw];
        if (start) extras.push(`starting from ${start}`);
        if (direction) extras.push(`running ${direction}`);
      }
      const parts: string[] = [];
      parts.push(
        `${damageLeadIn(location, wording.plural)} ${wording.phrase}${element ? ` to the ${element}` : ""}${
          extras.length ? `, ${extras.join(" and ")}` : ""
        }.`,
      );
      if (width > 0 || length > 0) {
        const bits: string[] = [];
        if (width > 0) bits.push(`approximately ${width}mm wide`);
        if (length > 0) bits.push(`approximately ${length}mm long`);
        parts.push(`The ${wording.noun} is ${bits.join(" and ")}.`);
      }
      // A newline inside the notes would split this sentence from its marker.
      if (notes) parts.push(withPeriod(notes.replace(/\s*\n+\s*/g, " ").trim()));
      return `DEFECT::${defectIndex}::${parts.join(" ")}`;
    })
    .join("\n\n");
}

function obstructionsSentence(itemFields: TemplateField[], inst: AnswerTree, noun: string): string {
  const labels = many(itemFields, inst, ["obstructions", "obscuredBy", "obstruction"]).map(lower);
  if (labels.length === 0) return "";
  return ` Sections of the ${noun} were obscured by ${joinList(labels)}.`;
}

/** "Cladding: paint is flaking from sections and timber is cracked." -- for the published templates' observation checklists, whose option labels are already complete phrases. */
function observationLine(itemFields: TemplateField[], inst: AnswerTree, keys: string[], heading: string): string {
  const items = many(itemFields, inst, keys).map(lower);
  return items.length ? ` ${heading}: ${joinList(items)}.` : "";
}

/**
 * Paving & Paths' own `defects` field (trip hazard / surface wear /
 * settlement) used to be run through `obstructionsSentence`, producing
 * nonsense like "Sections of the paving were obscured by surface wear" --
 * surface wear is a defect, not a physical object blocking a view of the
 * paving. This states it as what it is instead.
 */
function defectsSentence(itemFields: TemplateField[], inst: AnswerTree): string {
  const labels = many(itemFields, inst, ["defects"]).map(lower);
  if (labels.length === 0) return "";
  return ` ${capitalize(joinList(labels))} noted.`;
}

function tail(parts: string[], itemFields: TemplateField[], inst: AnswerTree): string {
  const damages = damageSentences(inst, itemFields);
  if (damages) parts.push(damages);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
}

const driveway: Composer = (inst, itemFields, label) => {
  // A driveway divided into parts (Front left / Front right / Rear / Side) is called with the part's name as `label` and
  // has no "Located at" question of its own; the older single-item form is called with no label.
  const part = label && itemFields.some((f) => f.key === "present") ? label : "";
  if (isNotPresent(inst)) return part ? "" : "There is no driveway to the property.";
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
  const where = name ? `to the ${lower(name)}` : isFixedArea && label ? `to the ${lower(label)}` : "to the block";
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
  if (isNotPresent(inst)) return "";
  const isFixedSide = itemFields.some((f) => f.key === "present");
  const location = one(itemFields, inst, ["location"]) || (isFixedSide ? label : "");
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
    }${obstructionsSentence(itemFields, inst, "structure")}${observationLine(itemFields, inst, ["cladding"], "Cladding")}${observationLine(
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
    }.${paving.length ? ` The surrounding area is paved with ${joinList(paving)}.` : ""}${obstructionsSentence(itemFields, inst, "pool/spa area")}`,
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
  parts.push(
    `The ${lower(label)} elevation${orientation ? ` generally faces ${compassPhrase(orientation)}` : ""}.${
      cond.word ? ` It is in ${cond.word} condition.` : ""
    }${damageOverviewSentence(itemFields, inst) ? ` ${damageOverviewSentence(itemFields, inst)}` : ""}${
      partyWall ? ` It is a party wall${partyWallNumber ? ` (${partyWallNumber})` : ""}.` : ""
    }${partial.length ? ` Partial inspection only: ${joinList(partial)}.` : ""}${
      claddingObs.length ? ` ${capitalize(joinList(claddingObs))} noted to the cladding.` : ""
    }${windowDoorObs.length ? ` ${capitalize(joinList(windowDoorObs))} noted to windows/doors.` : ""}${obstructionsSentence(
      itemFields,
      inst,
      "elevation",
    )}${observationLine(itemFields, inst, ["cladding"], "Cladding")}${observationLine(
      itemFields,
      inst,
      ["windowsDoors"],
      "Windows and doors",
    )}${observationLine(itemFields, inst, ["eaves"], "Eaves")}${observationLine(itemFields, inst, ["downpipesGutters"], "Downpipes and gutters")}`,
  );
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
export function floorHeading(label: string): string {
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
  const text = `${[cond.word ? `It is in ${cond.word} condition.` : "", damageOverview].filter(Boolean).join(" ")}${obstructionsSentence(
    itemFields,
    inst,
    "room",
  )}${moisture.length ? ` ${capitalize(joinList(moisture))} noted.` : ""}${yesNo(inst, "withEnsuite") ? " It has an ensuite." : ""}`.trim();
  if (text) parts.push(text);
  return tail(parts, itemFields, inst);
};

/** Internal Areas' section-level answers (everything above the room list) that are composed into prose by `composeInternalAreasLeadIn` rather than printed as "Label: value." lines. */
export const INTERNAL_AREAS_LEAD_IN_KEYS = new Set([
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

export function composeInternalAreasLeadIn(scope: AnswerTree, templateFields: TemplateField[]): string {
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

  return parts.join(" ");
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

/** Section key -> its composer. Sections not listed here keep the generic "Label: value." fallback. */
export const SECTION_SENTENCE_COMPOSERS: Record<string, Composer> = {
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

export function composeSectionSentence(
  sectionKey: string,
  inst: AnswerTree,
  itemFields: TemplateField[],
  label: string,
): string | undefined {
  const composer = SECTION_SENTENCE_COMPOSERS[sectionKey];
  if (!composer) return undefined;
  return composer(inst, itemFields, label);
}

/**
 * What to say when a section that CAN legitimately not exist at a property
 * (no driveway, no pool, ...) has nothing recorded -- matching the reference
 * template's own "There is no driveway." convention instead of leaving the
 * section blank (which otherwise reads as an incomplete inspection rather
 * than a reported fact).
 */
const ABSENCE_SENTENCES: Record<string, string> = {
  driveway: "There is no driveway to the property.",
  paving_paths: "There is no paving to the property.",
  fences: "There are no fences to the property.",
  retaining_walls: "There are no retaining walls to the property.",
  garage_carport_sheds: "There is no garage, carport or shed to the property.",
  pool_spa: "There is no pool or spa to the property.",
};

export function absenceSentence(sectionKey: string): string | undefined {
  return ABSENCE_SENTENCES[sectionKey];
}

// Re-exported only so callers don't need a second import from templateFields
// just for the type this module's Composer signature uses.
export type { AnswerValue };
