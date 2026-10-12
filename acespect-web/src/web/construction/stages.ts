/**
 * What is fixed about each Construction Stage report: its name, the standing sentences its office template carries, the
 * references it always includes, the order its sections print in, and which part of the building a section belongs to.
 */
import { headingOf } from "./words";

export type StageId = "pre_pour" | "slab" | "framework" | "lock_up" | "fixing" | "pci" | "slab_frame" | "lock_fix";

const PREFIXES: [string, StageId][] = [
  ["pp_", "pre_pour"], ["sd_", "slab"], ["fr_", "framework"], ["lu_", "lock_up"], ["fx_", "fixing"], ["pci_", "pci"], ["sf_", "slab_frame"], ["lf_", "lock_fix"],
];

/** The stage a section key belongs to ("pp_description" -> Pre-Pour), or null for any other key. */
export function stageOfKey(key: string): StageId | null {
  return PREFIXES.find(([p]) => key.startsWith(p))?.[1] ?? null;
}

/** The stage an inspection belongs to, read from its section keys. */
export function stageOfSectionKeys(keys: string[]): StageId | null {
  for (const k of keys) {
    const s = stageOfKey(k);
    if (s) return s;
  }
  return null;
}

export interface StageMeta {
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

export const PURPOSE =
  "The purpose of the inspection is to check on the progress of works and quality of workmanship at the specified construction stage, and to identify defects or faults in the new construction, insofar as a licensed builder can reasonably identify those defects or faults.";
export const GENERAL =
  "This report is the result of a visual inspection only and is intended to provide a reasonable confirmation of the progress of works and to note items that may need attention by the construction builder to ensure satisfactory quality of workmanship.";

const SLAB_CODES = ["2.01", "2.02", "2.03"];
const SLAB_BLOCKS = ["polyethylene", "bca_drainage", "site_drainage"];
const CERTIFICATES = "Builder to provide the owner with copies of all certificates of compliance from trades for electrical, plumbing, waterproofing and insulation installation.";
const FRAME_FOCUS =
  "This inspection is focussed on the key structural items of the framing, bracing and fixing. Minor variations in framing will be subject to additional straightening at pre-plaster stage with packing and trimming to studs and plates.";

export const STAGES: Record<StageId, StageMeta> = {
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
    label: "Slab Down", workmanshipLead: "The workmanship of the slab", groupedDefects: false, defaultCodes: SLAB_CODES, defaultBlocks: SLAB_BLOCKS,
    progress: "Progress of the works to date is slab down stage.", standingNotes: [],
  },
  framework: {
    label: "Frame", workmanshipLead: "The workmanship of the framework", groupedDefects: false, defaultCodes: [], defaultBlocks: [],
    progress: "The progress of the works to date is Framework.", standingNotes: [FRAME_FOCUS],
  },
  lock_up: {
    label: "Lock-up", workmanshipLead: "The workmanship of the lock-up stage", groupedDefects: true, defaultCodes: [], defaultBlocks: [],
    progress: "Progress of the works to date is the Lock Up stage.", standingNotes: [],
  },
  fixing: {
    label: "Fixing (Pre-paint)", workmanshipLead: "The workmanship to fixing stage", groupedDefects: true, defaultCodes: [], defaultBlocks: [],
    progress: "The progress of the works to date is Fixing.", standingNotes: [CERTIFICATES],
  },
  pci: {
    label: "Practical Completion / Handover / Defects Liability", workmanshipLead: "The workmanship", groupedDefects: true, defaultCodes: [], defaultBlocks: [],
    progress: "Progress of the works to date is approaching practical completion / handover / defects liability.",
    standingNotes: [
      "Builder to provide to the owner all information for appliances including handbooks, warranties and certificates.",
      "Builder to provide the owner with the Certificate of Occupancy (COO) from the building surveyor.",
      CERTIFICATES,
    ],
  },
  slab_frame: {
    label: "Slab down & Frame", workmanshipLead: "The workmanship of the slab and framework", groupedDefects: false, defaultCodes: SLAB_CODES, defaultBlocks: SLAB_BLOCKS,
    progress: "Progress of the works to date is frame stage.", standingNotes: [FRAME_FOCUS],
  },
  lock_fix: {
    label: "Lock-up & Fixing", workmanshipLead: "The workmanship of the lock-up and fixing stages", groupedDefects: true, defaultCodes: [], defaultBlocks: [],
    progress: "The progress of the works to date is lock up and fixing.", standingNotes: [CERTIFICATES],
  },
};

