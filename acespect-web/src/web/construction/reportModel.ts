/**
 * The Construction Report: turns a submitted Construction Stage inspection (its sections' answers + the templates they
 * were answered against) into the report content, following Houspect's office templates ("ACESPECT <stage>_Office
 * Template"): cover details, General Description, Photographs, Site & Facilities, the stage's own checks (one heading and
 * one sentence each), Identified Defects Requiring Attention (numbered, with photos), Notes, Client queries, items from the
 * previous inspection, and the References and Guide to Standards and Tolerances.
 *
 * Pure functions only (no React), so the same model drives the web page, the PDF and the tests.
 */
import type { AnswerTree, AnswerValue, TemplateField } from "../templateFields";
import { asAnswerTree, asString, asStringArray, isGateSatisfied, otherAnswerText } from "../templateFields";
import library from "./codeLibrary.json";

// ───────────────────────── Stages ─────────────────────────

export type StageId = "pre_pour" | "slab" | "framework" | "lock_up" | "fixing" | "pci" | "slab_frame" | "lock_fix";

const PREFIXES: [string, StageId][] = [
  ["pp_", "pre_pour"], ["sd_", "slab"], ["fr_", "framework"], ["lu_", "lock_up"], ["fx_", "fixing"], ["pci_", "pci"], ["sf_", "slab_frame"], ["lf_", "lock_fix"],
];

/** The stage an inspection belongs to, read from its section keys ("pp_description" -> Pre-Pour). */
export function stageOfSectionKeys(keys: string[]): StageId | null {
  for (const k of keys) {
    const hit = PREFIXES.find(([p]) => k.startsWith(p));
    if (hit) return hit[1];
  }
  return null;
}

interface StageMeta {
  label: string;
  /** The start of the statement, e.g. "The workmanship of the slab" -> "… is generally to a satisfactory industry standard, except for the defects noted above." */
  workmanshipLead: string;
  /** Defects are listed under EXTERNAL / INTERNAL with area sub-headings (Lock Up onward), otherwise as one numbered list. */
  groupedDefects: boolean;
  /** Numbered references and fixed blocks that stay in the references section for this stage. */
  defaultCodes: string[];
  defaultBlocks: string[];
  progress: string;
  /** Fixed notes the office template carries for this stage. */
  standingNotes: string[];
}

const PURPOSE =
  "The purpose of the inspection is to check on the progress of works and quality of workmanship at the specified construction stage, and to identify defects or faults in the new construction, insofar as a licensed builder / building consultant / building practitioner can reasonably identify those defects or faults.";
const GENERAL =
  "This report is the result of a visual inspection only and is intended to provide a reasonable confirmation of the progress of works and to note items that may need attention by the construction builder to ensure satisfactory quality of workmanship.";

const SLAB_CODES = ["2.01", "2.02", "2.03"];
const SLAB_BLOCKS = ["polyethylene", "bca_drainage", "site_drainage"];

const STAGES: Record<StageId, StageMeta> = {
  pre_pour: {
    label: "Pre-Pour Slab",
    workmanshipLead: "The finish and workmanship of the set out for the slab",
    groupedDefects: false,
    defaultCodes: SLAB_CODES,
    defaultBlocks: [...SLAB_BLOCKS, "exposed_reo"],
    progress: "Progress of the works to date is at pre-slab pour stage.",
    standingNotes: [
      "Houspect inspectors are registered builders and architects, not engineers, and the pre-pour inspection is not a verification of the design or computations of the footings/slab based on the soil tests. The requirements for foundations are specified by the engineers.",
      "Our inspection is limited to checking the positioning and pegging of the boxing of the slab, in relation to the site plan and the floor plan; the form work for the step downs to garage and/or alfresco areas are in place; that the steel reinforcing is in position and on the saddles, and related items including the polyethylene. Houspect checks the set-backs of the slab lay-out to see if it is positioned on the site as per the site plan. We also inspect the site management to ensure there is security fencing, power and water are onsite, that there is no rubbish on site that could cause a hazard or anything else that could hinder the proper installation of the slab and related construction work.",
    ],
  },
  slab: {
    label: "Slab Down",
    workmanshipLead: "The workmanship of the slab",
    groupedDefects: false,
    defaultCodes: SLAB_CODES,
    defaultBlocks: SLAB_BLOCKS,
    progress: "Progress of the works to date is slab down stage.",
    standingNotes: [],
  },
  framework: {
    label: "Frame",
    workmanshipLead: "The workmanship of the framework",
    groupedDefects: false,
    defaultCodes: [],
    defaultBlocks: [],
    progress: "The progress of the works to date is Framework.",
    standingNotes: [
      "This inspection is focussed on the key structural items of the framing, bracing and fixing. Minor variations in framing will be subject to additional straightening at pre-plaster stage with packing and trimming to studs and plates.",
    ],
  },
  lock_up: {
    label: "Lock Up",
    workmanshipLead: "The workmanship of the lock-up stage",
    groupedDefects: true,
    defaultCodes: [],
    defaultBlocks: [],
    progress: "Progress of the works to date is the Lock Up stage.",
    standingNotes: [],
  },
  fixing: {
    label: "Fixing (Pre-paint)",
    workmanshipLead: "The workmanship to fixing stage",
    groupedDefects: true,
    defaultCodes: [],
    defaultBlocks: [],
    progress: "The progress of the works to date is Fixing.",
    standingNotes: [
      "Builder to provide the owner with copies of all certificates of compliance from trades for electrical, plumbing, waterproofing and insulation installation.",
    ],
  },
  pci: {
    label: "Practical Completion / Handover / Defects Liability",
    workmanshipLead: "The workmanship",
    groupedDefects: true,
    defaultCodes: [],
    defaultBlocks: [],
    progress: "Progress of the works to date is approaching practical completion / handover / defects liability.",
    standingNotes: [
      "Builder to provide to the owner all information for appliances including handbooks, warranties and certificates.",
      "Builder to provide the owner with the Certificate of Occupancy (COO) from the building surveyor.",
      "Builder to provide the owner with copies of all certificates of compliance from trades for electrical, plumbing, waterproofing and insulation installation.",
    ],
  },
  slab_frame: {
    label: "Slab down & Frame",
    workmanshipLead: "The workmanship of the slab and framework",
    groupedDefects: false,
    defaultCodes: SLAB_CODES,
    defaultBlocks: SLAB_BLOCKS,
    progress: "Progress of the works to date is frame stage.",
    standingNotes: [
      "This inspection is focussed on the key structural items of the framing, bracing and fixing. Minor variations in framing will be subject to additional straightening at pre-plaster stage with packing and trimming to studs and plates.",
    ],
  },
  lock_fix: {
    label: "Lock-up & Fixing",
    workmanshipLead: "The workmanship of the lock-up and fixing stages",
    groupedDefects: true,
    defaultCodes: [],
    defaultBlocks: [],
    progress: "The progress of the works to date is lock up and fixing.",
    standingNotes: [
      "Builder to provide the owner with copies of all certificates of compliance from trades for electrical, plumbing, waterproofing and insulation installation.",
    ],
  },
};

