/**
 * The Construction Stage wording: turns one section's answers into the section's report text (and the defects it records).
 * This is what the web reviewer portal shows for a section and what the printed report is made from, so the two always agree.
 *
 * The text is lines, in the same plain format every report type uses, with these tags:
 *   ROOMHEAD::<heading>        a sub-heading (a group of checks, "Roof", "Walls" ...)
 *   ITEM::<heading>::<status>::<text>   one checklist row: its short name, its status (ok, progress, defect, note, notcomplete, na) and its sentence
 *   AFTER::<text>              the template's sentence printed under the checklist row just above it (the roof OH&S sentences)
 *   NOTE::<text>               a sentence that belongs under the report's Notes (printed there, and shown in the section for the reviewer)
 *   DEFECT::<n>::<text>        defect n of this section (its photos are the section's n-th damage record)
 * and plain paragraphs for everything else.
 */
import type { AnswerTree, TemplateField } from "../templateFields";
import { asAnswerTree, asString, asStringArray, isGateSatisfied } from "../templateFields";
import { EXTERNAL_WORDS, STAGES, areaOfSection, kindOfKey, stageOfKey, type StageId } from "./stages";
import {
  type Chosen, withReadableCodes, CATEGORY_LABELS, NOT_APPLICABLE, SATISFACTORY, SEVERITY_LABELS, asList, cap, chosen, defectItemName, groupOf, headingMap, headingOf, inline, joinList, labelsOf, lower, mapLabels, photosIn, sentence, toneOfOption,
} from "./words";

export interface ComposedDamage {
  /** The group the defect sits under ("Roof", "Walls" ...). */
  type: string;
  location: string;
  /** EXTERNAL or INTERNAL. */
  direction: string;
  widthMm: number;
  lengthMm: number;
  notes: string;
  photos: string[];
  /** The checklist row the defect was recorded against (printed as its heading when it has no location). */
  item?: string;
  /** The numbered line the report prints for it (not saved). */
  description?: string;
}
export interface Composed { text: string; damages: ComposedDamage[] }

export const TAGS = { room: "ROOMHEAD::", item: "ITEM::", after: "AFTER::", note: "NOTE::", defect: "DEFECT::" };

/**
 * The Lock-up template's OH&S sentences for a roof the inspector could not get onto (viewed from the ground). Under "Roof Covering" and
 * "Roof Gutters" they are filled in from the form's upper / lower answers; the flashings have no upper / lower answers of their own, so
 * under "Roof Flashing" and "Parapet Flashing / Capping" they read from that row's answer.
 */
export const OHS = {
  roof: "Due to OH&S constraints the upper roof could not be safely accessed.",
  roofUpper: (x: string) => `Observations from the ground indicate that the roof covering is ${x}.`,
  roofLower: (x: string) => `Lower level roofing was checked and is ${x}.`,
  flashings: "Due to OH&S constraints the upper roof flashings could not be safely inspected.",
  flashingsUpper: (x: string) => `Observations from the ground indicate that the flashings are ${x}.`,
  flashingsLower: (x: string) => `Lower level flashings were checked and are ${x}.`,
  gutters: "Due to OH&S constraints the upper guttering could not be safely accessed.",
  guttersUpper: (x: string) => `Observations from the ground indicate that the guttering is ${x}.`,
  guttersLower: (x: string) => `Lower level guttering was checked and is ${x}.`,
};
/** The rows the flashings sentences are printed under (the Lock-up template has them under both). */
const FLASHING_ROWS = new Set(["roofFlashing", "parapetFlashing"]);
const DEFECT_SUFFIX = "__defect";
/** Lock-up & Fixing, Doors: the fixing-stage (internal) door checks. Their defects print under INTERNAL > Internal doors; the rest of Doors is EXTERNAL. */
export const LF_INTERNAL_DOORS = new Set(["internalDoorsFitted", "doorsHungStraight", "doorFramesRubbed", "doorFinish", "cavitySliders"]);

// ───────────────────────── Description ─────────────────────────

/**
 * The foundations as they read after "The construction is a … ": "on a concrete slab", but "on stumps", "on timber stumps",
 * "on brick piers" (the templates: "on a concrete slab / timber stumps / concrete stumps"). "a" / "an" only before one thing; a typed
 * "Other" that already starts with "a", "an" or "the" is kept as typed.
 */
export function onFoundations(foundations: string): string {
  const f = foundations.trim();
  if (/^(a|an|the)\s/i.test(f)) return `on ${f}`;
  const last = (/([A-Za-z]+)[^A-Za-z]*$/.exec(f)?.[1] ?? "").toLowerCase();
  const plural = /(s|es)$/.test(last) && !/(ss|us|is)$/.test(last);
  if (plural || / and /i.test(f)) return `on ${f}`;
  return `on ${/^[aeiou]/i.test(f) ? "an" : "a"} ${f}`;
}

function describe(stage: StageId, fields: TemplateField[], a: AnswerTree, apartment: boolean): string[] {
  const f = (k: string) => fields.find((x) => x.key === k);
  // Each answer as it reads inside the sentence: a typed "Other" loses its own full stop and capital (inline).
  const one = (k: string) => inline(labelsOf(f(k), a[k])[0] ?? "");
  const all = (k: string) => labelsOf(f(k), a[k]).map(inline);
  const out: string[] = [];

  const by = (labelsOf(f("constructedBy"), a.constructedBy)[0] ?? "").trim().replace(/[\s.;:,!]+$/, ""); // a builder's name keeps its capitals
  if (by) out.push(`The property is being constructed by ${by}.`);

  const kind = one("constructionIs") || one("design");
  const foundations = one("foundations");
  if (stage === "pci") {
    // The PCI templates: "The construction is a single/double storey residential house." (House) or "The construction is a single level
    // apartment in a multi-level complex." (Apartment), then "Foundations are concrete slab / …" as its own line.
    if (kind) out.push(`The construction is a ${kind} ${apartment ? "apartment in a multi-level complex" : "residential house"}.`);
    if (foundations) out.push(`Foundations are ${foundations}.`);
  }
  else if (kind && foundations) out.push(`The construction is a ${kind}${apartment ? " apartment" : ""} ${onFoundations(foundations)}.`);
  else if (kind) out.push(`The construction is a ${kind}${apartment ? " apartment" : ""}.`);
  else if (foundations) out.push(`Foundations are ${foundations}.`);

  const ground = all("groundCladding");
  const first = all("firstCladding").filter((x) => x !== "not applicable");
  const groundCombo = inline(asString(a.groundCladdingCombo));
  const firstCombo = inline(asString(a.firstCladdingCombo));
  if (ground.length || first.length) {
    const g = ground.map((x) => (x === "combination of" ? groundCombo || x : x));
    const firstOther = inline(asString(a.firstCladdingOther));
    const fl = first.map((x) => (x === "combination of" ? firstCombo || x : x === "other" ? firstOther || x : x));
    out.push(`Wall cladding is constructed of ${joinList(g)}${fl.length ? ` to the ground floor and ${joinList(fl)} to the first floor` : ""}.`);
  }

  const windows = one("windowsAre");
  const windowsLine = windows ? `Windows are constructed of ${windows}.` : "";
  const roofDesign = one("roofDesign");
  const roofCover = one("roofCoveringIs");
  const roofLine = roofDesign || roofCover ? `The roof design is ${roofDesign || "—"}${roofCover ? ` and the covering is constructed of ${roofCover}` : ""}.` : "";
  // The Lock-up & Fixing template: builder, construction, wall cladding, ROOF, then windows. The other stages keep their own order.
  out.push(...(stage === "lock_fix" ? [roofLine, windowsLine] : [windowsLine, roofLine]).filter(Boolean));
  const frontage = one("frontage");
  if (frontage) out.push(`The street frontage is to the ${frontage}.`); // template: "The street frontage is to the north / south / east / west."
  const block = one("blockSlope");
  if (block) out.push(`The block is ${block}.`);
  if (a.supervisorOnSite === "yes" || a.supervisorOnSite === "no") out.push(`The site supervisor was${a.supervisorOnSite === "no" ? " not" : ""} onsite at the time of inspection.`);
  if (a.ownersOnSite === "yes" || a.ownersOnSite === "no") out.push(`The owner ${a.ownersOnSite === "no" ? "was not" : "was"} onsite at the time of inspection.`);
  if (a.safetyIssues === "yes") {
    const d = asString(a.safetyDescribe).trim();
    out.push(d ? `Safety issues were noted on site — ${sentence(inline(d))}` : "Safety issues were noted on site.");
  }
  out.push(STAGES[stage].progress);
  return out;
}

