// Dilapidation / Public Assets -- the wording for this report type, and only this one.
//
// Written from the Public Assets report document. A Public Assets survey has no building: the body of the
// report is the "Survey Parts" section (Part A: frontage to the project site, Part B: laneway / road to the
// side or rear), and each Part is walked in a fixed order of categories -- footpaths and crossovers, fences
// and walls along a laneway, nature strip / light posts / signage / trees, kerbs and channel, road surface
// and parking bays, laneway surface -- each with a material and condition overview, the most significant
// defects, and the street assets found (utility pit covers, light posts, signs, bollards, ...).
import type { AnswerTree, TemplateField } from "../templateFields";
import type { ConditionSummaryRow } from "../templateFields";
import { asString, buildDefectNote, isGateSatisfied, withPeriod } from "../templateFields";
import { gradeOf } from "../conditionGrades";
import type { Composer } from "./shared";
import { conditionOf, damageSentences, defectOffsets, joinList, lower, many, observedSentence, one, scopeAndSafetyParagraphs } from "./shared";
import type { ReportWording } from "./types";

// ---- Description and Overview --------------------------------------------------------------

/** "The inspection is for Public Assets to the {development site}." */
const description: Composer = (inst, itemFields) => {
  const worksType = lower(one(itemFields, inst, ["proposedWorksType"]));
  const lead = worksType ? `The inspection is for Public Assets to the ${worksType}.` : "The inspection is for Public Assets.";
  // What was recorded about the scope and about safety follows, each as its own paragraph.
  return [lead, ...scopeAndSafetyParagraphs(inst)].join("\n\n");
};

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

/** What the scope was confirmed to cover, as the labels the inspector ticked -- kept with the section so the Description page can word the scope sentence. */
function derivedFields(sectionKey: string, scope: AnswerTree, templateFields: TemplateField[]): Record<string, unknown> {
  if (sectionKey !== "description") return {};
  const items = many(templateFields, scope, ["scopeConfirmed"]).map(lower);
  return items.length ? { scopeItems: items } : {};
}

/** The two sentences the Description page words for this report type. */
function descriptionBlocks({ fields, areaCount }: { fields: Record<string, unknown>; areaCount: number }): { works?: string; scope?: string } {
  const address = typeof fields.projectSiteAddress === "string" ? fields.projectSiteAddress.trim() : "";
  const text = (v: unknown): string => (typeof v === "string" ? clean(v) : "");
  const side = text(fields.siteSide);
  const direction = text(fields.siteDirection);
  const items = Array.isArray(fields.scopeItems) ? (fields.scopeItems as string[]) : [];
  const areas = areaCount > 0 ? ` to the following ${numberWord(areaCount)} area${areaCount === 1 ? "" : "s"}:` : "";
  return {
    // Where the project works are in relation to the site, when the inspector gave a side and a direction.
    works: address
      ? side && direction
        ? `The project works are to the property at ${address}, which is at the ${lower(side)} - approximately ${COMPASS[direction] ?? lower(direction)} - of the site of this inspection.`
        : `The project works are to the property at ${address}.`
      : undefined,
    scope: items.length ? `The scope for inspection is public assets including ${joinList(items)}${areas}` : undefined,
  };
}

// ---- Survey parts ---------------------------------------------------------------------------

const COMPASS: Record<string, string> = { NE: "north-east", NW: "north-west", SE: "south-east", SW: "south-west" };

/** A choice the form offers as "Other" with no box to type in says nothing. */
const clean = (label: string): string => (/^other$/i.test(label.trim()) ? "" : label.trim());

/** "Mix" is not a material: alone it is "a mix of materials", beside others it is "a mix of" them. */
function materialWords(labels: string[]): string[] {
  const others = labels.filter((m) => !/^mix$/i.test(m));
  if (others.length === labels.length) return labels;
  if (others.length === 0) return ["a mix of materials"];
  return others.length === 1 ? [`${others[0]} and other materials`] : [`a mix of ${joinList(others)}`];
}

/** "a" or "an" for the kinds of asset the form lists ("a utility pit cover", "an unlisted ...": vowel sound, not letter, for "u"). */
const articleFor = (word: string): string => (/^[aeio]/i.test(word) ? "an" : "a");

type Category = {
  prefix: string;
  /** The heading shown above the category (the two laneway fence categories share one). */
  heading: string;
  /** The part of the sentence after "constructed of {material} and in {condition} condition with ...". */
  wear: string;
  /** Sections were obscured: "Sections of the nature strip were..." or just "Sections were...". */
  obscuredNoun: string;
  sentence: (c: { material: string; condition: string; wear: string }) => string;
};

