import type { AnswerTree, AnswerValue, TemplateField } from "./templateFields";
import { asString, asStringArray, withPeriod } from "./templateFields";

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
 * A few of the template's blanks (e.g. a crack's separate "starting at" /
 * "running to" points) don't have a matching field in the current
 * templates and are intentionally left out rather than inventing new
 * fields -- see the plan this was built against for why.
 */

type Composer = (inst: AnswerTree, itemFields: TemplateField[], label: string) => string;

function optionLabel(itemFields: TemplateField[], key: string, raw: string): string {
  const field = itemFields.find((f) => f.key === key);
  return field?.options?.find((o) => o.value === raw)?.label ?? raw;
}

/**
 * A bolded, colour-coded "Condition: Fair" tag for a `color-select` field,
 * reusing the exact colour already defined on that option in the template
 * (see SectionFieldEditor's ToggleField, which reads the same `o.color`) --
 * no separate colour scale to invent or keep in sync. Encoded as its own
 * plain-text paragraph (`COND::#hex::Label`) because `reportText` is stored
 * as flat text, not structured data; ReportSection.tsx recognises this exact
 * prefix and renders it as a tag instead of an ordinary paragraph. Neither
 * reference report actually applies its own New/Satisfactory/Fair/
 * Average/Poor scale inline -- it's defined in the SCOPE appendix and never
 * used again -- so this is a deliberate improvement on both, not something
 * being copied from either.
 */
function conditionTag(itemFields: TemplateField[], key: string, raw: string): string | undefined {
  if (!raw) return undefined;
  const field = itemFields.find((f) => f.key === key);
  const option = field?.options?.find((o) => o.value === raw);
  if (!option?.color) return undefined;
  return `COND::${option.color}::${option.label}`;
}

function optionLabels(itemFields: TemplateField[], key: string, raw: string[]): string[] {
  return raw.map((v) => optionLabel(itemFields, key, v));
}

/** "Timber Paling" -> "timber paling" -- template sentences use the lowercase form mid-sentence. */
/** "Exposed Aggregate Concrete" -> "exposed aggregate concrete" -- multi-word option labels read as Title Case for pills/chips but need to sit lowercase mid-sentence here. */
function lower(s: string): string {
  return s.toLowerCase();
}

/** "paint flaking" -> "Paint flaking" -- for an already-lowercased (mid-sentence-style) phrase that's actually being used to START a new sentence, so it needs its own capital letter back. */
function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "a" or "an", picked from `word`'s first letter -- a template option label
 *  can start with a vowel (e.g. the pool type "In-Ground", or the
 *  construction type "Apartment in a multi-level apartment complex"), and a
 *  sentence built with a hardcoded "a" would then read "a in-ground" / "a
 *  apartment...". This is a plain first-letter check (not true vowel-sound
 *  detection, e.g. it would get "an hour" or "a university" wrong), which is
 *  fine here since every word it actually sees comes from this app's own
 *  template option labels, not free-form English text. */
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

function yesNo(itemFields: TemplateField[], inst: AnswerTree, key: string): boolean | undefined {
  const raw = asString(inst[key]);
  if (!raw) return undefined;
  return raw === "yes";
}

/**
 * One sentence per damage/crack record. Sections whose damage-list has a
 * `damageType` field (crack/spall/leaning/other -- Driveway, Garage/Carport/
 * Sheds, Pool/Spa, Notes) describe each record as whatever type was actually
 * recorded; this used to hardcode "crack" regardless, so a recorded spall or
 * leaning defect was wrongly described as a crack. Sections whose damage-list
 * has no `damageType` at all (Paving & Paths, Fences, Retaining Walls -- those
 * only ever track cracks) correctly keep "crack" as a fixed default, since
 * there's no other type that field could ever hold.
 */
function damageSentences(inst: AnswerTree, itemFields: TemplateField[], damageKey = "damages"): string {
  const damageField = itemFields.find((f) => f.key === damageKey);
  const list = Array.isArray(inst[damageKey]) ? (inst[damageKey] as AnswerTree[]) : [];
  if (!damageField || list.length === 0) return "";
  const subFields = damageField.itemFields ?? [];
  const damageTypeField = subFields.find((f) => f.key === "damageType");
  return list
    .map((d) => {
      const location = asString(d.location);
      const width = Number(d.widthMm) || 0;
      const length = Number(d.lengthMm) || 0;
      const notes = asString(d.notes);
      const rawType = asString(d.damageType);
      const typeLabel = damageTypeField && rawType
        ? lower(damageTypeField.options?.find((o) => o.value === rawType)?.label ?? rawType)
        : "crack";
      const parts: string[] = [];
      parts.push(
        location
          ? `At the ${location}, there is ${article(typeLabel)} ${typeLabel}.`
          : `There is ${article(typeLabel)} ${typeLabel}.`,
      );
      if (width > 0 || length > 0) {
        const bits: string[] = [];
        if (width > 0) bits.push(`approximately ${width}mm wide`);
        if (length > 0) bits.push(`approximately ${length}mm long`);
        parts.push(`The ${typeLabel} is ${bits.join(" and ")}.`);
      }
      if (notes) parts.push(withPeriod(notes));
      return parts.join(" ");
    })
    .join(" ");
}

