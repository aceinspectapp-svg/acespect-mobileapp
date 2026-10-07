import type { DamageRecord, FormSection } from "../mockData";
import { Heading, Para, PhotoGrid, reportTextStyle, reportTokens, SectionBand, usePhotoNumbering } from "./reportKit";

// Internal Areas' floor headings (see the report type's wording (src/web/wording/) internal_areas
// composer) are injected as plain uppercase lines within the section's flat
// reportText, not as a separate structured field -- matched here by their
// fixed, known text so they can render as the reference's own tan/khaki
// bar instead of an ordinary paragraph.
const FLOOR_HEADINGS = ["GROUND FLOOR", "FIRST FLOOR", "SECOND FLOOR", "BASEMENT"];

// Matches the report type's wording (src/web/wording/) `conditionTag()` -- a composer-emitted
// "COND::#hex::Label" paragraph standing in for a structured condition tag,
// since reportText is stored as flat text rather than JSON. Applying the
// report's own New/Satisfactory/Fair/Average/Poor grading inline (not just
// as unused SCOPE-appendix boilerplate) is something neither Houspect
// reference report actually does either -- this is a deliberate improvement.
const CONDITION_TAG_RE = /^COND::(#[0-9a-fA-F]{6})::(.+)$/;

// Matches the report type's wording (src/web/wording/) internal_areas composer -- each room's name
// comes through as its own "ROOMHEAD::Bedroom 4" paragraph so it can render
// as a bold heading (matching the reference report's own per-room style)
// instead of being folded into the sentence itself ("Bedroom 4 is in...").
const ROOM_HEADING_RE = /^ROOMHEAD::(.+)$/;

function ConditionTag({ color, label }: { color: string; label: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: "5px",
        padding: "3px 11px",
        borderRadius: reportTokens.radius,
        background: color,
        color: "white",
        letterSpacing: "0.02em",
        margin: "6px 0 4px",
      }}
    >
      {/* Two sizes: the word "Condition:" smaller and lighter, the grade itself larger and bold. */}
      <span style={{ fontSize: "0.74em", fontWeight: 400, opacity: 0.92 }}>Condition:</span>
      <span style={{ fontSize: "0.98em", fontWeight: 700 }}>{label}</span>
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
  | { kind: "defect"; index: number; text: string }
  | { kind: "para"; text: string };

// Matches the report type's wording (src/web/wording/) damageSentences -- one tagged paragraph per recorded defect, where `index` is that defect's position in the section's damage list, so its own photos can be printed right under its sentence.
const DEFECT_RE = /^DEFECT::(\d+)::([\s\S]*)$/;

function renderParsedItem(item: ParsedItem, compact: boolean, key: number | string, damages: DamageRecord[]) {
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
    case "defect":
      return <DefectBlock key={key} text={item.text} damage={damages[item.index]} compact={compact} />;
    case "para":
      return <Para key={key}>{item.text}</Para>;
  }
}

/**
 * One defect: its sentence, then -- directly below it -- that defect's own
 * photos (the "Photographs" field on its entry in the form), in the report's
 * photo grid. Sentence, caption and photos are kept together across a page
 * break. A defect with no photos is just the sentence.
 */
function DefectBlock({ text, damage, compact }: { text: string; damage?: DamageRecord; compact: boolean }) {
  const photos = damage?.photos ?? [];
  const numbering = usePhotoNumbering(photos.length);
  const sentence = <Para style={{ margin: "0 0 6px" }}>{text}</Para>;
  if (photos.length === 0) return <div style={{ margin: "0 0 10px" }}>{sentence}</div>;
  return (
    <div style={{ margin: "0 0 10px" }}>
      <PhotoGrid
        photos={photos}
        compact={compact}
        startNumber={numbering.start}
        caption={
          <>
            {sentence}
            <Para style={{ margin: "0 0 4px", fontSize: "0.92em", color: reportTokens.inkMuted }}>{numbering.label}</Para>
          </>
        }
      />
    </div>
  );
}