// ───────────────────────── Defects ─────────────────────────

/**
 * A recorded defect. `text` is its full line for the section's report text; `item` (the checklist row) and `description` are what the
 * report's Identified Defects prints, as the template does: the location in bold (the item when there is no location), then the
 * numbered description.
 */
interface Defect { sub: string; area: "EXTERNAL" | "INTERNAL"; location: string; text: string; photos: string[]; item: string; description: string }

/** A checklist row's defect as the template's numbered line reads under its location: the row, then the inspector's comments. */
function rowDescription(item: string, location: string, comments: string, stage?: StageId): string {
  // The Lock-up & Fixing template: "<the inspector's description>. Please refer to Photographs …" -- not the checklist row's name in front.
  if (!location || stage === "lock_fix") return comments ? sentence(cap(comments)) : sentence(cap(item));
  return [sentence(cap(item)), comments ? sentence(cap(comments)) : ""].filter(Boolean).join(" ");
}

function defectText(heading: string, location: string, comments: string, severities: string[], categories: string[], code: string): string {
  const head = heading ? cap(heading) : "";
  const where = location && heading ? ` — ${location}` : location;
  const lead = head || where ? sentence(`${head}${where}`) : ""; // a label that already ends in a full stop is not given a second one
  const parts = [
    lead,
    comments ? sentence(cap(comments)) : "",
    severities.length ? `Severity: ${severities.join(", ")}.` : "",
    categories.length ? `Category: ${categories.join(", ")}.` : "",
    code ? `Construction code: ${code}.` : "",
  ].filter(Boolean);
  return parts.join(" ") || "Defect noted.";
}

/**
 * The PCI template's places in Identified Defects (EXTERNAL: Roof, Walls, Windows & Doors, Porch, Alfresco / Balcony, Garage/Carport,
 * Driveway & Paving, Site; INTERNAL: Front door, Hallway & Entry, … Laundry, then General). A defect from the general Defects list goes
 * under the place its location names first ("Garage, internal access door" -> Garage / Carport); one that names none stays under General.
 * A place the checklist already has a heading for ("Garage", "Balconies") is printed under that heading (reportModel.ts, placeKey).
 */
const PLACES: [RegExp, string][] = [
  // An apartment complex's common property ("Common corridor, level 3", "Foyer"): the checklist's Common areas.
  [/\b(common|foyer|lobby)\b/i, "Common areas"],
  [/\bfront door\b/i, "Front door"], [/\b(manhole|roof (space|cavity)|ceiling insulation|insulation|sarking)\b/i, "Manhole, Roof Cavity, Insulation"],
  [/\b(garage|carport)\b/i, "Garage / Carport"], [/\b(roof|gutters?|downpipes?|fascias?|eaves?|soffits?)\b/i, "Roof"], [/\bporch\b/i, "Porch"],
  [/\b(alfresco|balcon(y|ies)|decking|deck|verandah|terrace)\b/i, "Alfresco / Balcony"], [/\b(driveway|paving|path)\b/i, "Driveway & Paving"],
  [/\b(fences?|landscaping|retaining|yard|site)\b/i, "Site"], [/\b(brick(work)?|render|cladding|weep ?holes?|external walls?)\b/i, "Walls"],
  [/\b(hall(way)?|entry)\b/i, "Hallway & Entry"], [/\b(kitchen|pantry)\b/i, "Kitchen & Pantry"], [/\b(living|family)\b/i, "Living/Family"],
  [/\blounge\b/i, "Lounge"], [/\btheatre\b/i, "Theatre Room"], [/\bstair(s|well)?\b/i, "Stairs & Stairwell"],
  [/\b(bed(room)?\s*1|master bed(room)?|ensuite)\b/i, "Bedroom 1 & Ensuite"], [/\bbed(room)?\s*2\b/i, "Bedroom 2"], [/\bbed(room)?\s*3\b/i, "Bedroom 3"],
  [/\bbed(room)?\s*4\b/i, "Bedroom 4"], [/\bstudy\b/i, "Study"], [/\bbathroom\b/i, "Bathroom"], [/\bpowder( room)?\b/i, "Powder Room"], [/\blaundry\b/i, "Laundry"],
  [/\b(windows?|doors?|flyscreens?|sliders?)\b/i, "Windows and Doors"],
];
/** The place a location names first, or "" when it names none. */
export function placeOf(location: string): string {
  let best = { at: Infinity, place: "" };
  for (const [re, place] of PLACES) {
    const m = re.exec(location);
    if (m && m.index < best.at) best = { at: m.index, place };
  }
  return best.place;
}

function tableDefects(a: AnswerTree, stage: StageId): Defect[] {
  const rows = Array.isArray(a.defects) ? (a.defects as AnswerTree[]) : [];
  const out: Defect[] = [];
  for (const row of rows) {
    const location = asString(row.location).trim();
    const description = asString(row.description).trim();
    const photos = photosIn(row.photos);
    if (!location && !description && photos.length === 0) continue;
    const sub = (stage === "pci" && placeOf(location)) || "General";
    out.push({ sub, area: EXTERNAL_WORDS.test(`${location} ${description}`) ? "EXTERNAL" : "INTERNAL", location, text: defectText("", location, description, [], [], ""), photos, item: "", description: description ? sentence(cap(description)) : "" });
  }
  return out;
}

