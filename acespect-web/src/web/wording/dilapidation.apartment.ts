// Dilapidation / Apartment -- the wording for this report type, and only this one.
//
// Written from the Houspect "Dilapidation Residential Apartment / Infrastructure Project" Word template, and from the
// Apartment form itself. The Word template is short: a Description, four elevations, a chimney, the rooms by floor and
// Notes. The website form is much longer -- a checklist of the unit and the building (external walls, cladding, car space,
// doors, balconies, roof, ceilings, floors, plumbing, electrical, common areas, ...). Where the template has a sentence its
// wording is used (the property description, "There is significant cracking / damage. The most significant items are:",
// "This elevation is on the boundary and could not be inspected."); every other answer on the form is written as a plain
// sentence in the same style, under a heading for the part of the building it is about, so nothing recorded is dropped.
import type { AnswerTree, ConditionSummaryRow, TemplateField } from "../templateFields";
import { asString, buildDefectNote, isGateSatisfied, withPeriod } from "../templateFields";
import { gradeOf } from "../conditionGrades";
import type { Composer } from "./shared";
import { article, conditionOf, damageSentences, defectOffsets, joinClauses, joinList, lower, many, one } from "./shared";
import { residentialHouseComposers } from "./dilapidation.residential_house";
import type { ReportWording } from "./types";

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

