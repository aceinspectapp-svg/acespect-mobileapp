// pre_purchase / commercial_properties -- this report type's wording.
//
// The office template is "ACESPECT_Building_Pre-Purchase_House_and_Commercial_Nov_2026.dotm" (shared with House, whose report keeps its
// own wording: pre_purchase.residential_house.ts is not used here). Each section is written from the template, element by element, in
// the template's order and under the template's headings (`sectionText`):
//   - each element's template sentences, word for word, each blank filled from the Commercial form's matching question. A sentence
//     with a blank no question answers is left out whole -- never a blank, never a guess. The template's admin notes are never printed;
//   - then the element's Observations and Comments, as sentences; then its defects (each with its photos), its photos, and the
//     template's standard paragraphs for that element;
//   - an element answered "Not applicable", or not answered at all, prints nothing;
//   - "PART::<heading>" marks where each of the template's headings starts; the report places each part under ROOF, EXTERNAL or
//     INTERNAL in the template's order (PrePurchaseReport.tsx) -- so the roof space (underside, sarking, frame, insulation) prints under
//     INTERNAL although the form asks about it with the roof;
//   - INTERNAL has no rooms: a Warehouse & Production or Offices & Staff Facilities area's defects are printed under the element they
//     are recorded against ("At the Warehouse, there is ..."), by the defect's "Element" answer. An area's own overall sentence has no
//     place in the template and is not printed. A defect whose element names no template element, and an area's own notes, moisture
//     observations and photos, print at the end of INTERNAL (COMMERCIAL_UNPLACED) until the office says where they belong.
// The rest is as before: a list of sentences prints one bullet per sentence, "noted" is said once, no full stop after a stop, and an
// element's "Applicability" is never printed as a line.
import type { AnswerTree, TemplateField } from "../templateFields";
import { asString, asStringArray, INSTANCE_KEY, isGateSatisfied, otherAnswerText, resolveInstances, withPeriod } from "../templateFields";
import { article, capitalize, conditionOf, damageSentences, isNotPresent, lower, typedCase } from "./shared";
import { provisionalWording } from "./provisional";
import { listLine, moistureSentence, NO_MOISTURE, tidyFullStops } from "./pre_purchase.apartment";
import type { ReportWording } from "./types";
import { PPI_POOL_SPA_TEXT } from "../prepurchase/scopeText";

const base = provisionalWording({ inspectionType: "pre_purchase", propertyType: "commercial_properties" });

/** Each section's "Applicability" questions (the form's own keys). */
export const APPLICABILITY_FIELDS: Record<string, string[]> = {
  driveway: ["pp_driveway_applicability"],
  paving_paths: ["pp_paving_applicability"],
  fences: ["pp_fences_applicability"],
  retaining_walls: ["pp_retaining_applicability"],
  garage_carport_sheds: ["sheds_applicability", "garage_applicability", "carport_applicability", "studio_applicability", "grannyflat_applicability"],
  elevations: ["cladding_applicability", "subfloor_applicability", "extstairs_applicability", "balconies_applicability", "verandah_applicability", "alfresco_applicability", "pool_applicability"],
  roof_chimneys: [
    "eaves_applicability", "fascia_applicability", "gables_applicability", "flashings_applicability", "guttersvalleys_applicability", "chimneys_applicability",
    "roofcavity_applicability", "sarking_applicability", "roofframe_applicability", "insulation_applicability",
  ],
  internal_areas: ["partywalls_applicability", "intstairs_applicability", "gas_applicability", "fireplace_applicability"],
  pool_spa: ["pool_applicability"],
};

/** "No defects noted noted to windows/doors" -> "No defects noted to windows/doors": a sentence's "... noted" after a choice that already ends with "noted". */
export const notedOnce = (text: string): string => text.replace(/\b(noted)(?:\s+noted\b)+/gi, "$1");

// ---------------------------------------------------------------------------------------------------------------------------------
// The template's headings, in its order.

export const COMMERCIAL_ROOF_PARTS = ["Roof Covering", "Eaves", "Fascias", "Gables", "Flashings", "Valleys/Gutters", "Downpipes", "Chimney"];
export const COMMERCIAL_EXTERNAL_PARTS = [
  "Walls", "Cladding", "Sub-Floor", "Lintels", "Windows/Window Frames", "Front Door / Door Frames", "Other External Doors", "Stairs", "Balconies",
  "Verandah or Front Porch or Decking", "Alfresco or Pergola", "Pool/Spa", "Sheds", "Carport/Garage", "Studio", "Granny Flat", "Driveway",
  "External Paving", "Fences", "Retaining Walls", "Trees",
];
/** The roof space: asked with the roof, printed under INTERNAL (as the template has it). */
export const COMMERCIAL_ROOF_SPACE_PARTS = ["Roof Covering (underside)", "Sarking", "Roof Frame", "Ceiling Insulation"];
export const COMMERCIAL_INTERNAL_PARTS = [
  ...COMMERCIAL_ROOF_SPACE_PARTS, "Party Walls", "Ceilings", "Walls", "Floors", "Stairs", "Windows", "Doors", "Cabinets", "Plumbing", "Gas",
  "Fireplace / Heater", "Electrical",
];
/** The part, at the end of INTERNAL with no heading of its own, holding what the template has no place for (see the top of this file). */
export const COMMERCIAL_UNPLACED = "~unplaced";

/** The template's sentence at the top of INTERNAL. */
export const COMMERCIAL_INTERNAL_INTRO =
  "The inspector cannot see behind nor move furniture, nor concealed or obstructed areas such as stored goods in cupboards, inside walls, between floors, in roof cavities where there is no manhole, no safe access, or it is a flat roof design.";

// The template's standard paragraphs, word for word.
const STD = {
  roofTiles:
    "There may be damage to roof tiles to sections that could not be observed safely from a ladder, nor from the ground. Recommend engaging a licensed plumber with safety gear to check the entire roof and gutters to provide advice on any items needing repair or replacement.",
  roofMaterials: [
    "The materials of roofing, flashing, gutters and downpipes will be affected by weathering and normal deterioration over time. Minor deterioration at the time of inspection or not readily apparent due to limited safe access to roofing may become worse during the purchase settlement period (typically 1-3 months) or in the near future. The property owner is advised to plan for regular maintenance and upkeep of the roof and all components of external plumbing.",
    "Roof coverings are inspected from a ladder wherever reasonably possible and safe to do so. OH&S requirements prohibit inspectors from climbing from a ladder onto a roof – due to the high risk of falls and injury. Inspectors cannot walk on roof coverings, especially tiles, in case they cause damage.",
    "It is recommended that roof coverings, ridges and cappings are checked by suitably qualified trades such as a licensed plumber. Roof coverings, flashings, gutters and downpipes should be regularly checked and cleaned as part of the owners maintenance plan.",
  ],
  gutters:
    "Roof guttering and downpipes can be blocked by tree litter during strong winds or storms, which may result in rainwater overflowing into the structure. Gutters may become blocked during the weeks or months between purchasing a property and taking possession of the property, and it is recommended that roof gutters be cleaned regularly.",
  downpipes:
    "Horizontal sections of the downpipes will deteriorate faster than the vertical sections if water is allowed to pond. It is recommended that downpipes be cleaned regularly, and are attached to either the stormwater system or a rainwater storage tank.",
  chimneySweep: "It is recommended that before lighting a fire in the fireplace, a professional chimney sweep inspects the fireplace.",
  underside:
    "The underside of the roof was inspected from the manhole and only limited sections within the vicinity of the manhole could be observed. Inspectors cannot climb around a roof cavity at a pre-purchase inspection due to safety reasons and in case they cause damage should they slip and put a foot through a ceiling.",
  sarking:
    "The sarking was checked from the manhole and only limited sections within the vicinity of the manhole could be observed. Inspectors cannot climb around a roof cavity at a pre-purchase inspection due to safety reasons and in case they cause damage should they slip and put a foot through a ceiling.",
  roofFrame:
    "The roof frame was inspected from the manhole and only limited sections within the vicinity of the manhole could be observed. Inspectors cannot climb around a roof cavity at a pre-purchase inspection due to safety reasons and in case they cause damage should they slip and put a foot through a ceiling.",
  noManhole: "Roof cavity not accessible due to no manhole.",
  wallsMovement:
    "There is some movement in the foundations which is causing mortar and brickwork to crack. It is unlikely to become significantly worse if left untouched, however monitor the cracking to brickwork from time to time or patch if required.",
  wallsMaterials:
    "The materials of walls and cladding will be affected by weathering and normal deterioration and movement over time. Minor cracking to brickwork or cement sheets or decay to timber cladding or weathering of paint that is minor at the time of inspection or not readily apparent, may become evident during the purchase settlement period (typically 1 to 3 months) or in the near future. The property owner is advised to plan for regular maintenance and upkeep of all components of the building.",
  subfloorAccess: "It is recommended that access points be improved to the sub-floor to facilitate any future maintenance or repairs.",
  subfloorDebris: "It is recommended that debris be removed from the sub-floor area to reduce the risk of pest infestation.",
  lintels: "Lintels should be kept in good condition to avoid costly repairs.",
  safetyGlass:
    "Current Building Codes require that safety glass be installed in windows and doors in close proximity to the floor. Houses built prior to the 1980s did not have this requirement. It is recommended to bring the safety issue up to current standards, if applicable.",
  externalStructures:
    "External structures, especially timber structures exposed to weather elements will deteriorate over time and need to be assessed and maintained regularly. Timber decay may not be apparent at the time of inspection. If you have any further concerns we recommend you consult a structural engineer.",
  plumbingLeaks: "A licensed plumber may need to be engaged to identify the source of the water and advise on appropriate repairs.",
  plumbing: "As the Houspect Building Inspector is not a licensed plumber, the comments are observations by the inspector only.",
  gas:
    "As the Houspect Building Inspector is not a licensed gas fitter technician, the comments are general observations by the inspector only. Gas leaks cannot be detected when the gas supply is turned off, and may not be apparent if appliances are not in use at the time of inspection. A gas leak may become evident after the gas supply is turned back on to a property that has been left vacant and when disused appliances are put back into operation. It is recommended that all gas connections and appliances be checked by a licensed gas fitter/plumber, with a schedule of regular servicing and maintenance.",
  electrical:
    "As the Houspect Building Inspector is not a licensed electrician, the comments are observations by the inspector only. It is recommended that all electrical wiring and circuits be checked by a licensed electrician, including RCD protection and hard-wired smoke detectors.",
  councilApproval:
    "The inspector recommends if the property has renovations or extensions, that you confirm if they have been approved by the local council. Renovations or extensions require a building permit and should have a transferable structural building warranty.",
} as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading the answers.

