import type { AnswerTree, AnswerValue, TemplateField } from "../templateFields";
import { asString, asStringArray, isGateSatisfied, otherAnswerText, withPeriod } from "../templateFields";
import { gradeOf, shortConditionLabel } from "../conditionGrades";

/**
 * The building blocks every report type's wording is written from: reading an
 * answer as its label, joining lists, the condition grade, the defect sentences.
 * They say nothing about WHICH report is being written -- each report type's own
 * file under this folder decides the sentences, and uses these to build them.
 */

export type Composer = (inst: AnswerTree, itemFields: TemplateField[], label: string) => string;

export function optionLabel(itemFields: TemplateField[], key: string, raw: string): string {
  const field = itemFields.find((f) => f.key === key);
  return field?.options?.find((o) => o.value === raw)?.label ?? raw;
}

export function hasAnswer(v: AnswerValue): boolean {
  return Array.isArray(v) ? v.length > 0 : typeof v === "string" && v !== "";
}

/** The first of `keys` the inspector answered, else the first one this template defines, else the first key -- lets one composer serve every template generation's field names. */
export function keyOf(itemFields: TemplateField[], inst: AnswerTree, keys: string[]): string {
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
export function labelFor(itemFields: TemplateField[], inst: AnswerTree, key: string, raw: string): string {
  const typed = otherAnswerText(raw);
  if (typed !== undefined) return typed;
  if (raw === "other") return asString(inst[`${key}Other`]).trim();
  return optionLabel(itemFields, key, raw);
}

/** Single-select answer as its display label ("" when unanswered). */
export function one(itemFields: TemplateField[], inst: AnswerTree, keys: string[]): string {
  const key = keyOf(itemFields, inst, keys);
  const raw = asString(inst[key]);
  return raw ? labelFor(itemFields, inst, key, raw) : "";
}

/** Multi-select answer as its display labels -- also accepts a single-select field's one value, since the same sentence slot is a pick-one in some templates ("constructed of concrete") and a tick-any in others. */
export function many(itemFields: TemplateField[], inst: AnswerTree, keys: string[]): string[] {
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
export function lower(s: string): string {
  return s.replace(/[A-Za-z][A-Za-z']*/g, (word) => (/[A-Z]/.test(word.slice(1)) ? word : word.toLowerCase()));
}

/** "paint flaking" -> "Paint flaking" -- for an already-lowercased (mid-sentence-style) phrase that's actually being used to START a new sentence, so it needs its own capital letter back. */
export function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "a" or "an", picked from `word`'s first letter -- a plain first-letter check (not true vowel-sound detection), which is fine here since every word it sees comes from this app's own template option labels. */
export function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** "a, b, c" with a trailing "and" before the last item, matching the template's list style. */
export function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Stitches already-worded clause fragments with a trailing "and" and no comma -- e.g. ["with a pitched roof", "a covering of concrete tiles"] -> "with a pitched roof and a covering of concrete tiles", matching how the reference template's sentences run several prepositional clauses together. */
export function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return "";
  if (clauses.length === 1) return clauses[0];
  return `${clauses.slice(0, -1).join(" ")} and ${clauses[clauses.length - 1]}`;
}

export function yesNo(inst: AnswerTree, key: string): boolean | undefined {
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
export function conditionOf(
  itemFields: TemplateField[],
  inst: AnswerTree,
  keys: string[] = ["condition", "generalCondition", "wallsCondition"],
): { word: string; tag?: string } {
  const key = keyOf(itemFields, inst, keys);
  const raw = asString(inst[key]);
  if (!raw) return { word: "" };
  // A grade typed as "Other" is the inspector's own word for the condition; a bare "Other" says nothing.
  const typed = otherAnswerText(raw);
  if (typed !== undefined) return { word: lower(typed) };
  const option = itemFields.find((f) => f.key === key)?.options?.find((o) => o.value === raw);
  if (raw === "other" && !option) return { word: "" };
  const grade = gradeOf(option);
  if (grade) return { word: grade.word, tag: `COND::${grade.color}::${grade.label}` };
  return { word: lower(shortConditionLabel(option?.label ?? raw)) };
}

/** "Several minor cracks" -> "Several minor cracks observed." / "Numerous cracking throughout" -> "Numerous cracking observed throughout." */
export function observedSentence(label: string): string {
  const l = lower(label).trim();
  if (l.endsWith(" throughout")) return `${capitalize(l.slice(0, -" throughout".length))} observed throughout.`;
  return `${capitalize(l)} observed.`;
}

/** The yes/no (`hasDamage`) or three-way (`damageSummary`) "is there notable damage" answer, as its sentence. */
export function damageOverviewSentence(itemFields: TemplateField[], inst: AnswerTree): string {
  if (itemFields.some((f) => f.key === "hasDamage")) {
    return `There ${yesNo(inst, "hasDamage") ? "were" : "were no"} signs of notable damage.`;
  }
  const summary = one(itemFields, inst, ["damageSummary"]);
  if (!summary) return "";
  if (/^no visible/i.test(summary)) return "There were no signs of notable damage.";
  return observedSentence(summary);
}

/** A typed location starting with its own preposition ("above the front window", "near the meter box") used to get a second one stacked in front of it ("At the above the front window..."); this detects that case so the lead-in can drop "At the" and just capitalise the typed text instead ("Above the front window, there is..."), while a plain noun-phrase location ("centre of the driveway") still gets "At the" as before. */
export const LOCATION_STARTS_WITH_PREPOSITION_RE =
  /^(above|below|near|beside|under|over|behind|within|along|across|adjacent to|between|next to|around|at|in|on|outside|inside|opposite|beyond)\b/i;

/** "at the centre of the driveway" / "above the front window" -- a location phrase that reads right after a noun ("Cracking at ..."), for the one-line Executive Summary notes. */
export function atLocation(location: string): string {
  return LOCATION_STARTS_WITH_PREPOSITION_RE.test(location) ? location : `at ${location}`;
}

/** "At the centre of the driveway, there is" / "Above the front window, there is" / "There is" (no location typed). */
export function damageLeadIn(location: string, plural: boolean): string {
  const be = plural ? "there are" : "there is";
  if (!location) return capitalize(be);
  if (LOCATION_STARTS_WITH_PREPOSITION_RE.test(location)) return `${capitalize(location)}, ${be}`;
  // "the loading apron" already has its article: "At the loading apron", not "At the the loading apron".
  if (/^the\s/i.test(location)) return `At ${location}, ${be}`;
  return `At the ${location}, ${be}`;
}

export const DAMAGE_TYPE_PHRASES: Record<string, { noun: string; plural?: boolean }> = {
  surface_damage: { noun: "surface damage" },
  material_deterioration: { noun: "material deterioration" },
  movement_displacement: { noun: "movement or displacement" },
  moisture_evidence: { noun: "moisture-related evidence" },
  operational_defects: { noun: "operational defects", plural: true },
  previous_repairs: { noun: "previous repairs", plural: true },
  safety_issues: { noun: "safety issues", plural: true },
};

export const DIRECTION_ADVERBS: Record<string, string> = {
  vertical: "vertically",
  horizontal: "horizontally",
  diagonal: "diagonally",
};

/** How one recorded defect reads in a sentence -- `phrase` for "there is ___", `noun` for the follow-up "The ___ is approximately 5mm wide". */
export function damageWording(rawType: string, typeLabel: string, subLabel: string): { phrase: string; noun: string; plural: boolean } {
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
export function damageSentences(
  inst: AnswerTree,
  itemFields: TemplateField[],
  // A report type whose section holds several defect lists names the one to write, and where its defects start in the
  // instance's combined list (the order the lists come in the template) so each sentence finds its own photos.
  options: { key?: string; indexOffset?: number } = {},
): string {
  const damageKey = options.key ?? keyOf(itemFields, inst, ["damages", "cracks"]);
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
      return `DEFECT::${(options.indexOffset ?? 0) + defectIndex}::${parts.join(" ")}`;
    })
    .join("\n\n");
}

export function obstructionsSentence(itemFields: TemplateField[], inst: AnswerTree, noun: string): string {
  const labels = many(itemFields, inst, ["obstructions", "obscuredBy", "obstruction"]).map(lower);
  if (labels.length === 0) return "";
  return ` Sections ${noun ? `of the ${noun} ` : ""}were obscured by ${joinList(labels)}.`;
}

/** "Satisfactory and in typical condition." for the one grade the reference wording covers; any other grade keeps the plain "It is in {grade} condition." */
export function typicalCondition(word: string): string {
  if (!word) return "";
  return word === "satisfactory" ? "Satisfactory and in typical condition." : `It is in ${word} condition.`;
}

/** A fixed Front / Left / Rear / Right tab as the report says it: "left-hand", "right-hand", "front", "rear". */
export function handedSide(label: string): string {
  const l = lower(label).trim();
  return l === "left" ? "left-hand" : l === "right" ? "right-hand" : l;
}

/** "Cladding: paint is flaking from sections and timber is cracked." -- for the published templates' observation checklists, whose option labels are already complete phrases. */
export function observationLine(itemFields: TemplateField[], inst: AnswerTree, keys: string[], heading: string): string {
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
export function defectsSentence(itemFields: TemplateField[], inst: AnswerTree): string {
  const labels = many(itemFields, inst, ["defects"]).map(lower);
  if (labels.length === 0) return "";
  return ` ${capitalize(joinList(labels))} noted.`;
}

export function tail(parts: string[], itemFields: TemplateField[], inst: AnswerTree): string {
  const damages = damageSentences(inst, itemFields);
  if (damages) parts.push(damages);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
}

/**
 * Where each defect list's sentences start in the Part's combined defect list -- the walk collects them in
 * template order, only for lists the inspector actually reached (their gate is satisfied).
 */
export function defectOffsets(itemFields: TemplateField[], inst: AnswerTree): Record<string, number> {
  const offsets: Record<string, number> = {};
  let next = 0;
  for (const field of itemFields) {
    if (field.type !== "damage-list" || !isGateSatisfied(field, inst)) continue;
    offsets[field.key] = next;
    const list = inst[field.key];
    next += Array.isArray(list) ? list.length : 0;
  }
  return offsets;
}

/**
 * What the inspector recorded about the scope and about safety on the Description form, as sentences -- scope changes,
 * limitations to the scope, safety issues (and, for Public Assets, whether safety and access were assessed). Nothing
 * is said for an answer of "No" with nothing to add.
 */
export function scopeAndSafetyParagraphs(inst: AnswerTree): string[] {
  const out: string[] = [];
  const changes = asString(inst.scopeChanges).trim();
  if (changes) out.push(`Changes to the scope: ${withPeriod(changes.replace(/\s*\n+\s*/g, " "))}`);
  if (yesNo(inst, "scopeLimitations")) {
    const notes = asString(inst.scopeLimitationsNotes).trim();
    out.push(notes ? `Limitations to the scope of the inspection: ${withPeriod(notes.replace(/\s*\n+\s*/g, " "))}` : "There were limitations to the scope of the inspection.");
  }
  if (inst.safetyAssessed !== undefined && asString(inst.safetyAssessed) !== "") {
    const notes = asString(inst.safetyAssessedNotes).trim();
    const said = yesNo(inst, "safetyAssessed") ? "All safety and access matters were assessed on site." : "Safety and access matters were not assessed on site.";
    out.push(notes ? `${said} ${withPeriod(notes.replace(/\s*\n+\s*/g, " "))}` : said);
  }
  if (yesNo(inst, "safetyIssues")) {
    const notes = asString(inst.safetyIssuesNotes).trim();
    out.push(notes ? `Safety issues: ${withPeriod(notes.replace(/\s*\n+\s*/g, " "))}` : "There were safety issues at the property.");
  }
  return out;
}

/** "The proposed works are to the development site." -- the form's "The proposed works are to" answer. */
export function proposedWorksParagraph(itemFields: TemplateField[], inst: AnswerTree): string {
  const type = lower(one(itemFields, inst, ["proposedWorksType"]));
  return type ? `The proposed works are to the ${type}.` : "";
}

