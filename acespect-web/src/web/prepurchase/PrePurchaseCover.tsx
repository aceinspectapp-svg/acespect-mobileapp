/**
 * The Pre-Purchase cover: the shared cover page (components/CoverPage.tsx) with this report's details. The small line says
 * "PRE-PURCHASE REPORT" and the big title is the inspection's property type ("Apartment").
 *
 * The signature (Dinuke De Coonghe, Director – Houspect Victoria) always prints on page 1. When the details are too long to fit on page 1
 * with it (a long weather note, inspector name or General), the details that do not fit -- down to the word -- carry on at the top of
 * page 2 instead, and the signature stays on page 1. The fit is measured at the PDF's own page size (A4 less the margins of
 * acespect-backend/src/lib/reportPdf.ts): the page lays itself out before the server prints it.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Inspection } from "../mockData";
import { registrationKind, registrationLabel, type ReportHeader } from "../report";
import { reportProfileOf } from "../wording/profile";
import { propertyTitle } from "../constants/inspectionData";
import { COVER_COLORS, CoverPage, DEFAULT_SIGNATURE, type CoverPageProps } from "../components/CoverPage";
import { optionText } from "../construction/printCase";

/** The PDF's page: A4 (210 x 297 mm) less 22 mm each side, 30 mm at the top and 42 mm at the bottom (reportPdf.ts). */
export const PDF_PAGE_MM = { width: 166, height: 225 };
/** Room kept free at the bottom of page 1, so a rounding difference between this measure and the printer never moves the signature. */
const SAFETY_PX = 6;

export const PPI_KICKER = "Pre-Purchase Report";

/** The template's "Report Purpose", with its choice of "builder / building consultant" made from the inspector's registration. */
export function prePurchasePurpose(registration = "", inspectorName = ""): string {
  const kind = registrationKind(registration);
  // The template offers "a licensed builder / building consultant": an architect (and the inspection-registered inspector, who is not a
  // builder) is a building consultant; with no registration on file, Trevor Scott still is.
  const who = kind === "architect" || kind === "inspection" || (!kind && /trevor scott/i.test(inspectorName)) ? "building consultant" : "builder";
  return `The purpose of this report is to identify the action required to rectify major defects or structural faults in the building, insofar as a licensed ${who} can reasonably identify those defects or faults.`;
}

/** The template's "General" line on the cover. */
export const PPI_GENERAL =
  "This report is the result of a visual inspection only and is intended to be read as a whole. Please read the detailed inspection information and the scope section. Whilst all defects have been investigated to confirm cause and significance, some minor defects have not been detailed as they were considered a normal occurrence or general wear and tear for a building of this age.";


/** The cover's big title: the inspection's property type, as the app names it ("Apartment", "Residential House"); "Commercial" for Commercial Properties. */
export function prePurchaseCoverTitle(inspection: Pick<Inspection, "type" | "propertyType">): string {
  const p = reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "");
  if (p.propertyType === "commercial_properties") return "Commercial";
  return propertyTitle(p.propertyType) || inspection.propertyType;
}

/**
 * The House and Commercial template's "Summary", with only the part a form field decides: "In consideration of its age, it is / is not
 * structurally sound and free of major defects." -- "is" when Notes answers both "The property is considered structurally sound" and
 * "is the property free of major defects" Yes, "is not" when either is No. The template's "constructed around the ..." has no field, so it
 * is left out; with either question unanswered there is no Summary. (Commercial only: the Apartment template's cover is printed as before.)
 */
export function prePurchaseSummary(inspection: Pick<Inspection, "sections">): string {
  const notes = inspection.sections.find((s) => (s.key ?? s.id) === "notes");
  const a = (notes?.answers as Record<string, unknown> | null | undefined) ?? {};
  const sound = a.structural_structurallySound, free = a.majordefects_freeOfMajorDefects;
  const known = (v: unknown) => v === "yes" || v === "no";
  if (!known(sound) || !known(free)) return "";
  return `In consideration of its age, it ${sound === "yes" && free === "yes" ? "is" : "is not"} structurally sound and free of major defects.`;
}

/** Where page 1 ends: the details from row `row` on (that row from word `words` on) carry on at the top of page 2. */
export interface CoverSplit { row: number; words: number }

/** The cover's rows, as printed on page 1 and (when they do not all fit) at the top of page 2. */
export function splitRows(rows: [string, string][], split: CoverSplit | null): { first: [string, string][]; rest: [string, string][] } {
  if (!split) return { first: rows, rest: [] };
  const [label, value] = rows[split.row]!;
  const words = value.split(/\s+/).filter(Boolean);
  const head = words.slice(0, split.words).join(" ");
  const tail = words.slice(split.words).join(" ");
  return {
    first: [...rows.slice(0, split.row), ...(head ? ([[label, head]] as [string, string][]) : [])],
    rest: [...(tail ? ([[head ? `${label} (continued)` : label, tail]] as [string, string][]) : []), ...rows.slice(split.row + 1)],
  };
}