/**
 * The PCI "Part 2: Identified Defects" ticks: the place each one is printed under (as the template's Identified Defects lists them), and the
 * template's own sentence where it has one ("Scrape and clean garage hardstand.", "Clean porch slab." …). The rest print as the form words
 * them. A tick not listed here prints under General.
 */
export const TYPICAL_DEFECTS: Record<string, { place: string; text?: string }> = {
  roof_tiles: { place: "Roof" }, gutter_debris: { place: "Roof" }, gutter_water: { place: "Roof" }, downpipe_connectors: { place: "Roof" },
  mortar_voids: { place: "Walls" }, brickwork_cleaned_at: { place: "Walls" }, cladding_cleaned_at: { place: "Walls" },
  pipe_penetrations: { place: "Walls", text: "Ensure gaps at pipe penetrations are sealed/caulked when appliances are fitted off." },
  porch_slab: { place: "Porch", text: "Clean porch slab." },
  alfresco_slab: { place: "Alfresco / Balcony" }, balcony_fall: { place: "Alfresco / Balcony" },
  garage_slab: { place: "Garage / Carport", text: "Scrape and clean garage hardstand." },
  ground_falls: { place: "Site" },
  sliding_door_tracks: { place: "Windows and Doors" }, window_seals_at: { place: "Windows and Doors" },
  front_door_fire: { place: "Front door" }, front_door_latching: { place: "Front door" }, excess_paint_door: { place: "Front door" },
  // The form's "Screws missing from Front door hinges", without the capital in the middle of the sentence.
  screws_door_hinges: { place: "Front door", text: "Screws missing from front door hinges." },
  hallway_marks: { place: "Hallway & Entry" },
  kitchen_cabinet_doors: { place: "Kitchen & Pantry" }, cabinets_chipped: { place: "Kitchen & Pantry" }, kitchen_family_marks: { place: "Kitchen & Pantry" }, kitchen_caulking: { place: "Kitchen & Pantry" },
  bed1_marks: { place: "Bedroom 1 & Ensuite" }, ensuite1_caulking: { place: "Bedroom 1 & Ensuite" },
  bed2_marks: { place: "Bedroom 2" }, ensuite2_caulking: { place: "Bedroom 2" }, bed3_marks: { place: "Bedroom 3" },
  grouting_poor: { place: "Finishes" }, floor_coverings_marked: { place: "Finishes" },
  windows_doors_cleaned: { place: "General", text: "All windows and doors to be cleaned and detailed." },
  // The form's "All windows and floor tile and coverings to be cleaned": the template's line, keeping the windows.
  // When "All windows and doors to be cleaned and detailed." is printed too, it is the template's own line (windows are not said twice).
  windows_floor_cleaned: { place: "General", text: "All windows, tiles and floor coverings to be cleaned and detailed." },
  benchtops_cleaned: { place: "General", text: "All benchtops and vanities to be cleaned and detailed." },
};

/**
 * The word that joins a tick to what the inspector typed for it, from the follow-up's own label ("Cleaned at …" -> "at", "Gaps at …" ->
 * "at"): "Sections of brickwork to be cleaned" + "the front porch piers" -> "Sections of brickwork to be cleaned at the front porch piers.".
 * Not added twice when the inspector already began with it ("at the front porch").
 */
function joined(lead: string, followUp: TemplateField | undefined, typed: string): string {
  const t = inline(typed);
  if (!t) return sentence(lead);
  const word = /(\S+)\s*(…|\.\.\.)\s*$/.exec(followUp?.label ?? "")?.[1]?.toLowerCase() ?? "";
  const join = word && !new RegExp(`^${word}\\b`, "i").test(t) ? `${word} ` : "";
  return sentence(`${lead} ${join}${t}`);
}

/** The template's General line for tiles and floor coverings (printed beside "All windows and doors to be cleaned and detailed."). */
export const TILES_CLEANED = "All tiles and floor coverings to be cleaned and detailed.";

function typicalDefects(fields: TemplateField[], a: AnswerTree): Defect[] {
  const out: Defect[] = [];
  const ticked = new Set(fields.filter((f) => f.type === "chip-multiselect" && isGateSatisfied(f, a)).flatMap((f) => asList(a[f.key])));
  for (const f of fields) {
    if (f.type !== "chip-multiselect" || !isGateSatisfied(f, a)) continue;
    for (const optKey of asList(a[f.key])) {
      const opt = f.options?.find((o) => o.value === optKey);
      if (!opt) continue;
      const at = asString(a[`${optKey}_at`]).trim();
      const known = TYPICAL_DEFECTS[optKey];
      const both = optKey === "windows_floor_cleaned" && ticked.has("windows_doors_cleaned");
      const description = both ? TILES_CLEANED : known?.text && !at ? known.text : joined(opt.label, fields.find((x) => x.key === `${optKey}_at`), at);
      // Printed under its place with no bold line of its own: the place is the heading, and the numbered line says what it is (not the tick's name twice).
      out.push({ sub: known?.place ?? "General", area: f.sectionLetter === "External" ? "EXTERNAL" : "INTERNAL", location: "", text: defectText("", "", description, [], [], ""), photos: photosIn(a[`${optKey}_pics`]), item: "", description });
    }
  }
  return out;
}

// ───────────────────────── Checklist rows ─────────────────────────

const toMm = (n: string) => (n ? `${n} millimetres` : "—");

/** How a checklist row reads on the report: the colour of its status. */
export type ItemStatus = "ok" | "progress" | "defect" | "note" | "notcomplete" | "na";
export const ITEM_STATUSES: ItemStatus[] = ["ok", "progress", "defect", "note", "notcomplete", "na"];

const NOT_YET = /\bnot\s+(yet|commenced|complete|compete|sighted|started|installed|fitted|done)\b/i;
const IN_PROGRESS = /progress|part done|temp|off hinges|incomplete/i;

/** The status a chosen answer stands for: a defect, a note, work in progress, not yet done, not applicable, or checked and okay. */
function statusOf(c: Chosen, isDefect: boolean): ItemStatus {
  if (isDefect) return "defect";
  if (c.tone === "na") return NOT_YET.test(c.label) ? "notcomplete" : "na";
  if (c.tone === "warn") {
    if (/note/i.test(c.label)) return "note";
    if (NOT_YET.test(c.label)) return "notcomplete";
    if (IN_PROGRESS.test(c.label)) return "progress";
    return "note";
  }
  return "ok";
}