type Fields = TemplateField[];
const fieldOf = (fields: Fields, key: string) => fields.find((f) => f.key === key);

/** The answer's words mid-sentence ("Colorbond", "timber"), what was typed for an "Other", or "" when unanswered. */
function word(fields: Fields, a: AnswerTree, key: string): string {
  const raw = asString(a[key]).trim();
  if (!raw) return "";
  const typed = otherAnswerText(raw);
  if (typed !== undefined) return typed.trim() ? typedCase(typed.trim()) : "";
  const f = fieldOf(fields, key);
  if (!f?.options?.length) return typedCase(raw); // a typed answer
  const option = f.options.find((o) => o.value === raw);
  return option ? lower(option.label) : "";
}

/** One of `choices` by the stored value ("" for an answer the template has no word for, or none). */
const pick = (a: AnswerTree, key: string, choices: Record<string, string>): string => choices[asString(a[key])] ?? "";
const yn = (a: AnswerTree, key: string, yes: string, no: string): string => (asString(a[key]) === "yes" ? yes : asString(a[key]) === "no" ? no : "");
/** The grade's word ("satisfactory", "fair", ...), or "". */
const grade = (fields: Fields, a: AnswerTree, key: string): string => (asString(a[key]) ? conditionOf(fields, a, [key]).word : "");
/** Is the element assessed? (No "Applicability" question: assessed.) */
const assessed = (a: AnswerTree, key?: string): boolean => !key || asString(a[key]) === "applicable";
const ticked = (a: AnswerTree, key: string): string[] => asStringArray(a[key]);
/** A checklist the inspector went through: a choice not ticked was not seen. */
const answered = (a: AnswerTree, key: string): boolean => ticked(a, key).length > 0;
const all = (...parts: string[]) => parts.every(Boolean);

/** An observation that is an instruction to the inspector, not a finding ("If nil RCDs, add to safety matters"). */
const INSTRUCTION = /^(if\b|add to safety matters\.?$)|confirm "/i;

/** The element's ticked observations as sentences (without `skip`, which the element's own sentences already say). */
function observations(fields: Fields, a: AnswerTree, key: string, skip: string[] = []): string {
  const f = fieldOf(fields, key);
  const out: string[] = [];
  for (const raw of ticked(a, key)) {
    if (skip.includes(raw)) continue;
    const typed = otherAnswerText(raw);
    if (typed !== undefined) {
      if (typed.trim()) out.push(capitalize(withPeriod(typed.trim())));
      continue;
    }
    const label = f?.options?.find((o) => o.value === raw)?.label;
    if (!label || INSTRUCTION.test(label)) continue;
    out.push(capitalize(withPeriod(label.replace(/\s*[–-]\s*(add to|refer to) safety matters\.?$/i, "").trim())));
  }
  return out.join(" ");
}

/** What the inspector typed, as a sentence. */
const typedText = (a: AnswerTree, key: string): string => {
  const t = asString(a[key]).replace(/\s*\n+\s*/g, " ").trim();
  return t ? withPeriod(t) : "";
};

/** Typed words put after "At the ...,": their first letter in lower case, unless it starts a name or an acronym. */
const afterComma = (t: string): string => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

// ---------------------------------------------------------------------------------------------------------------------------------
// The defects, numbered as the report's defect list has them (so each sentence prints its own photos).

interface Ctx {
  fields: Fields;
  a: AnswerTree;
  /** "<area key>|<damage list key>" -> where that list's defects start in the section's defect list. */
  at: Map<string, number>;
  /** False when the numbering could not be matched to the section's defect list: sentences then carry no number (photos print after). */
  tagged: boolean;
}

/** The section's defect lists in the order the report's defect list holds them (templateFields.ts `walk`). */
export function defectOrder(fields: Fields, answers: AnswerTree): { at: Map<string, number>; list: AnswerTree[] } {
  const at = new Map<string, number>();
  const list: AnswerTree[] = [];
  const visit = (fs: Fields, scope: AnswerTree, area: string, top: boolean) => {
    for (const f of fs) {
      if (!isGateSatisfied(f, scope)) continue;
      if (f.type === "damage-list") {
        at.set(`${area}|${f.key}`, list.length);
        for (const { scope: d } of resolveInstances(f, scope[f.key])) list.push(d);
      } else if (f.type === "repeating-group") {
        for (const item of resolveInstances(f, scope[f.key])) {
          if (top && isNotPresent(item.scope)) continue; // the report leaves out the defects of an item marked not present
          visit(f.itemFields ?? [], item.scope, item.key ?? item.label, false);
        }
      }
    }
  };
  visit(fields, answers, "", true);
  return { at, list };
}

function context(fields: Fields, answers: AnswerTree, damages: { notes: string; photos: string[] }[]): Ctx {
  const { at, list } = defectOrder(fields, answers);
  const same = list.length === damages.length && list.every((d, i) => asString(d.notes) === damages[i]!.notes && JSON.stringify(asStringArray(d.photos)) === JSON.stringify(damages[i]!.photos));
  return { fields, a: answers, at, tagged: same };
}

/** The defects of one damage list, each "DEFECT::<n>::<sentence>" (optionally one defect only, and with the place said as `where`). */
function defects(ctx: Ctx, owner: Fields, scope: AnswerTree, key: string, opts: { area?: string; only?: number; where?: string } = {}): string[] {
  const f = fieldOf(owner, key);
  if (!f || !isGateSatisfied(f, scope)) return [];
  const list = Array.isArray(scope[key]) ? (scope[key] as AnswerTree[]) : [];
  const start = ctx.at.get(`${opts.area ?? ""}|${key}`) ?? 0;
  const out: string[] = [];
  list.forEach((d, j) => {
    if (opts.only !== undefined && opts.only !== j) return;
    const one = opts.where !== undefined ? { ...d, location: opts.where } : d;
    const text = damageSentences({ [key]: [one] } as unknown as AnswerTree, owner, { key, indexOffset: start + j });
    if (text) out.push(ctx.tagged ? text : text.replace(/DEFECT::\d+::/g, ""));
  });
  return out;
}

/** "PHOTOS::<key>" for an answer's photos (or the photos themselves, for an item inside a list). */
const photosOf = (a: AnswerTree, key: string): string[] => (ticked(a, key).length ? [`PHOTOS::${key}`] : []);
const photoList = (urls: string[]): string[] => (urls.length ? [`PHOTOS::${urls.join(",")}`] : []);

// ---------------------------------------------------------------------------------------------------------------------------------
// One element: its heading, its sentences, then observations, comments, defects, photos, standard paragraphs.

interface Element {
  title: string;
  /** The element's template sentences (one paragraph). */
  sentences: string[];
  /** Template paragraphs right after its sentences. */
  after?: string[];
  observations?: string;
  comments?: string;
  defects?: string[];
  photos?: string[];
  /** More found elsewhere (an elevation's or an area's), printed after the element's own. */
  more?: string[];
  /** The template's standard paragraphs, after everything else -- printed only when the element has something of its own. */
  standard?: string[];
}

function element(e: Element): string {
  const main = e.sentences.filter(Boolean).join(" ");
  const own = [main, ...(e.after ?? []), e.observations ?? "", e.comments ?? "", ...(e.defects ?? []), ...(e.photos ?? []), ...(e.more ?? [])].filter(Boolean);
  if (!own.length) return "";
  return [`PART::${e.title}`, ...own, ...(e.standard ?? [])].join("\n\n");
}

const join = (blocks: string[]) => blocks.filter(Boolean).join("\n\n");

// ---------------------------------------------------------------------------------------------------------------------------------
// ROOF (and the roof space, printed under INTERNAL).