/** The section's own general photos (not tied to a defect) -- printed after the defects, with their own photo numbers. */
function GeneralPhotos({ photos, compact }: { photos: string[]; compact: boolean }) {
  const numbering = usePhotoNumbering(photos.length);
  if (photos.length === 0) return null;
  return (
    <div style={{ marginTop: "6px" }}>
      <PhotoGrid
        photos={photos}
        compact={compact}
        startNumber={numbering.start}
        caption={
          <Para style={{ margin: "0 0 4px", fontSize: "0.92em", color: reportTokens.inkMuted }}>
            General photographs — {numbering.label.charAt(0).toLowerCase() + numbering.label.slice(1)}
          </Para>
        }
      />
    </div>
  );
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

/** "All photographs for Driveway (full archive): Click here" -- the reviewer selects only some photos for the report; this reaches the rest. */
function ArchiveLink({ name, url }: { name: string; url: string }) {
  return (
    <Para style={{ margin: "0 0 6px", fontSize: "0.92em" }}>
      Full photo archive for {name}:{" "}
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>
        Click here
      </a>
    </Para>
  );
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
          <PhotoGrid photos={damage.photos} compact={compact} startNumber={numbering.start} />
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
  archiveUrl,
}: {
  section: FormSection;
  /** Link to this section's full photo archive (its own sub-folder in the job's photo folder) -- printed under the section title so the client can reach every photo the inspector uploaded, not just the ones the reviewer selected for the report. */
  archiveUrl?: string | null;
  showHeading?: boolean;
  compact?: boolean;
  /** True for a section whose reportText already narrates each crack/damage inline (see the report type's wording (src/web/wording/)) -- skip the sentence here so it isn't said twice, but still show that damage's photos. */
  hideDamageText?: boolean;
}) {
  const paras = section.reportText
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

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
      const defectMatch = p.match(DEFECT_RE);
      if (defectMatch) return { kind: "defect", index: Number(defectMatch[1]), text: defectMatch[2].trim() };
      if (FLOOR_HEADINGS.includes(p)) return { kind: "floorband", text: p };
      return { kind: "para", text: p };
    }),
  ];
  const groups = groupForPagination(items);
  // Defects whose sentence carries no tag (a report saved before defects were paired with their photos) keep the older layout: their photos follow the text.
  const taggedDefects = new Set(items.flatMap((it) => (it.kind === "defect" ? [it.index] : [])));

  return (
    <div style={reportTextStyle(compact)}>
      {/* Description -- with each defect's sentence followed by its own photos */}
      {groups.map((group, gi) => {
        const rendered = group.map((item, ii) => renderParsedItem(item, compact, `${section.id}-${gi}-${ii}`, section.damages));
        // The photo-archive link belongs directly under the heading, which is
        // the first item of the first group -- splice it in right after it
        // instead of hoisting the whole group out of its breakInside wrapper.
        if (gi === 0 && showHeading && archiveUrl) {
          rendered.splice(1, 0, <ArchiveLink key={`${section.id}-archive`} name={section.name} url={archiveUrl} />);
        }
        if (rendered.length === 1) return rendered[0];
        return (
          <div key={`${section.id}-${gi}`} style={{ breakInside: "avoid" }}>
            {rendered}
          </div>
        );
      })}

      {/* Defects without a tagged sentence (older saved text): photos after the text, as before */}
      {section.damages.map((d, i) =>
        taggedDefects.has(i) ? null : <DamageBlock key={d.id} damage={d} compact={compact} hideDamageText={hideDamageText} />,
      )}

      {/* The section's general photographs come last, after every defect */}
      <GeneralPhotos photos={section.photos} compact={compact} />

      {section.photos.length === 0 && section.damages.length === 0 && paras.length === 0 && (
        <p style={{ color: reportTokens.inkFaint, fontStyle: "italic" }}>No content recorded for this category.</p>
      )}
    </div>
  );
}