export const stageMeta = (id: StageId): StageMeta => STAGES[id];

/** The big title on the cover: "Lock-up Stage". */
export function coverTitleOf(stage: StageId): string {
  const titles: Record<StageId, string> = {
    pre_pour: "Pre-Pour Stage", slab: "Slab Down Stage", framework: "Frame Stage", lock_up: "Lock-up Stage", fixing: "Fixing Stage",
    pci: "Practical Completion / Handover", slab_frame: "Slab Down & Frame Stage", lock_fix: "Lock-up & Fixing Stage",
  };
  return titles[stage];
}

/** The order the app lists a stage's sections in, which is also the order they print in. */
export const SECTION_ORDER: string[] = ['pp_description','pp_site_facilities','pp_measurements','pp_formwork','pp_general','pp_defects','pp_summary','pp_client_issues','sd_description','sd_site_facilities','sd_measurements','sd_quality','sd_defects','sd_summary','sd_previous_defects','sd_client_issues','fr_description','fr_site_facilities','fr_services','fr_roof_frame','fr_wall_floor','fr_windows_doors','fr_progress','fr_defects','fr_summary','fr_previous_defects','fr_client_issues','lu_description','lu_site_facilities','lu_external_walls','lu_doors_windows','lu_framework','lu_roofing','lu_defects','lu_summary','lu_previous_defects','lu_client_issues','fx_description','fx_site_facilities','fx_walls_ceilings','fx_stairs_floors','fx_doors_windows','fx_fitout','fx_waterproofing','fx_defects','fx_summary','fx_previous_defects','fx_client_issues','pci_description','pci_site_facilities','pci_roof','pci_walls_doors','pci_garage_site','pci_internal','pci_finishes','pci_services','pci_typical_defects','pci_defects','pci_summary','pci_previous_defects','pci_client_issues','sf_description','sf_site_facilities','sf_measurements','sf_quality','sf_services','sf_roof_frame','sf_wall_floor','sf_windows_doors','sf_progress','sf_defects','sf_summary','sf_previous_defects','sf_client_issues','lf_description','lf_site_facilities','lf_external_walls','lf_roofing','lf_walls_ceilings','lf_stairs_floors','lf_doors_windows','lf_fitout','lf_waterproofing','lf_services','lf_defects','lf_summary','lf_previous_defects','lf_client_issues'];

/** Every Construction Stage section key. */
export const CONSTRUCTION_KEYS = SECTION_ORDER;

/** The banner heading the office template prints above a stage's checks, by section key. */
export function bannerOf(key: string, name: string): string {
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

export type SectionKind = "description" | "site" | "defects" | "summary" | "previous" | "client" | "typical" | "stage";

export function kindOfKey(key: string): SectionKind {
  if (/_description$/.test(key)) return "description";
  if (/_site_facilities$/.test(key)) return "site";
  if (/_typical_defects$/.test(key)) return "typical";
  if (/_previous_defects$/.test(key)) return "previous";
  if (/_defects$/.test(key)) return "defects";
  if (/_summary$/.test(key)) return "summary";
  if (/_client_issues$/.test(key)) return "client";
  return "stage";
}

/** Which part of the building a section belongs to, for listing its defects under EXTERNAL / INTERNAL. */
export function areaOfSection(key: string): "EXTERNAL" | "INTERNAL" {
  if (/(_roof|_roofing|_external_walls|_walls_doors|_garage_site|_site_facilities|_doors_windows|_roof_frame|_progress)$/.test(key)) return "EXTERNAL";
  return "INTERNAL";
}

export const EXTERNAL_WORDS = /\b(roof|gutter|downpipe|fascia|eave|flashing|brick|render|cladding|wall(s)? external|external|facade|window|door|garage|carport|porch|alfresco|balcon|deck|verandah|fence|shed|site|driveway|paving|landscap|drain|slab|footing|boundary|kerb|crossover|front yard|rear yard)\b/i;
