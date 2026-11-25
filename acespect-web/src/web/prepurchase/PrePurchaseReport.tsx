/**
 * The Pre-Purchase / Apartment report ("ACESPECT Building (Pre-Purchase)_Apartment Nov 2026" -- "Building Report"), laid out as the
 * Construction reports are: the same cover page, headings, General Description block, Photographs paragraph and photo grid
 * (construction/ConstructionReport.tsx, components/CoverPage.tsx, components/reportKit.tsx). Only what belongs to this inspection type differs.
 *
 * Pre-Purchase / Commercial ("ACESPECT Building (Pre-Purchase)_House and Commercial Nov 2026") is laid out the same way, in its template's
 * order: ROOF, EXTERNAL, INTERNAL (with the form's Warehouse & Production and Offices & Staff Facilities under their own names), STRUCTURAL
 * DEFECTS, MAJOR DEFECTS, SAFETY HAZARDS and NOTES (the form's Notes section, split by its questions), then the template's GLOSSARY,
 * MAINTENANCE and Terms and Conditions.
 *
 * Every other report type keeps its own layout (pages/ReportView.tsx), Pre-Purchase / House included.
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
import { useOriginalPhotosLink } from "../components/OriginalPhotosLink";
import { Back, Bullets, Heading, KeepTogether, PhotographsBlock, page } from "../construction/ConstructionReport";
import { ScopeBlocks } from "./ScopeBlocks";
import { siteAccessSentences } from "./siteAccess";
import {
  PPI_CONDITION_DEFINITIONS_BLOCKS, PPI_CONDITION_DEFINITIONS_TITLE, PPI_DEFECTS_BLOCKS, PPI_POOL_SPA_TEXT, PPI_SCOPE_BLOCKS, PPI_SCOPE_TITLE, PPI_SITE_ACCESS_TITLE,
} from "./scopeText";
import { PPI_GLOSSARY_BLOCKS, PPI_GLOSSARY_TITLE, PPI_MAINTENANCE_BLOCKS, PPI_MAINTENANCE_TITLE, PPI_TERMS_BLOCKS, PPI_TERMS_TITLE } from "./termsText";
import { SubHeading } from "../construction/ConstructionReport";
import { commercialElementRows } from "./commercialSummary";
import type { ConditionSummaryRow } from "../templateFields";

/** True for the report this file lays out: Pre-Purchase / Apartment. */
export function isPrePurchaseApartment(inspection?: Pick<Inspection, "type" | "propertyType">): boolean {
  if (!inspection) return false;
  const p = reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "");
  return p.inspectionType === "pre_purchase" && p.propertyType === "apartment";
}

/** True for Pre-Purchase / Commercial, laid out here too (see above). */
export function isPrePurchaseCommercial(inspection?: Pick<Inspection, "type" | "propertyType">): boolean {
  if (!inspection) return false;
  const p = reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "");
  return p.inspectionType === "pre_purchase" && p.propertyType === "commercial_properties";
}

/** True for a report this file lays out: Pre-Purchase / Apartment or Pre-Purchase / Commercial. */
export function isPrePurchaseLayout(inspection?: Pick<Inspection, "type" | "propertyType">): boolean {
  return isPrePurchaseApartment(inspection) || isPrePurchaseCommercial(inspection);
}

const slug = (s: Pick<FormSection, "id" | "key">): string => s.key ?? s.id;

/** A media id, however the photo's address is written (a plain /api/v1/media/:id or a signed link). */
const mediaId = (u: string): string => /\/media\/([0-9a-z-]+)/i.exec(u)?.[1]?.toLowerCase() ?? u;