/** The sentence under a row's name. */
function textFor(status: ItemStatus, c: Chosen, hasRedOption: boolean, plainYesNo: boolean): string {
  if (status === "defect") return "Refer defects.";
  if (status === "ok" && (SATISFACTORY.test(c.label) || hasRedOption || (plainYesNo && /^(yes|no)$/i.test(c.label)))) return "Checked and okay.";
  if (status === "note" && /note|^other$/i.test(c.label)) return "Refer notes.";
  if (status === "na" && NOT_APPLICABLE.test(c.label)) return "Not applicable.";
  return sentence(c.label);
}

const SEVERITY_ORDER: ItemStatus[] = ["defect", "note", "notcomplete", "progress", "ok", "na"];
const worst = (list: ItemStatus[]): ItemStatus => SEVERITY_ORDER.find((s) => list.includes(s)) ?? "ok";

interface Row {
  group?: string; heading: string; status: ItemStatus; text: string; key?: string; answer?: string;
  /** What the inspector typed, exactly (the row's text is it as a sentence). */ typed?: string;
  /** The template's sentence printed under the row (AFTER::). */ after?: string;
}

/** One checklist section -> its rows (heading, status and sentence) and the defects raised in it. */
function checklistRows(key: string, fields: TemplateField[], a: AnswerTree, kind: "site" | "stage", apartment = false): { rows: Row[]; defects: Defect[] } {
  const prePour = stageOfKey(key) === "pre_pour";
  const lockFix = stageOfKey(key) === "lock_fix";
  const rows: Row[] = [];
  const defects: Defect[] = [];
  const used = new Set<string>();
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  // The PCI house form also carries the unit form's Common Areas checks; a house report leaves them out (a defect recorded there still prints).
  const commonArea = (f: TemplateField) => !apartment && /^common areas?$/i.test((f.sectionLetter ?? "").trim()) && !(f.defectOn && typeof a[f.key] === "string" && f.defectOn.includes(a[f.key] as string));
  const visible = [...fields].filter((f) => isGateSatisfied(f, a) && !commonArea(f)).sort((x, y) => x.order - y.order);
  const headings = headingMap(fields);
  const area = kind === "site" ? "EXTERNAL" : areaOfSection(key);
  // The Apartment form groups Flyscreens with the car bay ("Flyscreens and car bay"); its template prints Flyscreens under Windows and
  // Doors and the car bay, storage cage and car stacker under BASEMENT.
  const windowsGroup = fields.map((f) => (f.sectionLetter ? groupOf(f.sectionLetter) : "")).find((g) => /^windows and doors$/i.test(g)) ?? "Windows and Doors";
  const groupFor = (f: TemplateField): string | undefined => {
    const g = f.sectionLetter ? groupOf(f.sectionLetter) : undefined;
    if (apartment && g && /^flyscreens and car bay$/i.test(g)) return /^flyscreens/i.test(f.label) ? windowsGroup : "Basement";
    return g;
  };
  const add = (f: TemplateField, heading: string, status: ItemStatus, text: string) => {
    if (text) rows.push({ group: groupFor(f), heading, status, text, key: f.key });
  };
  const hasRed = (f: TemplateField) => !!f.options?.some((x) => toneOfOption(x.color) === "bad");

  /** If this row was answered "Defect", record the defect (with the details the inspector gave) and say so. */
  const captureDefect = (f: TemplateField, rowHeading: string): boolean => {
    const v = a[f.key];
    let heading = defectItemName(rowHeading); // "Lower level roof covering inspected from ladder" -> "Lower level roof covering"
    if (f.type !== "pill-select" || typeof v !== "string") return false;
    const isDefect = f.defectOn ? f.defectOn.includes(v) : chosen(f, v).tone === "bad";
    if (!isDefect) return false;
    const d = asAnswerTree(a[`${f.key}${DEFECT_SUFFIX}`]);
    // An "Other" row is named by what the inspector typed for it ("Other: reclaimed hardwood" -> "Reclaimed hardwood — Front yard.").
    const typed = /_other$/.test(f.key) ? asString(a[`${f.key}_note`]).trim().replace(/[.]$/, "") : "";
    if (typed) heading = cap(typed);
    const internalDoor = lockFix && LF_INTERNAL_DOORS.has(f.key);
    defects.push({
      sub: internalDoor ? "Internal doors" : groupFor(f) ?? "General", area: internalDoor ? "INTERNAL" : area, location: asString(d.location).trim(),
      text: defectText(heading, asString(d.location).trim(), asString(d.comments).trim(), mapLabels(d.severity, SEVERITY_LABELS), mapLabels(d.category, CATEGORY_LABELS), asString(d.constructionCode).trim()),
      item: heading, description: rowDescription(heading, asString(d.location).trim(), asString(d.comments).trim(), lockFix ? "lock_fix" : undefined),
      photos: photosIn(d.photos),
    });
    return true;
  };
  const statusOfField = (f: TemplateField | undefined): ItemStatus => {
    const v = f ? a[f.key] : undefined;
    if (!f || typeof v !== "string" || !v) return "ok";
    const c = chosen(f, v);
    return statusOf(c, f.defectOn ? f.defectOn.includes(v) : c.tone === "bad");
  };

  // Items worked out from several rows at once are printed where their first row sits.
  const emitAt = new Map<string, () => void>();
  const anchorOf = (...fs: (TemplateField | undefined)[]) => visible.find((v) => fs.some((x) => x && x.key === v.key))!.key;

  // Measurements that sit in plan / site / result triples: "As estimated using …. Setbacks on plan are … millimetres and on site are approximately … millimetres."
  for (const f of visible) {
    const m = /^(.*)Plan$/.exec(f.key);
    if (!m || used.has(f.key)) continue;
    const base = m[1]!;
    const site = fieldByKey.get(`${base}Site`);
    if (!site) continue;
    const datum = fieldByKey.get(`${base}Datum`);
    const result = fieldByKey.get(`${base}Result`) ?? fieldByKey.get(`${base}StepResult`);
    const group = f.sectionLetter ? groupOf(f.sectionLetter) : "";
    const baseName = f.label.replace(/\s+on plan( is)?$/i, "").replace(/ \(approx\)$/i, "");
    const name = group && !baseName.toLowerCase().startsWith(group.toLowerCase().split(" ")[0]!) ? `${group} — ${lower(baseName)}` : baseName;
    const plan = asString(a[f.key]);
    const onSite = asString(a[site.key]);
    if (!plan && !onSite) continue;
    const parts: string[] = [];
    if (datum && a[datum.key]) {
      const d = chosen(datum, asString(a[datum.key])).label;
      parts.push(/^estimated (from|using) /i.test(d) ? `As ${lower(d)}.` : `As estimated using the ${lower(d)}.`);
    }
    parts.push(
      f.type === "numeric"
        ? `${/step/i.test(base) ? "On plan is" : "Setbacks on plan are"} ${toMm(plan)} and on site ${/step/i.test(base) ? "is" : "are approximately"} ${toMm(onSite)}.`
        : `On plan is ${plan || "—"} and on site is approximately ${onSite || "—"}.`,
    );
    const resRaw = result ? asString(a[result.key]) : "";
    let status: ItemStatus = "ok";
    if (result && resRaw) {
      const r = chosen(result, resRaw);
      status = statusOf(r, false);
      if (r.label) parts.push(r.tone === "ok" && SATISFACTORY.test(r.label) ? "Checked and okay." : sentence(r.label));
    }
    used.add(f.key); used.add(site.key); if (datum) used.add(datum.key); if (result) used.add(result.key);
    const text = parts.join(" ");
    emitAt.set(anchorOf(datum, f, site, result), () => add(f, name, status, text));
  }

  /** An observation as it reads after "… is": "Satisfactory" -> "satisfactory", "Refer defects" -> "defective", "Refer notes" -> "noted for attention". */
const observed = (c: Chosen): string => {
  if (c.tone === "bad" || /defect/i.test(c.label)) return "defective";
  if (/note/i.test(c.label)) return "noted for attention (refer notes)";
  if (/^ok$/i.test(c.label)) return "satisfactory";
  return lower(c.label);
};

  /** The template's sentence printed under the row just added. */
  const printUnder = (text: string) => { const last = rows[rows.length - 1]; if (last && text) last.after = text; };

  // The upper-roof rows carry a limitation sentence in the office template.
  const roofFrom = fieldByKey.get("upperRoofFrom");
  const upperRoofFromGround = !!roofFrom && typeof a.upperRoofFrom === "string" && /ground/i.test(chosen(roofFrom, a.upperRoofFrom).label);
  if (roofFrom && a.upperRoofFrom && !used.has("upperRoofFrom")) {
    const from = chosen(roofFrom, asString(a.upperRoofFrom)).label;
    const appears = fieldByKey.get("upperRoofAppears");
    const lowerRoof = fieldByKey.get("lowerRoofLadder");
    const up = appears && a.upperRoofAppears ? observed(chosen(appears, asString(a.upperRoofAppears))) : "";
    const low = lowerRoof && a.lowerRoofLadder ? observed(chosen(lowerRoof, asString(a.lowerRoofLadder))) : "";
    const ground = /ground/i.test(from);
    const parts = [
      ground ? OHS.roof : /scaffold/i.test(from) ? "The upper roof covering was inspected from the scaffold." : "",
      up ? (ground ? OHS.roofUpper(up) : `The upper roof covering is ${up}.`) : "",
      low ? OHS.roofLower(low) : "",
    ].filter(Boolean);
    used.add("upperRoofFrom"); used.add("upperRoofAppears"); used.add("lowerRoofLadder");
    if (parts.length) {
      const text = parts.join(" ");
      emitAt.set("upperRoofFrom", () => {
        const defect = [appears, lowerRoof].map((f) => (f ? captureDefect(f, headingOf(f.label)) : false)).some(Boolean);
        add(roofFrom, "Roof covering", defect ? "defect" : worst([statusOfField(appears), statusOfField(lowerRoof)]), defect ? `${text} Refer defects.` : text);
        if (ground) printUnder(text); // the template's OH&S sentences, under the row
      });
    }
  }
  const gutterAccess = fieldByKey.get("safeAccessGuttering");
  if (gutterAccess && a.safeAccessGuttering && !used.has("safeAccessGuttering")) {
    const noAccess = /no/i.test(chosen(gutterAccess, asString(a.safeAccessGuttering)).label);
    const g = fieldByKey.get("upperGutteringGround");
    const l = fieldByKey.get("lowerGutteringLadder");
    const up = g && a.upperGutteringGround ? observed(chosen(g, asString(a.upperGutteringGround))) : "";
    const low = l && a.lowerGutteringLadder ? observed(chosen(l, asString(a.lowerGutteringLadder))) : "";
    const parts = [
      noAccess ? OHS.gutters : "",
      up ? OHS.guttersUpper(up) : "",
      low ? OHS.guttersLower(low) : "",
    ].filter(Boolean);
    used.add("safeAccessGuttering"); used.add("upperGutteringGround"); used.add("lowerGutteringLadder");
    if (parts.length) {
      const text = parts.join(" ");
      emitAt.set("safeAccessGuttering", () => {
        const defect = [g, l].map((f) => (f ? captureDefect(f, headingOf(f.label)) : false)).some(Boolean);
        add(gutterAccess, "Roof gutters", defect ? "defect" : worst([statusOfField(g), statusOfField(l)]), defect ? `${text} Refer defects.` : text);
        if (noAccess) printUnder(text);
      });
    }
  }

  const rowByKey = new Map<string, Row>();
  for (const f of visible) {
    emitAt.get(f.key)?.();
    if (used.has(f.key)) continue;
    const v = a[f.key];
    const heading = headings.get(f.key) ?? headingOf(f.label);

    if (/_other_note$/.test(f.key)) continue; // printed with its "Other" row below
    if (f.type === "photos" || f.type === "repeating-group" || f.type === "damage-list") continue;
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;

    if (f.type === "pill-select" && typeof v === "string") {
      const c = chosen(f, v);
      if (/^(applicable|not applicable)$/i.test(c.label) && /^(truss|non-truss|hebel|masonry|blueboard|stairwell|balcony)/i.test(heading)) continue; // only switches a group of checks on or off
      if (c.other && !c.label) continue; // a typed "Other" with nothing typed says nothing
      if (f.key.endsWith("_material")) {
        // "Colorbond" belongs to the row above it; if that row was left out, it stands on its own.
        const baseRow = rowByKey.get(f.key.replace(/_material$/, ""));
        if (baseRow) baseRow.text = `${c.label}. ${baseRow.text}`.trim();
        else add(f, heading, "ok", sentence(c.label));
        continue;
      }
      const isOtherRow = /_other$/.test(f.key);
      const isDefect = f.defectOn ? f.defectOn.includes(v) : c.tone === "bad";
      let status = statusOf(c, isDefect);
      if (apartment && !isDefect) {
        // The Apartment template uses "Multi-level complex" only in the construction line, not as a Roof row; and an apartment has no
        // garage row unless the inspector answered it with something other than N/A.
        if (/^multi-level complex$/i.test(heading)) continue;
        if (/^garage\b/i.test(heading) && status === "na") continue;
      }
      // "Yes" / "No" on a check that also offers "see notes" (power supply: Yes / No - see notes) means it is fine; "Complete? Yes" is an answer in itself.
      const plainYesNo = !/complete\??$/i.test(heading) && !!f.options?.some((x) => toneOfOption(x.color) !== "ok");
      let text = textFor(status, c, hasRed(f), plainYesNo);
      // Lock-up & Fixing: an answer the form no longer offers (an older inspection) is said in words, not as "Checked and okay."
      if (lockFix && !c.other && !f.options?.some((o) => o.value === v)) text = sentence(c.label);
      // The Pre-pour template's fixed wording for two rows: the power supply's "Meter & Pole at Slab", and the note above the kitchen bench penetrations.
      if (prePour && f.key === "powerSupply" && status === "ok") text = POWER_SUPPLY_OK;
      if (prePour && f.key === "kitchenBenchPenetrations" && status !== "na") text = `${KITCHEN_BENCH_FIXED} ${text}`;
      let typedText = "";
      if (isOtherRow) {
        // "Other": printed only when the inspector said what it was (or it is a defect).
        const note = asString(a[`${f.key}_note`]).trim();
        if (!note && !isDefect) continue;
        if (note) {
          text = isDefect ? `${text} ${sentence(cap(note))}` : sentence(cap(note));
          if (!isDefect) typedText = note;
          if (status === "ok" || status === "na") status = "note";
        }
      }
      const row: Row = { group: groupFor(f), heading, status, text, key: f.key, answer: c.label, typed: typedText || undefined };
      // The upper roof seen from the ground only: the template's flashings sentences under "Roof Flashing" and "Parapet Flashing / Capping".
      // The form has no upper / lower answers for the flashings, so they read from the row's own answer: OK fills both in; a defect
      // keeps the first sentence and points to the defects (which level is defective is in the defect itself).
      if (upperRoofFromGround && FLASHING_ROWS.has(f.key) && status !== "na") {
        row.after = status === "defect" ? `${OHS.flashings} Refer defects.`
          : status === "ok" ? [OHS.flashings, OHS.flashingsUpper("satisfactory"), OHS.flashingsLower("satisfactory")].join(" ")
          : [OHS.flashings, OHS.flashingsUpper(observed(c)), OHS.flashingsLower(observed(c))].join(" ");
      }
      rows.push(row);
      rowByKey.set(f.key, row);
      if (isDefect) captureDefect(f, heading);
      continue;
    }

    if (f.type === "yesno") { add(f, heading, "ok", v === "yes" ? "Yes." : v === "no" ? "No." : ""); continue; }
    if (f.type === "chip-multiselect" || f.type === "tile-multiselect") {
      const list = labelsOf(f, v);
      if (!list.length) continue;
      if (/visible at$/i.test(heading)) {
        const name = heading.replace(/\s+(are\s+)?visible at$/i, "");
        // Pre-pour: "Boundary survey pegs visible at front and rear." as the template words it.
        add(f, name, "ok", /none/i.test(list[0]!) ? "None visible." : prePour ? `${name} visible at ${joinList(list.map(lower))}.` : `Visible at ${joinList(list.map(lower))}.`);
      }
      else add(f, heading, "ok", sentence(joinList(list)));
      continue;
    }
    if (f.type === "numeric") { add(f, heading, "ok", `${asString(v) || String(v)}${f.unit ? ` ${f.unit}` : ""}.`); continue; }
    if (f.type === "text" || f.type === "textarea" || f.type === "date") {
      const t = asString(v).trim();
      if (t) { add(f, heading, "note", sentence(cap(t))); rows[rows.length - 1]!.typed = t; }
    }
  }
  return { rows, defects };
}

