import type { DamageRecord, FormSection } from "../mockData";
import { Heading, Para, PhotoGrid, reportTextStyle, reportTokens, SectionBand } from "./reportKit";

// Internal Areas' floor headings (see reportSentences.ts's internal_areas
// composer) are injected as plain uppercase lines within the section's flat
// reportText, not as a separate structured field -- matched here by their
// fixed, known text so they can render as the reference's own tan/khaki
// bar instead of an ordinary paragraph.
const FLOOR_HEADINGS = ["GROUND FLOOR", "FIRST FLOOR", "SECOND FLOOR", "BASEMENT"];

/** Turn a damage record into a report sentence. */
function describeDamage(d: DamageRecord): string {
  const descriptor = `${d.direction ? d.direction.toLowerCase() + " " : ""}${d.type.toLowerCase()}`;
  const dims: string[] = [];
  if (d.widthMm > 0) dims.push(`approximately ${d.widthMm}mm wide`);
  if (d.lengthMm > 0) dims.push(`approximately ${d.lengthMm}mm long`);
  let s = `At ${d.location}, there is a ${descriptor}`;
  if (dims.length) s += `, ${dims.join(" and ")}`;
  s += ".";
  if (d.notes) s += ` ${d.notes}`;
  return s;
}

/**
 * A single inspection category rendered as report content: the description, then
 * its photographs, then each crack/damage described with its image. Used in both
 * the official report and the reviewer's Report Content column so they match.
 */
export function ReportSection({
  section,
  showHeading = true,
  compact = false,
  hideDamageText = false,
}: {
  section: FormSection;
  showHeading?: boolean;
  compact?: boolean;
  /** True for a section whose reportText already narrates each crack/damage inline (see reportSentences.ts) -- skip the sentence here so it isn't said twice, but still show that damage's photos. */
  hideDamageText?: boolean;
}) {
  const paras = section.reportText
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div style={reportTextStyle(compact)}>
      {showHeading && <Heading compact={compact}>{section.name}</Heading>}

      {/* "Please refer to Photographs" sits directly under the heading in
          the reference report, in body style (not a distinct grey label) --
          matched here once per section rather than repeated after every
          paragraph the way the reference's own blank fill-in template does,
          since our photos are one flat list per section, not tied to a
          specific paragraph the way separate raw fields were. */}
      {section.photos.length > 0 && <Para>Please refer to Photographs:</Para>}

      {/* Description */}
      {paras.map((p, i) =>
        FLOOR_HEADINGS.includes(p) ? (
          <SectionBand key={i} tone="khaki" compact={compact}>
            {p}
          </SectionBand>
        ) : (
          <Para key={i}>{p}</Para>
        ),
      )}

      {/* Photographs for the category */}
      {section.photos.length > 0 && <PhotoGrid photos={section.photos} compact={compact} />}

      {/* Cracks / damages — described and imaged (text skipped when reportText already narrates it) */}
      {section.damages.map((d) => (
        <div key={d.id} style={{ margin: "10px 0 0" }}>
          {!hideDamageText && <Para style={{ margin: "0 0 6px" }}>{describeDamage(d)}</Para>}
          <PhotoGrid photos={d.photos} compact={compact} />
        </div>
      ))}

      {section.photos.length === 0 && section.damages.length === 0 && paras.length === 0 && (
        <p style={{ color: reportTokens.inkFaint, fontStyle: "italic" }}>No content recorded for this category.</p>
      )}
    </div>
  );
}
