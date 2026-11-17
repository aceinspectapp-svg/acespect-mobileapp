import { useContext, type ReactNode } from "react";
import type { Inspection } from "../mockData";
import type { TextEdits } from "../textEdits";
import { DESCRIPTION_PHOTO_PLACEHOLDER, PHOTOGRAPHS_NOTE } from "../report";
import { Note, Para, Placeholder, PhotoGrid, PhotoMetaContext, reportTextStyle, SectionBand, usePhotoNumbering } from "./reportKit";
import { reportProfileOf } from "../wording/profile";
import { OriginalPhotosPending, useOriginalPhotosLink } from "./OriginalPhotosLink";
import { wordingFor } from "../wording/registry";
import { scopeOfInspectionSentences } from "../descriptionScope";
import { DILAPIDATION_METHOD_NOV2026, printsAgreement } from "../reportAgreement";
import { InlineText } from "./InlineText";
import { EditableText, ReportEditContext } from "./EditableText";

/** How many distinct photos the inspection has. A defect's photos are also in its section's photo list, so each photo is counted once (by its address, ignoring any signing query). */
export function countReportPhotos(inspection: Inspection): number {
  const seen = new Set<string>();
  for (const s of inspection.sections) {
    for (const url of [...s.photos, ...s.damages.flatMap((d) => d.photos)]) seen.add(String(url).split("?")[0]);
  }
  return seen.size;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** One of the Description page's own sentences (not part of the section's report text), which a reviewer can retype for this inspection. */
export interface DescriptionBlock {
  key: "photographs" | "works" | "scope" | "method" | "displayed";
  /** What the editor calls it. */
  label: string;
  /** The heading it prints under. */
  band: "Photographs" | "Scope of Inspection and Comments";
  /** The wording the report uses when nobody has retyped it ("" when there is none yet -- a placeholder prints instead). */
  standard: string;
  /** The reviewer's wording, when they have retyped it ("" = left out of the report). */
  override?: string;
  /** What prints when there is neither: the template's fill-in placeholder. */
  placeholder?: string;
}

/**
 * Everything the Description page shows, worked out from the inspection: the description paragraphs, the front photo, the photo
 * download link, and its own sentences (with any wording the reviewer gave them). Shared by the page and the reviewer's text editor,
 * so the editor offers exactly the sentences that print.
 */
