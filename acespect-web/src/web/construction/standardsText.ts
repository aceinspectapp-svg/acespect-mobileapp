/**
 * "References and Guide to Standards and Tolerances" -- the fixed page a Construction Stage report prints after Client Concerns and before the
 * Conditions. Copied word for word from Houspect's office template "ACESPECT Pre-pour_Office Template Nov 2026.dotm" (bold where the template
 * is bold, the same two links); do not reword here -- update the template wording, then copy it again. The PDF and the Word report are both
 * made from the rendered page, so this file is the one place the wording lives.
 *
 * Only the Pre-pour office template carries this page so far; when another stage's template gets it, add that stage to STANDARDS_PAGE_STAGES.
 */
import type { StageId } from "./stages";

export const STANDARDS_PAGE_STAGES: readonly StageId[] = ["pre_pour"];

export const STANDARDS_TITLE = "REFERENCES AND GUIDE TO STANDARDS AND TOLERANCES";
export const STANDARDS_GUIDE_URL = "https://houspect.egnyte.com/dl/8vb6WbJQqK3k";
export const NCC_PORTAL_URL = "https://ncc.abcb.gov.au/";

/** One run of text in a paragraph: bold as in the template, or a link. */
export interface StandardsRun { text: string; bold?: boolean; href?: string }

/** The page's paragraphs, in order, after the title. */
export const STANDARDS_PARAGRAPHS: StandardsRun[][] = [
  [{ text: "Please refer to the link below for Standards and Tolerances 2026 which is effective for constructions commencing 1 August 2026.", bold: true }],
  [{ text: "Click the Link here to view and download the Standards and Tolerances 2026", href: STANDARDS_GUIDE_URL }],
  [{ text: "Authority of the Guide Victoria has a legislated building framework that regulates compliance with building standards. This function is facilitated through an Act of parliament and subordinate legislation such as Regulations. The National Construction Code (NCC) and other Australian building standards are adopted into law in Victoria through Regulations; however, the Guide is not within this framework." }],
  [{ text: "The Guide to Standards and Tolerances is only an advisory document. It is not part of the Victorian legislative framework.", bold: true }],
  [{ text: "The Guide is published to assist parties in determining if domestic building work is considered defective for the purpose of section 8 of the Domestic Building Contracts Act 1995 (Vic). Where there is any contradiction or difference between the Guide and an Act, Regulations, the NCC, a documented Standard, or a building contract including the project drawings and specification, legislation takes precedence. The Guide does not replace the need for compliance with any requirement under law." }],
  [{ text: "The Normal Viewing Position", bold: true }],
  [{ text: "Variations in the surface colour, texture and finish of walls, ceilings, floors and roofs and similar transparent materials are to be viewed where possible from a normal viewing position. A normal viewing position is looking at a distance of 1.5 m or greater (or 600 mm for appliances and fixtures, and 3 m for glass) with the surface or material being illuminated by non-critical light, as depicted in Diagram B3. Non-critical light means the light that strikes the surface is diffused and is not glancing or parallel to that surface. Variations in the colour and finish of materials are typically within tolerance when not apparent from a normal viewing position, subject to any specific provisions within Part C." }],
  [{ text: "National Construction Code (NCC) Compliance", bold: true }],
  [{ text: "Attention is drawn to the National Construction Code (NCC), which sets out the minimum necessary standards for safety, health, amenity, accessibility, and sustainability in the design and construction of buildings throughout Australia." }],
  [
    { text: "The items and observations detailed within this report should be reviewed in accordance with the relevant volumes of the NCC (Volume One, Volume Two, and/or Volume Three / the Housing Provisions). Practitioners and clients can access or download digital versions of these requirements through the official ABCB NCC Portal at " },
    { text: "ncc.abcb.gov.au", href: NCC_PORTAL_URL },
    { text: ". Compliance with the NCC is legally mandated, and any rectification or remediation works must adhere strictly to these Performance Requirements and Governing Requirements." },
  ],
  [
    { text: "Please note: ", bold: true },
    { text: "The applicable version of the NCC depends entirely on the specific building's age, approval dates, and jurisdiction. Clients must refer to the original approved plans and building permits, or consult with the relevant Building Surveyor/Certifier, to definitively identify the version governing the structure." },
  ],
];
