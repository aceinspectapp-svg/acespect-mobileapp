import type { FormSection, Inspection, User } from "./mockData";
import { getReportSigner } from "./mockData";

/** The front-matter of a Dilapidation Report, derived from Job Information. */
export interface ReportHeader {
  reportTitle: string;
  clientName: string;
  clientAttn?: string;
  clientEmail?: string;
  yourReference: string;
  ourReference: string;
  property: string;
  propertyOwner?: string;
  propertyOwnerEmail?: string;
  inspectionDate: string; // already formatted
  weather: string;
  inspector: string;
  inspectorRegistration?: string;
  purpose: string;
  /** The Description & Overview section's "Front Elevation" photo -- embedded on the cover, matching the reference report's placement. */
  coverPhotoUrl?: string;
  signatureUrl?: string;
  signatureName?: string;
  signatureTitle?: string;
}

/** Standard boilerplate used when the Job Information section has no custom purpose. */
export const DEFAULT_PURPOSE =
  "The purpose of the inspection is to identify cracking, gaps and dilapidation in the main " +
  "structures on the property, so as to establish the current condition of the site in relation " +
  "to project works nearby, insofar as a licensed builder can reasonably identify the defects and " +
  "current state of the property. This report documents existing visible cracks and gaps to areas " +
  "in scope and may include internal walls, ceilings and floors, external walls, garage, driveway, " +
  "paths and fencing and is the result of a visual survey only.";

/* ── Description & Overview section boilerplate / template placeholders ── */

export const DESCRIPTION_PHOTO_PLACEHOLDER =
  "Insert photograph of front of property (from street view). Size 9.3cm";

export const PHOTOGRAPHS_NOTE =
  "You may view/save individual photographs by clicking on a file in the list. To save a copy of all " +
  "photographs, click the Download All button above the list of files and follow the prompts. The " +
  "security settings on your computer may display a bar at the top of the window, indicating that you " +
  "need to allow your browser to download from the site. If this message appears, please allow " +
  "downloads temporarily from this site. If a window does not then appear asking where you would like " +
  "the download saved, simply click on the Download All button again to commence the download.";

export const SCOPE_BOILERPLATE =
  "The scope for inspection is external and internal to all structures / external and internal to part " +
  "of the property at / internal only to all areas / external only to all areas. OR insert description of scope.";

export const SCOPE_PHOTOS_REF =
  "Selected photographs are displayed in this report. For a full download of photographs provided by " +
  "the Houspect survey please go to the link in the Photographs heading on page 2 of the report.";

export const SITE_IMAGE_NOTE =
  "Please do not anchor images. Just insert them the same way as a photograph so they can be easily " +
  "sized and moved. (Admin: adjust photo size to 5.9cm for landscape & 5.2cm for portrait.)";

/* ── Scope page: Condition Definitions + Dilapidation Report Information ── */

export interface ConditionDefinition {
  term: string;
  description: string;
}

/** The 5-tier condition scale used across every color-select field in every template. */
export const CONDITION_DEFINITIONS: ConditionDefinition[] = [
  { term: "New", description: "Self explanatory." },
  { term: "Satisfactory", description: "Generally good condition." },
  { term: "Fair", description: "Starting to look like it needs maintenance." },
  { term: "Average", description: "Functioning but needs maintenance and/or repairs within 6 months." },
  { term: "Poor", description: "Needs repair or replacement now." },
];

export const DILAPIDATION_REPORT_INFORMATION: string[] = [
  "This dilapidation report is the result of a visual inspection on the date noted on the report and is compiled by the Inspector noted on the report. The Inspector is a qualified Licensed Builder with extensive experience in the building industry.",
  "The dilapidation report methodology involves a systematic visual review of each accessible room and area of the building, including internal walls, ceilings and floor surfaces.",
  "The report highlights inspection findings such as damaged areas, cracks, popped nails, binding doors and windows, and any other matters which the Inspector feels are noteworthy or material. Where appropriate the crack categorisation table is used to categorise notable or significant cracks identified in this report.",
  "The report findings are by exception — that is, only items which are noteworthy or significant are reported on and, where appropriate, photographed and compiled. The majority of findings reported are generally minor and cosmetic in nature, and are generally consistent with normal minor settling or movement in any building. Unless specifically noted otherwise, the findings reported on are not material or structural in nature.",
  "In conducting the inspection, the Inspector may also take additional archive photos of the building, but only those photos of notable findings are contained in this report.",
];

/* ── Crack Categorisation Table (AS4349.1-2007 Table E1) ── */

export interface CrackCategoryRow {
  description: string;
  widthLimit: string;
  category: string;
}

export const CRACK_CATEGORISATION_TABLE_TITLE =
  'Crack Categorisation Table (based on AS4349.1-2007 Table E1 — "Categorisation of Cracking in Masonry Structures")';

export const CRACK_CATEGORISATION_TABLE: CrackCategoryRow[] = [
  { description: "Hairline cracks", widthLimit: "<= 0.1 mm", category: "0" },
  { description: "Fine cracks", widthLimit: "<= 1.0 mm", category: "1" },
  { description: "Moderate cracks that are clearly noticeable", widthLimit: "<= 5.0 mm", category: "2" },
  {
    description: "Significant cracks that are of a notable concern",
    widthLimit: "> 5.0 mm, <= 15.0 mm (or a number of cracks 3.0 mm or more in one group)",
    category: "3",
  },
  {
    description: "Significant cracks requiring extensive repair work",
    widthLimit: "<=> 15.0 mm, <= 25 mm but also depends on number of cracks",
    category: "4",
  },
];