const description: Composer = (inst, itemFields) => {
  const buildingType = lower(one(itemFields, inst, ["buildingType"]));
  const storeys = asString(inst.storeys).trim();
  const slope = one(itemFields, inst, ["slope"]);
  const year = asString(inst.constructedYear).trim();
  const walls = lower(one(itemFields, inst, ["cladding"]));
  const foundations = lower(one(itemFields, inst, ["foundations"]));
  const roofDesign = lower(one(itemFields, inst, ["roofDesign"]));
  const roofCovering = lower(one(itemFields, inst, ["roofCovering"]));
  const windows = lower(one(itemFields, inst, ["windows"]));
  const works = lower(one(itemFields, inst, ["worksType"]));

  const parts: string[] = [];
  const opening: string[] = [];
  if (storeys) opening.push(`with ${storeys} ${/^1$|^one$/i.test(storeys) ? "storey" : "storeys"}`);
  if (slope) opening.push(/^flat$/i.test(slope) ? "on a flat block of land" : `on a block of land with a ${lower(slope)}`);
  if (year) opening.push(`estimated to have been constructed around ${year}`);
  if (buildingType) {
    const subject = `The property is ${article(buildingType)} ${buildingType}`;
    parts.push(opening.length ? `${subject}, ${joinClauses(opening)}.` : `${subject}.`);
  } else if (opening.length) {
    parts.push(`The property is ${joinClauses(opening)}.`);
  }

  const build: string[] = [];
  if (walls) build.push(`constructed of ${walls} walls`);
  if (foundations) build.push(`on ${foundations}`);
  if (roofDesign) build.push(`with a ${roofDesign} roof`);
  if (roofCovering) build.push(`a covering of ${roofCovering}`);
  if (build.length) parts.push(`It is ${joinClauses(build)}.`);
  if (windows) parts.push(`Windows are constructed of ${windows}.`);

  const paragraphs = [parts.join(" ")];
  if (works) paragraphs.push(`The proposed works are ${works}.`);
  // Limitations to the scope and safety issues, as the inspector recorded them.
  const clean = (v: unknown): string => asString(v as string).trim().replace(/\s*\n+\s*/g, " ");
  if (asString(inst.limitations) === "yes") {
    const notes = clean(inst.limitationsNotes);
    paragraphs.push(notes ? `Limitations to the scope of the inspection: ${withPeriod(notes)}` : "There were limitations to the scope of the inspection.");
  }
  if (asString(inst.safetyIssues) === "yes") {
    const notes = clean(inst.safetyIssuesNotes);
    paragraphs.push(notes ? `Safety issues: ${withPeriod(notes)}` : "There were safety issues at the property.");
  }
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

/** The House sentences for the driveway, then the form's two flags. */
const driveway: Composer = (inst, itemFields, label) => {
  const base = residentialHouseComposers.driveway(inst, itemFields, label);
  const flags = flagSentences(inst, [
    ["notableDamage", "Notable damage was observed."],
    ["safetyHazard", "A safety hazard was identified."],
  ]);
  return [base, ...flags].filter(Boolean).join("\n\n");
};

/** "The front fence is a timber paling fence constructed of timber and is in fair condition with typical weathering." */
const fences: Composer = (inst, itemFields) => {
  const location = lower(one(itemFields, inst, ["location"]));
  const structure = lower(one(itemFields, inst, ["structureType"]));
  const material = lower(one(itemFields, inst, ["material"]));
  const cond = conditionOf(itemFields, inst);
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const subject = `The ${location ? `${location} ` : ""}fence`;
  const built = [structure ? `is ${article(structure)} ${structure} fence` : "", material ? `constructed of ${material}` : ""].filter(Boolean).join(" ");
  const predicates = [built, cond.word ? `is in ${cond.word} condition with typical weathering` : ""].filter(Boolean);
  const obscured = many(itemFields, inst, ["obstructions"]).map(lower);
  parts.push(
    `${predicates.length ? `${subject} ${predicates.join(" and ")}.` : `${subject} was inspected.`}${obscured.length ? ` Sections of the fence were obscured by ${joinList(obscured)}.` : ""}`,
  );
  const flags = flagSentences(inst, [
    ["notableDamage", "Notable damage was observed."],
    ["notableCracking", "Notable cracking was observed."],
  ]);
  const defects = damageSentences(inst, itemFields);
  const notes = asString(inst.notes).trim();
  return [...parts, ...flags, defects, notes ? withPeriod(notes) : ""].filter(Boolean).join("\n\n");
};

/** "There is a masonry retaining wall to the left, constructed of brick. It is in fair condition with typical weathering." */
const retainingWalls: Composer = (inst, itemFields) => {
  const location = lower(one(itemFields, inst, ["location"]));
  const structure = lower(one(itemFields, inst, ["structureType"]));
  const material = lower(one(itemFields, inst, ["material"]));
  const cond = conditionOf(itemFields, inst);
  const parts: string[] = [];
  if (cond.tag) parts.push(cond.tag);
  const first = `There is ${article(structure || "retaining")} ${structure ? `${structure} ` : ""}retaining wall${location ? ` to the ${location}` : ""}${material ? `, constructed of ${material}` : ""}.`;
  const second = cond.word ? ` It is in ${cond.word} condition with typical weathering.` : "";
  const obscured = many(itemFields, inst, ["obstructions"]).map(lower);
  parts.push(`${first}${second}${obscured.length ? ` Sections of the wall were obscured by ${joinList(obscured)}.` : ""}`);
  const flags = flagSentences(inst, [
    ["notableDamage", "Notable damage was observed."],
    ["notableCracking", "Notable cracking was observed."],
  ]);
  const defects = damageSentences(inst, itemFields);
  const notes = asString(inst.notes).trim();
  return [...parts, ...flags, defects, notes ? withPeriod(notes) : ""].filter(Boolean).join("\n\n");
};

/** The House sentences for a pool or spa, then the form's damage flag. */
const poolSpa: Composer = (inst, itemFields, label) => {
  const base = residentialHouseComposers.pool_spa(inst, itemFields, label);
  const flags = flagSentences(inst, [["hasDamage", "Damage was present."]]);
  return [base, ...flags].filter(Boolean).join("\n\n");
};

// ---- The checklist sections ------------------------------------------------------------------

type Group = { prefix: string; title: string };

const GROUPS: Record<string, Group[]> = {
  elevations: [
    { prefix: "elev_overview", title: "Elevations overview" },
    { prefix: "ext_walls", title: "External walls" },
    { prefix: "cladding", title: "Cladding" },
    { prefix: "garage", title: "Car space" },
    { prefix: "front_door", title: "Front door" },
    { prefix: "other_doors_ext", title: "Other external doors" },
    { prefix: "balconies", title: "Balconies" },
  ],
  garage_carport_sheds: [{ prefix: "carspace", title: "Car space" }],
  roof_chimneys: [
    { prefix: "roof_covering", title: "Roof covering" },
    { prefix: "eaves", title: "Eaves" },
    { prefix: "fascia", title: "Fascia" },
    { prefix: "gutters", title: "Gutters" },
    { prefix: "downpipes", title: "Downpipes" },
  ],
  internal_areas: [
    { prefix: "int_roof", title: "Roof space" },
    { prefix: "party_walls", title: "Party walls" },
    { prefix: "ceilings", title: "Ceilings" },
    { prefix: "int_walls", title: "Internal walls" },
    { prefix: "floors", title: "Floors" },
    { prefix: "int_stairs", title: "Stairs" },
    { prefix: "int_windows", title: "Windows (internal)" },
    { prefix: "int_doors", title: "Internal doors" },
    { prefix: "cabinets", title: "Cabinets" },
    { prefix: "plumbing", title: "Plumbing" },
    { prefix: "gas", title: "Gas" },
    { prefix: "electrical", title: "Electrical" },
    { prefix: "fireplace", title: "Fireplace" },
  ],
  paving_paths: [
    { prefix: "foyer", title: "Foyer" },
    { prefix: "lifts", title: "Lifts" },
    { prefix: "driveway_common", title: "Common driveway" },
    { prefix: "ext_paving", title: "External paving" },
    { prefix: "pool", title: "Pool / spa" },
    { prefix: "meeting_room", title: "Meeting room" },
    { prefix: "gym", title: "Gym" },
    { prefix: "roof_terrace", title: "Roof terrace" },
    { prefix: "fences_common", title: "Common fences" },
  ],
  notes: [
    { prefix: "structural", title: "Structural" },
    { prefix: "major_defects", title: "Major defects" },
    { prefix: "safety", title: "Safety" },
    { prefix: "post_project", title: "Notes and areas not accessed" },
  ],
};

/** Labels the form wrote as the start of a sentence ("External walls constructed of", "Cornices are") read straight into their answer. */
const OPENER = /(\b(of|are|is|to|on|a|generally)|\brequires?)$/i;

/** A few questions whose label cannot start a sentence on its own. */
const SAY: Record<string, (value: string, yes: boolean) => string> = {
  front_door_requires: (v) => `The front door requires ${lower(v)}.`,
  other_doors_ext_requires: (v) => `The other external doors generally require ${lower(v)}.`,
  cladding_requires: (v) => `The cladding requires ${lower(v)}.`,
  int_doors_style: (v) => `Internal doors are generally ${lower(v)}.`,
  // The template's own sentence for a party wall / limited access elevation.
  elev_overview_partyWall: (_v, yes) => (yes ? "This elevation is on the boundary and could not be inspected." : ""),
};

const cleanLabel = (label: string): string =>
  label
    .replace(/\s*\(select all that apply\)/i, "")
    .replace(/\s*\?$/, "")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s*\(.*$/, "")
    .trim();

const hasAnswer = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v !== "" : typeof v === "number");