export const stageMeta = (id: StageId): StageMeta => STAGES[id];

// ───────────────────────── Model ─────────────────────────

export interface ReportPhotoSet { photos: string[] }

export interface ReportItem {
  heading: string;
  text: string;
  photos: string[];
  defectNos: number[];
}
export interface ReportGroup { heading?: string; items: ReportItem[] }
export interface ReportBlock { banner: string; groups: ReportGroup[] }

export interface DefectEntry {
  no: number;
  area: "EXTERNAL" | "INTERNAL";
  sub: string;
  /** The sentence for this defect: the checklist item, where it is, and the inspector's comments. */
  text: string;
  categories: string[];
  severities: string[];
  code: string;
  photos: string[];
  /** Where it came from, to tie the checklist row back to its defect number. */
  id: string;
}

export interface ReferenceSection { section: string; codes: { code: string; title: string; text: string[] }[] }

export interface ConstructionReportModel {
  stage: StageId;
  stageLabel: string;
  purpose: string;
  general: string;
  description: string[];
  streetPhotos: string[];
  otherPhotos: string[];
  site: ReportGroup[];
  blocks: ReportBlock[];
  defects: DefectEntry[];
  groupedDefects: boolean;
  notes: string[];
  clientQueries: { text: string; photos: string[] } | null;
  previous: { text: string; photos: string[] } | null;
  blocksRef: { title: string; text: string[] }[];
  references: ReferenceSection[];
  /** Sections that were submitted but not yet approved, so they are not printed. */
  waitingSections: string[];
}

export interface SectionInput {
  key: string;
  name: string;
  answers: AnswerTree | null;
  fields: TemplateField[];
  approved: boolean;
  excludedPhotos?: string[];
}

// ───────────────────────── Answer helpers ─────────────────────────

const TONE_BY_COLOR: Record<string, "ok" | "bad" | "warn" | "na"> = { "#1FA463": "ok", "#E63329": "bad", "#E8A33D": "warn", "#94A1B2": "na" };

interface Chosen { label: string; tone: "ok" | "bad" | "warn" | "na" | "plain"; other: boolean }

/** The option a stored value points at (its label and colour tone), or the typed "Other" text. */
function chosen(field: TemplateField, raw: string): Chosen {
  const other = otherAnswerText(raw);
  if (other !== undefined) return { label: other, tone: "plain", other: true };
  const opt = field.options?.find((o) => o.value === raw);
  if (!opt) return { label: raw, tone: "plain", other: false };
  return { label: opt.label, tone: (opt.color && TONE_BY_COLOR[opt.color]) || "plain", other: false };
}

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "Gutters; debris, lack of fall…" -> "Gutters": the report headings are the short names; the rest is the form's own guidance. */
function headingOf(label: string): string {
  let depth = 0;
  let cut = label.length;
  for (let i = 0; i < label.length; i++) {
    const ch = label[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) { cut = i; break; }
  }
  return label.slice(0, cut).replace(/\s+—\s+material$/i, "").trim().replace(/\s*\?$/, "");
}

/**
 * The heading each row prints under. Normally the short name ("Gutters"); where two rows share a short name ("Gutters;
 * clipped…" and "Gutters; debris…") the rest of the label is kept so they can be told apart.
 */
