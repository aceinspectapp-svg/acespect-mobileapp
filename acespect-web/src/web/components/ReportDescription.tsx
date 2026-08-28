import type { Inspection } from "../mockData";
import {
  DESCRIPTION_PHOTO_PLACEHOLDER,
  PHOTOGRAPHS_NOTE,
  SCOPE_BOILERPLATE,
  SCOPE_PHOTOS_REF,
  SITE_IMAGE_NOTE,
} from "../report";
import { Note, Para, Placeholder, reportTextStyle, SectionBand } from "./reportKit";

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

  return (
    <div style={reportTextStyle(compact)}>
      <SectionBand compact={compact}>Description and Overview</SectionBand>
      {paras.length > 0 ? (
        paras.map((p, i) => <Para key={i}>{p}</Para>)
      ) : (
        <Placeholder>Insert property description (storeys, orientation, construction, roof, windows).</Placeholder>
      )}
      <Placeholder>{DESCRIPTION_PHOTO_PLACEHOLDER}</Placeholder>

      <SectionBand compact={compact}>Photographs</SectionBand>
      <Para>
        Selected photographs are included in the body of this report. For a full download please{" "}
        <a style={{ color: "#2563eb", textDecoration: "underline" }} href="#photos" onClick={(e) => e.preventDefault()}>
          Click here
        </a>{" "}
        to access. We recommend that you download the digital photographs immediately and save in a secure
        folder on your device, as the link will remain active for only a few months from the date of this report.
      </Para>
      <Note>{PHOTOGRAPHS_NOTE}</Note>

      <SectionBand compact={compact}>Scope of Inspection and Comments</SectionBand>
      <Placeholder>
        The project works are to the property at {property}, which is at the [direction] – approximately
        [compass point] – of the site of this inspection.
      </Placeholder>
      <Para>{SCOPE_BOILERPLATE}</Para>
      <Para>{SCOPE_PHOTOS_REF}</Para>

      <SectionBand compact={compact} tone="neutral">Site Image</SectionBand>
      <Placeholder>Mark-up by inspector indicating areas surveyed.</Placeholder>
      <Para justify={false}>North is approximately to the top of the image.</Para>
      <Note>{SITE_IMAGE_NOTE}</Note>
    </div>
  );
}
