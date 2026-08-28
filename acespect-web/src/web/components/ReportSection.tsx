import type { DamageRecord, FormSection } from "../mockData";
import { Heading, Para, PhotoGrid, reportTextStyle, reportTokens } from "./reportKit";

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
}: {
  section: FormSection;
  showHeading?: boolean;
  compact?: boolean;
}) {
  const paras = section.reportText
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div style={reportTextStyle(compact)}>
      {showHeading && <Heading compact={compact}>{section.name}</Heading>}

      {/* Description */}
      {paras.map((p, i) => (
        <Para key={i}>{p}</Para>
      ))}

      {/* Photographs for the category */}
      {section.photos.length > 0 && (
        <>
          <p style={{ fontWeight: 600, color: reportTokens.inkMuted, margin: "4px 0 2px", fontSize: "0.88em" }}>
            Please refer to Photographs:
          </p>
          <PhotoGrid photos={section.photos} compact={compact} />
        </>
      )}

      {/* Cracks / damages — described and imaged */}
      {section.damages.map((d) => (
        <div key={d.id} style={{ margin: "10px 0 0" }}>
          <Para style={{ margin: "0 0 6px" }}>{describeDamage(d)}</Para>
          <PhotoGrid photos={d.photos} compact={compact} />
        </div>
      ))}

      {section.photos.length === 0 && section.damages.length === 0 && paras.length === 0 && (
        <p style={{ color: reportTokens.inkFaint, fontStyle: "italic" }}>No content recorded for this category.</p>
      )}
    </div>
  );
}