function roof(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  const cov = word(F, a, "roofcov_covering"), covCond = grade(F, a, "roofcov_condition");
  const covReq = pick(a, "roofcov_requires", { item0: "it does not", item1: "some items", item2: "it does" });
  const covSentences = [cov ? `The roof covering is constructed of ${cov} material.` : "", all(covCond, covReq) ? `The condition of the covering appears to be ${covCond} in relation to its age and ${covReq} require attention.` : ""];
  // "The ridges and capping are in [...] condition.": no question asks it (the form asks the covering's condition only).
  const covered = covSentences.some(Boolean);
  const covering = element({
    title: "Roof Covering",
    sentences: [...covSentences, covered ? "Consult a licensed plumber." : ""],
    after: covered ? [STD.roofTiles] : [],
    observations: observations(F, a, "roofcov_checks0"),
    comments: typedText(a, "roofcov_comments"),
    defects: defects(ctx, F, a, "roofcov_damages"),
    photos: photosOf(a, "roofcov_photos"),
    standard: [...STD.roofMaterials],
  });

  const eavesReq = pick(a, "eaves_requires", { item0: "do", item1: "do", item2: "do not" });
  const eaves = !assessed(a, "eaves_applicability") ? "" : element({
    title: "Eaves",
    sentences: [
      word(F, a, "eaves_material") ? `The eaves are ${word(F, a, "eaves_material")}.` : "",
      all(grade(F, a, "eaves_condition"), eavesReq) ? `They are in ${grade(F, a, "eaves_condition")} condition and ${eavesReq} require attention.` : "",
    ],
    observations: observations(F, a, "eaves_checks0"),
    comments: typedText(a, "eaves_comments"),
    defects: defects(ctx, F, a, "eaves_damages"),
    photos: photosOf(a, "eaves_photos"),
  });

  const fasciaReq = yn(a, "fascia_requiresAttention", "do", "do not");
  const fascias = !assessed(a, "fascia_applicability") ? "" : element({
    title: "Fascias",
    sentences: [
      all(word(F, a, "fascia_finish"), word(F, a, "fascia_material")) ? `The fascias are ${word(F, a, "fascia_finish")} and constructed of ${word(F, a, "fascia_material")}.` : "",
      all(grade(F, a, "fascia_condition"), fasciaReq) ? `They are in ${grade(F, a, "fascia_condition")} condition and ${fasciaReq} require attention.` : "",
    ],
    observations: observations(F, a, "fascia_checks0"),
    comments: typedText(a, "fascia_comments"),
    defects: defects(ctx, F, a, "fascia_damages"),
    photos: photosOf(a, "fascia_photos"),
  });

  const painted = yn(a, "gables_painted", "painted", "unpainted");
  const gables = !assessed(a, "gables_applicability") ? "" : element({
    title: "Gables",
    // "They are in ... condition and [do not] require attention.": no question asks whether the gables need attention.
    sentences: [all(painted, word(F, a, "gables_material")) ? `The gables are ${painted} and constructed of ${word(F, a, "gables_material")}.` : ""],
    observations: observations(F, a, "gables_checks0"),
    comments: typedText(a, "gables_comments"),
    defects: defects(ctx, F, a, "gables_damages"),
    photos: photosOf(a, "gables_photos"),
  });

  const flashings = !assessed(a, "flashings_applicability") ? "" : element({
    title: "Flashings",
    // The upper-flashings sentence, "Lower level flashings are in ... and [do not] require attention." and "Consult a licensed plumber."
    // ([Remove if not required]) have no question.
    sentences: [word(F, a, "flashings_material") ? `The flashings are constructed of ${word(F, a, "flashings_material")}.` : ""],
    observations: observations(F, a, "flashings_checks0"),
    comments: typedText(a, "flashings_comments"),
    defects: defects(ctx, F, a, "flashings_damages"),
    photos: photosOf(a, "flashings_photos"),
  });

  const gutterNoun = pick(a, "guttersvalleys_gutterType", { item1: "boxed gutters", item2: "perimeter and boxed gutters" }) || "perimeter gutters";
  const gutterReq = pick(a, "guttersvalleys_requires", { item0: "require attention", item1: "require attention", item2: "require normal maintenance", item3: "do not require attention" });
  const gMat = word(F, a, "guttersvalleys_material"), gCond = grade(F, a, "guttersvalleys_condition");
  const hasValleys = !!asString(a.guttersvalleys_valleys) && asString(a.guttersvalleys_valleys) !== "item0";
  const vMat = hasValleys ? word(F, a, "guttersvalleys_valleys") : "", vCond = grade(F, a, "guttersvalleys_valleysCondition");
  const gutters = !assessed(a, "guttersvalleys_applicability") ? "" : element({
    title: "Valleys/Gutters",
    sentences: [
      all(gMat, gCond, gutterReq) ? `The ${gutterNoun} are constructed of ${gMat} and are in ${gCond} condition and ${gutterReq}.` : "",
      all(vMat, vCond) ? `Valleys are constructed of ${vMat} and are in ${vCond} condition.` : "",
    ],
    observations: observations(F, a, "guttersvalleys_checks0"),
    comments: typedText(a, "guttersvalleys_comments"),
    defects: [...defects(ctx, F, a, "guttersvalleys_damages"), ...defects(ctx, F, a, "guttersvalleys_valleys_damages")],
    photos: photosOf(a, "guttersvalleys_photos"),
    standard: [STD.gutters],
  });

  const dpMat = word(F, a, "downpipes_material"), dpCond = grade(F, a, "downpipes_condition");
  const dpReq = pick(a, "downpipes_requires", { item0: "require", item1: "require", item2: "require", item3: "do not require", item4: "do not require" });
  const dpSentences = [all(dpMat, dpCond) ? `The downpipes are fabricated of ${dpMat} material and are in ${dpCond} condition.` : "", dpReq ? `They ${dpReq} repairs.` : ""];
  const downpipes = element({
    title: "Downpipes",
    sentences: [...dpSentences, dpSentences.some(Boolean) ? "Ensure downpipes are cleaned of tree litter regularly to avoid storm water overflows." : ""],
    observations: observations(F, a, "downpipes_checks0"),
    comments: typedText(a, "downpipes_comments"),
    defects: defects(ctx, F, a, "downpipes_damages"),
    photos: photosOf(a, "downpipes_photos"),
    standard: [STD.downpipes],
  });

  const chType = word(F, a, "chimneys_type").replace(/ and okay$/, ""), chCond = grade(F, a, "chimneys_condition");
  const chOp = yn(a, "chimneys_operating", "was operating", "was not operating");
  const chimney = !assessed(a, "chimneys_applicability") ? "" : element({
    title: "Chimney",
    sentences: [all(chType, chCond) ? `The chimney is constructed of ${chType} and is in ${chCond} structural condition.` : "", chOp ? `It ${chOp} at the time of inspection.` : ""],
    observations: observations(F, a, "chimneys_checks0"),
    comments: typedText(a, "chimneys_comments"),
    defects: defects(ctx, F, a, "chimneys_damages"),
    photos: photosOf(a, "chimneys_photos"),
    standard: [STD.chimneySweep],
  });

  return join([covering, eaves, fascias, gables, flashings, gutters, downpipes, chimney, roofSpace(ctx)]);
}