/** "The footpath and crossovers are constructed of concrete and in satisfactory condition with typical wear and tear." */
function overview(subject: string, verb: "is" | "are") {
  return ({ material, condition, wear }: { material: string; condition: string; wear: string }): string => {
    const made = material ? `constructed of ${material}` : "";
    // "with typical wear and tear" belongs to the satisfactory choice only: a fair, average or poor asset is just stated as such.
    const state = condition ? `in ${condition} condition${condition === "satisfactory" ? ` with ${wear}` : ""}` : "";
    const body = [made, state].filter(Boolean).join(" and ");
    return body ? `${subject} ${verb} ${body}.` : "";
  };
}

// Doc order: Part A is footpaths, nature strip, kerbs, road surface; Part B is fences, light posts / signage / trees, laneway surface.
const CATEGORIES: Category[] = [
  { prefix: "footpaths", heading: "Footpaths and Crossovers", wear: "typical wear and tear", obscuredNoun: "", sentence: overview("The footpath and crossovers", "are") },
  { prefix: "fenceleft", heading: "Fencing / Walls along laneway", wear: "typical weathering", obscuredNoun: "", sentence: overview("The left side fences and walls", "are") },
  { prefix: "fenceright", heading: "Fencing / Walls along laneway", wear: "typical weathering", obscuredNoun: "", sentence: overview("The right side fences and walls", "are") },
  {
    prefix: "naturestrip",
    heading: "Nature strip, Light posts, Signage, Trees",
    wear: "typical wear and tear",
    obscuredNoun: "nature strip",
    // "There is a nature strip of grass which is in typical condition."
    sentence: ({ material, condition }) =>
      `There is a nature strip${material ? ` of ${material}` : ""}${condition ? ` which is in ${condition === "satisfactory" ? "typical" : condition} condition` : ""}.`,
  },
  { prefix: "kerbs", heading: "Kerbs and Channel", wear: "typical wear and tear", obscuredNoun: "", sentence: overview("The kerbs and channel", "are") },
  { prefix: "roadsurface", heading: "Road surface and Parking bays", wear: "typical shrinkage cracks and wear and tear", obscuredNoun: "", sentence: overview("The road surface and parking bays", "are") },
  { prefix: "lanesurface", heading: "Laneway surface", wear: "typical shrinkage cracks and wear and tear", obscuredNoun: "", sentence: overview("The laneway surface", "is") },
];

/** Singular and plural wording for each kind of street asset, as the form lists them. */
const ASSET_WORDS: [RegExp, string, string][] = [
  [/^stormwater cover/i, "stormwater cover", "stormwater covers"],
  [/^utility pit cover/i, "utility pit cover", "utility pit covers"],
  [/^light post/i, "light post", "light posts"],
  [/^tree/i, "tree", "trees"],
  [/^parking sign/i, "parking/traffic sign", "parking/traffic signs"],
  [/^bollard/i, "bollard/parking meter", "bollards/parking meters"],
  [/^traffic light/i, "traffic light", "traffic lights"],
  [/^public bin/i, "public bin/seating", "public bins/seating"],
  [/^bike rack/i, "bike rack", "bike racks"],
  [/^phone booth/i, "phone booth/bus or tram stop", "phone booths/bus or tram stops"],
  [/^planter box/i, "planter box/sculpture/artwork/playground", "planter boxes/sculptures/artworks/playgrounds"],
];

/** The count the form offers as a word-less choice: Nil, 1, 2, 3. */
function countOf(label: string): number {
  const n = Number(label.trim());
  return Number.isFinite(n) ? n : 0;
}

/** What the inspector ticked is wrong with an asset ("Crack / subsidence / gap / chipping / leaning / damage ... or OK"); OK says nothing. */
function defectKindSentence(kind: string, count: number): string {
  const one = count === 1;
  switch (lower(kind)) {
    case "crack":
      return one ? "It has a crack." : "They have cracks.";
    case "subsidence":
      return one ? "It has subsidence." : "They have subsidence.";
    case "gap":
      return one ? "It has a gap." : "They have gaps.";
    case "chipping":
      return one ? "It has chipping." : "They have chipping.";
    case "leaning":
      return one ? "It is leaning." : "They are leaning.";
    case "damage":
      return one ? "It is damaged." : "They are damaged.";
    case "rust":
      return one ? "It is rusted." : "They are rusted.";
    case "graffiti":
      return one ? "It has graffiti." : "They have graffiti.";
    default:
      return "";
  }
}