export const CRACK_CATEGORISATION_TABLE_FOOTNOTE =
  '*Based on AS4349.1-2007 Table E1 — "Categorisation of Cracking in Masonry Structures"';

/* ── Pool & Spa boilerplate, appended after the Pool / Spa section ── */

export const POOL_SPA_DISCLAIMER_TITLE = "Pool and Spa Safety Disclaimer";

// Verbatim from Houspect Victoria's own master report template -- "Houspect"
// here is this business's own real trading name (Acespect Pty Ltd trades as
// Houspect Victoria), not a third party's, so it belongs in this content.
export const POOL_SPA_DISCLAIMER: string[] = [
  "The Houspect building inspector's comments are observations only, and any comments offered about the pool area are of a general nature and should not be relied upon.",
  "All pools and spas in Victoria must be registered with local council and certified for a pool safety barrier by a building surveyor or registered pool inspector (licensed by the VBA).",
  "Houspect does not inspect pool pumps, filters, solar panels, pool cleaning equipment, play equipment, etc.",
  "It is recommended that all electrical circuits and equipment to the pool area be checked by a licensed electrician or pool specialist for function and performance.",
];

export const POOL_SAFETY_NOTE =
  "Pool safety is important and requirements vary. Please seek advice from your local council.";

/** "Residential House" → "House", a short cover-title form matching the industry-standard report layout this app follows. */
function shortPropertyTypeLabel(propertyType: string): string {
  const words = propertyType.trim().split(/\s+/);
  return words[words.length - 1] || propertyType;
}

/** Draft until a report's sections have all been reviewed and approved. */
function reportStatusSuffix(status: Inspection["status"]): string {
  return status === "approved" ? "(FINAL)" : "(DRAFT)";
}

/** "2024-06-15" → "Thursday, 18 June, 2026" (en-AU style with comma before year). */
export function formatLongDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday}, ${d.getDate()} ${month}, ${d.getFullYear()}`;
}

function str(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

/**
 * Build the report front-matter from an inspection's Job Information section,
 * falling back to top-level inspection data when a field isn't recorded.
 *
 * `inspector` is the live, API-backed user record for `inspection.inspectorId`
 * (from `useAppData().getUser`) -- callers must pass it in since this is a
 * plain function with no access to that context. Previously this looked the
 * inspector up in `mockData.USERS`, a hardcoded demo list whose ids ("u1",
 * "u2", …) never match a real database UUID, so the inspector name/license
 * fallback silently never worked for any real inspection.
 */
export function buildReportHeader(inspection: Inspection, inspector?: Pick<User, "name" | "licenseNumber">): ReportHeader {
  const jobInfo = inspection.sections.find((s) => (s.key ?? s.id).startsWith("job-info"));
  const f = jobInfo?.fields ?? {};
  const signer = getReportSigner();

  // "Front Elevation" from Description & Overview -- embedded on the cover
  // itself, matching the reference report's "insert photograph of front of
  // property" placement, rather than only appearing later in that section.
  const description = inspection.sections.find((s) => (s.key ?? s.id).startsWith("description"));
  const frontElevation = (description?.answers as Record<string, unknown> | null | undefined)?.front_elevation;
  const coverPhotoUrl =
    Array.isArray(frontElevation) && typeof frontElevation[0] === "string" ? frontElevation[0] : undefined;

  const baseTitle = inspection.type === "Dilapidation" ? "Dilapidation Report" : `${inspection.type} Report`;
  const reportTitle = `${baseTitle} - ${shortPropertyTypeLabel(inspection.propertyType)} ${reportStatusSuffix(inspection.status)}`;

  return {
    reportTitle,
    clientName: str(f.clientName, inspection.client),
    clientAttn: str(f.clientAttn) || undefined,
    clientEmail: str(f.clientEmail) || undefined,
    yourReference: str(f.yourReference, inspection.jobNo),
    ourReference: str(f.ourReference, inspection.jobNo),
    property: str(f.address, `${inspection.address}, ${inspection.suburb}`),
    propertyOwner: str(f.propertyOwner) || undefined,
    propertyOwnerEmail: str(f.propertyOwnerEmail) || undefined,
    inspectionDate: formatLongDate(str(f.date, inspection.date)),
    weather: str(f.weather, "—"),
    inspector: str(f.inspector, inspector?.name ?? "—"),
    inspectorRegistration: str(f.inspectorRegistration) || inspector?.licenseNumber || undefined,
    purpose: str(f.purpose) || DEFAULT_PURPOSE,
    coverPhotoUrl,
    signatureUrl: signer?.signatureUrl,
    signatureName: signer?.name,
    signatureTitle: signer?.signatureTitle,
  };
}

/**
 * A section with any reviewer-excluded photos already filtered out of
 * `photos` and every damage's own `photos`. Used right before handing a
 * section to `ReportSection` -- both the reviewer's live preview and the
 * final printed report call this first, so the two always agree on exactly
 * which photos are in the report.
 */
export function withExcludedPhotosRemoved(section: FormSection): FormSection {
  const sectionExcluded = section.excludedPhotoUrls ?? [];
  return {
    ...section,
    photos: section.photos.filter((url) => !sectionExcluded.includes(url)),
    damages: section.damages.map((d) => {
      const damageExcluded = d.excludedPhotoUrls ?? [];
      return damageExcluded.length === 0 ? d : { ...d, photos: d.photos.filter((url) => !damageExcluded.includes(url)) };
    }),
  };
}