function roofSpace(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  const noManhole = asString(a.roofcavity_applicability) === "na-manhole";
  const failure = yn(a, "roofcavity_failureIndications", "some", "no");
  const underside = assessed(a, "roofcavity_applicability")
    ? element({
        title: "Roof Covering (underside)",
        sentences: [
          grade(F, a, "roofcavity_condition") ? `The underside of the roof appears to be in ${grade(F, a, "roofcavity_condition")} condition.` : "",
          failure ? `To sections observed from the manhole, there are ${failure} points to indicate the failure of the covering surface. Consult a licensed plumber.` : "",
        ],
        observations: observations(F, a, "roofcavity_checks0"),
        comments: typedText(a, "roofcavity_comments"),
        defects: defects(ctx, F, a, "roofcavity_damages"),
        photos: photosOf(a, "roofcavity_photos"),
        standard: [STD.underside],
      })
    : noManhole ? element({ title: "Roof Covering (underside)", sentences: [STD.noManhole] }) : "";

  const sarkingAnswer = asString(a.sarking_applicability);
  const sarking = sarkingAnswer === "applicable"
    ? element({
        title: "Sarking",
        sentences: [yn(a, "sarking_effective", "Sarking is in place and appears to be effective.", "Sarking is in place and appears to be not effective.")],
        comments: typedText(a, "sarking_comments"),
        photos: photosOf(a, "sarking_photos"),
        standard: [STD.sarking],
      })
    : sarkingAnswer === "na-none" ? element({ title: "Sarking", sentences: ["Sarking is not in place."] }) : "";

  const frameType = pick(a, "roofframe_frameType", { item0: "stick", item1: "truss", item4: "stick and truss" });
  const support = yn(a, "roofframe_supportAdequate", "adequate", "inadequate");
  const frame = assessed(a, "roofframe_applicability")
    ? element({
        title: "Roof Frame",
        // "The roof frame is constructed of ... and was inspected from the [location] manhole.": no question asks where the manhole is.
        sentences: [all(frameType, support) ? `It is a conventional ${frameType} construction and the support system appears to be ${support}.` : ""],
        observations: observations(F, a, "roofframe_checks0"),
        comments: typedText(a, "roofframe_comments"),
        photos: photosOf(a, "roofframe_photos"),
        standard: [STD.roofFrame],
      })
    : noManhole ? element({ title: "Roof Frame", sentences: [STD.noManhole] }) : "";

  const inPlace = pick(a, "insulation_visibility", { item0: "is", item2: "is" });
  const effective = yn(a, "insulation_effective", "is", "is not");
  const insulation = assessed(a, "insulation_applicability")
    ? element({
        title: "Ceiling Insulation",
        sentences: [all(inPlace, effective) ? `Insulation ${inPlace} in place and ${effective} considered effective.` : ""],
        observations: observations(F, a, "insulation_checks0"),
        comments: typedText(a, "insulation_comments"),
        photos: photosOf(a, "insulation_photos"),
      })
    : noManhole ? element({ title: "Ceiling Insulation", sentences: [STD.noManhole] }) : "";

  return join([underside, sarking, frame, insulation]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// EXTERNAL.

/** Which External element an elevation's defect is recorded against, by its "Element" answer (the walls when it names none). */
export function externalElementOf(text: string): string {
  const t = text.toLowerCase();
  if (/front door/.test(t)) return "Front Door / Door Frames";
  if (/window|glazing|glass|pane/.test(t)) return "Windows/Window Frames";
  if (/door/.test(t)) return "Other External Doors";
  if (/lintel/.test(t)) return "Lintels";
  if (/clad/.test(t)) return "Cladding";
  if (/stair|step/.test(t)) return "Stairs";
  return "Walls";
}

function elevations(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  // What each elevation adds to the elements (the template has no elevations of its own).
  const more = new Map<string, string[]>();
  const add = (title: string, ...paras: string[]) => more.set(title, [...(more.get(title) ?? []), ...paras.filter(Boolean)]);
  const sidesField = fieldOf(F, "sides");
  if (sidesField && isGateSatisfied(sidesField, a)) {
    const itemFields = sidesField.itemFields ?? [];
    for (const item of resolveInstances(sidesField, a.sides)) {
      const s = item.scope;
      if (isNotPresent(s)) continue;
      const side = `${item.label.toLowerCase()} elevation`;
      const cladding = observationWords(itemFields, s, "claddingObs");
      if (cladding) add("Cladding", `${capitalize(cladding)} noted to the ${side}.`);
      const windows = observationWords(itemFields, s, "windowDoorObs");
      if (windows) add("Windows/Window Frames", `${capitalize(windows)} noted to the windows and doors at the ${side}.`);
      const notes = typedText(s, "notes");
      if (notes) add("Walls", `At the ${side}, ${afterComma(notes)}`);
      const list = isGateSatisfied(fieldOf(itemFields, "damages") ?? ({} as TemplateField), s) && Array.isArray(s.damages) ? (s.damages as AnswerTree[]) : [];
      list.forEach((d, j) => {
        const loc = asString(d.location).trim();
        // A location that already names the side ("Front (east) elevation, office extension") is said as typed.
        const where = !loc ? side : new RegExp(`\\b${item.label}\\b`, "i").test(loc) ? loc : `${side} (${loc})`;
        add(externalElementOf(asString(d.element)), ...defects(ctx, itemFields, s, "damages", { area: item.key ?? item.label, only: j, where }));
      });
      add("Walls", ...photoList(asStringArray(s.photos)));
    }
  }

  const wMat = word(F, a, "extwalls_material"), wCond = grade(F, a, "extwalls_condition");
  const cracking = asString(a.extwalls_majorCracking), weathering = asString(a.extwalls_sigWeathering);
  const signs = cracking === "yes" && weathering === "yes" ? "are signs of significant cracking and significant weathering"
    : cracking === "no" && weathering === "no" ? "are no signs of significant cracking or significant weathering"
    : cracking === "yes" ? "are signs of significant cracking" : weathering === "yes" ? "are signs of significant weathering" : "";
  const minorCracking = ticked(a, "extwalls_checks0").includes("item0");
  const walls = element({
    title: "Walls",
    sentences: [
      all(wMat, wCond) ? `The external walls are constructed of ${wMat} material and are in ${wCond} condition in relation to their age.` : "",
      signs ? `To sections observed there ${signs}.` : "",
      yn(a, "extwalls_generallyStable", "The walls are considered generally stable.", "The walls are not considered generally stable."),
    ],
    observations: [observations(F, a, "extwalls_checks0"), observations(F, a, "extwalls_checks1")].filter(Boolean).join(" "),
    comments: typedText(a, "extwalls_comments"),
    defects: defects(ctx, F, a, "extwalls_damages"),
    photos: photosOf(a, "extwalls_photos"),
    more: [...(more.get("Walls") ?? []), minorCracking ? STD.wallsMovement : ""],
    standard: [STD.wallsMaterials],
  });

  const cladding = !assessed(a, "cladding_applicability") ? element({ title: "Cladding", sentences: [], more: more.get("Cladding") }) : element({
    title: "Cladding",
    sentences: [all(word(F, a, "cladding_material"), grade(F, a, "cladding_condition")) ? `The cladding is constructed of ${word(F, a, "cladding_material")} material and to sections observed is in ${grade(F, a, "cladding_condition")} condition.` : ""],
    observations: observations(F, a, "cladding_checks0"),
    comments: typedText(a, "cladding_comments"),
    defects: defects(ctx, F, a, "cladding_damages"),
    photos: photosOf(a, "cladding_photos"),
    more: more.get("Cladding"),
    // "If this paragraph already used under Walls section, delete this one – do not duplicate."
    standard: walls ? [] : [STD.wallsMaterials],
  });

  const subAnswer = asString(a.subfloor_applicability);
  const debris = ticked(a, "subfloor_checks0").includes("item5");
  const subCond = pick(a, "subfloor_viewsThrough", { item0: "varying", item1: "satisfactory", item2: "fair", item3: "average", item4: "poor" });
  const subSupport = yn(a, "subfloor_adequateSupport", "appears to provide", "does not provide");
  const subfloor = subAnswer === "na-slab" ? element({ title: "Sub-Floor", sentences: ["The property is constructed on a concrete slab."] })
    : subAnswer === "na-access" ? element({ title: "Sub-Floor", sentences: [STD.subfloorAccess] })
    : subAnswer !== "applicable" ? "" : element({
        title: "Sub-Floor",
        sentences: [
          word(F, a, "subfloor_accessedFrom") ? `The underfloor space was inspected from the manhole to the ${word(F, a, "subfloor_accessedFrom")}.` : "",
          all(subCond, subSupport) ? `The support system is in ${subCond} structural condition and ${subSupport} adequate support.` : "",
        ],
        after: debris ? [STD.subfloorDebris] : [],
        observations: observations(F, a, "subfloor_checks0", ["item5"]),
        comments: typedText(a, "subfloor_comments"),
        photos: photosOf(a, "subfloor_photos"),
      });

  const rust = pick(a, "lintels_signsOfFailure", { item0: "no", item1: "no obvious", item2: "some minor", item3: "some major", item4: "significant" });
  const lintels = element({
    title: "Lintels",
    sentences: [all(word(F, a, "lintels_material"), grade(F, a, "lintels_condition"), rust) ? `The external ${word(F, a, "lintels_material")} lintels are in ${grade(F, a, "lintels_condition")} condition with ${rust} signs of rust.` : ""],
    observations: observations(F, a, "lintels_checks0"),
    comments: typedText(a, "lintels_comments"),
    defects: defects(ctx, F, a, "lintels_damages"),
    photos: photosOf(a, "lintels_photos"),
    more: more.get("Lintels"),
    standard: [STD.lintels],
  });

  const winReq = pick(a, "windowsext_requires", { item0: "normal maintenance", item1: "repairs", item2: "no attention" });
  const broken = answered(a, "windowsext_checks0") ? (ticked(a, "windowsext_checks0").includes("item0") ? "are" : "are no") : "";
  const beads = word(F, a, "windowsext_glazingBeads");
  const glazing = [
    all(beads, broken) ? `The glazing beads appear ${beads} and there ${broken} broken panels.` : "",
    yn(a, "windowsext_securityScreens", "Security screens are installed.", "Security screens are not installed."),
  ].filter(Boolean).join(" ");
  const windows = element({
    title: "Windows/Window Frames",
    sentences: [
      all(word(F, a, "windowsext_material"), grade(F, a, "windowsext_condition")) ? `The window frames are constructed of ${word(F, a, "windowsext_material")} and are in ${grade(F, a, "windowsext_condition")} condition.` : "",
      winReq ? `They require ${winReq}.` : "",
    ],
    after: glazing ? [glazing] : [],
    observations: observations(F, a, "windowsext_checks0", ["item0"]),
    comments: typedText(a, "windowsext_comments"),
    defects: defects(ctx, F, a, "windowsext_damages"),
    photos: photosOf(a, "windowsext_photos"),
    more: more.get("Windows/Window Frames"),
    standard: [STD.safetyGlass],
  });

  const fdReq = pick(a, "frontdoor_requires", { item0: "no attention", item1: "normal maintenance", item2: "re-painting" });
  const frontDoor = element({
    title: "Front Door / Door Frames",
    sentences: [
      all(word(F, a, "frontdoor_material"), grade(F, a, "frontdoor_condition"), fdReq)
        ? `The front door and door frame is constructed of ${word(F, a, "frontdoor_material")} and its condition is generally ${grade(F, a, "frontdoor_condition")}, requiring ${fdReq}.` : "",
      yn(a, "frontdoor_secScreen", "A security screen door is installed.", "A security screen door is not installed."),
      yn(a, "frontdoor_deadlocks", "Deadlocks are fitted.", "Deadlocks are not fitted."),
    ],
    after: [pick(a, "frontdoor_doorCloser", { item1: "Door closer is working.", item2: "Door closer is not working." })].filter(Boolean),
    comments: typedText(a, "frontdoor_comments"),
    defects: defects(ctx, F, a, "frontdoor_damages"),
    photos: photosOf(a, "frontdoor_photos"),
    more: more.get("Front Door / Door Frames"),
  });

  const otherDoors = element({
    title: "Other External Doors",
    // "The external doors are [traditional/modern] in design ...": no question asks the doors' design (the form asks their style).
    sentences: [],
    observations: observations(F, a, "otherdoors_checks0"),
    comments: typedText(a, "otherdoors_comments"),
    defects: defects(ctx, F, a, "otherdoors_damages"),
    photos: photosOf(a, "otherdoors_photos"),
    more: more.get("Other External Doors"),
  });

  const rails = asString(a.extstairs_handrails), rise = asString(a.extstairs_riseTreadAdequate);
  const stairsAdequate = rails === "item1" && rise === "yes" ? "are" : (rails === "item2" && rise) || (rails === "item1" && rise === "no") ? "are not" : "";
  const stairs = !assessed(a, "extstairs_applicability") ? element({ title: "Stairs", sentences: [], more: more.get("Stairs") }) : element({
    title: "Stairs",
    sentences: [
      all(word(F, a, "extstairs_material"), grade(F, a, "extstairs_condition")) ? `The external stairs on the property are constructed of ${word(F, a, "extstairs_material")} and are in ${grade(F, a, "extstairs_condition")} condition.` : "",
      stairsAdequate ? `The handrails, rise and tread ${stairsAdequate} adequate.` : "",
    ],
    observations: observations(F, a, "extstairs_checks0"),
    comments: typedText(a, "extstairs_comments"),
    defects: defects(ctx, F, a, "extstairs_damages"),
    photos: photosOf(a, "extstairs_photos"),
    more: more.get("Stairs"),
  });

  const balconies = !assessed(a, "balconies_applicability") ? "" : element({
    title: "Balconies",
    sentences: [
      all(word(F, a, "balconies_material"), grade(F, a, "balconies_condition")) ? `The balconies are constructed of ${word(F, a, "balconies_material")} and are in ${grade(F, a, "balconies_condition")} condition.` : "",
      yn(a, "balconies_adequatelyFixed", "They appear to be adequately fixed to the building.", "They appear to be inadequately fixed to the building."),
      word(F, a, "balconies_handRailCond") ? `The handrails are in ${word(F, a, "balconies_handRailCond")} condition.` : "",
    ],
    observations: observations(F, a, "balconies_checks0"),
    comments: typedText(a, "balconies_comments"),
    defects: defects(ctx, F, a, "balconies_damages"),
    photos: photosOf(a, "balconies_photos"),
    standard: [STD.externalStructures],
  });

  const vRails = asString(a.verandah_handRails);
  const verandah = !assessed(a, "verandah_applicability") ? "" : element({
    title: "Verandah or Front Porch or Decking",
    sentences: [
      all(word(F, a, "verandah_material"), grade(F, a, "verandah_condition")) ? `The verandah is constructed of ${word(F, a, "verandah_material")} and in ${grade(F, a, "verandah_condition")} condition.` : "",
      yn(a, "verandah_adequatelyFixed", "It appears to be adequately fixed to the building.", "It appears to be inadequately fixed to the building."),
      vRails !== "item0" && word(F, a, "verandah_handRailCond") ? `The handrails are in ${word(F, a, "verandah_handRailCond")} condition.` : "",
    ],
    after: [pick(a, "verandah_handRails", { item0: "Handrails are not required.", item2: "The handrails are not in compliance with current Australian standards and therefore are not in acceptable condition." })].filter(Boolean),
    observations: observations(F, a, "verandah_checks0"),
    comments: typedText(a, "verandah_comments"),
    defects: defects(ctx, F, a, "verandah_damages"),
    photos: photosOf(a, "verandah_photos"),
    standard: [STD.externalStructures],
  });

  const fixed = yn(a, "alfresco_adequatelyFixed", "adequately", "not adequately");
  const covered = yn(a, "alfresco_covered", "is", "is not");
  const supported = yn(a, "alfresco_adequatelySupported", "adequately", "not adequately");
  const sagging = answered(a, "alfresco_checks0") ? (ticked(a, "alfresco_checks0").includes("item5") ? "signs of sagging and movement" : "no signs of sagging or movement") : "";
  const alfresco = !assessed(a, "alfresco_applicability") ? "" : element({
    title: "Alfresco or Pergola",
    sentences: [
      all(word(F, a, "alfresco_material"), fixed) ? `The pergola is ${word(F, a, "alfresco_material")}-framed and ${fixed} fixed to the house.` : "",
      all(covered, supported, sagging) ? `It ${covered} covered and ${supported} supported, with ${sagging}.` : "",
    ],
    observations: observations(F, a, "alfresco_checks0", ["item5"]),
    comments: typedText(a, "alfresco_comments"),
    photos: photosOf(a, "alfresco_photos"),
    standard: [STD.externalStructures],
  });

  return join([walls, cladding, subfloor, lintels, windows, frontDoor, otherDoors, stairs, balconies, verandah, alfresco, pool(ctx)]);
}

/** Pool/Spa: in External (elevations) on the current form, in its own section on an inspection started on the earlier form. */
function pool(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  if (!fieldOf(F, "pool_applicability") || !assessed(a, "pool_applicability")) return "";
  const kind = word(F, a, "pool_type");
  const where = pick(a, "pool_installation", { item0: "above", item1: "below" });
  const checked = answered(a, "pool_checks0");
  const gates = checked ? (ticked(a, "pool_checks0").includes("item4") ? "The gates are not self-latching and do not appear to meet pool regulations." : "The gates are self-latching and appear to meet pool regulations.") : "";
  const windows = checked ? (ticked(a, "pool_checks0").includes("item2") ? "The windows are not self-latching and do not appear to meet pool regulations." : "The windows are self-latching and appear to meet pool regulations.") : "";
  return element({
    title: "Pool/Spa",
    sentences: [
      all(kind, word(F, a, "pool_material"), where) ? `The ${kind} on the property is constructed of ${word(F, a, "pool_material")} and situated ${where} ground.` : "",
      kind ? yn(a, "pool_signsOfSubsidence", `There are signs of subsidence around the ${kind}.`, `There are no signs of subsidence around the ${kind}.`) : "",
      kind ? yn(a, "pool_fencingAdequate", `The ${kind} appears adequately fenced.`, `The ${kind} appears inadequately fenced.`) : "",
      gates,
      windows,
    ],
    observations: observations(F, a, "pool_checks0", ["item2", "item4"]),
    comments: typedText(a, "pool_comments"),
    photos: photosOf(a, "pool_photos"),
    standard: [PPI_POOL_SPA_TEXT],
  });
}

function outbuildings(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  const sheds = !assessed(a, "sheds_applicability") ? "" : element({
    title: "Sheds",
    // "There is a [type] shed constructed of ...": no question asks the shed's type.
    sentences: [],
    comments: typedText(a, "sheds_comments"),
    defects: defects(ctx, F, a, "sheds_damages"),
    photos: photosOf(a, "sheds_photos"),
  });
  // "There is a [freestanding] [carport/garage] to the side of the house." -- only where the answer says so. "It is constructed of ...
  // with a [material] hardstand ...": no question asks the hardstand's material.
  const garageSentence = pick(a, "garage_location", { item2: "There is a freestanding garage to the side of the house.", item4: "There is a garage to the side of the house.", item6: "There is a garage to the side of the house." });
  const carportSentence = pick(a, "carport_location", { item1: "There is a carport to the side of the house.", item3: "There is a carport to the side of the house." });
  const garage = !assessed(a, "garage_applicability") ? "" : element({
    title: "Carport/Garage",
    sentences: [garageSentence],
    observations: observations(F, a, "garage_checks0"),
    comments: typedText(a, "garage_comments"),
    defects: defects(ctx, F, a, "garage_damages"),
    photos: photosOf(a, "garage_photos"),
  });
  const carport = !assessed(a, "carport_applicability") ? "" : element({
    title: "Carport/Garage",
    sentences: [carportSentence],
    observations: observations(F, a, "carport_checks0"),
    comments: typedText(a, "carport_comments"),
    defects: defects(ctx, F, a, "carport_damages"),
    photos: photosOf(a, "carport_photos"),
  });
  const attention = (key: string) => yn(a, key, "does", "does not");
  const studio = !assessed(a, "studio_applicability") ? "" : element({
    title: "Studio",
    // "There is a studio at the [location] side of the house constructed of [material].": no question asks the studio's material.
    sentences: [all(grade(F, a, "studio_condition"), attention("studio_requiresAttention")) ? `It is in ${grade(F, a, "studio_condition")} condition and ${attention("studio_requiresAttention")} require attention.` : ""],
    comments: typedText(a, "studio_comments"),
    defects: defects(ctx, F, a, "studio_damages"),
    photos: photosOf(a, "studio_photos"),
  });
  const granny = !assessed(a, "grannyflat_applicability") ? "" : element({
    title: "Granny Flat",
    sentences: [
      all(word(F, a, "grannyflat_location"), word(F, a, "grannyflat_material")) ? `There is a granny flat at the ${word(F, a, "grannyflat_location")} side of the house constructed of ${word(F, a, "grannyflat_material")}.` : "",
      all(grade(F, a, "grannyflat_condition"), attention("grannyflat_requiresAttention")) ? `It is in ${grade(F, a, "grannyflat_condition")} condition and ${attention("grannyflat_requiresAttention")} require attention.` : "",
    ],
    comments: typedText(a, "grannyflat_comments"),
    defects: defects(ctx, F, a, "grannyflat_damages"),
    photos: photosOf(a, "grannyflat_photos"),
  });
  return join([sheds, garage, carport, studio, granny]);
}

function driveway(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  if (!assessed(a, "pp_driveway_applicability")) return "";
  // "It is in ... condition and [does/does not] require attention.": the form asks neither.
  return element({
    title: "Driveway",
    sentences: [word(F, a, "pp_driveway_material") ? `The driveway is constructed of ${word(F, a, "pp_driveway_material")}.` : ""],
    observations: observations(F, a, "pp_driveway_checks0"),
    comments: typedText(a, "pp_driveway_comments"),
    photos: photosOf(a, "pp_driveway_photos"),
  });
}

function paving(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  if (!assessed(a, "pp_paving_applicability")) return "";
  // "External paving is in ... condition and [does not] require attention.": the form asks neither.
  return element({ title: "External Paving", sentences: [], observations: observations(F, a, "pp_paving_checks0"), comments: typedText(a, "pp_paving_comments"), photos: photosOf(a, "pp_paving_photos") });
}

function fences(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  if (!assessed(a, "pp_fences_applicability")) return "";
  const req = pick(a, "pp_fences_requires", { item0: "repairs", item1: "normal maintenance" });
  return element({
    title: "Fences",
    sentences: [all(word(F, a, "pp_fences_material"), grade(F, a, "pp_fences_condition"), req) ? `The fences on the property are constructed of ${word(F, a, "pp_fences_material")} and are in ${grade(F, a, "pp_fences_condition")} condition, requiring ${req}.` : ""],
    observations: observations(F, a, "pp_fences_checks0"),
    comments: typedText(a, "pp_fences_comments"),
    defects: defects(ctx, F, a, "pp_fences_damages"),
    photos: photosOf(a, "pp_fences_photos"),
  });
}

function retainingWalls(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  if (!assessed(a, "pp_retaining_applicability")) return "";
  const signs = yn(a, "pp_retaining_signsOfMajorCracking", "signs", "no signs");
  return element({
    title: "Retaining Walls",
    sentences: [all(word(F, a, "pp_retaining_material"), signs) ? `The retaining walls are constructed of ${word(F, a, "pp_retaining_material")}, with ${signs} of significant cracking.` : ""],
    observations: observations(F, a, "pp_retaining_checks0"),
    comments: typedText(a, "pp_retaining_comments"),
    photos: photosOf(a, "pp_retaining_photos"),
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// INTERNAL.

/** The names of the areas the earlier form had (an inspection started on it keeps its answers under these keys). */
export const RETIRED_AREA_NAMES: Record<string, string> = {
  front_entry_hallway: "Front Entry & Hallway", living_room: "Living Room", dining_area: "Dining Area", kitchen: "Kitchen", bedroom: "Bedroom",
  bathroom: "Bathroom", laundry: "Laundry", toilet: "Toilet",
};

/** Which INTERNAL element an area's defect is recorded against, by its "Element" answer ("" when it names none of them). */
export function internalElementOf(text: string): string {
  const t = text.toLowerCase();
  if (!t.trim()) return "";
  const rules: [RegExp, string][] = [
    [/insulation|\bbatts?\b/, "Ceiling Insulation"],
    [/sarking/, "Sarking"],
    [/roof frame|rafter|truss|purlin/, "Roof Frame"],
    [/party wall/, "Party Walls"],
    [/ceiling|cornice/, "Ceilings"],
    [/cabinet|cupboard|robe|drawer|bench|vanity|pantry|joinery/, "Cabinets"],
    [/window|glazing|glass|flyscreen|fly screen|flywire|servery/, "Windows"],
    [/door|latch/, "Doors"],
    [/stair|tread|riser|nosing|balustrade|handrail/, "Stairs"],
    [/floor|tile|tiling|slab|carpet|vinyl|laminate|skirting|joint/, "Floors"],
    [/wall|plaster|render/, "Walls"],
    [/tap|toilet|shower|basin|sink|plumb|pipe|drain|waste|cistern|hot water|water heater/, "Plumbing"],
    [/\bgas\b/, "Gas"],
    [/fireplace|heater|flue/, "Fireplace / Heater"],
    [/electric|power point|power outlet|\bgpo\b|switch|light|\brcd\b|smoke alarm|smoke detector|wiring/, "Electrical"],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? "";
}

/** One area's name as the report says it ("Warehouse", or the earlier form's "Kitchen"). */
function areaName(item: { key?: string; label: string }, group: TemplateField): string {
  const key = item.key ?? "";
  return RETIRED_AREA_NAMES[key] ?? group.repeat?.fixedInstances?.find((f) => f.key === key)?.label ?? item.label;
}

/** The ticked choices as lower-case words ("paint flaking and render cracking"), typed "Other" words included; "" when none. */
function observationWords(fields: Fields, a: AnswerTree, key: string): string {
  const f = fieldOf(fields, key);
  const words = ticked(a, key)
    .map((raw) => {
      const typed = otherAnswerText(raw);
      if (typed !== undefined) return typed.trim();
      if (raw === "other") return "";
      return f?.options?.find((o) => o.value === raw)?.label ?? "";
    })
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  return words.length <= 1 ? words[0] ?? "" : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Every area's defects placed under its element, and what has no place (COMMERCIAL_UNPLACED). */
function areaFindings(ctx: Ctx, groupKey: string): { byElement: Map<string, string[]>; unplaced: string[] } {
  const byElement = new Map<string, string[]>();
  const unplaced: string[] = [];
  const group = fieldOf(ctx.fields, groupKey);
  if (!group || group.type !== "repeating-group" || !isGateSatisfied(group, ctx.a)) return { byElement, unplaced };
  const itemFields = group.itemFields ?? [];
  for (const item of resolveInstances(group, ctx.a[groupKey])) {
    const s = item.scope;
    if (isNotPresent(s) || !Object.entries(s).some(([k, v]) => k !== INSTANCE_KEY && (Array.isArray(v) ? v.length > 0 : typeof v === "string" && v !== ""))) continue;
    const name = areaName(item, group);
    const isOther = /^other\b/i.test(name);
    for (const listKey of ["general_damages", "damages"]) {
      const listField = fieldOf(itemFields, listKey);
      const list = listField && isGateSatisfied(listField, s) && Array.isArray(s[listKey]) ? (s[listKey] as AnswerTree[]) : [];
      list.forEach((d, j) => {
        const loc = asString(d.location).trim();
        const where = isOther ? loc || "other area" : `${name}${loc ? ` (${loc})` : ""}`;
        const text = defects(ctx, itemFields, s, listKey, { area: item.key ?? item.label, only: j, where });
        const el = internalElementOf(asString(d.element));
        if (el) byElement.set(el, [...(byElement.get(el) ?? []), ...text]);
        else unplaced.push(...text);
      });
    }
    const at = isOther ? "other area" : name;
    const notes = typedText(s, "notes");
    if (notes) unplaced.push(`At the ${at}, ${afterComma(notes)}`);
    // The template's words for "None observed" (Pre-Purchase / Apartment), and findings listed ("Staining noted at the Warehouse.").
    const moisture = moistureSentence(s.moistureObservations, fieldOf(itemFields, "moistureObservations"));
    if (moisture === NO_MOISTURE) unplaced.push(`At the ${at}, ${afterComma(NO_MOISTURE)}`);
    else if (moisture) unplaced.push(moisture.replace(/ noted\.$/, ` noted at the ${at}.`));
    unplaced.push(...photoList(asStringArray(s.photos)));
  }
  return { byElement, unplaced };
}

function internal(ctx: Ctx): string {
  const { fields: F, a } = ctx;
  const { byElement, unplaced } = areaFindings(ctx, "rooms");
  const more = (t: string) => byElement.get(t);

  const partyWalls = !assessed(a, "partywalls_applicability") ? "" : element({
    title: "Party Walls",
    sentences: [
      word(F, a, "partywalls_location") ? `The property has a party wall on the ${word(F, a, "partywalls_location")} side of the property.` : "",
      yn(a, "partywalls_extendsToRoof", "The party wall does extend to the underside of the roof cover.", "The party wall does not extend to the underside of the roof cover."),
      yn(a, "partywalls_fireBarrier", "The party wall is appropriately constructed as a fire barrier according to current regulations.", "The party wall is not appropriately constructed as a fire barrier according to current regulations."),
    ],
    observations: observations(F, a, "partywalls_checks0"),
    comments: typedText(a, "partywalls_comments"),
    photos: photosOf(a, "partywalls_photos"),
    more: more("Party Walls"),
  });

  const cornice = answered(a, "ceilings_checks0") ? (ticked(a, "ceilings_checks0").includes("item2") ? "are" : "are no") : "";
  const ceilFixed = yn(a, "ceilings_adequatelyFixed", "adequately", "not adequately");
  const ceilings = element({
    title: "Ceilings",
    sentences: [
      all(word(F, a, "ceilings_material"), word(F, a, "ceilings_cornices"), grade(F, a, "ceilings_condition"))
        ? `The ceilings are constructed of generally ${word(F, a, "ceilings_material")} with ${word(F, a, "ceilings_cornices")} cornices, which are generally in ${grade(F, a, "ceilings_condition")} condition.` : "",
      all(cornice, ceilFixed) ? `There ${cornice} signs of minor cornice cracks and the ceilings are generally ${ceilFixed} fixed.` : "",
    ],
    observations: observations(F, a, "ceilings_checks0"),
    comments: typedText(a, "ceilings_comments"),
    defects: defects(ctx, F, a, "ceilings_damages"),
    photos: photosOf(a, "ceilings_photos"),
    more: more("Ceilings"),
  });

  const wallTicks = ticked(a, "walls_checks0");
  const serious = !wallTicks.length ? "" : wallTicks.includes("item3") || wallTicks.includes("item4") ? "signs of serious cracks and movement" : "no signs of serious cracks or movement";
  const walls = element({
    title: "Walls",
    sentences: [
      all(word(F, a, "walls_material"), serious) ? `The walls are constructed of ${word(F, a, "walls_material")}, with ${serious}.` : "",
      grade(F, a, "walls_condition") ? `They are generally in ${article(grade(F, a, "walls_condition"))} ${grade(F, a, "walls_condition")} condition.` : "",
    ],
    observations: observations(F, a, "walls_checks0", ["item0"]),
    comments: typedText(a, "walls_comments"),
    defects: defects(ctx, F, a, "walls_damages"),
    photos: photosOf(a, "walls_photos"),
    more: more("Walls"),
  });

  const floorTicks = ticked(a, "floors_checks0");
  const floors = element({
    title: "Floors",
    sentences: [
      all(word(F, a, "floors_material"), word(F, a, "floors_coverings")) ? `The floors are constructed of ${word(F, a, "floors_material")} and covered in ${word(F, a, "floors_coverings")}.` : "",
      floorTicks.includes("item0") ? "The tiled areas do not require attention." : "",
      floorTicks.includes("item1") ? "No significant cracks were seen." : "",
    ],
    observations: observations(F, a, "floors_checks0", ["item0", "item1"]),
    comments: typedText(a, "floors_comments"),
    photos: photosOf(a, "floors_photos"),
    more: more("Floors"),
  });

  const stairs = !assessed(a, "intstairs_applicability") ? element({ title: "Stairs", sentences: [], more: more("Stairs") }) : element({
    title: "Stairs",
    sentences: [
      all(word(F, a, "intstairs_material"), grade(F, a, "intstairs_condition")) ? `The internal stairs on the property are constructed of ${word(F, a, "intstairs_material")} and are in ${grade(F, a, "intstairs_condition")} structural condition.` : "",
      pick(a, "intstairs_handrails", { item1: "The handrails are adequate.", item2: "The handrails are not adequate." }),
    ],
    observations: observations(F, a, "intstairs_checks0"),
    comments: typedText(a, "intstairs_comments"),
    defects: defects(ctx, F, a, "intstairs_damages"),
    photos: photosOf(a, "intstairs_photos"),
    more: more("Stairs"),
  });

  const flyscreens = pick(a, "intwindows_flywire", { item0: "some", item1: "most", item2: "all", item3: "none" });
  const restrictors = ticked(a, "intwindows_checks0").includes("item1");
  const windows = element({
    title: "Windows",
    sentences: [
      grade(F, a, "intwindows_condition") ? `The windows are in ${grade(F, a, "intwindows_condition")} condition.` : "",
      yn(a, "intwindows_locksGeneral", "Generally locks are in place.", "Generally locks are not in place."),
    ],
    after: [
      restrictors ? "Window restrictors are not fitted. This is a safety concern." : "",
      all(flyscreens, grade(F, a, "intwindows_flywireCondition")) ? `Flyscreens are installed in ${flyscreens} of the windows and are in ${grade(F, a, "intwindows_flywireCondition")} condition.` : "",
    ].filter(Boolean),
    observations: observations(F, a, "intwindows_checks0", ["item1"]),
    comments: typedText(a, "intwindows_comments"),
    defects: [...defects(ctx, F, a, "intwindows_damages"), ...defects(ctx, F, a, "intwindows_flywire_damages")],
    photos: photosOf(a, "intwindows_photos"),
    more: more("Windows"),
  });

  const doors = element({
    title: "Doors",
    // "The doors are of a [modern/traditional] style ...": no question asks it (the form asks Panelled / Flush / Several styles).
    sentences: [],
    observations: observations(F, a, "intdoors_checks0"),
    comments: typedText(a, "intdoors_comments"),
    defects: defects(ctx, F, a, "intdoors_damages"),
    photos: photosOf(a, "intdoors_photos"),
    more: more("Doors"),
  });

  const cabinets = element({
    title: "Cabinets",
    sentences: [grade(F, a, "cabinets_condition") ? `The general condition of the cabinets is considered to be ${grade(F, a, "cabinets_condition")}.` : ""],
    observations: observations(F, a, "cabinets_checks0"),
    comments: typedText(a, "cabinets_comments"),
    defects: defects(ctx, F, a, "cabinets_damages"),
    photos: photosOf(a, "cabinets_photos"),
    more: more("Cabinets"),
  });

  const waterOff = asString(a.plumbing_waterSupplyOn) === "no";
  const plumbing = element({
    title: "Plumbing",
    sentences: waterOff ? ["Water was switched off at the time of inspection."] : [
      // "The water flow [is/is not] adequate.": no question asks it.
      yn(a, "plumbing_waterHammer", "There are signs of water hammer.", "There are no signs of water hammer."),
      yn(a, "plumbing_tapsNormal", "All toilets were tested and are operational.", "All toilets were tested and are not operational."),
    ],
    after: !waterOff && asString(a.plumbing_waterLeaks) === "yes" ? [STD.plumbingLeaks] : [],
    comments: typedText(a, "plumbing_comments"),
    photos: photosOf(a, "plumbing_photos"),
    more: more("Plumbing"),
    standard: [STD.plumbing],
  });

  const gasType = pick(a, "gas_supplyType", { item0: "Mains", item1: "LPG" });
  const gas = !assessed(a, "gas_applicability") ? element({ title: "Gas", sentences: [], more: more("Gas") }) : element({
    title: "Gas",
    // "There are detectable leaks at [location]": no question asks where.
    sentences: [asString(a.gas_gasSupplyOn) === "no" ? "Gas was switched off at the time of inspection." : asString(a.gas_gasSupplyOn) === "yes" && gasType ? `${gasType} gas is connected to the property.` : ""],
    observations: observations(F, a, "gas_checks0"),
    comments: typedText(a, "gas_comments"),
    photos: photosOf(a, "gas_photos"),
    more: more("Gas"),
    standard: [STD.gas],
  });

  const heater = pick(a, "fireplace_type", { item0: "a gas", item1: "an electric" });
  const operating = yn(a, "fireplace_operating", "was", "was not");
  const fireTicks = ticked(a, "fireplace_checks0");
  const fireplace = !assessed(a, "fireplace_applicability") ? element({ title: "Fireplace / Heater", sentences: [], more: more("Fireplace / Heater") }) : element({
    title: "Fireplace / Heater",
    sentences: [
      all(heater, operating) ? `There is ${heater} heater installed which ${operating} operating at time of inspection.` : "",
      fireTicks.includes("item0") ? "It requires normal maintenance." : "",
      fireTicks.includes("item1") ? "Recommend urgent servicing." : "",
    ],
    observations: observations(F, a, "fireplace_checks0", ["item0", "item1"]),
    comments: typedText(a, "fireplace_comments"),
    photos: photosOf(a, "fireplace_photos"),
    more: more("Fireplace / Heater"),
    standard: [STD.chimneySweep],
  });

  const powerOff = asString(a.electrical_powerOn) === "no";
  const rcd = pick(a, "electrical_rcdCount", { item0: "no", item1: "1", item2: "2", item3: "3", item4: "4", item5: "5" });
  const battery = asString(a.electrical_batteryAlarms) === "yes" ? pick(a, "electrical_batteryAlarmsCount", { item0: "1", item1: "2", item2: "3" }) : "";
  const hardwired = asString(a.electrical_hardwiredAlarms) === "yes" ? pick(a, "electrical_hardwiredCount", { item0: "1", item1: "2", item2: "3" }) : "";
  const located = asString(a.electrical_alarmsLocated) === "yes";
  const alarms = !located ? "" : battery && hardwired ? `${battery} battery smoke alarms and ${hardwired} hardwired smoke alarms are installed and the locations are appropriate.`
    : battery ? `${battery} battery smoke alarms are installed and the locations are appropriate.`
    : hardwired ? `${hardwired} hardwired smoke alarms are installed and the locations are appropriate.` : "";
  const electrical = element({
    title: "Electrical",
    sentences: powerOff ? ["Electricity was switched off at the time of inspection."] : [rcd ? `The circuit board has ${rcd} RCD (residual current device) safety ${rcd === "1" ? "switch" : "switches"}.` : ""],
    after: !powerOff && alarms ? [alarms] : [],
    observations: observations(F, a, "electrical_checks0"),
    comments: typedText(a, "electrical_comments"),
    photos: photosOf(a, "electrical_photos"),
    more: more("Electrical"),
    standard: [STD.electrical],
  });

  // The roof space's own elements are written with the roof (roof_chimneys); an area's defect recorded against one prints there too.
  const roofSpaceMore = COMMERCIAL_ROOF_SPACE_PARTS.map((t) => (more(t)?.length ? [`PART::${t}`, ...more(t)!].join("\n\n") : ""));
  // INTERNAL's opening sentence is printed by the report, at the top of INTERNAL (COMMERCIAL_INTERNAL_INTRO).
  return join([...roofSpaceMore, partyWalls, ceilings, walls, floors, stairs, windows, doors, cabinets, plumbing, gas, fireplace, electrical, unplaced.length ? [`PART::${COMMERCIAL_UNPLACED}`, ...unplaced].join("\n\n") : ""]);
}

/** Offices & Staff Facilities (the pool_spa slot): its areas' defects under INTERNAL's elements -- or, on the earlier form, Pool/Spa. */
function officesOrPool(ctx: Ctx): string {
  if (fieldOf(ctx.fields, "pool_applicability")) return pool(ctx);
  const { byElement, unplaced } = areaFindings(ctx, "rooms");
  return join([
    ...COMMERCIAL_INTERNAL_PARTS.map((t) => (byElement.get(t)?.length ? [`PART::${t}`, ...byElement.get(t)!].join("\n\n") : "")),
    unplaced.length ? [`PART::${COMMERCIAL_UNPLACED}`, ...unplaced].join("\n\n") : "",
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// STRUCTURAL DEFECTS, MAJOR DEFECTS, SAFETY HAZARDS and NOTES: the Notes section, printed in four parts (PrePurchaseReport.tsx gives each
// part its own questions).

/** The template's NOTES standard paragraphs, printed at the top of NOTES (the rest of NOTES is the form's own Notes answers). */
export const COMMERCIAL_NOTES_STANDARD = [
  "Ensure downpipes and gutters are cleaned of tree litter regularly to avoid storm water overflows.",
  "Smoke detectors should be tested regularly and batteries changed (usually every 6 months). It is recommended that a smoke detector is located within 1.5 metres outside each bedroom/sleeping area. Smoke alarms must meet the Australian Standard AS:3786-1993.",
];
const MAJOR_DEFECTS_STANDARD =
  "Whether or not a defect should be regarded as major, may depend upon the age of the building being inspected. Older properties with some cracking may be considered stable with little or no concern about structure. Conversely, a major item may occur in a new property due to an unusual design or poor construction. All instances of structural and/or major defects should be monitored and if deterioration occurs consult a structural engineer or other specialists relevant to the issue.";
const SMOKE_DETECTOR = "It is recommended that a smoke detector is located within 1.5 metres outside each bedroom/sleeping area. Smoke alarms must meet the Australian Standard AS:3786-1993.";
const ASBESTOS =
  "Due to the age of the property, asbestos may be present. This would need to be tested by a specialist. Some older fibre cement sheet materials may contain materials with asbestos and, if damaged or if they are to be removed, may require specialists to test and handle the removal. Please refer to Houspect’s limitations in regard to asbestos, as the general advice from government sources is that properties built prior to 1983 may contain asbestos. Please also read Item 11 in the Conditions for the Provision of this Report.";

/** A part of the Notes section, by the questions it was given; undefined for NOTES itself (the form's own Notes answers, as they are). */
function notes(ctx: Ctx): string | undefined {
  const { fields: F, a } = ctx;
  const only = (prefix: string) => F.length > 0 && F.every((f) => f.key.startsWith(prefix));
  if (only("structural_")) {
    return [
      yn(a, "structural_structurallySound", "There are no structural defects evident at the time of inspection.", "There are structural defects evident at the time of inspection."),
      typedText(a, "structural_comments"),
      ...photosOf(a, "structural_photos"),
    ].filter(Boolean).join("\n\n");
  }
  if (only("majordefects_")) {
    const own = [
      yn(a, "majordefects_freeOfMajorDefects", "There are no major defects evident at the time of inspection.", "There are major defects evident at the time of inspection."),
      typedText(a, "majordefects_comments"),
      ...photosOf(a, "majordefects_photos"),
    ].filter(Boolean);
    return own.length ? [...own, MAJOR_DEFECTS_STANDARD].join("\n\n") : "";
  }
  if (only("safety_")) {
    // "If an RCD was not located" and the full electrical inspection ("house is more than 5 yrs old") are not asked here; a safety item
    // that only points elsewhere ("Refer to pool concerns") is said where it is.
    const items = observations(F, a, "safety_checks0").split(/(?<=\.)\s+/).filter((x) => x && !/^Refer to\b/i.test(x)).join(" ");
    const own = [items, typedText(a, "safety_comments"), ...photosOf(a, "safety_photos")].filter(Boolean);
    if (!own.length && asString(a.safety_safetyMatters) !== "yes") return "";
    return [...own, SMOKE_DETECTOR, ticked(a, "safety_checks0").includes("item2") ? ASBESTOS : ""].filter(Boolean).join("\n\n");
  }
  return undefined;
}

const SECTION_TEXT: Record<string, (ctx: Ctx) => string | undefined> = {
  notes,
  roof_chimneys: roof,
  elevations,
  garage_carport_sheds: outbuildings,
  driveway,
  paving_paths: paving,
  fences,
  retaining_walls: retainingWalls,
  internal_areas: internal,
  pool_spa: officesOrPool,
};

/** The element a section's own damage list belongs to, by its key's prefix (for a defect recorded under an element answered "Not applicable"). */
const LIST_ELEMENT: [RegExp, string][] = [
  [/^roofcov_/, "Roof Covering"], [/^eaves_/, "Eaves"], [/^fascia_/, "Fascias"], [/^gables_/, "Gables"], [/^flashings_/, "Flashings"], [/^guttersvalleys_/, "Valleys/Gutters"],
  [/^downpipes_/, "Downpipes"], [/^chimneys_/, "Chimney"], [/^roofcavity_/, "Roof Covering (underside)"],
  [/^extwalls_/, "Walls"], [/^cladding_/, "Cladding"], [/^lintels_/, "Lintels"], [/^windowsext_/, "Windows/Window Frames"], [/^frontdoor_/, "Front Door / Door Frames"],
  [/^otherdoors_/, "Other External Doors"], [/^extstairs_/, "Stairs"], [/^balconies_/, "Balconies"], [/^verandah_/, "Verandah or Front Porch or Decking"],
  [/^sheds_/, "Sheds"], [/^(garage|carport)_/, "Carport/Garage"], [/^studio_/, "Studio"], [/^grannyflat_/, "Granny Flat"], [/^pp_fences_/, "Fences"],
  [/^ceilings_/, "Ceilings"], [/^walls_/, "Walls"], [/^intstairs_/, "Stairs"], [/^intwindows_/, "Windows"], [/^intdoors_/, "Doors"], [/^cabinets_/, "Cabinets"],
];

/** A Commercial section's report text, from the template (undefined: a section this file does not write -- the walk's own text). */
export function commercialSectionText(sectionKey: string, answers: AnswerTree, fields: TemplateField[], damages: { notes: string; photos: string[] }[]): string | undefined {
  const write = SECTION_TEXT[sectionKey];
  if (!write) return undefined;
  const ctx = context(fields, answers, damages);
  const text = write(ctx);
  if (text === undefined || !ctx.tagged) return text;
  // A defect the element's own sentences did not say -- recorded before its element was answered "Not applicable" -- is still printed,
  // under its element: the record and its photos are the inspector's.
  const said = new Set([...text.matchAll(/(?:^|\n)DEFECT::(\d+)::/g)].map((m) => Number(m[1])));
  const extra: string[] = [];
  for (const where of ctx.at.keys()) {
    const [area, key] = where.split("|") as [string, string];
    if (area) continue;
    const title = LIST_ELEMENT.find(([re]) => re.test(key))?.[1];
    const lines = defects(ctx, fields, answers, key).filter((l) => !said.has(Number(/^DEFECT::(\d+)::/.exec(l)?.[1] ?? -1)));
    if (lines.length) extra.push([`PART::${title ?? COMMERCIAL_UNPLACED}`, ...lines].join("\n\n"));
  }
  return join([text, ...extra]);
}

/**
 * An inspection started on the earlier form keeps its rooms under the earlier form's keys ("kitchen"): the areas list it is printed with
 * names them as that form did (its own answers only), so the report and its Condition Summary say "Kitchen", not "Areas 8".
 */
export function withRetiredAreas(fields: TemplateField[], answers: AnswerTree): TemplateField[] {
  const group = fieldOf(fields, "rooms");
  const saved = answers.rooms && typeof answers.rooms === "object" && !Array.isArray(answers.rooms) ? Object.keys(answers.rooms) : [];
  const fixed = group?.repeat?.fixedInstances ?? [];
  const retired = saved.filter((k) => RETIRED_AREA_NAMES[k] && !fixed.some((f) => f.key === k)).map((k) => ({ key: k, label: RETIRED_AREA_NAMES[k]! }));
  if (!group || !retired.length) return fields;
  return fields.map((f) => (f === group ? { ...group, repeat: { ...group.repeat!, fixedInstances: [...fixed, ...retired] } } : f));
}

// ---------------------------------------------------------------------------------------------------------------------------------
// GENERAL DESCRIPTION: the template's sentences, from Job Information and the front elevation.

/**
 * The General Description's sentences. "The building is a [single storey / ...]." and "The design of the property is [modern/traditional]."
 * have no question; "The front of the building is facing approximately [Direction], on a [Sloping or flat] block of land." is filled from
 * the front elevation's orientation and "The block is"; "There is an [addition/extension] at the [...] constructed around [...]. The design
 * of the extension is [...]." has no question for the addition / extension word or its design, and the form asks where and when it was
 * built in one typed answer -- so it is left out; the council-approval recommendation prints when there are additions / extensions.
 */
export function commercialGeneralDescription(jobInfo: AnswerTree, jobInfoFields: TemplateField[], elevations: AnswerTree, elevationFields: TemplateField[]): string[] {
  const sides = fieldOf(elevationFields, "sides");
  const front = sides ? resolveInstances(sides, elevations.sides).find((i) => i.key === "front") : undefined;
  const direction = front && !isNotPresent(front.scope) ? word(sides!.itemFields ?? [], front.scope, "orientation") : "";
  const block = word(jobInfoFields, jobInfo, "blockSlope");
  return [
    all(direction, block) ? `The front of the building is facing approximately ${capitalize(direction)}, on a ${block} block of land.` : "",
    asString(jobInfo.additionsExtensions) === "yes" ? STD.councilApproval : "",
  ].filter(Boolean);
}

// ---------------------------------------------------------------------------------------------------------------------------------

const { driveway: _driveway, pool_spa: _poolSpa, ...composers } = base.composers;

export const prePurchaseCommercialProperties: ReportWording = {
  ...base,
  composers,
  // Only the Description is written in one go by a composer; every other section is written from the template by `sectionText`.
  isFlatComposed: (sectionKey) => sectionKey === "description" || sectionKey.startsWith("custom_"),
  metadataFields: { ...base.metadataFields, ...APPLICABILITY_FIELDS, notes: [...(base.metadataFields.notes ?? [])] },
  // The Notes' typed comments are said as typed, not as "If Other — specify: ...".
  plainFields: { ...base.plainFields, notes: [...(base.plainFields?.notes ?? []), "generalCommentsOther"] },
  listLine,
  sectionText: commercialSectionText,
  finish: (_sectionKey, text) => tidyFullStops(notedOnce(text)),
  // The template's Pool/Spa paragraph is part of the Pool/Spa element's own text (above).
  poolSpaDisclaimer: false,
};