function headingMap(fields: TemplateField[]): Map<string, string> {
  const base = new Map<string, number>();
  for (const f of fields) if (f.type === "pill-select") base.set(headingOf(f.label), (base.get(headingOf(f.label)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const f of fields) {
    const b = headingOf(f.label);
    const full = f.label.replace(/\s*;\s*/, " — ").replace(/\s*\?$/, "");
    const clipped = full.length <= 110 ? full : `${full.slice(0, 107).replace(/[\s,;(]+\S*$/, "")}…`;
    out.set(f.key, (base.get(b) ?? 0) > 1 ? clipped : b);
  }
  return out;
}

const SATISFACTORY = /^((yes|no)\s*[—-]\s*)?ok$|^satisfactory$|^yes\s*[—-]\s*required$/i;
const NOT_APPLICABLE = /^(n\/a|not applicable)$/i;

function labelsOf(field: TemplateField | undefined, v: AnswerValue): string[] {
  if (!field) return [];
  const list = Array.isArray(v) ? asStringArray(v) : typeof v === "string" && v ? [v] : [];
  return list.map((raw) => chosen(field, raw).label);
}

function photosIn(v: AnswerValue, excluded: string[] = []): string[] {
  return asStringArray(v).filter((u) => !excluded.includes(u));
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// ───────────────────────── Description ─────────────────────────

function describe(stage: StageId, fields: TemplateField[], a: AnswerTree, status: string, apartment: boolean): string[] {
  const f = (k: string) => fields.find((x) => x.key === k);
  const one = (k: string) => lower(labelsOf(f(k), a[k])[0] ?? "");
  const all = (k: string) => labelsOf(f(k), a[k]).map(lower);
  const out: string[] = [];

  const by = labelsOf(f("constructedBy"), a.constructedBy)[0];
  if (by) out.push(`The property is being constructed by ${by}.`);

  const kind = one("constructionIs") || one("design");
  const foundations = one("foundations");
  if (kind) out.push(`The construction is a ${kind} ${apartment ? "apartment" : "house"}.`);
  if (foundations) out.push(`Foundations are ${foundations}.`);

  const ground = all("groundCladding");
  const first = all("firstCladding").filter((x) => x !== "not applicable");
  const groundCombo = asString(a.groundCladdingCombo).trim();
  const firstCombo = asString(a.firstCladdingCombo).trim();
  if (ground.length || first.length) {
    const g = ground.map((x) => (x === "combination of" ? groundCombo || x : x));
    const fl = first.map((x) => (x === "combination of" ? firstCombo || x : x));
    out.push(`Wall cladding is constructed of ${joinList(g)}${fl.length ? ` to the ground floor and ${joinList(fl)} to the first floor` : ""}.`);
  }

  const windows = one("windowsAre");
  if (windows) out.push(`Windows are constructed of ${windows}.`);
  const roofDesign = one("roofDesign");
  const roofCover = one("roofCoveringIs");
  if (roofDesign || roofCover) {
    out.push(`The roof design is ${roofDesign || "—"}${roofCover ? ` and the covering is constructed of ${roofCover}` : ""}.`);
  }
  const frontage = one("frontage");
  if (frontage) out.push(`The street frontage is to the ${frontage}.`);
  const block = one("blockSlope");
  if (block) out.push(`The block is ${block}.`);
  if (a.supervisorOnSite === "yes" || a.supervisorOnSite === "no") out.push(`The site supervisor was${a.supervisorOnSite === "no" ? " not" : ""} onsite at the time of inspection.`);
  if (a.ownersOnSite === "yes" || a.ownersOnSite === "no") out.push(`The owners were${a.ownersOnSite === "no" ? " not" : ""} present for the inspection.`);
  if (a.safetyIssues === "yes") {
    const d = asString(a.safetyDescribe).trim();
    out.push(d ? `Safety issues were noted: ${sentence(d)}` : "Safety issues were noted on site.");
  }
  out.push(stage === "pci" && status ? `Progress of the works to date is ${lower(status.split(" — ")[0] ?? status)}.` : STAGES[stage].progress);
  return out;
}

// ───────────────────────── Checklist sections ─────────────────────────

/** The order the app lists a stage's sections in, which is also the order they print in. */
const SECTION_ORDER: string[] = ['pp_description','pp_site_facilities','pp_measurements','pp_formwork','pp_general','pp_defects','pp_summary','pp_client_issues','sd_description','sd_site_facilities','sd_measurements','sd_quality','sd_defects','sd_summary','sd_previous_defects','sd_client_issues','fr_description','fr_site_facilities','fr_services','fr_roof_frame','fr_wall_floor','fr_windows_doors','fr_progress','fr_defects','fr_summary','fr_previous_defects','fr_client_issues','lu_description','lu_site_facilities','lu_external_walls','lu_doors_windows','lu_framework','lu_roofing','lu_defects','lu_summary','lu_previous_defects','lu_client_issues','fx_description','fx_site_facilities','fx_walls_ceilings','fx_stairs_floors','fx_doors_windows','fx_fitout','fx_waterproofing','fx_defects','fx_summary','fx_previous_defects','fx_client_issues','pci_description','pci_site_facilities','pci_roof','pci_walls_doors','pci_garage_site','pci_internal','pci_finishes','pci_services','pci_typical_defects','pci_defects','pci_summary','pci_previous_defects','pci_client_issues','sf_description','sf_site_facilities','sf_measurements','sf_quality','sf_services','sf_roof_frame','sf_wall_floor','sf_windows_doors','sf_progress','sf_defects','sf_summary','sf_previous_defects','sf_client_issues','lf_description','lf_site_facilities','lf_external_walls','lf_roofing','lf_walls_ceilings','lf_stairs_floors','lf_doors_windows','lf_fitout','lf_waterproofing','lf_services','lf_defects','lf_summary','lf_previous_defects','lf_client_issues'];

/** The banner heading the office template prints above a stage's checks, by section key. */
function bannerOf(key: string, name: string): string {
  if (key.startsWith("pp_")) return "PRE POUR";
  if (key.startsWith("sd_")) return "SLAB DOWN";
  if (key.startsWith("fr_")) return "FRAMEWORK STAGE";
  if (key.startsWith("lu_")) return "LOCK-UP STAGE";
  if (key.startsWith("fx_")) return "FIT OUT (FIXING) STAGE";
  if (key.startsWith("sf_")) return /_(measurements|quality)$/.test(key) ? "SLAB" : "FRAME STAGE";
  if (key.startsWith("lf_")) return /_(external_walls|roofing)$/.test(key) ? "LOCK-UP STAGE" : "FIXING STAGE";
  const pci: Record<string, string> = {
    pci_roof: "EXTERNAL — ROOF", pci_walls_doors: "EXTERNAL — WALLS, WINDOWS AND DOORS", pci_garage_site: "EXTERNAL — GARAGE, BALCONIES AND SITE",
    pci_internal: "INTERNAL", pci_finishes: "INTERNAL — FINISHES", pci_services: "UTILITIES, SERVICES AND OTHER",
  };
  return pci[key] ?? headingOf(name.split(":").pop() ?? name).toUpperCase();
}

const SECTION_KIND = (key: string): "description" | "site" | "defects" | "summary" | "previous" | "client" | "typical" | "stage" => {
  if (/_description$/.test(key)) return "description";
  if (/_site_facilities$/.test(key)) return "site";
  if (/_typical_defects$/.test(key)) return "typical";
  if (/_defects$/.test(key)) return "defects";
  if (/_summary$/.test(key)) return "summary";
  if (/_previous_defects$/.test(key)) return "previous";
  if (/_client_issues$/.test(key)) return "client";
  return "stage";
};

/** Which part of the building a section belongs to, for listing its defects under EXTERNAL / INTERNAL. */
function areaOfSection(key: string): "EXTERNAL" | "INTERNAL" {
  if (/(_roof|_roofing|_external_walls|_walls_doors|_garage_site|_site_facilities|_doors_windows|_roof_frame|_progress)$/.test(key)) return "EXTERNAL";
  return "INTERNAL";
}
const EXTERNAL_WORDS = /\b(roof|gutter|downpipe|fascia|eave|flashing|brick|render|cladding|wall(s)? external|external|facade|window|door|garage|carport|porch|alfresco|balcon|deck|verandah|fence|shed|site|driveway|paving|landscap|drain|slab|footing|boundary|kerb|crossover|front yard|rear yard)\b/i;

interface Defect {
  id: string;
  area: "EXTERNAL" | "INTERNAL";
  sub: string;
  heading: string;
  location: string;
  comments: string;
  categories: string[];
  severities: string[];
  code: string;
  photos: string[];
  detailed: boolean;
}

const DEFECT_SUFFIX = "__defect";

const CATEGORY_LABELS: Record<string, string> = {
  non_compliant_plans_specs: "Non-compliant with approved plans/specs", non_compliant_ncc_as: "Non-compliant with NCC/AS", workmanship_outside_tolerance: "Workmanship outside tolerance",
  material_product_defect: "Material/product defect", damage: "Damage", incomplete_work: "Incomplete work", design_documentation_conflict: "Design/documentation conflict", unable_to_inspect_concealed: "Unable to inspect/concealed",
};
const SEVERITY_LABELS: Record<string, string> = {
  major: "Major", minor: "Minor", cosmetic: "Cosmetic", structural: "Structural", safety: "Safety", weatherproofing: "Weatherproofing", durability: "Durability", serviceability: "Serviceability", amenity: "Amenity",
};
const asList = (v: AnswerValue): string[] => (Array.isArray(v) ? asStringArray(v) : typeof v === "string" && v ? [v] : []);
const mapLabels = (v: AnswerValue, table: Record<string, string>) => asList(v).map((x) => table[x] ?? x);

/** Every defect the inspector recorded: rows answered "Defect" (with their defect details), the Defects table, and the PCI "identified defects" ticks. */
function collectDefects(sections: SectionInput[]): Defect[] {
  const out: Defect[] = [];
  for (const s of sections) {
    const a = s.answers;
    if (!a) continue;
    const kind = SECTION_KIND(s.key);
    const excluded = s.excludedPhotos ?? [];

    if (kind === "defects") {
      const rows = Array.isArray(a.defects) ? (a.defects as AnswerTree[]) : [];
      rows.forEach((row, i) => {
        const location = asString(row.location).trim();
        const description = asString(row.description).trim();
        if (!location && !description && photosIn(row.photos, excluded).length === 0) return;
        out.push({
          id: `${s.key}:table:${i}`, area: EXTERNAL_WORDS.test(`${location} ${description}`) ? "EXTERNAL" : "INTERNAL", sub: "General",
          heading: "", location, comments: description, categories: [], severities: [], code: "", photos: photosIn(row.photos, excluded), detailed: false,
        });
      });
      continue;
    }

    if (kind === "typical") {
      for (const f of s.fields) {
        if (f.type !== "chip-multiselect" || !isGateSatisfied(f, a)) continue;
        const ticked = asStringArray(a[f.key]);
        for (const optKey of ticked) {
          const opt = f.options?.find((o) => o.value === optKey);
          if (!opt) continue;
          const at = asString(a[`${optKey}_at`]).trim();
          out.push({
            id: `${s.key}:typical:${optKey}`, area: f.sectionLetter === "External" ? "EXTERNAL" : "INTERNAL", sub: "General",
            heading: "", location: "", comments: at ? `${opt.label} ${at}` : opt.label, categories: [], severities: [], code: "", photos: photosIn(a[`${optKey}_pics`], excluded), detailed: false,
          });
        }
      }
      continue;
    }

    if (kind !== "stage" && kind !== "site") continue;
    const headings = headingMap(s.fields);
    for (const f of s.fields) {
      if (!isGateSatisfied(f, a)) continue;
      const v = a[f.key];
      if (f.type !== "pill-select" || typeof v !== "string") continue;
      const isDefect = f.defectOn ? f.defectOn.includes(v) : chosen(f, v).tone === "bad";
      if (!isDefect) continue;
      const d = asAnswerTree(a[`${f.key}${DEFECT_SUFFIX}`]);
      out.push({
        id: `${s.key}:${f.key}`, area: kind === "site" ? "EXTERNAL" : areaOfSection(s.key), sub: f.sectionLetter ? headingOf(f.sectionLetter) : headingOf(s.name.split(":").pop() ?? s.name),
        heading: headings.get(f.key) ?? headingOf(f.label), location: asString(d.location).trim(), comments: asString(d.comments).trim(),
        categories: mapLabels(d.category, CATEGORY_LABELS), severities: mapLabels(d.severity, SEVERITY_LABELS), code: asString(d.constructionCode).trim(),
        photos: photosIn(d.photos, excluded), detailed: Object.keys(d).length > 0,
      });
    }
  }
  return out;
}

function defectSentence(d: Defect): string {
  const head = d.heading ? cap(d.heading) : "";
  const where = d.location && d.heading ? ` — ${d.location}` : d.location;
  const body = d.comments ? ` ${sentence(d.comments)}` : "";
  const lead = head || where ? `${head}${where}.` : "";
  return `${lead}${body}`.trim() || "Defect noted.";
}

// ───────────────────────── Sentences for the checklist items ─────────────────────────

const toMm = (n: string) => (n ? `${n} millimetres` : "—");

/** One checklist section -> groups of items. Rows answered "N/A" are left out, as the office template deletes them. */
function stageGroups(s: SectionInput, defectNo: Map<string, number>): ReportGroup[] {
  const a = s.answers;
  if (!a) return [];
  const groups: ReportGroup[] = [];
  let current: ReportGroup | null = null;
  const used = new Set<string>();
  const fieldByKey = new Map(s.fields.map((f) => [f.key, f]));
  const excluded = s.excludedPhotos ?? [];

  const groupFor = (name: string | undefined): ReportGroup => {
    const heading = name ? headingOf(name) : undefined;
    if (!current || current.heading !== heading) {
      current = { heading, items: [] };
      groups.push(current);
    }
    return current;
  };
  const add = (field: TemplateField, heading: string, text: string, photos: string[] = [], nos: number[] = []) => {
    if (!text && photos.length === 0) return;
    groupFor(field.sectionLetter).items.push({ heading, text, photos, defectNos: nos });
  };

  const visible = [...s.fields].filter((f) => isGateSatisfied(f, a)).sort((x, y) => x.order - y.order);
  const headings = headingMap(s.fields);

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
    const group = f.sectionLetter ? headingOf(f.sectionLetter) : "";
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
    if (result && resRaw) {
      const r = chosen(result, resRaw);
      parts.push(r.tone === "ok" && SATISFACTORY.test(r.label) ? "Checked and satisfactory." : sentence(r.label));
    }
    used.add(f.key); used.add(site.key); if (datum) used.add(datum.key); if (result) used.add(result.key);
    const text = parts.join(" ");
    emitAt.set(anchorOf(datum, f, site, result), () => add(f, name, text));
  }

  // The upper-roof rows carry a limitation sentence in the office template.
  const roofFrom = fieldByKey.get("upperRoofFrom");
  if (roofFrom && a.upperRoofFrom && !used.has("upperRoofFrom")) {
    const from = chosen(roofFrom, asString(a.upperRoofFrom)).label;
    const appears = fieldByKey.get("upperRoofAppears");
    const lowerRoof = fieldByKey.get("lowerRoofLadder");
    const up = appears && a.upperRoofAppears ? lower(chosen(appears, asString(a.upperRoofAppears)).label) : "";
    const low = lowerRoof && a.lowerRoofLadder ? lower(chosen(lowerRoof, asString(a.lowerRoofLadder)).label) : "";
    const ground = /ground/i.test(from);
    const parts = [
      ground ? "Due to OH&S constraints the upper roof could not be safely accessed." : /scaffold/i.test(from) ? "The upper roof covering was inspected from the scaffold." : "",
      up ? `${ground ? "Observations from the ground indicate that the roof covering is" : "The upper roof covering is"} ${up}.` : "",
      low ? `Lower level roofing was checked from the ladder and is ${low}.` : "",
    ].filter(Boolean);
    used.add("upperRoofFrom"); used.add("upperRoofAppears"); used.add("lowerRoofLadder");
    if (parts.length) { const text = parts.join(" "); emitAt.set("upperRoofFrom", () => add(roofFrom, "Roof covering", text)); }
  }
  const gutterAccess = fieldByKey.get("safeAccessGuttering");
  if (gutterAccess && a.safeAccessGuttering && !used.has("safeAccessGuttering")) {
    const noAccess = /no/i.test(chosen(gutterAccess, asString(a.safeAccessGuttering)).label);
    const g = fieldByKey.get("upperGutteringGround");
    const l = fieldByKey.get("lowerGutteringLadder");
    const up = g && a.upperGutteringGround ? lower(chosen(g, asString(a.upperGutteringGround)).label) : "";
    const low = l && a.lowerGutteringLadder ? lower(chosen(l, asString(a.lowerGutteringLadder)).label) : "";
    const parts = [
      noAccess ? "Due to OH&S constraints the upper guttering could not be safely accessed." : "",
      up ? `Observations from the ground indicate that the guttering is ${up}.` : "",
      low ? `Lower level guttering was checked and is ${low}.` : "",
    ].filter(Boolean);
    used.add("safeAccessGuttering"); used.add("upperGutteringGround"); used.add("lowerGutteringLadder");
    if (parts.length) { const text = parts.join(" "); emitAt.set("safeAccessGuttering", () => add(gutterAccess, "Roof gutters", text)); }
  }

  let last: ReportItem | null = null;
  const itemByKey = new Map<string, ReportItem>();
  for (const f of visible) {
    emitAt.get(f.key)?.();
    if (used.has(f.key)) continue;
    const v = a[f.key];
    const heading = headings.get(f.key) ?? headingOf(f.label);

    if (/_other_note$/.test(f.key)) continue; // printed with its "Other" row below

    if (f.type === "photos") {
      const photos = photosIn(v, excluded);
      if (!photos.length) continue;
      const base = f.key.replace(/Photos$/, "");
      const target = itemByKey.get(base);
      if (target) target.photos.push(...photos);
      else add(f, f.label.replace(/^Photos? (of|showing) /i, ""), "", photos);
      continue;
    }

    if (f.type === "repeating-group" || f.type === "damage-list") continue;
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;

    if (f.type === "pill-select" && typeof v === "string") {
      const c = chosen(f, v);
      if (/^(applicable|not applicable)$/i.test(c.label) && /^(truss|non-truss|hebel|masonry|blueboard|stairwell|balcony)/i.test(heading)) {
        // "Applicable / Not applicable" only switches a group of checks on or off.
        continue;
      }
      if (f.key.endsWith("_material")) {
        const prior = last;
        if (prior) prior.text = `${c.label}. ${prior.text}`.trim();
        continue;
      }
      if (c.tone === "na" && NOT_APPLICABLE.test(c.label)) continue;
      const id = `${s.key}:${f.key}`;
      const isDefect = f.defectOn ? f.defectOn.includes(v) : c.tone === "bad";
      const no = isDefect ? defectNo.get(id) : undefined;
      let text: string;
      if (isDefect) text = `Refer to Defects${no ? ` (Defect ${no})` : ""}.`;
      else if (c.tone === "ok" && (SATISFACTORY.test(c.label) || f.options?.some((x) => x.color && TONE_BY_COLOR[x.color] === "bad"))) text = "Checked and satisfactory.";
      else if (/note/i.test(c.label)) text = "Refer to Notes.";
      else text = sentence(c.label);
      if (/_other$/.test(f.key)) {
        // "Other": printed only when the inspector said what it was (or it is a defect).
        const note = asString(a[`${f.key}_note`]).trim();
        if (!note && !isDefect) continue;
        text = note ? (isDefect ? `${text} ${sentence(note)}` : sentence(note)) : text;
      }
      groupFor(f.sectionLetter).items.push({ heading, text, photos: [], defectNos: no ? [no] : [] });
      last = groups[groups.length - 1]!.items[groups[groups.length - 1]!.items.length - 1]!;
      itemByKey.set(f.key, last);
      continue;
    }

    if (f.type === "yesno") {
      add(f, heading, v === "yes" ? "Yes." : v === "no" ? "No." : "");
      continue;
    }
    if (f.type === "chip-multiselect" || f.type === "tile-multiselect") {
      const list = labelsOf(f, v);
      if (!list.length) continue;
      if (/visible at$/i.test(heading)) add(f, heading.replace(/\s+(are\s+)?visible at$/i, ""), /none/i.test(list[0]!) ? "None visible." : `Visible at ${joinList(list.map(lower))}.`);
      else add(f, heading, sentence(joinList(list)));
      continue;
    }
    if (f.type === "numeric") {
      add(f, heading, `${asString(v) || String(v)}${f.unit ? ` ${f.unit}` : ""}.`);
      continue;
    }
    if (f.type === "text" || f.type === "textarea" || f.type === "date") {
      const t = asString(v).trim();
      if (t) add(f, heading, sentence(t));
    }
  }

  return groups.filter((g) => g.items.length > 0);
}

// ───────────────────────── Notes ─────────────────────────

const GROUND_FALLS =
  "Due to ground falls towards the slab stormwater may pond and affect the footings. Stormwater needs to be controlled on site by the construction company to protect the foundations and surface to be graded to fall away from the building/s – refer to Codes 2. Footings and to Site Drainage requirements. Soil may erode and potentially block stormwater pipes – some protection may be advisable until landscaping/retaining works are done.";

function pciAppliances(status: string): string {
  if (/^practical completion/i.test(status)) return "Appliances such as the oven, cook top, rangehood, dishwasher and hot water service are not yet installed due to concerns about theft of appliances.";
  if (/^handover/i.test(status)) return "Appliances are installed, except for oven, cook top, rangehood, dishwasher and hot water service.";
  if (/^off the plan/i.test(status)) return "Appliances are installed.";
  return "";
}

function buildNotes(stage: StageId, sections: SectionInput[], defectCount: number, status: string): string[] {
  const meta = STAGES[stage];
  const notes: string[] = [];
  const answers = (suffix: string) => sections.find((s) => s.key.endsWith(suffix))?.answers ?? null;
  const summary = answers("_summary");
  const site = sections.find((s) => SECTION_KIND(s.key) === "site");

  if (summary) {
    if (summary.workmanshipSatisfactory === "yes") notes.push(`${meta.workmanshipLead} is generally to a satisfactory industry standard, except for the defects noted above.`);
    else if (summary.workmanshipSatisfactory === "no") notes.push(`${meta.workmanshipLead} is not generally to a satisfactory industry standard. Refer to the defects noted above.`);
  }
  if (stage === "pre_pour" && defectCount > 0) notes.push("The inspector contacted the slab/site supervisor regarding defects/concerns, and they are to be attended to prior to the concrete pour.");
  if (stage === "pci") {
    const a = pciAppliances(status);
    if (a) notes.push(a);
  }
  notes.push(...meta.standingNotes);

  // From the Site & Facilities answers.
  if (site?.answers) {
    const pick = (key: string) => {
      const f = site.fields.find((x) => x.key === key);
      const v = site.answers![key];
      return f && typeof v === "string" ? chosen(f, v) : null;
    };
    const fence = pick("securityFencing");
    if (fence && (fence.tone === "warn" || fence.tone === "bad")) notes.push("Sections of the security fence are not in position and need to be re-instated.");
    const rubbish = pick("rubbishDangerous");
    const managed = pick("siteManaged");
    const finalClean = pick("finalSiteClean");
    if ((rubbish && rubbish.tone === "bad") || (managed && managed.tone !== "ok") || (finalClean && /required/i.test(finalClean.label))) {
      notes.push(stage === "pci" ? "Final builder's clean to be completed." : "Site needs a clean-up of rubbish/debris to improve access and safety.");
    }
    const kerb = pick("kerbDamage");
    if (kerb && kerb.tone !== "ok") notes.push("Damage was noted to the footpath/kerbs/nature strip/vehicle crossover. Usually, such items are attended to at the end of the project and arranged between the construction company and the local authority.");
  }

  // The inspector's own ticks and words.
  if (summary) {
    const ticks = asStringArray(summary.notesToInclude);
    if (ticks.includes("ground_falls")) notes.push(GROUND_FALLS);
    const g = asString(summary.groundFallsDetail).trim();
    if (g) notes.push(sentence(g));
    const r = asString(summary.retainingWallsDetail).trim();
    if (ticks.includes("retaining_walls")) notes.push(r ? sentence(`Retaining walls are advised: ${r}`) : "Retaining walls are advised.");
    const agi = asString(summary.agiDrainsDetail).trim();
    if (ticks.includes("agi_drains")) notes.push(agi ? sentence(`Agi drains are advised: ${agi}`) : "Agi drains are advised.");
    const roof = asString(summary.roofAccessDetail).trim();
    if (ticks.includes("roof_access")) notes.push(roof ? sentence(`Roof access was limited: ${roof}`) : "Roof access was limited.");
    const other = asString(summary.otherConcerns).trim();
    if (other) notes.push(sentence(other));
  }
  return notes;
}

// ───────────────────────── References ─────────────────────────

type Library = { codes: Record<string, { section: string; title: string; text: string[] }>; blocks: Record<string, { title: string; text: string[] }> };
const LIB = library as unknown as Library;

/** "2.04, 3.01 and 12.2" -> the numbered references the library knows about. */
export function referencedCodes(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\b/g)) {
    const code = `${m[1]}.${m[2]!.padStart(2, "0")}`;
    if (LIB.codes[code]) found.add(code);
  }
  return [...found];
}