function obstructionsSentence(itemFields: TemplateField[], inst: AnswerTree, noun: string, key = "obstructions"): string {
  const raw = asStringArray(inst[key]);
  if (raw.length === 0) return "";
  const labels = optionLabels(itemFields, key, raw).map(lower);
  return ` Sections of the ${noun} were obscured by ${joinList(labels)}.`;
}

/**
 * Paving & Paths' own `defects` field (trip hazard / surface wear /
 * settlement) used to be run through `obstructionsSentence`, producing
 * nonsense like "Sections of the paving were obscured by surface wear" --
 * surface wear is a defect, not a physical object blocking a view of the
 * paving. This states it as what it is instead.
 */
function defectsSentence(itemFields: TemplateField[], inst: AnswerTree, key = "defects"): string {
  const raw = asStringArray(inst[key]);
  if (raw.length === 0) return "";
  const labels = optionLabels(itemFields, key, raw).map(lower);
  return ` ${capitalize(joinList(labels))} noted.`;
}

const driveway: Composer = (inst, itemFields) => {
  const location = optionLabel(itemFields, "location", asString(inst.location));
  const material = optionLabel(itemFields, "material", asString(inst.material));
  const condition = optionLabel(itemFields, "condition", asString(inst.condition));
  const parts: string[] = [];
  if (!inst.location && !inst.material) {
    parts.push("There is no driveway.");
  } else {
    const tag = conditionTag(itemFields, "condition", asString(inst.condition));
    if (tag) parts.push(tag);
    parts.push(
      `The driveway is to the ${lower(location)} of the block and is constructed of ${lower(material)}. It is in ${lower(condition)} condition with typical wear and tear.${obstructionsSentence(itemFields, inst, "driveway")}`,
    );
  }
  const damages = damageSentences(inst, itemFields, "damages");
  if (damages) parts.push(damages);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

const pavingPaths: Composer = (inst, itemFields) => {
  const name = asString(inst.name);
  const pathType = optionLabel(itemFields, "pathType", asString(inst.pathType));
  const condition = optionLabel(itemFields, "condition", asString(inst.condition));
  const where = name ? `to the ${lower(name)}` : "to the block";
  const parts: string[] = [];
  const pavingTag = conditionTag(itemFields, "condition", asString(inst.condition));
  if (pavingTag) parts.push(pavingTag);
  parts.push(
    `There is paving ${where}, constructed of ${lower(pathType)}. It is in ${lower(condition)} condition with typical wear and tear.${defectsSentence(itemFields, inst, "defects")}`,
  );
  const drainage = optionLabel(itemFields, "drainage", asString(inst.drainage));
  if (inst.drainage) {
    const drainageNote = asString(inst.drainageNote);
    parts.push(`Drainage is ${lower(drainage)}.${drainageNote ? ` ${drainageNote}` : ""}`);
  }
  const cracks = damageSentences(inst, itemFields, "cracks");
  if (cracks) parts.push(cracks);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

const fences: Composer = (inst, itemFields) => {
  const location = optionLabel(itemFields, "location", asString(inst.location));
  const structureType = optionLabel(itemFields, "structureType", asString(inst.structureType));
  const condition = optionLabel(itemFields, "condition", asString(inst.condition));
  const parts: string[] = [];
  const fenceTag = conditionTag(itemFields, "condition", asString(inst.condition));
  if (fenceTag) parts.push(fenceTag);
  parts.push(
    `The ${lower(location)} fence is constructed of ${lower(structureType)} and is in ${lower(condition)} condition with typical weathering.${obstructionsSentence(itemFields, inst, "fence")}`,
  );
  const cracks = damageSentences(inst, itemFields, "cracks");
  if (cracks) parts.push(cracks);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

const retainingWalls: Composer = (inst, itemFields) => {
  const location = optionLabel(itemFields, "location", asString(inst.location));
  const material = optionLabel(itemFields, "material", asString(inst.material));
  const condition = optionLabel(itemFields, "condition", asString(inst.condition));
  const parts: string[] = [];
  const wallTag = conditionTag(itemFields, "condition", asString(inst.condition));
  if (wallTag) parts.push(wallTag);
  parts.push(
    `There is a retaining wall to the ${lower(location)}, constructed of ${lower(material)}. It is in ${lower(condition)} condition with typical weathering.${obstructionsSentence(itemFields, inst, "wall")}`,
  );
  const cracks = damageSentences(inst, itemFields, "cracks");
  if (cracks) parts.push(cracks);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

const garageCarportSheds: Composer = (inst, itemFields) => {
  const name = asString(inst.name) || "structure";
  const position = optionLabel(itemFields, "position", asString(inst.position));
  const wall = optionLabels(itemFields, "wallConstruction", asStringArray(inst.wallConstruction)).map(lower);
  const roof = optionLabels(itemFields, "roofConstruction", asStringArray(inst.roofConstruction)).map(lower);
  const condition = optionLabel(itemFields, "condition", asString(inst.condition));
  const constructionBits: string[] = [];
  if (wall.length) constructionBits.push(joinList(wall));
  if (roof.length) constructionBits.push(`${article(roof[0])} ${joinList(roof)} roof`);
  const constructionText = constructionBits.length ? `, constructed of ${constructionBits.join(" with ")}` : "";
  const parts: string[] = [];
  const structureTag = conditionTag(itemFields, "condition", asString(inst.condition));
  if (structureTag) parts.push(structureTag);
  const lowerName = lower(name);
  parts.push(
    `There is ${article(lowerName)} ${lowerName} to the house${position ? ` at the ${lower(position)}` : ""}${constructionText}, and is generally in ${lower(condition)} state of repair.${obstructionsSentence(itemFields, inst, "structure")}`,
  );
  const damages = damageSentences(inst, itemFields, "damages");
  if (damages) parts.push(damages);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

const poolSpa: Composer = (inst, itemFields) => {
  const name = asString(inst.name) || "pool/spa";
  const poolType = optionLabel(itemFields, "poolType", asString(inst.poolType));
  const construction = optionLabels(itemFields, "construction", asStringArray(inst.construction)).map(lower);
  const condition = optionLabel(itemFields, "condition", asString(inst.condition));
  const fenceType = optionLabels(itemFields, "fenceType", asStringArray(inst.fenceType)).map(lower);
  const fenceSafety = optionLabel(itemFields, "fenceSafety", asString(inst.fenceSafety));
  const parts: string[] = [];
  const poolTag = conditionTag(itemFields, "condition", asString(inst.condition));
  if (poolTag) parts.push(poolTag);
  const lowerPoolName = lower(name);
  const lowerPoolType = lower(poolType);
  parts.push(
    `There is ${article(lowerPoolName)} ${lowerPoolName} located at the property${poolType ? `, ${article(lowerPoolType)} ${lowerPoolType}` : ""}${construction.length ? `, constructed of ${joinList(construction)}` : ""}, which is generally in ${lower(condition)} state of repair.${obstructionsSentence(itemFields, inst, "pool/spa area")}`,
  );
  if (fenceType.length || inst.fenceSafety) {
    parts.push(
      `The pool fence is constructed of ${fenceType.length ? joinList(fenceType) : "the surrounding boundary"} and appears to be ${lower(fenceSafety || "not observed")}.`,
    );
  }
  const damages = damageSentences(inst, itemFields, "damages");
  if (damages) parts.push(damages);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

const elevations: Composer = (inst, itemFields, label) => {
  const orientation = optionLabel(itemFields, "orientation", asString(inst.orientation));
  const condition = optionLabel(itemFields, "condition", asString(inst.condition));
  const hasDamage = yesNo(itemFields, inst, "hasDamage");
  const claddingObs = optionLabels(itemFields, "claddingObs", asStringArray(inst.claddingObs)).map(lower);
  const windowDoorObs = optionLabels(itemFields, "windowDoorObs", asStringArray(inst.windowDoorObs)).map(lower);
  const parts: string[] = [];
  const elevationTag = conditionTag(itemFields, "condition", asString(inst.condition));
  if (elevationTag) parts.push(elevationTag);
  parts.push(
    `The ${lower(label)} elevation${orientation ? ` generally faces ${lower(orientation)}` : ""}. It is in ${lower(condition)} condition. There ${hasDamage ? "were" : "were no"} signs of notable damage.${
      claddingObs.length ? ` ${capitalize(joinList(claddingObs))} noted to the cladding.` : ""
    }${windowDoorObs.length ? ` ${capitalize(joinList(windowDoorObs))} noted to windows/doors.` : ""}`,
  );
  const damages = damageSentences(inst, itemFields, "damages");
  if (damages) parts.push(damages);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

const roofChimneys: Composer = (inst, itemFields, label) => {
  const accessibility = optionLabels(itemFields, "accessibility", asStringArray(inst.accessibility)).map(lower);
  const coveringType = optionLabels(itemFields, "coveringType", asStringArray(inst.coveringType)).map(lower);
  const condition = optionLabel(itemFields, "generalCondition", asString(inst.generalCondition));
  const observations = optionLabels(itemFields, "generalObservations", asStringArray(inst.generalObservations)).map(lower);
  const parts: string[] = [];
  const roofTag = conditionTag(itemFields, "generalCondition", asString(inst.generalCondition));
  if (roofTag) parts.push(roofTag);
  parts.push(
    `The ${lower(label)} appears to be in ${lower(condition)} condition${coveringType.length ? `, constructed of ${joinList(coveringType)}` : ""}.${
      accessibility.length ? ` Comments are based on ${joinList(accessibility)}.` : ""
    }${observations.length ? ` ${capitalize(joinList(observations))} noted.` : ""}`,
  );
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

const internalAreas: Composer = (inst, itemFields, label) => {
  const condition = optionLabel(itemFields, "generalCondition", asString(inst.generalCondition));
  const hasDamage = yesNo(itemFields, inst, "hasDamage");
  const moisture = optionLabels(itemFields, "moistureObservations", asStringArray(inst.moistureObservations)).map(lower);
  const parts: string[] = [];
  // Room name as its own bold heading (see ReportSection.tsx's "ROOMHEAD::"
  // handling), matching the reference report's "Bedroom 4" / "Bathroom"
  // style -- rather than folding the name into the sentence itself
  // ("Bedroom 4 is in..."), which is what every other section here still
  // does (there, the category heading above already names the item, so
  // there's no redundant second name needed the way there is for a whole
  // floor of differently-named rooms).
  parts.push(`ROOMHEAD::${label}`);
  const roomTag = conditionTag(itemFields, "generalCondition", asString(inst.generalCondition));
  if (roomTag) parts.push(roomTag);
  parts.push(
    `It is in ${lower(condition)} condition. There ${hasDamage ? "were" : "were no"} signs of notable damage.${obstructionsSentence(itemFields, inst, "room", "obstruction")}${
      moisture.length ? ` ${capitalize(joinList(moisture))} noted.` : ""
    }`,
  );
  const damages = damageSentences(inst, itemFields, "damages");
  if (damages) parts.push(damages);
  const notes = asString(inst.notes);
  if (notes) parts.push(withPeriod(notes));
  return parts.join("\n\n");
};

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
  const constructionType = optionLabel(itemFields, "constructionIs", asString(inst.constructionIs));
  const streetFrontage = optionLabel(itemFields, "streetFrontage", asString(inst.streetFrontage));
  const blockSlope = optionLabel(itemFields, "blockSlope", asString(inst.blockSlope));
  const constructedYear = asString(inst.constructedYear);
  const underConstructionStage = asString(inst.underConstructionStage);
  const wallGround = optionLabels(itemFields, "wallCladdingGround", asStringArray(inst.wallCladdingGround)).map(lower);
  const wallFirst = optionLabels(itemFields, "wallCladdingFirst", asStringArray(inst.wallCladdingFirst)).map(lower);
  const foundations = optionLabel(itemFields, "foundations", asString(inst.foundations));
  const roofDesign = optionLabel(itemFields, "roofDesign", asString(inst.roofDesign));
  const roofCovering = optionLabels(itemFields, "roofCovering", asStringArray(inst.roofCovering)).map(lower);
  const windows = optionLabels(itemFields, "windows", asStringArray(inst.windows)).map(lower);

  const parts: string[] = [];

  const frontageBlockBits: string[] = [];
  if (streetFrontage) frontageBlockBits.push(`facing ${lower(streetFrontage)}`);
  if (blockSlope) frontageBlockBits.push(`on a ${lower(blockSlope)} block of land`);
  const ageBit = constructedYear
    ? `estimated to have been constructed around ${constructedYear}`
    : underConstructionStage
      ? `currently under construction at ${lower(underConstructionStage)} stage`
      : "";
  const openingClauses = [frontageBlockBits.join(" "), ageBit].filter(Boolean);
  if (constructionType || openingClauses.length) {
    const lowerConstructionType = lower(constructionType);
    const subject = constructionType
      ? `The property is ${article(lowerConstructionType)} ${lowerConstructionType}`
      : "The property is";
    parts.push(openingClauses.length ? `${subject}, ${joinClauses(openingClauses)}.` : `${subject}.`);
  }

  const wallsBit = wallGround.length
    ? `${joinList(wallGround)} walls${wallFirst.length ? ` to the ground floor and ${joinList(wallFirst)} to the first floor` : ""}`
    : wallFirst.length
      ? `${joinList(wallFirst)} walls`
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
    const note = asString(inst.note);
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
 * (no driveway, no pool, ...) has zero recorded instances -- matching the
 * reference template's own "There is no driveway." convention instead of
 * leaving the section blank (which otherwise reads as an incomplete
 * inspection rather than a reported fact). Only sections backed by a plain
 * user-addable list (not elevations/roof/internal-areas, whose fixed
 * instances always exist -- see templateFields.ts's resolveInstances) ever
 * hit zero instances, so this only needs to cover those.
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