/** One street asset: "There is a utility pit cover at the corner. It is in satisfactory condition with typical wear and tear." */
function assetSentence(assetFields: TemplateField[], asset: AnswerTree): string {
  const count = countOf(one(assetFields, asset, ["count"]));
  if (count <= 0) return "";
  const kind = one(assetFields, asset, ["assetType"]);
  const known = ASSET_WORDS.find(([re]) => re.test(kind));
  const singular = known ? known[1] : lower(kind);
  const plural = known ? known[2] : `${lower(kind)}s`;
  if (!singular) return "";
  const location = asString(asset.location).trim();
  const at = location ? ` at ${location}` : "";
  const cond = conditionOf(assetFields, asset, ["condition"]);
  const state = cond.word ? ` ${count === 1 ? "It is" : "They are"} in ${cond.word} condition${cond.word === "satisfactory" ? " with typical wear and tear" : ""}.` : "";
  const defect = defectKindSentence(one(assetFields, asset, ["defectKind"]), count);
  const lead = count === 1 ? `There is ${articleFor(singular)} ${singular}${at}.` : `There are ${numberWord(count)} ${plural}${at}.`;
  // Where the asset's run starts and which way it goes, and its size, as the inspector recorded them.
  const start = asString(asset.startDirection).trim();
  const width = Number(asset.widthMm) || 0;
  const length = Number(asset.lengthMm) || 0;
  const sizeBits = [width > 0 ? `approximately ${width}mm wide` : "", length > 0 ? `approximately ${length}mm long` : ""].filter(Boolean);
  const extra = [start ? `Start point and direction: ${withPeriod(start)}` : "", sizeBits.length ? `${count === 1 ? "It is" : "They are each"} ${sizeBits.join(" and ")}.` : ""].filter(Boolean).join(" ");
  return `${lead}${state}${defect ? ` ${defect}` : ""}${extra ? ` ${extra}` : ""}`;
}

