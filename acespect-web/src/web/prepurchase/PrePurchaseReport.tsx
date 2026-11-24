/**
 * The Pre-Purchase / Apartment report ("ACESPECT Building (Pre-Purchase)_Apartment Nov 2026" -- "Building Report"), laid out as the
 * Construction reports are: the same cover page, headings, General Description block, Photographs paragraph and photo grid
 * (construction/ConstructionReport.tsx, components/CoverPage.tsx, components/reportKit.tsx). Only what belongs to this inspection type differs.
 *
 * Every other report type keeps its own layout (pages/ReportView.tsx); this one is used only for Pre-Purchase / Apartment.
 */
import { useEffect, useState } from "react";
import type { DamageRecord, FormSection, Inspection } from "../mockData";
import { withExcludedPhotosRemoved, type ReportHeader } from "../report";
import { fetchActiveTemplate, flattenSectionToDraft, type AnswerTree, type TemplateField } from "../templateFields";
import { reportProfileOf, type ReportProfile } from "../wording/profile";
import { PrePurchaseCover } from "./PrePurchaseCover";
import { PhotoGrid, PhotoMetaContext, PhotoNumberProvider, ReportWordingStyleContext } from "../components/reportKit";
import { ReportSection } from "../components/ReportSection";
import { PrePurchaseSummary, type SummarySection } from "./PrePurchaseSummary";
import { ReportConditions } from "../components/ReportConditions";
import { useOriginalPhotosLink } from "../components/OriginalPhotosLink";
import { Back, Bullets, Heading, KeepTogether, PhotographsBlock, page } from "../construction/ConstructionReport";
import { ScopeBlocks } from "./ScopeBlocks";
import { siteAccessSentences } from "./siteAccess";
import {
  PPI_CONDITION_DEFINITIONS_BLOCKS, PPI_CONDITION_DEFINITIONS_TITLE, PPI_DEFECTS_BLOCKS, PPI_SCOPE_BLOCKS, PPI_SCOPE_TITLE, PPI_SITE_ACCESS_TITLE,
} from "./scopeText";
import type { ConditionSummaryRow } from "../templateFields";

/** True for the report this file lays out: Pre-Purchase / Apartment. */
export function isPrePurchaseApartment(inspection?: Pick<Inspection, "type" | "propertyType">): boolean {
  if (!inspection) return false;
  const p = reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "");
  return p.inspectionType === "pre_purchase" && p.propertyType === "apartment";
}

const slug = (s: Pick<FormSection, "id" | "key">): string => s.key ?? s.id;

/**
 * One section as the report prints it: its text worked out from its answers with this report type's wording (so a report made before a
 * wording fix prints the fixed sentences, and the phone's own "Question: option_code" text never reaches the report) -- unless the
 * reviewer has typed over the text, which is then kept. Its defects come from the answers, so their photos stay attached.
 */
export function prePurchaseSectionText(section: FormSection, fields: TemplateField[] | undefined, profile: ReportProfile): FormSection {
  const answers = (section.answers as AnswerTree | null | undefined) ?? null;
  if (!fields || !answers || Object.keys(answers).length === 0) return section;
  const derived = flattenSectionToDraft(fields, answers, slug(section), profile);
  const overridden = (section.fields as Record<string, unknown> | undefined)?.reportTextOverride === true;
  return {
    ...section,
    reportText: overridden ? section.reportText : derived.reportText,
    damages: derived.damages.map((d, i): DamageRecord => ({
      id: `${section.id}-defect-${i}`, type: d.type, location: d.location, direction: d.direction, widthMm: d.widthMm, lengthMm: d.lengthMm, notes: d.notes, photos: d.photos,
      // A photo the reviewer left out of a defect stays out.
      excludedPhotoUrls: section.damages[i]?.excludedPhotoUrls,
    })),
    // The Condition Summary rows, from the same answers.
    fields: overridden ? section.fields : { ...(section.fields as Record<string, unknown>), ...(derived.fields.conditionSummary ? { conditionSummary: derived.fields.conditionSummary } : {}) } as FormSection["fields"],
  };
}

