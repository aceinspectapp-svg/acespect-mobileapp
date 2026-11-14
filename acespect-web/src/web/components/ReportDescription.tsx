import type { Inspection } from "../mockData";
import { DESCRIPTION_PHOTO_PLACEHOLDER, PHOTOGRAPHS_NOTE } from "../report";
import { Note, Para, Placeholder, PhotoGrid, reportTextStyle, SectionBand, usePhotoNumbering } from "./reportKit";
import { reportProfileOf } from "../wording/profile";
import { wordingFor } from "../wording/registry";
import { scopeOfInspectionSentences } from "../descriptionScope";
import { DILAPIDATION_METHOD_NOV2026, printsAgreement } from "../reportAgreement";

/** Every photo that actually appears in the printed report -- general section photos plus each damage/crack's own -- matching what the reader can actually count, for the "full download of N photographs" disclosure. */
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

/**
 * The Description & Overview report section, in the standard Houspect layout:
 * description + photo placeholder, the Photographs notice, the Scope of
 * Inspection block, and the Site Image placeholder. The property description
 * paragraph comes from the section's (reviewer-editable) report text.
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
  const paras = reportText
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const property = `${inspection.address}, ${inspection.suburb}`;

  // The front-of-property photo lives here, not on the cover (which the
  // reference report never puts one on -- see ReportCover). Read straight
  // off this same section's own "front_elevation" answer field.
  const description = inspection.sections.find((s) => (s.key ?? s.id).startsWith("description"));
  const wording = wordingFor(reportProfileOf(inspection.type, inspection.propertyType));
  // The Residential form's "front_elevation" photo; the Apartment form's is its "Building & street overview pics" (the first of them).
  const answers = (description?.answers as Record<string, unknown> | null | undefined) ?? {};
  const frontPhotos = [answers.front_elevation, answers.overviewPhotos].find((v) => Array.isArray(v) && typeof v[0] === "string") as string[] | undefined;
  const photoUrl = frontPhotos?.[0];
  const frontPhotoNumbering = usePhotoNumbering(photoUrl ? [photoUrl] : [], "front");
  const totalPhotos = countReportPhotos(inspection);

  // Scope, Safety and Limitations fields (projectSiteAddress, siteSide,
  // siteDirection, scopeForInspection, ...) live in this section's own
  // `fields` -- populated by the generic per-field fallback in
  // templateFields.ts since they're deliberately excluded from the
  // composed property-description paragraph (see the report type's wording (src/web/wording/)
  // `description` composer). Reading them here lets this block show the
  // reference report's actual filled-in sentence instead of an unfilled
  // "[direction] / [compass point]" placeholder whenever the inspector has
  // answered them.
  const f = (description?.fields as Record<string, unknown> | null | undefined) ?? {};
  // Reviewer-pasted link to the full external photo archive (e.g. a
  // Dropbox/Drive folder) -- stored as an ordinary template field on this
  // same section (see seed-description-photo-archive-url.ts), not a
  // separate database column, so it flows through exactly like every other
  // description field (`fields.photoArchiveUrl`, populated by the generic
  // per-field fallback in templateFields.ts). When absent, "Click here"
  // doesn't appear at all and both mentions reword to stay meaningful
  // without a dead link.
  // The link to THIS job's photo folder is generated from its job number
  // (backend: inspectionFolderUrl) and wins; a link a reviewer pasted by hand
  // is the fallback for when storage isn't set up (or as a deliberate override
  // when no generated link exists). With no photos there is nothing to link to.
  const generatedArchiveUrl = totalPhotos > 0 ? inspection.photoArchiveUrl ?? "" : "";
  const photoArchiveUrl = generatedArchiveUrl || str(f.photoArchiveUrl);
  // A report type can word the works and scope sentences itself (Public Assets does); the others keep the standard ones (descriptionScope.ts).
  const surveyParts = (inspection.sections.find((s) => (s.key ?? s.id) === "elevations")?.answers as { parts?: unknown } | null | undefined)?.parts;
  const { works, scope } = scopeOfInspectionSentences(wording, f, Array.isArray(surveyParts) ? surveyParts.length : 0);

  return (
    <div style={reportTextStyle(compact)}>
      <SectionBand compact={compact}>Description and Overview</SectionBand>
      {paras.length > 0 ? (
        paras.map((p, i) => <Para key={i}>{p}</Para>)
      ) : (
        <Placeholder>Insert property description (storeys, orientation, construction, roof, windows).</Placeholder>
      )}
      {photoUrl ? (
        // The front-of-property photo: the same photo grid as every other photo in the report.
        // ("Size to fit the page and centre" where the report type's template says so -- Apartment.)
        <PhotoGrid photos={[photoUrl]} compact={compact} startNumber={frontPhotoNumbering.start} fitPage={wording.frontPhoto?.fit === "page"} />
      ) : (
        <Placeholder>{wording.frontPhoto?.placeholder ?? DESCRIPTION_PHOTO_PLACEHOLDER}</Placeholder>
      )}

      <SectionBand compact={compact}>Photographs</SectionBand>
      {photoArchiveUrl ? (
        <Para>
          Selected photographs are included in the body of this report. For a full download
          {totalPhotos > 0 ? ` of ${totalPhotos} photographs` : ""} please{" "}
          <a href={photoArchiveUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
            Click here
          </a>{" "}
          to access. We recommend that you download the digital photographs immediately and save in a secure
          folder on your device, as the link will remain active for only a few months from the date of this report.
        </Para>
      ) : (
        // No archive link on file -- no "Click here" at all (a dead link
        // that goes nowhere is worse than no link): the template's first
        // sentence on its own, with nothing added to it.
        <Para>Selected photographs are included in the body of this report.</Para>
      )}
      {photoArchiveUrl && <Note>{PHOTOGRAPHS_NOTE}</Note>}

      <SectionBand compact={compact}>Scope of Inspection and Comments</SectionBand>
      {works ? (
        <Para>{works}</Para>
      ) : (
        <Placeholder>
          The project works are to the property at {property}, which is at the [direction] – approximately
          [compass point] – of the site of this inspection.
        </Placeholder>
      )}
      {scope ? (
        <Para>{scope}</Para>
      ) : (
        <Placeholder>
          The scope for inspection is external and internal to all structures / external and internal to part of
          the property at / internal only to all areas / external only to all areas. OR insert description of
          scope.
        </Placeholder>
      )}
      {printsAgreement(reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "")) && <Para>{DILAPIDATION_METHOD_NOV2026}</Para>}
      {photoArchiveUrl ? (
        <Para>
          Selected photographs are displayed in this report. For a full download
          {totalPhotos > 0 ? ` of ${totalPhotos} photographs` : ""} provided by the Houspect survey please go to the
          link in the Photographs heading on page 2 of the report.
        </Para>
      ) : (
        <Para>Selected photographs are displayed in this report.</Para>
      )}

      {/* No "Site Image" section here: the reference report only includes
          one when there's a real aerial/mark-up image to show, and omits it
          entirely otherwise (confirmed directly against the reference's own
          57-page sample, which never shows this section at all). There's no
          backing template field for an uploaded site-image/markup photo yet,
          so unlike the front-of-property photo above, this can't be real
          data -- showing a permanent placeholder here was pure unfilled
          boilerplate. Revisit once a real site-image field exists. */}
    </div>
  );
}