/** Sentences the Site & Facilities answers add to the report's Notes. */
function siteNotes(stage: StageId, fields: TemplateField[], a: AnswerTree): string[] {
  const pick = (key: string) => {
    const f = fields.find((x) => x.key === key);
    const v = a[key];
    return f && typeof v === "string" ? chosen(f, v) : null;
  };
  const notes: string[] = [];
  const fence = pick("securityFencing");
  if (fence && (fence.tone === "warn" || fence.tone === "bad")) notes.push("Sections of the security fence are not in position and need to be re-instated.");
  const rubbish = pick("rubbishDangerous");
  const managed = pick("siteManaged");
  const finalClean = pick("finalSiteClean");
  // "Is the site well managed?" answered "Can be improved …" (REFER NOTES): the Lock-up template's "Site appears to be well managed."
  // before the clean-up note -- unless the inspector typed a note of their own about it in this section, which is printed instead.
  const typedHere = fields.filter((x) => x.type === "text" || x.type === "textarea").map((x) => asString(a[x.key]).trim()).filter(Boolean);
  if (stage === "lock_fix") {
    // The Lock-up & Fixing template: one sentence for the answer. "Yes" -> "Site appears to be well managed." (unless the inspector wrote
    // their own note about it); "Can be improved by cleaning up rubbish …" -> only the clean-up sentence, once.
    if (managed && managed.tone === "ok" && !typedHere.some((t) => SITE_MANAGEMENT.test(t))) notes.push(WELL_MANAGED);
    if ((rubbish && rubbish.tone === "bad") || (managed && managed.tone !== "ok") || (finalClean && /required/i.test(finalClean.label))) notes.push(CLEAN_UP);
    // Kerb damage: the template's sentence once, then the inspector's own kerb note in their words (no "Site and facilities:" in front).
    const kerbLf = pick("kerbDamage");
    if (kerbLf && kerbLf.tone !== "ok") {
      const typed = asString(a.kerbOther).trim();
      notes.push(typed ? `${KERB} ${sentence(cap(typed))}` : KERB);
    }
    return notes;
  }
  if (managed && managed.tone === "warn" && !typedHere.some((t) => SITE_MANAGEMENT.test(t))) notes.push(WELL_MANAGED);
  if ((rubbish && rubbish.tone === "bad") || (managed && managed.tone !== "ok") || (finalClean && /required/i.test(finalClean.label))) {
    notes.push(stage === "pci" ? "Final builder's clean to be completed." : CLEAN_UP);
  }
  const kerb = pick("kerbDamage");
  if (kerb && kerb.tone !== "ok") notes.push(stage === "pci" ? KERB_PCI : KERB);
  return notes;
}