/** Every photo address in an answer tree. */
function photosIn(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof v === "string") { if (/\/media\//.test(v)) out.add(mediaId(v)); }
  else if (Array.isArray(v)) v.forEach((x) => photosIn(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => photosIn(x, out));
  return out;
}

/**
 * The Commercial form's Notes section, as the template's STRUCTURAL DEFECTS, MAJOR DEFECTS, SAFETY HAZARDS and NOTES: the "structural_",
 * "majordefects_" and "safety_" questions under the first three, everything else (the movement checklist, No Access Areas, the damage
 * records, Additional Notes, General Comments) under NOTES. Each part keeps its own photos and defects. Text the reviewer typed over is not
 * split: it prints whole, under NOTES.
 */
export const COMMERCIAL_NOTES_PARTS: { part: string; heading: string; prefix?: string }[] = [
  { part: "structural", heading: "Structural Defects", prefix: "structural_" },
  { part: "major", heading: "Major Defects", prefix: "majordefects_" },
  { part: "safety", heading: "Safety Hazards", prefix: "safety_" },
  { part: "notes", heading: "Notes" },
];

export function splitCommercialNotes(section: FormSection, fields: TemplateField[] | undefined, profile: ReportProfile): FormSection[] {
  const whole = prePurchaseSectionText(section, fields, profile);
  const overridden = (section.fields as Record<string, unknown> | undefined)?.reportTextOverride === true;
  const answers = (section.answers as AnswerTree | null | undefined) ?? null;
  const asPart = (s: FormSection, part: string, heading: string, photos: string[]): FormSection => ({ ...s, id: `${section.id}-${part}`, key: `notes#${part}`, name: heading, photos });
  if (!fields || !answers || overridden) return [asPart(whole, "notes", "Notes", whole.photos)];
  const named = COMMERCIAL_NOTES_PARTS.filter((p) => p.prefix).map((p) => p.prefix!);
  return COMMERCIAL_NOTES_PARTS.map((p) => {
    const own = fields.filter((f) => (p.prefix ? f.key.startsWith(p.prefix) : !named.some((x) => f.key.startsWith(x))));
    const text = prePurchaseSectionText(section, own, profile);
    const ids = photosIn(own.map((f) => answers[f.key]));
    return asPart(text, p.part, p.heading, section.photos.filter((u) => ids.has(mediaId(u))));
  });
}

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
    fields: overridden ? section.fields : { ...(section.fields as Record<string, unknown>), ...summaryOf(derived.fields.conditionSummary as ConditionSummaryRow[] | undefined, fields, answers, profile) } as FormSection["fields"],
  };
}

/** The section's Condition Summary rows: its lists' rows, and for Commercial each graded element outside a list too (commercialSummary.ts). */
function summaryOf(rows: ConditionSummaryRow[] | undefined, fields: TemplateField[], answers: AnswerTree, profile: ReportProfile): { conditionSummary?: ConditionSummaryRow[] } {
  if (profile.propertyType !== "commercial_properties") return rows ? { conditionSummary: rows } : {};
  const all = [...(rows ?? []), ...commercialElementRows(fields, answers)];
  return all.length || rows ? { conditionSummary: all } : {};
}

