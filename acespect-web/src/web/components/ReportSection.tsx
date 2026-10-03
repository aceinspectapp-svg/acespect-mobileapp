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

// Matches reportSentences.ts's internal_areas composer -- each room's name
// comes through as its own "ROOMHEAD::Bedroom 4" paragraph so it can render
// as a bold heading (matching the reference report's own per-room style)
// instead of being folded into the sentence itself ("Bedroom 4 is in...").
const ROOM_HEADING_RE = /^ROOMHEAD::(.+)$/;

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

/** One parsed line of `reportText`, tagged by what it renders as -- built up
 *  before rendering so {@link groupForPagination} can see the whole sequence
 *  and decide which runs of items need to stay together across a page break
 *  (see that function for why). */
type ParsedItem =
  | { kind: "heading"; text: string }
  | { kind: "roomhead"; text: string }
  | { kind: "floorband"; text: string }
  | { kind: "cond"; color: string; label: string }
  | { kind: "para"; text: string };

function renderParsedItem(item: ParsedItem, compact: boolean, key: number | string) {
  switch (item.kind) {
    case "heading":
      return (
        <Heading key={key} compact={compact}>
          {item.text}
        </Heading>
      );
    case "roomhead":
      return (
        <Heading key={key} compact={compact} level={3}>
          {item.text}
        </Heading>
      );
    case "floorband":
      return (
        <SectionBand key={key} tone="khaki" compact={compact}>
          {item.text}
        </SectionBand>
      );
    case "cond":
      return <ConditionTag key={key} color={item.color} label={item.label} />;
    case "para":
      return <Para key={key}>{item.text}</Para>;
  }
}

/**
 * Chromium's print pagination (Puppeteer's page.pdf(), see reportPdf.ts)
 * does not reliably honor `break-after: avoid` on a heading/condition-tag by
 * itself -- a page can still end right on "Driveway" + its condition pill,
 * with the actual description starting fresh on the next page. The
 * technique that *is* reliably honored is `break-inside: avoid` on a
 * wrapper spanning the whole unbreakable chunk (already used for the cover
 * signature in ReportCover.tsx), so this groups each heading/room-head and
 * its condition tag together with the first paragraph that follows them --
 * short enough to never itself need to split, but long enough that a page
 * break can no longer land between a heading and the text that explains it.
 * Any further paragraphs/damages after that stay free to break normally,
 * same as before.
 */
function groupForPagination(items: ParsedItem[]): ParsedItem[][] {
  const groups: ParsedItem[][] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    if (item.kind === "heading" || item.kind === "roomhead") {
      const group: ParsedItem[] = [item];
      i++;
      if (i < items.length && items[i].kind === "cond") {
        group.push(items[i]);
        i++;
      }
      if (i < items.length && items[i].kind === "para") {
        group.push(items[i]);
        i++;
      }
      groups.push(group);
    } else if (item.kind === "cond") {
      const group: ParsedItem[] = [item];
      i++;
      if (i < items.length && items[i].kind === "para") {
        group.push(items[i]);
        i++;
      }
      groups.push(group);
    } else {
      groups.push([item]);
      i++;
    }
  }
  return groups;
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
        // Caption + grid kept together (same breakInside:avoid technique as
        // every other heading-like line in this report) -- without it, the
        // caption alone can end up as the last line on a page with its
        // photos starting fresh on the next, which reads like the photos
        // reference has gone missing rather than just turned the page.
        <div style={{ breakInside: "avoid" }}>
          <Para style={{ margin: "0 0 4px", fontSize: "0.92em", color: reportTokens.inkMuted }}>{numbering.label}</Para>
          <PhotoGrid photos={damage.photos} compact={compact} startNumber={numbering.start} layout="grid" />
        </div>
      )}
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

  // The section's own heading joins the same grouping pass as the parsed
  // paragraphs below (see groupForPagination) so it, too, can't be
  // stranded alone at the bottom of a page.
  const items: ParsedItem[] = [
    ...(showHeading ? [{ kind: "heading", text: section.name } as const] : []),
    ...paras.map((p): ParsedItem => {
      const condMatch = p.match(CONDITION_TAG_RE);
      if (condMatch) return { kind: "cond", color: condMatch[1], label: condMatch[2] };
      const roomMatch = p.match(ROOM_HEADING_RE);
      if (roomMatch) return { kind: "roomhead", text: roomMatch[1] };
      if (FLOOR_HEADINGS.includes(p)) return { kind: "floorband", text: p };
      return { kind: "para", text: p };
    }),
  ];
  const groups = groupForPagination(items);

  return (
    <div style={reportTextStyle(compact)}>
      {/* Sits directly under the heading in the reference report, in body
          style (not a distinct grey label) -- matched here once per
          section's general photos (cracks/damages get their own reference
          below, next to their own photos) rather than repeated after every
          paragraph the way the reference's own blank fill-in template does.
          Rendered before the grouped heading/paragraphs below only when
          there's no heading to sit under (showHeading false); otherwise it
          has to come after the heading, so it's placed inline within the
          first group instead -- see the render below. */}
      {!showHeading && section.photos.length > 0 && <Para>{sectionPhotoNumbering.label}</Para>}

      {/* Description */}
      {groups.map((group, gi) => {
        const rendered = group.map((item, ii) => renderParsedItem(item, compact, `${section.id}-${gi}-${ii}`));
        // The section's photo-reference line belongs directly under the
        // heading (matching the reference report), which is now the first
        // item of the first group -- splice it in right after that heading
        // instead of hoisting the whole group out of its breakInside wrapper.
        if (gi === 0 && showHeading && section.photos.length > 0) {
          rendered.splice(1, 0, <Para key={`${section.id}-photo-ref`}>{sectionPhotoNumbering.label}</Para>);
        }
        if (rendered.length === 1) return rendered[0];
        return (
          <div key={`${section.id}-${gi}`} style={{ breakInside: "avoid" }}>
            {rendered}
          </div>
        );
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
