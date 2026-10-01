import type { DamageRecord, FormSection } from "../mockData";
import { Heading, Para, PhotoGrid, reportTextStyle, reportTokens, SectionBand, usePhotoNumbering } from "./reportKit";

// Internal Areas' floor headings (see reportSentences.ts's internal_areas
// composer) are injected as plain uppercase lines within the section's flat
// reportText, not as a separate structured field -- matched here by their
// fixed, known text so they can render as the reference's own tan/khaki
// bar instead of an ordinary paragraph.
const FLOOR_HEADINGS = ["GROUND FLOOR", "FIRST FLOOR", "SECOND FLOOR", "BASEMENT"];

// Matches reportSentences.ts's `conditionTag()` -- a composer-emitted
// "COND::#hex::Label" paragraph standing in for a structured condition tag,
// since reportText is stored as flat text rather than JSON. Applying the
// report's own New/Satisfactory/Fair/Average/Poor grading inline (not just
// as unused SCOPE-appendix boilerplate) is something neither Houspect
// reference report actually does either -- this is a deliberate improvement.
const CONDITION_TAG_RE = /^COND::(#[0-9a-fA-F]{6})::(.+)$/;

function ConditionTag({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: "4px",
        background: color,
        color: "white",
        fontWeight: 700,
        fontSize: "0.82em",
        letterSpacing: "0.02em",
        margin: "6px 0 4px",
      }}
    >
      Condition: {label}
    </div>
  );
}

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

/** One crack/damage record: its sentence (optional), its own "Please refer to
 *  Photograph(s) N(-M):" line, and its photos -- a separate component (not
 *  inlined in a .map) because `usePhotoNumbering` is a hook, and each damage
 *  needs its own stable call so React can track them across renders. */
function DamageBlock({
  damage,
  compact,
  hideDamageText,
}: {
  damage: DamageRecord;
  compact: boolean;
  hideDamageText: boolean;
}) {
  const numbering = usePhotoNumbering(damage.photos.length);
  return (
    <div style={{ margin: "10px 0 0" }}>
      {!hideDamageText && <Para style={{ margin: "0 0 6px" }}>{describeDamage(damage)}</Para>}
      {damage.photos.length > 0 && (
        <Para style={{ margin: "0 0 4px", fontSize: "0.92em", color: reportTokens.inkMuted }}>{numbering.label}</Para>
      )}
      <PhotoGrid photos={damage.photos} compact={compact} startNumber={numbering.start} layout="grid" />
    </div>
  );
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

  // Sequential "Photo N" numbering (see PhotoNumberContext) -- claimed here,
  // in render order, so the label text ("Please refer to Photographs 9 to
  // 12:") and the photos it refers to always get the same numbers, matching
  // the reference report's per-item photo cross-referencing instead of one
  // generic "Please refer to Photographs:" line per whole category.
  const sectionPhotoNumbering = usePhotoNumbering(section.photos.length);

  return (
    <div style={reportTextStyle(compact)}>
      {showHeading && <Heading compact={compact}>{section.name}</Heading>}

      {/* Sits directly under the heading in the reference report, in body
          style (not a distinct grey label) -- matched here once per
          section's general photos (cracks/damages get their own reference
          below, next to their own photos) rather than repeated after every
          paragraph the way the reference's own blank fill-in template does. */}
      {section.photos.length > 0 && <Para>{sectionPhotoNumbering.label}</Para>}

      {/* Description */}
      {paras.map((p, i) => {
        const condMatch = p.match(CONDITION_TAG_RE);
        if (condMatch) return <ConditionTag key={i} color={condMatch[1]} label={condMatch[2]} />;
        if (FLOOR_HEADINGS.includes(p)) {
          return (
            <SectionBand key={i} tone="khaki" compact={compact}>
              {p}
            </SectionBand>
          );
        }
        return <Para key={i}>{p}</Para>;
      })}

      {/* Photographs for the category -- a 2-column grid, since these are
          routine documentation photos (not a single defect needing a large,
          closely-readable image like each damage's own photo below). */}
      {section.photos.length > 0 && (
        <PhotoGrid photos={section.photos} compact={compact} startNumber={sectionPhotoNumbering.start} layout="grid" />
      )}

      {/* Cracks / damages — described and imaged (text skipped when reportText already narrates it) */}
      {section.damages.map((d) => (
        <DamageBlock key={d.id} damage={d} compact={compact} hideDamageText={hideDamageText} />
      ))}

      {section.photos.length === 0 && section.damages.length === 0 && paras.length === 0 && (
        <p style={{ color: reportTokens.inkFaint, fontStyle: "italic" }}>No content recorded for this category.</p>
      )}
    </div>
  );
}