/** The templates' site clean-up note. */
export const CLEAN_UP = "Site needs a clean-up of rubbish/debris to improve access and safety.";
/** The Lock-up template's sentence under "Management of Site". */
export const WELL_MANAGED = "Site appears to be well managed.";
/** A typed note that is about how the site is managed (so it is the note for "Is the site well managed?"). */
const SITE_MANAGEMENT = /\b(well[- ]managed|managed|management|rubbish|clean[- ]?up|untidy|tidy|debris)\b/i;

/** The kerb damage note: the Pre-pour, Slab and Frame templates' wording, and the PCI template's own. */
export const KERB = "Damage was noted to the footpath/kerbs/nature strip/vehicle crossover. Usually, such items are attended to at the end of the project and arranged between the construction company and the local authority.";
export const KERB_PCI = "Damage was noted to the footpath/kerbs/vehicle crossover/nature strip. Usually, such damage is attended to at the end of the project and arranged between the construction company and the local authority.";

// ───────────────────────── Statement and notes ─────────────────────────

/** The office templates' ground-falls note (Notes section), as the Pre-pour and Frame templates word it, every stage. */
export const GROUND_FALLS =
  "Due to ground falls towards the slab stormwater may pond and affect the footings. Stormwater needs to be controlled on site by the construction company to protect the foundations and surface to be graded to fall away from the building/s – refer to Codes 2. Footings and to Site Drainage requirements. Soil may erode and potentially block stormwater pipes – some protection may be advisable until landscaping/retaining works are done.";