/** The inspection's sections as this report prints them (undefined while their templates load, null for another report type). */
export function usePrePurchaseSections(inspection?: Inspection, opts?: { includeUnapproved?: boolean }): FormSection[] | null | undefined {
  const all = !!opts?.includeUnapproved;
  const ppi = isPrePurchaseApartment(inspection);
  const [sections, setSections] = useState<FormSection[] | null | undefined>(ppi ? undefined : null);
  const key = inspection
    ? `${all ? "all" : "approved"}:${inspection.id}:${inspection.sections.map((s) => `${slug(s)}:${s.reviewStatus}:${s.reportText.length}:${(s.excludedPhotoUrls ?? []).join("|")}:${JSON.stringify(s.answers ?? null)}`).join(",")}`
    : "";
  useEffect(() => {
    if (!inspection || !ppi) { setSections(null); return; }
    let cancelled = false;
    const profile = reportProfileOf(inspection.type, inspection.propertyType);
    Promise.all(
      inspection.sections.map(async (s) => {
        if (slug(s).startsWith("job-info")) return s;
        const t = await fetchActiveTemplate(inspection.type, inspection.propertyType, slug(s)).catch(() => null);
        return prePurchaseSectionText(s, (t?.fields ?? undefined) as TemplateField[] | undefined, profile);
      }),
    ).then((out) => { if (!cancelled) setSections(out.filter((s) => all || slug(s).startsWith("job-info") || s.reviewStatus === "approved")); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return ppi ? sections : null;
}

/** The front-of-property photo (Description's first "Front Elevation" photo). */
function frontPhotoOf(description?: FormSection): string | undefined {
  const a = (description?.answers as Record<string, unknown> | null | undefined) ?? {};
  const front = [a.front_elevation, a.overviewPhotos].find((v) => Array.isArray(v) && typeof v[0] === "string") as string[] | undefined;
  return front?.[0] ?? description?.photos[0];
}

/**
 * The sections in the template's order, under the template's headings: ROOF, EXTERNAL, INTERNAL, then "Structural & Safety" where the
 * template has STRUCTURAL DEFECTS, MAJOR DEFECTS, SAFETY HAZARDS and NOTES, then COMMON AREAS. A section the template does not name
 * (an inspector-added one) prints after them, under its own name.
 */
export const PPI_SECTION_ORDER: { key: string; heading?: string }[] = [
  { key: "roof_chimneys", heading: "Roof" },
  { key: "elevations", heading: "External" },
  { key: "internal_areas", heading: "Internal" },
  // Where the template has STRUCTURAL DEFECTS, MAJOR DEFECTS, SAFETY HAZARDS and NOTES (the live form calls it "Structural & Safety").
  { key: "notes", heading: "Structural & Safety" },
  { key: "paving_paths", heading: "Common Areas" },
];

/** The body sections in the template's order, each with the heading it prints under. */
export function orderedPrePurchaseSections(rest: FormSection[]): { section: FormSection; heading: string }[] {
  const rank = (s: FormSection) => {
    const i = PPI_SECTION_ORDER.findIndex((o) => o.key === slug(s));
    return i < 0 ? PPI_SECTION_ORDER.length : i;
  };
  return rest
    .map((section, i) => ({ section, i }))
    .sort((a, b) => rank(a.section) - rank(b.section) || a.i - b.i)
    .map(({ section }) => ({ section, heading: PPI_SECTION_ORDER.find((o) => o.key === slug(section))?.heading ?? section.name }));
}

export function PrePurchaseReportBody({ inspection, sections, header }: { inspection: Inspection; sections: FormSection[]; header: ReportHeader }) {
  const originals = useOriginalPhotosLink(inspection.id);
  const fullDownloadUrl = originals.url || inspection.photoArchiveUrl;
  const body = sections.filter((s) => !slug(s).startsWith("job-info"));
  const description = body.find((s) => slug(s).startsWith("description"));
  const front = frontPhotoOf(description);
  // Every other section with something to print, in the template's order (no heading is printed with nothing under it).
  const rest = orderedPrePurchaseSections(body.filter((s) => s !== description && (s.reportText.trim() || s.photos.length > 0 || s.damages.length > 0)));
  const summary: SummarySection[] = rest.map(({ section: s, heading }) => ({
    heading, anchorId: `section-${s.id}`, rows: (s.fields as unknown as { conditionSummary?: ConditionSummaryRow[] }).conditionSummary ?? [],
  }));
  const hasSummary = summary.some((c) => c.rows.length > 0);
  const siteAccess = siteAccessSentences(body);

  // Every main title starts on a new page ("report-page-break": the PDF and the Word file both break there); the headings inside a
  // section (Eaves, Front Elevation, Kitchen ...) do not. A title is kept on its page with what follows it, and a section with nothing to
  // print is left out, so no page is empty.
  return (
    <div style={page}>
      <PrePurchaseCover r={header} inspection={inspection} />
      <PhotoNumberProvider>
        {/* "Please refer to Photographs 9 to 12." -- the template's words, as the Construction reports print them. */}
        <ReportWordingStyleContext.Provider value={{ nov2026: true }}>
          {/* SCOPE (1 Purpose of inspection, 2 Scope of inspection), 3 DEFECTS and the Condition Definitions: the template's own text. */}
          <div className="report-page-break" id="scope" data-ppi-title="SCOPE">
            <Heading>{PPI_SCOPE_TITLE}</Heading>
            <ScopeBlocks blocks={PPI_SCOPE_BLOCKS} />
          </div>
          <div className="report-page-break" id="defects" data-ppi-title="DEFECTS">
            <ScopeBlocks blocks={PPI_DEFECTS_BLOCKS} />
          </div>
          <div className="report-page-break" id="condition-definitions" data-ppi-title="Condition Definitions">
            <KeepTogether>
              <Heading>{PPI_CONDITION_DEFINITIONS_TITLE}</Heading>
              <ScopeBlocks blocks={PPI_CONDITION_DEFINITIONS_BLOCKS} />
            </KeepTogether>
          </div>

          {/* Our Condition Summary, laid out as the Construction report's Inspection Checklist summary. */}
          {hasSummary && (
            <div className="report-page-break" data-ppi-title="Condition Summary">
              <PrePurchaseSummary sections={summary} lead={<Heading>Condition Summary</Heading>} />
            </div>
          )}

          {/* Site Access Conditions: only the template's sentences a field decides (siteAccess.ts). */}
          {siteAccess.length > 0 && (
            <div className="report-page-break" id="site-access" data-ppi-title="Site Access Conditions">
              <Bullets items={siteAccess} lead={<Heading>{PPI_SITE_ACCESS_TITLE}</Heading>} />
            </div>
          )}

          {/* GENERAL DESCRIPTION. The template's "The building is a ... built around ..." sentence has no form field, so it is not printed. */}
          {front && (
            <div className="report-page-break" data-ppi-title="General Description">
              <KeepTogether>
                <Heading>General Description</Heading>
                <PhotoMetaContext.Provider value={description?.photoMeta ?? {}}>
                  <PhotoGrid photos={[front]} compact={false} maxHeight={7.5} />
                </PhotoMetaContext.Provider>
              </KeepTogether>
            </div>
          )}
          <div className="report-page-break" data-ppi-title="Photographs">
            <PhotographsBlock fullDownloadUrl={fullDownloadUrl} originals={originals} />
          </div>

          {rest.map(({ section: s, heading }) => (
            <div key={s.id} id={`section-${s.id}`} className="report-page-break" data-ppi-title={heading}>
              <KeepTogether>
                <Heading>{heading}</Heading>
                {hasSummary && <Back href="#summary" />}
              </KeepTogether>
              <ReportSection section={withExcludedPhotosRemoved(s)} showHeading={false} hideDamageText />
            </div>
          ))}

          {/* The Terms and Conditions (the Nov 2026 template's own text comes with its GLOSSARY and MAINTENANCE). */}
          <div className="report-page-break" data-ppi-title="Terms and Conditions">
            <ReportConditions />
          </div>
        </ReportWordingStyleContext.Provider>
      </PhotoNumberProvider>
    </div>
  );
}

export { PPI_GENERAL, PrePurchaseCover, prePurchasePurpose } from "./PrePurchaseCover";