export function useDescriptionContent(inspection: Inspection, reportText: string) {
  const paras = reportText
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const property = `${inspection.address}, ${inspection.suburb}`;

  // The front-of-property photo lives here, not on the cover (which the reference report never puts one on -- see ReportCover). Read
  // straight off this same section's own "front_elevation" answer field.
  const description = inspection.sections.find((s) => (s.key ?? s.id).startsWith("description"));
  const wording = wordingFor(reportProfileOf(inspection.type, inspection.propertyType));
  // The Residential form's "front_elevation" photo; the Apartment form's is its "Building & street overview pics" (the first of them);
  // Public Assets' is the first of its "Site & Assets Overview" photo sequence.
  const answers = (description?.answers as Record<string, unknown> | null | undefined) ?? {};
  const frontPhotos = [answers.front_elevation, answers.overviewPhotos, answers.siteAssetsOverview].find((v) => Array.isArray(v) && typeof v[0] === "string") as string[] | undefined;
  const photoUrl = frontPhotos?.[0];
  const totalPhotos = countReportPhotos(inspection);

  // Scope, Safety and Limitations fields (projectSiteAddress, siteSide, siteDirection, scopeForInspection, ...) live in this section's
  // own `fields` -- populated by the generic per-field fallback in templateFields.ts since they're deliberately excluded from the composed
  // property-description paragraph. Reading them here lets this block show the reference report's actual filled-in sentence instead of
  // an unfilled "[direction] / [compass point]" placeholder whenever the inspector has answered them.
  const f = (description?.fields as Record<string, unknown> | null | undefined) ?? {};
  // The link to THIS job's photo folder is generated from its job number (backend: inspectionFolderUrl) and wins; a link a reviewer
  // pasted by hand (fields.photoArchiveUrl) is the fallback for when storage isn't set up. With no photos there is nothing to link to.
  const generatedArchiveUrl = totalPhotos > 0 ? inspection.photoArchiveUrl ?? "" : "";
  const photoArchiveUrl = generatedArchiveUrl || str(f.photoArchiveUrl);
  // "Click here" downloads every original photo of the inspection as one zip; the folder link above stays the fallback.
  const originals = useOriginalPhotosLink(inspection.id);
  const fullDownloadUrl = originals.url || photoArchiveUrl;
  // "For a full download of N photographs": with the zip link, N is what the zip holds (every photo of the inspection).
  const fullDownloadCount = originals.url ? originals.count : totalPhotos;
  // A report type can word the works and scope sentences itself (Public Assets does); the others keep the standard ones (descriptionScope.ts).
  const surveyParts = (inspection.sections.find((s) => (s.key ?? s.id) === "elevations")?.answers as { parts?: unknown } | null | undefined)?.parts;
  // Each survey part by its name, with its road or lane when the name does not already say it ("Part B - Laneway beside no. 24 (Gwynne Lane)").
  const areaNames = (Array.isArray(surveyParts) ? (surveyParts as Record<string, unknown>[]) : []).map((p, i) => {
    const name = str(p?.partName) || `Part ${String.fromCharCode(65 + i)}`;
    const road = str(p?.roadName);
    return road && !name.toLowerCase().includes(road.toLowerCase()) ? `${name} (${road})` : name;
  });
  const { works, scope, areas } = scopeOfInspectionSentences(wording, f, Array.isArray(surveyParts) ? surveyParts.length : 0, areaNames);

  const count = fullDownloadCount > 0 ? ` of ${fullDownloadCount} photographs` : "";
  const overrides = ((description?.textEdits as TextEdits | null | undefined)?.blocks ?? {}) as Record<string, string>;
  const block = (b: Omit<DescriptionBlock, "override">): DescriptionBlock => (b.key in overrides ? { ...b, override: overrides[b.key] } : b);
  const blocks: DescriptionBlock[] = [
    block({
      key: "photographs", label: "Photographs paragraph", band: "Photographs",
      standard: fullDownloadUrl
        ? `Selected photographs are included in the body of this report. For a full download${count} please [Click here] to access. We recommend that you download the digital photographs immediately and save in a secure folder on your device, as the link will remain active for only a few months from the date of this report.`
        : "Selected photographs are included in the body of this report.",
    }),
    block({
      key: "works", label: "Where the project works are", band: "Scope of Inspection and Comments", standard: works ?? "",
      placeholder: `The project works are to the property at ${property}, which is at the [direction] – approximately [compass point] – of the site of this inspection.`,
    }),
    block({
      key: "scope", label: "Scope of the inspection", band: "Scope of Inspection and Comments", standard: scope ?? "",
      placeholder: "The scope for inspection is external and internal to all structures / external and internal to part of the property at / internal only to all areas / external only to all areas. OR insert description of scope.",
    }),
    ...(printsAgreement(reportProfileOf(inspection.type ?? "", inspection.propertyType ?? ""))
      ? [block({ key: "method", label: "How the inspection was done", band: "Scope of Inspection and Comments", standard: DILAPIDATION_METHOD_NOV2026 })]
      : []),
    block({
      key: "displayed", label: "Photographs note", band: "Scope of Inspection and Comments",
      standard: fullDownloadUrl
        ? `Selected photographs are displayed in this report. For a full download${count} provided by the Houspect survey please go to the link in the Photographs heading on page 2 of the report.`
        : "Selected photographs are displayed in this report.",
    }),
  ];

  return { paras, description, wording, photoUrl, photoArchiveUrl, fullDownloadUrl, originals, areas, blocks };
}