function buildReferences(stage: StageId, defects: Defect[]): { blocks: { title: string; text: string[] }[]; sections: ReferenceSection[] } {
  const codes = new Set<string>(STAGES[stage].defaultCodes);
  for (const d of defects) for (const c of referencedCodes(d.code)) codes.add(c);
  const sorted = [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const bySection = new Map<string, ReferenceSection>();
  for (const code of sorted) {
    const c = LIB.codes[code]!;
    let sec = bySection.get(c.section);
    if (!sec) { sec = { section: c.section, codes: [] }; bySection.set(c.section, sec); }
    sec.codes.push({ code, title: c.title, text: c.text });
  }
  const blocks = ["normal_viewing", ...STAGES[stage].defaultBlocks].map((k) => LIB.blocks[k]).filter((b): b is { title: string; text: string[] } => !!b);
  return { blocks, sections: [...bySection.values()] };
}

// ───────────────────────── The whole report ─────────────────────────

export function buildConstructionReport(sections: SectionInput[], jobInfo: AnswerTree | null, apartment = false): ConstructionReportModel | null {
  const stage = stageOfSectionKeys(sections.map((s) => s.key));
  if (!stage) return null;
  const meta = STAGES[stage];
  const rank = (k: string) => { const i = SECTION_ORDER.indexOf(k); return i === -1 ? 9999 : i; };
  const approved = sections.filter((s) => s.approved).map((s, i) => ({ s, i })).sort((x, y) => rank(x.s.key) - rank(y.s.key) || x.i - y.i).map((x) => x.s);
  const waitingSections = sections.filter((s) => !s.approved && s.answers).map((s) => s.name);

  // The Stage / Status the inspector picked on Job Information (PCI has four).
  const statusRaw = jobInfo ? asString(jobInfo.stageOptionPci) : "";
  const statusLabel = statusRaw ? (statusRaw.startsWith("__other__:") ? statusRaw.slice(10) : statusRaw.replace(/_/g, " ")) : "";
  const statusClean = /^practical_completion/.test(statusRaw) ? "Practical Completion — appliances not yet installed"
    : /^handover/.test(statusRaw) ? "Handover — appliances installed or some installed"
    : /^off_the_plan/.test(statusRaw) ? "Off the Plan Handover — appliances are installed"
    : /^defects_liability/.test(statusRaw) ? "Defects Liability — after handover and now occupied" : statusLabel;
  const stageLabel = stage === "pci" && statusClean ? statusClean.split(" — ")[0]! : meta.label;

  // Defects first, so the checklist rows can point at their defect numbers.
  const raw = collectDefects(approved);
  const subOrder = new Map<string, number>();
  for (const d of raw) if (!subOrder.has(`${d.area}|${d.sub}`)) subOrder.set(`${d.area}|${d.sub}`, subOrder.size);
  const ordered = meta.groupedDefects
    ? raw.map((d, i) => ({ d, i })).sort((x, y) => (x.d.area === y.d.area ? (subOrder.get(`${x.d.area}|${x.d.sub}`)! - subOrder.get(`${y.d.area}|${y.d.sub}`)!) || x.i - y.i : x.d.area === "EXTERNAL" ? -1 : 1)).map((x) => x.d)
    : raw;
  const defectNo = new Map<string, number>();
  const defects: DefectEntry[] = ordered.map((d, i) => {
    defectNo.set(d.id, i + 1);
    return {
      no: i + 1, area: d.area, sub: d.sub, text: defectSentence(d), categories: d.categories, severities: d.severities, code: d.code, photos: d.photos, id: d.id,
    };
  });

  let description: string[] = [];
  let streetPhotos: string[] = [];
  let otherPhotos: string[] = [];
  let site: ReportGroup[] = [];
  const blocks: ReportBlock[] = [];
  let clientQueries: ConstructionReportModel["clientQueries"] = null;
  let previous: ConstructionReportModel["previous"] = null;

  for (const s of approved) {
    const a = s.answers;
    if (!a) continue;
    const kind = SECTION_KIND(s.key);
    const excluded = s.excludedPhotos ?? [];
    if (kind === "description") {
      description = describe(stage, s.fields, a, statusClean, apartment);
      streetPhotos = photosIn(a.streetPhotos, excluded);
      otherPhotos = [...photosIn(a.elevationPhotos, excluded), ...photosIn(a.neighbourPhotos, excluded)];
    } else if (kind === "site") {
      site = stageGroups(s, defectNo);
    } else if (kind === "stage") {
      const groups = stageGroups(s, defectNo);
      if (groups.length === 0) continue;
      const banner = bannerOf(s.key, s.name);
      const prior = blocks[blocks.length - 1];
      if (prior && prior.banner === banner) prior.groups.push(...groups);
      else blocks.push({ banner, groups });
    } else if (kind === "client" || kind === "previous") {
      const prefix = kind === "client" ? "clientList" : "previousDefects";
      const status = asString(a[`${prefix}Status`]);
      if (status !== "attached") continue;
      const entry = { text: asString(a[`${prefix}Updates`]).trim(), photos: photosIn(a[`${prefix}Photos`], excluded) };
      if (kind === "client") clientQueries = entry; else previous = entry;
    }
  }

  const refs = buildReferences(stage, raw);
  return {
    stage, stageLabel, purpose: PURPOSE, general: GENERAL, description, streetPhotos, otherPhotos, site, blocks, defects,
    groupedDefects: meta.groupedDefects, notes: buildNotes(stage, approved, defects.length, statusClean), clientQueries, previous,
    blocksRef: refs.blocks, references: refs.sections, waitingSections,
  };
}