/** The Pre-pour template's text under "Power supply to site" when the supply is in place. */
export const POWER_SUPPLY_OK = "Meter & Pole at Slab";
/** The Pre-pour template's fixed sentence under "Kitchen Bench Supply Penetrations Correctly Positioned", above the inspector's comment. */
export const KITCHEN_BENCH_FIXED = "Positions are estimates only from formwork. The positions will need to be measured after Slab Down.";

/** The office templates' sentence for retaining walls (the checklist's "Advise retaining wall/s would be prudent?" and the Summary tick). */
export const RETAINING_WALLS = "Retaining walls are advised.";

/** "Front setback" -> "The front setback is", "Slab dimensions — length" -> "The slab length is", "Alfresco slab — step down" -> "The alfresco slab step down is". */
function theSubject(heading: string): string {
  const h = lower(heading).replace(/^slab dimensions — (length|width)$/i, "slab $1").replace(/\s+[—–-]\s+/g, " ");
  return `The ${h} ${/dimensions$/i.test(h) ? "are" : "is"}`;
}

/**
 * The note each "see notes" answer leads to, by form field, as a sentence of its own (the office templates' wording where they have one,
 * e.g. Frame: "Sisalation has not yet been installed to frame."). Each field has one answer that leads to a note; the pattern checks it is
 * that answer, so no other answer can print the sentence. Shared by every stage that has the field.
 */
const NOTE_SENTENCES: Record<string, { answer: RegExp; note: string; /** What a typed note on the same thing mentions: then the inspector's note is printed, not this one. */ typedAbout?: RegExp }> = {
  powerSupply: { answer: /^no\b/i, note: "There is no power supply to the site.", typedAbout: /\bpower\b|\belectricity\b/i },
  waterSupply: { answer: /^no\b/i, note: "There is no water supply to the site.", typedAbout: /\bwater\s+(supply|connect\w*|service)\b|\bno\s+water\b|\btap\b/i },
  siteToilet: { answer: /^no\b/i, note: "There is no site toilet in position.", typedAbout: /\btoilet\b/i },
  ceilingInsulation: { answer: /^no\b/i, note: "Ceiling insulation has not yet been installed." },
  manhole: { answer: /^not yet\b/i, note: "The manhole has not yet been installed." },
  garageSlab: { answer: /^infill later\b/i, note: "The garage slab is to be infilled later." },
  porchSlab: { answer: /^infill later\b/i, note: "The porch slab is to be infilled later." },
  alfrescoSlab: { answer: /^infill later\b/i, note: "The alfresco slab is to be infilled later." },
  poolFormed: { answer: /^refer notes$/i, note: "The inground pool is noted for attention." },
  inGroundPool: { answer: /^refer notes$/i, note: "The inground pool is noted for attention." },
  footingDepths: { answer: /^could not see$/i, note: "The footing depths could not be seen at the time of inspection." },
  excessWater: { answer: /^could not see$/i, note: "The footings could not be seen to check for excess water at the time of inspection." },
  polythene: { answer: /^covered in backfill$/i, note: "The polyethylene could not be checked as it is covered in backfill." },
  adviseRetaining: { answer: /^yes\b/i, note: RETAINING_WALLS },
};

/**
 * The row an "Other" box belongs to, as the report names it: its group on the form ("Hebel", "Slab quality", "Roof"), else the row's own
 * name without "other" ("Stairwell/s — other" -> "Stairwell/s"). The PCI "Services & Other" group's own "Other" reads "Services and other".
 */
function otherRowName(r: Row, lockFix = false): string {
  const own = r.heading.replace(/\s*[—–-]\s*other\??$/i, "").replace(/^other\??$/i, "").trim();
  // Lock-up & Fixing: a group's name in front reads wrong ("Painting: Kitchen island end panel …" from the fit-out's "Other?"): only the
  // row's own name ("Hebel — other" -> "Hebel"), and no name when the box is just "Other".
  if (lockFix) return own ? cap(own) : "";
  const name = r.group && !/^other$/i.test(r.group) ? r.group : own || (r.group ? "Services and other" : "Other");
  return cap(name);
}

/** One "Refer notes" row as its note: a full sentence, never the row's name and the answer ("Ceiling insulation installed — no."). */
function noteOf(r: Row, rows: Row[] = [], lockFix = false): string {
  // What the inspector typed (an "Other" box, "Part done to …") is the note, in their words.
  if (r.typed) {
    const typed = r.typed.trim();
    if (r.key === "plasterworkPartDone") return sentence(`Plasterwork is part done to ${lower(typed).replace(/[.]$/, "")}`);
    // An "Other" box: the row it belongs to, then the inspector's words exactly as typed, with a full stop if they left none ("Hebel: Some sheets cracked.").
    const name = otherRowName(r, lockFix);
    return sentence(name ? `${name}: ${typed}` : cap(typed));
  }
  const own = r.key ? NOTE_SENTENCES[r.key] : undefined;
  if (own && own.answer.test(r.answer ?? "")) {
    // One sentence per thing: when the inspector typed a note about it in this section ("No water supply on site …"), theirs is printed.
    if (own.typedAbout && rows.some((o) => o !== r && o.typed && own.typedAbout!.test(o.typed))) return "";
    return own.note;
  }
  // A measurement the builder is to re-check: "The front setback is to be re-checked by the builder. As estimated from pegs, setbacks on plan are …"
  if (/\bbuilder to re-check\.?$/i.test(r.text)) {
    const detail = r.text.replace(/\s*\bbuilder to re-check\.?$/i, "").trim()
      .replace(/^(As [^.]+)\.\s+(\S)/, (_m, as: string, c: string) => `${as}, ${c.toLowerCase()}`)
      .replace(/^On plan is (.+) and on site is /, "On plan it is $1 and on site it is ");
    return [`${theSubject(r.heading)} to be re-checked by the builder.`, detail ? sentence(cap(detail)) : ""].filter(Boolean).join(" ");
  }
  // The roof and gutter rows are already sentences ("The upper roof covering is noted for attention (refer notes).").
  if (r.key === "upperRoofFrom" || r.key === "safeAccessGuttering") return cap(r.text.replace(/\s*\((refer|see) (to )?notes\)/gi, "").trim());
  // Any other row (none in today's forms): its name and what is left of the answer, as one sentence.
  const strip = (t: string) => t.replace(/[\s,—–-]*\(?\s*\b(refer|see)\s+(to\s+)?notes\b\s*\)?\.?/gi, "").trim().replace(/^[—–-]\s*/, "").replace(/[\s,—–-]+$/, "");
  const detail = strip(r.text) || strip(r.answer ?? "");
  return detail ? sentence(`${cap(r.heading)}: ${lower(detail)}`) : sentence(cap(r.heading));
}