/** The inspection's sections as this report prints them (undefined while their templates load, null for another report type). */
export function usePrePurchaseSections(inspection?: Inspection, opts?: { includeUnapproved?: boolean }): FormSection[] | null | undefined {
  const all = !!opts?.includeUnapproved;
  const ppi = isPrePurchaseLayout(inspection);
  const [sections, setSections] = useState<FormSection[] | null | undefined>(ppi ? undefined : null);
  const key = inspection
    ? `${all ? "all" : "approved"}:${inspection.id}:${inspection.sections.map((s) => `${slug(s)}:${s.reviewStatus}:${s.reportText.length}:${(s.excludedPhotoUrls ?? []).join("|")}:${JSON.stringify(s.answers ?? null)}`).join(",")}`
    : "";
  useEffect(() => {
    if (!inspection || !ppi) { setSections(null); return; }
    let cancelled = false;
    const profile = reportProfileOf(inspection.type, inspection.propertyType);
    const commercial = isPrePurchaseCommercial(inspection);
    Promise.all(
      inspection.sections.map(async (s): Promise<FormSection | FormSection[]> => {
        if (slug(s).startsWith("job-info")) return s;
        const t = await fetchActiveTemplate(inspection.type, inspection.propertyType, slug(s)).catch(() => null);
        const fields = (t?.fields ?? undefined) as TemplateField[] | undefined;
        if (commercial && slug(s) === "notes") return splitCommercialNotes(s, fields, profile);
        return prePurchaseSectionText(s, fields, profile);
      }),
    ).then((out) => { if (!cancelled) setSections(out.flat().filter((s) => all || slug(s).startsWith("job-info") || s.reviewStatus === "approved")); });
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
  if (isPrePurchaseCommercial(inspection)) return <PrePurchaseCommercialBody inspection={inspection} sections={sections} header={header} />;
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

          {/* The template's GLOSSARY, MAINTENANCE and "Terms and Conditions – Pre-Purchase Building Inspection", word for word. */}
          <div className="report-page-break" data-ppi-title="Glossary">
            <Heading>{PPI_GLOSSARY_TITLE}</Heading>
            <ScopeBlocks blocks={PPI_GLOSSARY_BLOCKS} />
          </div>
          <div className="report-page-break" data-ppi-title="Maintenance">
            <Heading>{PPI_MAINTENANCE_TITLE}</Heading>
            <ScopeBlocks blocks={PPI_MAINTENANCE_BLOCKS} />
          </div>
          <div className="report-page-break" data-ppi-title="Terms and Conditions">
            <Heading>{PPI_TERMS_TITLE}</Heading>
            <ScopeBlocks blocks={PPI_TERMS_BLOCKS} />
          </div>
        </ReportWordingStyleContext.Provider>
      </PhotoNumberProvider>
    </div>
  );
}

/**
 * Where each Commercial section prints: its main title, and the name it prints under there (undefined: the main title alone). The form's
 * "Offices & Staff Facilities" is served from the pool_spa slot: while that slot still asks the Pool / Spa questions it prints under
 * EXTERNAL as the template's "Pool/Spa" (and only when a pool or spa was assessed: an answer of Not applicable prints nothing); once it
 * asks about offices, it prints under INTERNAL with its own name.
 */
export const COMMERCIAL_PARTS: { title: string; keys: string[]; named: boolean }[] = [
  { title: "Roof", keys: ["roof_chimneys"], named: false },
  { title: "External", keys: ["elevations", "pool_spa:pool", "garage_carport_sheds", "driveway", "paving_paths", "fences", "retaining_walls"], named: true },
  { title: "Internal", keys: ["internal_areas", "pool_spa:offices"], named: true },
  ...COMMERCIAL_NOTES_PARTS.map((p) => ({ title: p.heading, keys: [`notes#${p.part}`], named: false })),
];

/** Is the pool_spa slot (still) the Pool / Spa questions? */
const isPoolSlot = (s: FormSection) => Object.keys((s.answers as Record<string, unknown> | null | undefined) ?? {}).some((k) => k.startsWith("pool_"));
const poolAssessed = (s: FormSection) => ((s.answers as Record<string, unknown> | null | undefined) ?? {}).pool_applicability === "applicable";
const placeKey = (s: FormSection) => (slug(s) === "pool_spa" ? `pool_spa:${isPoolSlot(s) ? "pool" : "offices"}` : slug(s));

/** The Commercial body sections under their main titles, in the template's order; a section the template does not name prints after them under its own name. */
export function commercialParts(rest: FormSection[]): { title: string; sections: { section: FormSection; name?: string }[] }[] {
  const parts = COMMERCIAL_PARTS.map((p) => ({
    title: p.title,
    sections: p.keys.flatMap((k) => rest.filter((s) => placeKey(s) === k).map((section) => ({ section, name: p.named ? (k === "pool_spa:pool" ? "Pool/Spa" : section.name) : undefined }))),
  }));
  const placed = new Set(COMMERCIAL_PARTS.flatMap((p) => p.keys));
  const others = rest.filter((s) => !placed.has(placeKey(s))).map((section) => ({ title: section.name, sections: [{ section }] }));
  return [...parts, ...others].filter((p) => p.sections.length > 0);
}

function PrePurchaseCommercialBody({ inspection, sections, header }: { inspection: Inspection; sections: FormSection[]; header: ReportHeader }) {
  const originals = useOriginalPhotosLink(inspection.id);
  const fullDownloadUrl = originals.url || inspection.photoArchiveUrl;
  const body = sections.filter((s) => !slug(s).startsWith("job-info"));
  const description = body.find((s) => slug(s).startsWith("description"));
  const front = frontPhotoOf(description);
  // Every other section with something to print (no heading is printed with nothing under it); Pool/Spa only when one was assessed.
  const printable = body.filter((s) => s !== description && (s.reportText.trim() || s.photos.length > 0 || s.damages.length > 0) && !(slug(s) === "pool_spa" && isPoolSlot(s) && !poolAssessed(s)));
  const parts = commercialParts(printable);
  const summary: SummarySection[] = parts.flatMap((p) => p.sections.map(({ section: s, name }) => ({
    heading: name ?? p.title, anchorId: `section-${s.id}`, rows: (s.fields as unknown as { conditionSummary?: ConditionSummaryRow[] }).conditionSummary ?? [],
  })));
  const hasSummary = summary.some((c) => c.rows.length > 0);
  const siteAccess = siteAccessSentences(body, { commercial: true });

  return (
    <div style={page}>
      <PrePurchaseCover r={header} inspection={inspection} />
      <PhotoNumberProvider>
        <ReportWordingStyleContext.Provider value={{ nov2026: true }}>
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
          {hasSummary && (
            <div className="report-page-break" data-ppi-title="Condition Summary">
              <PrePurchaseSummary sections={summary} lead={<Heading>Condition Summary</Heading>} />
            </div>
          )}
          {siteAccess.length > 0 && (
            <div className="report-page-break" id="site-access" data-ppi-title="Site Access Conditions">
              <Bullets items={siteAccess} lead={<Heading>{PPI_SITE_ACCESS_TITLE}</Heading>} />
            </div>
          )}
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

          {parts.map((p) => (
            <div key={p.title} className="report-page-break" data-ppi-title={p.title}>
              {p.sections.map(({ section: s, name }, i) => {
                const title = i === 0 ? (
                  <KeepTogether>
                    <Heading>{p.title}</Heading>
                    {hasSummary && <Back href="#summary" />}
                  </KeepTogether>
                ) : null;
                return (
                  <div key={s.id} id={`section-${s.id}`} data-ppi-section={name ?? p.title}>
                    {title}
                    {name && <SubHeading>{name}</SubHeading>}
                    <ReportSection section={withExcludedPhotosRemoved(s)} showHeading={false} hideDamageText />
                    {slug(s) === "pool_spa" && isPoolSlot(s) && poolAssessed(s) && <p data-ppi="pool-spa-text" style={{ margin: "8px 0 0", textAlign: "justify" }}>{PPI_POOL_SPA_TEXT}</p>}
                  </div>
                );
              })}
            </div>
          ))}

          {/* The template's GLOSSARY, MAINTENANCE and "Terms and Conditions – Pre-Purchase Building Inspection", word for word. */}
          <div className="report-page-break" data-ppi-title="Glossary">
            <Heading>{PPI_GLOSSARY_TITLE}</Heading>
            <ScopeBlocks blocks={PPI_GLOSSARY_BLOCKS} />
          </div>
          <div className="report-page-break" data-ppi-title="Maintenance">
            <Heading>{PPI_MAINTENANCE_TITLE}</Heading>
            <ScopeBlocks blocks={PPI_MAINTENANCE_BLOCKS} />
          </div>
          <div className="report-page-break" data-ppi-title="Terms and Conditions">
            <Heading>{PPI_TERMS_TITLE}</Heading>
            <ScopeBlocks blocks={PPI_TERMS_BLOCKS} />
          </div>
        </ReportWordingStyleContext.Provider>
      </PhotoNumberProvider>
    </div>
  );
}

export { PPI_GENERAL, PrePurchaseCover, prePurchasePurpose } from "./PrePurchaseCover";