/**
 * The Description & Overview report section, in the standard Houspect layout: description + photo placeholder, the Photographs notice,
 * the Scope of Inspection block. The property description paragraph comes from the section's (reviewer-editable) report text; the other
 * sentences from the Description answers, or from the reviewer's own wording of them (the report text editor).
 */
export function ReportDescription({
  inspection,
  reportText,
  compact = false,
}: {
  inspection: Inspection;
  reportText: string;
  compact?: boolean;
}) {
  const { paras, description, wording, photoUrl, photoArchiveUrl, fullDownloadUrl, originals, areas, blocks } = useDescriptionContent(inspection, reportText);
  const frontPhotoNumbering = usePhotoNumbering(photoUrl ? [photoUrl] : [], "front");
  const link: ReactNode = fullDownloadUrl ? (
    <a href={fullDownloadUrl} data-original-photos-link={originals.url ? "" : undefined} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
      Click here
    </a>
  ) : (
    "Click here"
  );
  const byKey = (k: DescriptionBlock["key"]) => blocks.find((b) => b.key === k);
  // In the reviewer's preview every sentence here can be clicked and typed into (EditableText); in the report it is plain.
  const edit = useContext(ReportEditContext);
  /** One of the page's own sentences: the reviewer's wording, else the standard one, else the template's placeholder. */
  const sentence = (b: DescriptionBlock | undefined) => {
    if (!b || b.override === "") return null;
    const text = b.override ?? b.standard;
    if (edit?.saveBlock) {
      const save = (next: string) => edit.saveBlock!(b.key, next, b.standard);
      if (!text && b.placeholder) return <Para><EditableText text="" emptyHint={`${b.placeholder} (click to write it)`} onSave={save} /></Para>;
      if (text) return <Para><EditableText text={text} link={link} onSave={save} /></Para>;
    }
    if (!text) return b.placeholder ? <Placeholder>{b.placeholder}</Placeholder> : null;
    return <Para><InlineText text={text} link={link} /></Para>;
  };
  const scopeShown = !!(byKey("scope")?.override ?? byKey("scope")?.standard);

  return (
    <div style={reportTextStyle(compact)}>
      <SectionBand compact={compact}>Description and Overview</SectionBand>
      {paras.length > 0 ? (
        paras.map((p, i) => <Para key={i}>{edit?.saveLine ? <EditableText text={p} onSave={(next) => edit.saveLine!(i, next)} /> : <InlineText text={p} />}</Para>)
      ) : (
        <Placeholder>Insert property description (storeys, orientation, construction, roof, windows).</Placeholder>
      )}
      {photoUrl ? (
        // The front-of-property photo: the same photo grid as every other photo in the report.
        // ("Size to fit the page and centre" where the report type's template says so -- Apartment.)
        <PhotoMetaContext.Provider value={description?.photoMeta ?? {}}>
          <PhotoGrid photos={[photoUrl]} compact={compact} startNumber={frontPhotoNumbering.start} fitPage={wording.frontPhoto?.fit === "page"} />
        </PhotoMetaContext.Provider>
      ) : (
        <Placeholder>{wording.frontPhoto?.placeholder ?? DESCRIPTION_PHOTO_PLACEHOLDER}</Placeholder>
      )}

      <SectionBand compact={compact}>Photographs</SectionBand>
      <OriginalPhotosPending pending={originals.pending} />
      {sentence(byKey("photographs"))}
      {photoArchiveUrl && <Note>{PHOTOGRAPHS_NOTE}</Note>}

      <SectionBand compact={compact}>Scope of Inspection and Comments</SectionBand>
      {sentence(byKey("works"))}
      {sentence(byKey("scope"))}
      {scopeShown && areas?.map((a, i) => <Para key={`area-${i}`}>{`${i + 1}. ${a}`}</Para>)}
      {sentence(byKey("method"))}
      {sentence(byKey("displayed"))}

      {/* No "Site Image" section here: the reference report only includes one when there's a real aerial/mark-up image to show, and
          omits it entirely otherwise. There's no backing template field for an uploaded site-image/markup photo yet. */}
    </div>
  );
}