/** Measures the cover laid out at the PDF's page size and works out where page 1 must end for the signature to fit on it. */
function measureSplit(probe: HTMLElement, rows: [string, string][]): CoverSplit | null {
  const pxPerMm = probe.offsetWidth / PDF_PAGE_MM.width;
  const budget = PDF_PAGE_MM.height * pxPerMm - SAFETY_PX;
  const top = probe.getBoundingClientRect().top;
  if (probe.getBoundingClientRect().height <= budget) return null;
  const sig = probe.querySelector<HTMLElement>('[data-cover="signature"]');
  const sigHeight = sig ? sig.getBoundingClientRect().height + parseFloat(getComputedStyle(sig).marginTop || "0") : 0;
  const room = budget - sigHeight;
  const rowEls = [...probe.querySelectorAll<HTMLElement>('[data-cover="row"]')];
  for (let i = 0; i < rowEls.length; i++) {
    const el = rowEls[i]!;
    if (el.getBoundingClientRect().bottom - top <= room) continue;
    // This row does not fit whole: as many of its words as fit stay on page 1.
    const valueEl = el.querySelector<HTMLElement>('[data-cover="row-value"]');
    const words = (rows[i]?.[1] ?? "").split(/\s+/).filter(Boolean);
    let fit = 0;
    if (valueEl && words.length > 1) {
      const original = valueEl.textContent;
      let lo = 1, hi = words.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        valueEl.textContent = words.slice(0, mid).join(" ");
        if (el.getBoundingClientRect().bottom - top <= room) { fit = mid; lo = mid + 1; } else hi = mid - 1;
      }
      valueEl.textContent = original;
    }
    return { row: i, words: fit };
  }
  return null;
}

const C = COVER_COLORS;
const rowLabel: CSSProperties = { fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", color: C.grey, textTransform: "uppercase", paddingTop: "3px" };

/** The details carried on to page 2, ruled as the cover's rows are. */
function ContinuedRows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="report-page-break" data-cover="continued" style={{ fontFamily: C.font, color: C.ink, fontSize: "14px", lineHeight: 1.45 }}>
      {rows.map(([k, v]) => (
        <div key={k} data-cover="row" style={{ display: "grid", gridTemplateColumns: "166px 1fr", gap: "14px", padding: "9px 0", borderBottom: `1px solid ${C.rule}`, breakInside: "avoid" }}>
          <div data-cover="row-label" style={rowLabel}>{k}</div>
          <div data-cover="row-value">{v}</div>
        </div>
      ))}
    </div>
  );
}

export function PrePurchaseCover({ r, inspection, compact = false }: { r: ReportHeader; inspection: Inspection; compact?: boolean }) {
  const jobInfo = inspection.sections.find((s) => (s.key ?? s.id).startsWith("job-info"));
  const a = (jobInfo?.answers as Record<string, unknown> | null | undefined) ?? {};
  const email = r.clientEmail || String((jobInfo?.fields as Record<string, unknown> | undefined)?.clientEmail ?? "") || undefined;
  // The template's "Occupied: Yes / No", from Job Information's "Occupied?".
  const occupied = a.occupied === "yes" ? "Yes" : a.occupied === "no" ? "No" : "";
  const rows: [string, string][] = [
    ["Property", r.property],
    ["Inspection Date", r.inspectionDate],
    ...(occupied ? ([["Occupied", occupied]] as [string, string][]) : []),
    ["Weather Conditions", optionText("weather", r.weather)],
    ["Inspector", `${r.inspector}${r.inspectorRegistration ? ` ${registrationLabel(r.inspectorRegistration)}` : ""}`],
    ["Report Purpose", prePurchasePurpose(r.inspectorRegistration, r.inspector)],
    ["General", PPI_GENERAL],
  ];
  if (reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "").propertyType === "commercial_properties") {
    const summary = prePurchaseSummary(inspection);
    if (summary) rows.push(["Summary", summary]);
  }
  const props: Omit<CoverPageProps, "rows"> = {
    compact,
    reportDate: r.reportDate,
    clientName: r.clientName,
    clientNotes: email ? [`Via email: ${email}`] : [],
    references: [["Our Reference", r.ourReference]],
    kicker: PPI_KICKER,
    title: prePurchaseCoverTitle(inspection),
    signatureName: "Dinuke De Coonghe",
    signatureTitle: "Director – Houspect Victoria",
    signatureImage: r.signatureUrl || DEFAULT_SIGNATURE,
  };

  // Measured in the browser only (the page the PDF and Word files are made from); the full cover is drawn until then.
  const key = JSON.stringify([props.reportDate, props.clientName, props.clientNotes, props.references, props.title, rows]);
  const [mounted, setMounted] = useState(false);
  const [fit, setFit] = useState<{ key: string; split: CoverSplit | null } | null>(null);
  const probe = useRef<HTMLDivElement>(null);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (compact || !mounted || fit?.key === key || !probe.current) return;
    setFit({ key, split: measureSplit(probe.current, rows) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, key, compact, fit?.key]);

  const split = fit?.key === key ? fit.split : null;
  const { first, rest } = splitRows(rows, split);
  return (
    <>
      <CoverPage {...props} rows={first} logo={<img src="/houspect-logo.png" alt="Houspect Building Inspections" style={{ height: "56px", width: "auto", display: "block" }} />} />
      {rest.length > 0 && <ContinuedRows rows={rest} />}
      {/* The cover as page 1 of the PDF lays it out (its width, no on-screen logo), measured once and then removed. */}
      {mounted && !compact && fit?.key !== key && (
        <div ref={probe} aria-hidden data-cover-probe="" style={{ position: "absolute", left: "-10000px", top: 0, width: `${PDF_PAGE_MM.width}mm`, visibility: "hidden", pointerEvents: "none" }}>
          <CoverPage {...props} rows={rows} />
        </div>
      )}
    </>
  );
}
