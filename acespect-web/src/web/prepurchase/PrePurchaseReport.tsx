/**
 * The Pre-Purchase / Apartment report ("ACESPECT Building (Pre-Purchase)_Apartment Nov 2026" -- "Building Report"), laid out as the
 * Construction reports are: the same cover page, headings, General Description block, Photographs paragraph and photo grid
 * (construction/ConstructionReport.tsx, components/CoverPage.tsx, components/reportKit.tsx). Only what belongs to this inspection type differs.
 *
 * Every other report type keeps its own layout (pages/ReportView.tsx); this one is used only for Pre-Purchase / Apartment.
 */
import { useEffect, useState } from "react";
import type { DamageRecord, FormSection, Inspection } from "../mockData";
import { registrationKind, registrationLabel, withExcludedPhotosRemoved, type ReportHeader } from "../report";
import { fetchActiveTemplate, flattenSectionToDraft, type AnswerTree, type TemplateField } from "../templateFields";
import { reportProfileOf, type ReportProfile } from "../wording/profile";
import { CoverPage, DEFAULT_SIGNATURE } from "../components/CoverPage";
import { PhotoGrid, PhotoMetaContext, PhotoNumberProvider, ReportWordingStyleContext } from "../components/reportKit";
import { ReportSection } from "../components/ReportSection";
import { ReportConditionSummary, type ConditionSummaryCategory } from "../components/ReportConditionSummary";
import { ReportScope } from "../components/ReportScope";
import { ReportConditions } from "../components/ReportConditions";
import { useOriginalPhotosLink } from "../components/OriginalPhotosLink";
import { Heading, KeepTogether, PhotographsBlock, page } from "../construction/ConstructionReport";
import { optionText } from "../construction/printCase";
import type { ConditionSummaryRow } from "../templateFields";

/** True for the report this file lays out: Pre-Purchase / Apartment. */
export function isPrePurchaseApartment(inspection?: Pick<Inspection, "type" | "propertyType">): boolean {
  if (!inspection) return false;
  const p = reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "");
  return p.inspectionType === "pre_purchase" && p.propertyType === "apartment";
}

/** The template's title. */
export const PPI_TITLE = "Building Report";

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

/** The cover: the shared cover page with this report's details -- the Construction cover's lines, with the template's title, purpose and General. */
export function PrePurchaseCover({ r, inspection, compact = false }: { r: ReportHeader; inspection: Inspection; compact?: boolean }) {
  const jobInfo = inspection.sections.find((s) => slug(s).startsWith("job-info"));
  const a = (jobInfo?.answers as Record<string, unknown> | null | undefined) ?? {};
  const email = r.clientEmail || String((jobInfo?.fields as Record<string, unknown> | undefined)?.clientEmail ?? "") || undefined;
  // The template's "Occupied: Yes / No", from Job Information's "Occupied?".
  const occupied = a.occupied === "yes" ? "Yes" : a.occupied === "no" ? "No" : "";
  return (
    <CoverPage
      compact={compact}
      logo={<img src="/houspect-logo.png" alt="Houspect Building Inspections" style={{ height: "56px", width: "auto", display: "block" }} />}
      reportDate={r.reportDate}
      clientName={r.clientName}
      clientNotes={email ? [`Via email: ${email}`] : []}
      references={[["Our Reference", r.ourReference]]}
      kicker="Pre-Purchase Report"
      title={PPI_TITLE}
      rows={[
        ["Property", r.property],
        ["Inspection Date", r.inspectionDate],
        ...(occupied ? ([["Occupied", occupied]] as [string, string][]) : []),
        ["Weather Conditions", optionText("weather", r.weather)],
        ["Inspector", `${r.inspector}${r.inspectorRegistration ? ` ${registrationLabel(r.inspectorRegistration)}` : ""}`],
        ["Report Purpose", prePurchasePurpose(r.inspectorRegistration, r.inspector)],
        ["General", PPI_GENERAL],
      ]}
      signatureName="Dinuke De Coonghe"
      signatureTitle="Director – Houspect Victoria"
      signatureImage={r.signatureUrl || DEFAULT_SIGNATURE}
    />
  );
}

/** The front-of-property photo (Description's first "Front Elevation" photo). */
function frontPhotoOf(description?: FormSection): string | undefined {
  const a = (description?.answers as Record<string, unknown> | null | undefined) ?? {};
  const front = [a.front_elevation, a.overviewPhotos].find((v) => Array.isArray(v) && typeof v[0] === "string") as string[] | undefined;
  return front?.[0] ?? description?.photos[0];
}

export function PrePurchaseReportBody({ inspection, sections, header }: { inspection: Inspection; sections: FormSection[]; header: ReportHeader }) {
  const originals = useOriginalPhotosLink(inspection.id);
  const fullDownloadUrl = originals.url || inspection.photoArchiveUrl;
  const body = sections.filter((s) => !slug(s).startsWith("job-info"));
  const description = body.find((s) => slug(s).startsWith("description"));
  const descriptionText = (description?.reportText ?? "").split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
  const front = frontPhotoOf(description);
  // Every other section, with something to print.
  const rest = body.filter((s) => s !== description && (s.reportText.trim() || s.photos.length > 0 || s.damages.length > 0));
  const summary: ConditionSummaryCategory[] = rest
    .map((s) => ({ sectionName: s.name, anchorId: `section-${s.id}`, rows: (s.fields as unknown as { conditionSummary?: ConditionSummaryRow[] }).conditionSummary ?? [] }))
    .filter((c) => c.rows.length > 0);

  return (
    <div style={page}>
      <PrePurchaseCover r={header} inspection={inspection} />
      <PhotoNumberProvider>
        {/* "Please refer to Photographs 9 to 12." -- the template's words, as the Construction reports print them. */}
        <ReportWordingStyleContext.Provider value={{ nov2026: true }}>
          <div className="report-page-break">
            <Heading>General Description</Heading>
            {descriptionText.map((p, i) => <p key={i} style={{ margin: "0 0 8px" }}>{p}</p>)}
            {front && (
              <PhotoMetaContext.Provider value={description?.photoMeta ?? {}}>
                <PhotoGrid photos={[front]} compact={false} maxHeight={7.5} />
              </PhotoMetaContext.Provider>
            )}
            <PhotographsBlock fullDownloadUrl={fullDownloadUrl} originals={originals} />
          </div>

          {summary.length > 0 && (
            <div className="report-page-break">
              <ReportConditionSummary categories={summary} nov2026 />
            </div>
          )}

          {rest.map((s, i) => (
            <div key={s.id} id={`section-${s.id}`} className={i === 0 ? "report-page-break" : undefined} style={{ marginTop: i === 0 ? 0 : "26px" }}>
              <KeepTogether><Heading>{s.name}</Heading></KeepTogether>
              <ReportSection section={withExcludedPhotosRemoved(s)} showHeading={false} hideDamageText />
            </div>
          ))}

          <div className="report-page-break">
            <ReportScope />
          </div>
          <div className="report-page-break" style={{ marginTop: "20px" }}>
            <ReportConditions />
          </div>
        </ReportWordingStyleContext.Provider>
      </PhotoNumberProvider>
    </div>
  );
}

