/**
 * The Pre-Purchase / Apartment report ("ACESPECT Building (Pre-Purchase)_Apartment Nov 2026" -- "Building Report"), laid out as the
 * Construction reports are: the same cover page, headings, General Description block, Photographs paragraph and photo grid
 * (construction/ConstructionReport.tsx, components/CoverPage.tsx, components/reportKit.tsx). Only what belongs to this inspection type differs.
 *
 * Pre-Purchase / Commercial ("ACESPECT Building (Pre-Purchase)_House and Commercial Nov 2026") is laid out the same way, in its template's
 * order: GENERAL DESCRIPTION, ROOF, EXTERNAL and INTERNAL -- each with the template's element headings in the template's order, wherever the
 * form asks about the element (wording/pre_purchase.commercial_properties.ts marks them) -- then STRUCTURAL DEFECTS, MAJOR DEFECTS, SAFETY
 * HAZARDS and NOTES (the form's Notes section, split by its questions), then the template's GLOSSARY, MAINTENANCE and Terms and Conditions.
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
  PPI_CONDITION_DEFINITIONS_BLOCKS, PPI_CONDITION_DEFINITIONS_TITLE, PPI_DEFECTS_BLOCKS, PPI_SCOPE_BLOCKS, PPI_SCOPE_TITLE, PPI_SITE_ACCESS_TITLE,
} from "./scopeText";
import { PPI_GLOSSARY_BLOCKS, PPI_GLOSSARY_TITLE, PPI_MAINTENANCE_BLOCKS, PPI_MAINTENANCE_TITLE, PPI_TERMS_BLOCKS, PPI_TERMS_TITLE } from "./termsText";
import { SubHeading } from "../construction/ConstructionReport";
import { commercialElementRows } from "./commercialSummary";
import { generalPhotosOf } from "../components/ReportSection";
import { markedKeys, markedPhotos, photoKey, splitParts } from "../reportParts";
import {
  commercialGeneralDescription, COMMERCIAL_EXTERNAL_PARTS, COMMERCIAL_INTERNAL_INTRO, COMMERCIAL_NOTES_STANDARD, withRetiredAreas, COMMERCIAL_INTERNAL_PARTS, COMMERCIAL_ROOF_PARTS, COMMERCIAL_ROOF_SPACE_PARTS, COMMERCIAL_UNPLACED,
} from "../wording/pre_purchase.commercial_properties";
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
    let text = prePurchaseSectionText(section, own, profile);
    // NOTES opens with the template's standard paragraphs, then the form's own Notes answers.
    if (p.part === "notes" && profile.propertyType === "commercial_properties") text = { ...text, reportText: [...COMMERCIAL_NOTES_STANDARD, text.reportText].filter((x) => x.trim()).join("\n\n") };
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
  // Commercial: the rooms of an inspection started on the earlier form keep that form's names.
  if (profile.propertyType === "commercial_properties") fields = withRetiredAreas(fields, answers);
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
    const templates = new Map<string, Promise<TemplateField[] | undefined>>();
    const fieldsOf = (key: string) => {
      if (!templates.has(key)) templates.set(key, fetchActiveTemplate(inspection.type, inspection.propertyType, key).then((t) => (t?.fields ?? undefined) as TemplateField[] | undefined).catch(() => undefined));
      return templates.get(key)!;
    };
    Promise.all(
      inspection.sections.map(async (s): Promise<FormSection | FormSection[]> => {
        if (slug(s).startsWith("job-info")) return s;
        let fields = await fieldsOf(slug(s));
        if (commercial && slug(s) === "notes") return splitCommercialNotes(s, fields, profile);
        // Commercial: an inspection started on the earlier form saved its Pool / Spa answers in this slot; the form now asks them in External.
        if (commercial && isPoolSlot(s) && !fields?.some((f) => f.key === "pool_applicability")) fields = (await fieldsOf("elevations"))?.filter((f) => f.key.startsWith("pool_"));
        return prePurchaseSectionText(s, fields, profile);
      }),
    ).then(async (out) => {
      const printed = out.flat();
      // Commercial: the General Description's sentences, from Job Information and the front elevation (wording/pre_purchase.commercial_properties.ts).
      if (commercial) {
        const answersOf = (key: string) => ((inspection.sections.find((x) => slug(x) === key)?.answers ?? {}) as AnswerTree);
        const lines = commercialGeneralDescription(answersOf("job-info"), (await fieldsOf("job-info")) ?? [], answersOf("elevations"), (await fieldsOf("elevations")) ?? []);
        printed.forEach((x, i) => { if (slug(x).startsWith("description")) printed[i] = { ...x, reportText: lines.join("\n\n") }; });
      }
      if (!cancelled) setSections(printed.filter((s) => all || slug(s).startsWith("job-info") || s.reviewStatus === "approved"));
    });
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

/** One piece of a Commercial main title: a section's part under one of the template's headings. */
export interface CommercialPiece {
  /** The section, with only this part's text. */
  section: FormSection;
  /** The template's heading it prints under (none: printed straight under the main title). */
  heading?: string;
  /** The anchor the Condition Summary links to (the section's first piece). */
  anchor?: string;
  /** The photos printed after it: on a section's last piece, its photos no part names and no defect holds; none on the others. */
  generalPhotos: string[];
  /** The section's defects no sentence names: printed with its last piece. */
  untaggedDefects: boolean;
}