/**
 * The notes a section's "Refer notes" rows lead to. Rows that already have one of the template's own notes are left to it -- security
 * fencing, site clean-up and kerb damage (Site & Facilities, siteNotes) and the ground falls (site drainage / agi drains, below); every
 * other row's note is a sentence of its own (noteOf).
 */
const OWN_NOTE = new Set(["securityFencing", "rubbishDangerous", "siteManaged", "finalSiteClean", "kerbDamage", "siteDrainage", "agiDrain"]);
function referredNotes(rows: Row[], lockFix = false): string[] {
  const notes: string[] = [];
  const drainage = rows.some((r) => (r.key === "siteDrainage" && r.status === "defect") || (r.key === "agiDrain" && r.status === "note"));
  if (drainage) notes.push(GROUND_FALLS);
  for (const r of rows) {
    if (r.status !== "note" || (r.key && OWN_NOTE.has(r.key))) continue;
    // Lock-up & Fixing: the OH&S sentences print once, under their row (not again in Notes); the kerb box is in the kerb note (siteNotes).
    if (lockFix && (r.after || (r.key === "kerbOther" && rows.some((o) => o.key === "kerbDamage" && o.status !== "ok")))) continue;
    const n = noteOf(r, rows, lockFix);
    if (n) notes.push(n);
  }
  return notes;
}

function summaryLines(stage: StageId, fields: TemplateField[], a: AnswerTree): string[] {
  const meta = STAGES[stage];
  const lines: string[] = [];
  if (a.workmanshipSatisfactory === "yes") lines.push(`${meta.workmanshipLead} is generally to a satisfactory industry standard, except for the defects noted above.`);
  else if (a.workmanshipSatisfactory === "no") lines.push(`${meta.workmanshipLead} is not generally to a satisfactory industry standard. Refer to the defects noted above.`);
  if (stage === "pre_pour") {
    const works = fields.find((f) => f.key === "worksStatus");
    const w = works && typeof a.worksStatus === "string" && a.worksStatus ? chosen(works, a.worksStatus).label : "";
    if (w) lines.push(`The works are ${lower(w)}.`);
    if (a.contactedSupervisor === "yes") lines.push("The inspector contacted the slab/site supervisor regarding defects/concerns, and they are to be attended to prior to the concrete pour.");
  }
  lines.push(...meta.standingNotes);

  const ticks = asList(a.notesToInclude);
  const fenceDetail = asString(a.securityFencingDetail).trim();
  if (ticks.includes("security_fencing")) lines.push(fenceDetail ? `Security fencing is ${inline(fenceDetail)} and needs to be reinstated.` : "Sections of the security fence are not in position and need to be re-instated.");
  if (ticks.includes("ground_falls")) lines.push(GROUND_FALLS);
  const g = asString(a.groundFallsDetail).trim();
  if (g) lines.push(sentence(cap(g)));
  const r = asString(a.retainingWallsDetail).trim();
  // The tick's sentence, then what the inspector typed, in their words: "Retaining walls are advised. Timber sleeper retaining wall …"
  const withDetail = (lead: string, detail: string) => (detail ? `${lead} ${sentence(cap(detail))}` : lead);
  if (ticks.includes("retaining_walls")) lines.push(withDetail(RETAINING_WALLS, r));
  const agi = asString(a.agiDrainsDetail).trim();
  if (ticks.includes("agi_drains")) lines.push(withDetail("Agi drains are advised.", agi));
  const roof = asString(a.roofAccessDetail).trim();
  if (ticks.includes("roof_access")) lines.push(withDetail("Roof access was limited.", roof));
  const other = asString(a.otherConcerns).trim();
  if (other) lines.push(sentence(cap(other)));
  return lines;
}

function attachedList(a: AnswerTree, prefix: "clientList" | "previousDefects"): string[] {
  if (asString(a[`${prefix}Status`]) !== "attached") return [];
  const updates = asString(a[`${prefix}Updates`]).trim();
  const intro = prefix === "clientList" ? "The client's list of issues is attached, with the inspector's comments." : "The previous report's defects list is attached, with the updates shown.";
  return [intro, ...(updates ? [cap(updates)] : [])];
}

// ───────────────────────── One section ─────────────────────────

/** The report text and recorded defects for one Construction Stage section. */
export function composeConstructionSection(key: string, fields: TemplateField[], a: AnswerTree, apartment: boolean): Composed {
  const stage = stageOfKey(key);
  if (!stage) return { text: "", damages: [] };
  // Lock-up & Fixing: an answer the form no longer offers (an older inspection) prints as words, never as its stored code.
  if (stage === "lock_fix") return withReadableCodes(() => composeSection(key, stage, fields, a, apartment));
  return composeSection(key, stage, fields, a, apartment);
}

function composeSection(key: string, stage: StageId, fields: TemplateField[], a: AnswerTree, apartment: boolean): Composed {
  const kind = kindOfKey(key);
  const lines: string[] = [];
  const defects: Defect[] = [];

  if (kind === "description") lines.push(...describe(stage, fields, a, apartment));
  else if (kind === "summary") lines.push(...summaryLines(stage, fields, a));
  else if (kind === "client") lines.push(...attachedList(a, "clientList"));
  else if (kind === "previous") lines.push(...attachedList(a, "previousDefects"));
  else if (kind === "defects") defects.push(...tableDefects(a, stage));
  else if (kind === "typical") defects.push(...typicalDefects(fields, a));
  else {
    const { rows, defects: raised } = checklistRows(key, fields, a, kind === "site" ? "site" : "stage", apartment);
    let group: string | undefined;
    for (const r of rows) {
      if (r.group !== group) {
        group = r.group;
        if (group) lines.push(`${TAGS.room}${group}`);
      }
      lines.push(`${TAGS.item}${r.heading}::${r.status}::${r.text}`);
      if (r.after) lines.push(`${TAGS.after}${r.after}`);
    }
    defects.push(...raised);
    if (kind === "site") for (const n of siteNotes(stage, fields, a)) lines.push(`${TAGS.note}${n}`);
    for (const n of referredNotes(rows, stage === "lock_fix")) lines.push(`${TAGS.note}${n}`);
  }

  if (defects.length > 0) {
    lines.push(`${TAGS.room}Defects`);
    defects.forEach((d, i) => lines.push(`${TAGS.defect}${i}::${d.text}`));
  }
  return {
    text: lines.join("\n\n"),
    damages: defects.map((d) => ({ type: d.sub, location: d.location, direction: d.area, widthMm: 0, lengthMm: 0, notes: "", photos: d.photos, item: d.item, description: d.description })),
  };
}