/** The group a field belongs to: the longest matching prefix. */
function groupOf(key: string, groups: Group[]): Group | undefined {
  return groups.filter((g) => key.startsWith(`${g.prefix}_`)).sort((a, b) => b.prefix.length - a.prefix.length)[0];
}

/** One sentence for one answered field, or "" when the field says nothing on its own. */
function fieldSentence(field: TemplateField, inst: AnswerTree, itemFields: TemplateField[]): string {
  const key = field.key;
  const label = cleanLabel(field.label ?? key);
  if (field.type === "yesno") {
    const raw = asString(inst[key]);
    if (!raw) return "";
    const custom = SAY[key];
    return custom ? custom("", raw === "yes") : `${label}: ${raw}.`;
  }
  if (field.type === "chip-multiselect" || field.type === "tile-multiselect") {
    const items = many(itemFields, inst, [key]).map(lower);
    return items.length ? `${label}: ${joinList(items)}.` : "";
  }
  if (field.type === "textarea") {
    const text = asString(inst[key]).trim().replace(/\s*\n+\s*/g, " ");
    if (!text) return "";
    // "Comments" and the "No access to… / additional notes" box are the inspector's own words: printed as written.
    return /comments$/i.test(label) || key === "post_project_describe" ? withPeriod(text) : `${label}: ${withPeriod(text)}`;
  }
  // a typed value, a choice, or a grade
  const value = one(itemFields, inst, [key]);
  if (!value) return "";
  const custom = SAY[key];
  if (custom) return custom(value, true);
  if (OPENER.test(label)) return `${label} ${lower(value)}.`;
  return `${label}: ${value}.`;
}