const COMMERCIAL_MAINS = [
  { title: "Roof", headings: COMMERCIAL_ROOF_PARTS },
  { title: "External", headings: COMMERCIAL_EXTERNAL_PARTS },
  { title: "Internal", headings: COMMERCIAL_INTERNAL_PARTS },
] as const;

/** The main title a section's part prints under: the roof space and the areas under INTERNAL, the rest of the roof under ROOF. */
function commercialMainOf(section: FormSection, heading: string | undefined): string {
  const key = placeKey(section);
  if (heading && COMMERCIAL_ROOF_SPACE_PARTS.includes(heading)) return "Internal";
  if (key === "roof_chimneys") return "Roof";
  if (key === "internal_areas" || key === "pool_spa:offices") return "Internal";
  return COMMERCIAL_PARTS.find((p) => p.keys.includes(key))?.title ?? section.name;
}

/**
 * The Commercial body (not the Notes) under ROOF, EXTERNAL and INTERNAL: every section cut at its template headings (PART marks), each part
 * placed under its main title at its heading's place in the template's order, parts from different sections under the same heading one
 * after another. A section with no marks (text the reviewer typed over) prints whole under its own name. Each part prints its own photos
 * and defects; the section's other photos and its untagged defects print with its last part.
 */
export function commercialPieces(printable: FormSection[]): { title: string; pieces: CommercialPiece[] }[] {
  const ranked: (CommercialPiece & { main: string; rank: number; order: number; index: number })[] = [];
  printable.forEach((raw, order) => {
    if (slug(raw).startsWith("notes")) return;
    const s = withExcludedPhotosRemoved(raw);
    const parts = splitParts(s.reportText);
    const titled = parts.some((p) => p.title !== undefined);
    const list = titled ? parts : [{ title: undefined, text: s.reportText }];
    const marked = new Set(markedPhotos(s, markedKeys(s.reportText)).map(photoKey));
    const rest = generalPhotosOf(s).filter((u) => !marked.has(photoKey(u)));
    // A defect a part's sentence names prints there with its photos; the last part prints only those no part names.
    const named = (text: string) => new Set([...text.matchAll(/(?:^|\n)DEFECT::(\d+)::/g)].map((m) => Number(m[1])));
    const namedAnywhere = named(s.reportText);
    list.forEach((p, i) => {
      const unplaced = p.title === COMMERCIAL_UNPLACED;
      const heading = unplaced ? undefined : titled ? p.title : placeKey(s) === "pool_spa:pool" ? "Pool/Spa" : COMMERCIAL_PARTS.find((x) => x.keys.includes(placeKey(s)))?.named ? s.name : undefined;
      const main = commercialMainOf(s, p.title);
      const headings: readonly string[] = COMMERCIAL_MAINS.find((m) => m.title === main)?.headings ?? [];
      // The text before a section's first heading (INTERNAL's opening sentence) comes first; what has no place comes last; a heading the
      // template does not have comes after the template's own.
      const known = heading ? headings.indexOf(heading) : -1;
      const rank = p.title === undefined && titled ? -1 : unplaced ? Number.MAX_SAFE_INTEGER : known >= 0 ? known : headings.length;
      const last = i === list.length - 1;
      const here = named(p.text);
      // The last part's own list keeps every defect in its place (each sentence names its defect by its position), without the photos of
      // those another part prints.
      const damages = last ? s.damages.map((d, n) => (namedAnywhere.has(n) && !here.has(n) ? { ...d, photos: [] } : d)) : s.damages;
      ranked.push({
        section: { ...s, id: `${s.id}:${i}`, name: heading ?? "", reportText: p.text, damages },
        heading,
        anchor: i === 0 ? `section-${raw.id}` : undefined,
        generalPhotos: last ? rest : [],
        untaggedDefects: last,
        main,
        rank,
        order,
        index: i,
      });
    });
  });
  const mains = [...COMMERCIAL_MAINS.map((m) => m.title), ...new Set(ranked.map((p) => p.main).filter((m) => !COMMERCIAL_MAINS.some((x) => x.title === m)))];
  return mains
    .map((title) => ({
      title,
      pieces: ranked
        .filter((p) => p.main === title)
        .sort((a, b) => a.rank - b.rank || a.order - b.order || a.index - b.index)
        .map(({ main: _m, rank: _r, order: _o, index: _i, ...piece }) => piece),
    }))
    .filter((m) => m.pieces.some((p) => p.section.reportText.trim() || p.generalPhotos.length || (p.untaggedDefects && p.section.damages.length)));
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
  const placed = commercialPieces(printable);
  const generalDescription = (description?.reportText ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
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
          {(front || generalDescription.length > 0) && (
            <div className="report-page-break" data-ppi-title="General Description">
              <KeepTogether>
                <Heading>General Description</Heading>
                {generalDescription.map((p, i) => <p key={i} data-ppi="general-description" style={{ margin: "0 0 8px", textAlign: "justify" }}>{p}</p>)}
                {front && (
                  <PhotoMetaContext.Provider value={description?.photoMeta ?? {}}>
                    <PhotoGrid photos={[front]} compact={false} maxHeight={7.5} />
                  </PhotoMetaContext.Provider>
                )}
              </KeepTogether>
            </div>
          )}
          <div className="report-page-break" data-ppi-title="Photographs">
            <PhotographsBlock fullDownloadUrl={fullDownloadUrl} originals={originals} />
          </div>

          {placed.map((p) => (
            <div key={p.title} className="report-page-break" data-ppi-title={p.title}>
              <KeepTogether>
                <Heading>{p.title}</Heading>
                {hasSummary && <Back href="#summary" />}
              </KeepTogether>
              {/* The template's sentence at the top of INTERNAL. */}
              {p.title === "Internal" && <p data-ppi="internal-intro" style={{ margin: "0 0 8px", textAlign: "justify" }}>{COMMERCIAL_INTERNAL_INTRO}</p>}
              {p.pieces.map((piece, i) => {
                const sub = piece.heading && piece.heading !== p.pieces[i - 1]?.heading ? piece.heading : undefined;
                return (
                  <div key={piece.section.id} id={piece.anchor} data-ppi-section={piece.heading ?? p.title}>
                    {sub && <SubHeading>{sub}</SubHeading>}
                    <ReportSection section={piece.section} showHeading={false} hideDamageText generalPhotos={piece.generalPhotos} untaggedDefects={piece.untaggedDefects} />
                  </div>
                );
              })}
            </div>
          ))}

          {parts.filter((p) => COMMERCIAL_NOTES_PARTS.some((n) => n.heading === p.title)).map((p) => (
            <div key={p.title} className="report-page-break" data-ppi-title={p.title}>
              {p.sections.map(({ section: s }, i) => (
                <div key={s.id} id={`section-${s.id}`} data-ppi-section={p.title}>
                  {i === 0 && (
                    <KeepTogether>
                      <Heading>{p.title}</Heading>
                      {hasSummary && <Back href="#summary" />}
                    </KeepTogether>
                  )}
                  <ReportSection section={withExcludedPhotosRemoved(s)} showHeading={false} hideDamageText />
                </div>
              ))}
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