const surveyPart: Composer = (inst, itemFields, label) => {
  const offsets = defectOffsets(itemFields, inst);
  const defects = (key: string): string => damageSentences(inst, itemFields, { key, indexOffset: offsets[key] ?? 0 });
  const hasDefects = (key: string): boolean => Array.isArray(inst[key]) && (inst[key] as unknown[]).length > 0;
  const blocks: string[] = [];

  const partName = asString(inst.partName).trim() || label;
  if (partName) blocks.push(`ROOMHEAD::${partName}`);

  // "The following observations commenced from the south end at 3m past house 5 and proceeded north to the north end at the corner."
  const start = clean(one(itemFields, inst, ["surveyStart"]));
  const startRef = asString(inst.startRef).trim();
  const heading = clean(one(itemFields, inst, ["surveyDirection"]));
  const end = clean(one(itemFields, inst, ["surveyEnd"]));
  const endRef = asString(inst.endRef).trim();
  const from = start ? `the ${lower(start)}${startRef ? ` at ${startRef}` : ""}` : startRef;
  const to = end ? `the ${lower(end)}${endRef ? ` at ${endRef}` : ""}` : endRef;
  // Which way the road or lane runs.
  const runs = clean(one(itemFields, inst, ["runsDirection"]));
  if (runs) blocks.push(`The road / lane runs ${lower(runs)}.`);
  const walkPieces: string[] = [];
  if (from) walkPieces.push(`commenced from ${from}`);
  const proceeded = [heading ? `proceeded ${lower(heading)}` : to ? "proceeded" : "", to ? `to ${to}` : ""].filter(Boolean).join(" ");
  if (proceeded) walkPieces.push(proceeded);
  if (walkPieces.length) blocks.push(`The following observations ${walkPieces.join(" and ")}.`);

  let lastHeading = "";
  for (const category of CATEGORIES) {
    const p = category.prefix;
    const conditionField = itemFields.find((f) => f.key === `${p}_condition`);
    if (!conditionField || !isGateSatisfied(conditionField, inst)) continue; // this category is not part of this Part

    if (category.heading !== lastHeading) blocks.push(`ROOMHEAD::${category.heading}`);
    lastHeading = category.heading;

    const cond = conditionOf(itemFields, inst, [`${p}_condition`]);
    if (cond.tag) blocks.push(cond.tag);

    const material = joinList(materialWords(many(itemFields, inst, [`${p}_material`]).map(lower)));
    const main = category.sentence({ material, condition: cond.word, wear: category.wear });
    const lineMarkings = clean(one(itemFields, inst, [`${p}_lineMarkings`]));
    const obscured = many(itemFields, inst, [`${p}_obscuredBy`]).map(lower);
    const obscuredSentence = obscured.length
      ? `Sections ${category.obscuredNoun ? `of the ${category.obscuredNoun} ` : ""}were obscured by ${joinList(obscured)}.`
      : "";
    const paragraph = [
      main,
      lineMarkings && !/^na$/i.test(lineMarkings) ? `The painted line markings are ${lower(lineMarkings)}.` : "",
      obscuredSentence,
    ]
      .filter(Boolean)
      .join(" ");
    if (paragraph) blocks.push(paragraph);

    // Cracking / deterioration overview, then the most significant defects, each with its own photos.
    const summary = clean(one(itemFields, inst, [`${p}_summary`])).replace(/\s*\/\s*/g, " or ");
    const defectKey = `${p}_damages`;
    const anyDefects = hasDefects(defectKey);
    // The overview is said only when it records an issue: "No significant cracking / damage" says nothing -- a good asset is just reported as good.
    const summarySentence = summary && !/^no\b/i.test(summary) ? observedSentence(summary) : "";
    if (summarySentence || anyDefects) blocks.push([summarySentence, anyDefects ? "The most significant items are:" : ""].filter(Boolean).join(" "));
    const defectText = defects(defectKey);
    if (defectText) blocks.push(defectText);

    // Street assets found along this category.
    const assetsField = itemFields.find((f) => f.key === `${p}_assets`);
    const assetList = Array.isArray(inst[`${p}_assets`]) ? (inst[`${p}_assets`] as AnswerTree[]) : [];
    for (const asset of assetList) {
      const sentence = assetSentence(assetsField?.itemFields ?? [], asset);
      if (sentence) blocks.push(sentence);
    }

    // The road also carries guard rails, retaining walls and bridges, each with its own defect list, and a free-text "other".
    if (p === "roadsurface") {
      for (const [flag, listKey, present] of [
        ["guardRails", "guardRailsDamages", "Guard rails are present along the roadway."],
        ["retainingWalls", "retainingWallsDamages", "Retaining walls are present."],
        ["bridges", "bridgesDamages", "Bridges are present."],
      ] as const) {
        if (asString(inst[flag]) !== "yes") continue;
        blocks.push(present);
        const text = defects(listKey);
        if (text) blocks.push(text);
      }
      const other = asString(inst.other).trim();
      if (other) blocks.push(withPeriod(other));
    }
  }

  const otherDescription = asString(inst.otherDescription).trim();
  if (otherDescription) blocks.push(withPeriod(otherDescription));
  return blocks.join("\n\n");
};

/** One Condition Summary row per category the Part covers: "Part A: Frontage — Footpaths and Crossovers: Fair, cracking outside no. 7". */
function summaryRows(sectionKey: string, inst: AnswerTree, itemFields: TemplateField[], label: string): ConditionSummaryRow[] | undefined {
  if (sectionKey !== "elevations") return undefined;
  const partName = asString(inst.partName).trim() || label;
  const rows: ConditionSummaryRow[] = [];
  for (const category of CATEGORIES) {
    const field = itemFields.find((f) => f.key === `${category.prefix}_condition`);
    if (!field || !isGateSatisfied(field, inst)) continue;
    const grade = gradeOf(field.options?.find((o) => o.value === asString(inst[field.key])));
    if (!grade) continue;
    const damageField = itemFields.find((f) => f.key === `${category.prefix}_damages`);
    rows.push({
      // The two laneway fences share a heading, so the summary names the side.
      subLabel: `${partName} — ${category.heading}${category.prefix === "fenceleft" ? " (left side)" : category.prefix === "fenceright" ? " (right side)" : ""}`,
      conditionLabel: grade.label,
      conditionColor: grade.color,
      defectNote: damageField ? buildDefectNote(damageField, inst) : undefined,
    });
  }
  return rows;
}

export const dilapidationPublicAssets: ReportWording = {
  profile: { inspectionType: "dilapidation", propertyType: "public_assets" },
  status: "final",
  // A Public Assets report has no building, so only the description and the survey parts (the template's "elevations" section) are worded.
  composers: { description, elevations: surveyPart },
  absence: {},
  isFlatComposed: (sectionKey) => sectionKey === "description",
  metadataFields: {},
  noSummarySections: ["description"],
  absentSlotSections: [],
  derivedFields,
  descriptionBlocks,
  summaryRows,
};