/** The checklist sections: each group of questions under its heading, with the grade, what was found and the defects. */
function checklistComposer(sectionKey: string): Composer {
  const groups = GROUPS[sectionKey];
  // The Notes section prints as a plain numbered list, with no headings or grade tags.
  const plain = sectionKey === "notes";
  return (inst, itemFields) => {
    const offsets = defectOffsets(itemFields, inst);
    const blocks: string[] = [];
    for (const group of groups) {
      const fields = itemFields.filter((f) => groupOf(f.key, groups) === group && isGateSatisfied(f, inst));
      if (!fields.some((f) => f.type !== "photos" && hasAnswer(inst[f.key]))) continue; // this group was not visited
      if (!plain) blocks.push(`ROOMHEAD::${group.title}`);
      // The grade comes straight under the heading.
      const condField = fields.find((f) => f.key === `${group.prefix}_condition`);
      const groupCond = condField && asString(inst[`${group.prefix}_applicable`]) !== "no" ? conditionOf(itemFields, inst, [condField.key]) : undefined;
      if (groupCond?.tag && !plain) blocks.push(groupCond.tag);
      // Not applicable / not accessible: say so (and why) and keep only what the inspector added.
      const applicable = fields.find((f) => f.key === `${group.prefix}_applicable`);
      if (applicable && asString(inst[applicable.key]) === "no") {
        const reason = lower(one(itemFields, inst, [`${group.prefix}_naReason`]));
        blocks.push(`${group.title}: not applicable${reason && reason !== "not applicable" ? ` (${reason})` : ""}.`);
        const comment = asString(inst[`${group.prefix}_comments`]).trim().replace(/\s*\n+\s*/g, " ");
        if (comment) blocks.push(withPeriod(comment));
        continue;
      }
      for (const field of fields) {
        const key = field.key;
        if (field.type === "photos" || key === `${group.prefix}_applicable` || key === `${group.prefix}_naReason`) continue;
        if (/Other$/.test(key) && fields.some((f) => f.key === key.slice(0, -5))) continue; // the typed "Other" is read with its question
        if (key === `${group.prefix}_condition`) continue; // said under the heading
        if (field.type === "damage-list") {
          const list = Array.isArray(inst[key]) ? (inst[key] as AnswerTree[]) : [];
          if (list.length) {
            const cracks = list.filter((d) => !asString(d.damageType) || asString(d.damageType) === "cracking").length;
            blocks.push(
              `${cracks === list.length ? "There is significant cracking." : cracks === 0 ? "There is significant damage." : "There is significant cracking and damage."} The most significant items are:`,
              damageSentences(inst, itemFields, { key, indexOffset: offsets[key] ?? 0 }),
            );
          }
          continue;
        }
        const sentence = fieldSentence(field, inst, itemFields);
        if (sentence) blocks.push(sentence);
      }
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
    rows.push({ subLabel: group.title, conditionLabel: grade.label, conditionColor: grade.color, defectNote: damageField ? buildDefectNote(damageField, inst) : undefined });
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
  },
  absence: {},
  // The description and the checklist sections are flat in the Apartment form (no repeating group).
  isFlatComposed: (sectionKey, templateFields) =>
    sectionKey === "description" || (sectionKey in GROUPS && !templateFields.some((f) => f.type === "repeating-group")),
  metadataFields: {},
  noSummarySections: ["description"],
  absentSlotSections: [],
  summaryRows,
  descriptionBlocks,
};

