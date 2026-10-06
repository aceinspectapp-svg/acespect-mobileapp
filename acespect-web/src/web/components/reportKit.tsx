import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { resolveMediaUrl } from "../api";
import { COMPACT_PACK, PAGE_PACK, packPhotoRows } from "../photoLayout";
import { useImageAspects } from "../useImageAspects";

/**
 * Shared visual language for the generated inspection report — one modern,
 * consistent design system (typography/color/spacing) used by every Report*
 * component, replacing the old per-component ad hoc "Word document" styling
 * (mixed Calibri/Times New Roman, solid-color banners, colon tables, pink
 * fill-in underlines). Content/data driving each report is unchanged — this
 * file only changes how it's presented.
 */

export const reportTokens = {
  font: "Arial, Helvetica, sans-serif",
  ink: "#1e2530", // primary text
  inkMuted: "#5b6472", // secondary text
  inkFaint: "#94a0b0", // tertiary / placeholder text
  accent: "#1a2a4a", // brand navy, matches the existing toolbar/print button
  accentSoft: "#eef2f8", // tinted backgrounds for accent bands
  border: "#e2e6ec",
  placeholderBg: "#fbf3e3",
  placeholderBorder: "#eddcb5",
  placeholderInk: "#8a6d2f",
  radius: "6px", // every coloured box (title bands, condition tags and pills, placeholders) rounds its corners by this much
};

/** The one title look shared by every band and page title: same family, weight, case and letter-spacing. Only the size (band vs page title) and the band's own colours differ. */
const titleFont = {
  fontFamily: reportTokens.font,
  fontWeight: 700,
  letterSpacing: "0.05em",
  textTransform: "uppercase" as const,
};

/**
 * Section banner. `accent` (light blue) is used for DESCRIPTION AND
 * OVERVIEW / SCOPE OF INSPECTION AND COMMENTS, matching the reference.
 * `peach` is the reference's own flat orange band with black text, used for
 * the top-level EXTERNAL / INTERNAL dividers -- a different band style from
 * the light-blue ones, not just a color swap, so it's its own tone rather
 * than a variant.
 */
export function SectionBand({
  children,
  tone = "accent",
  compact = false,
}: {
  children: ReactNode;
  tone?: "accent" | "neutral" | "peach" | "khaki";
  compact?: boolean;
}) {
  if (tone === "peach" || tone === "khaki") {
    return (
      <div
        style={{
          background: tone === "peach" ? "#f6c89f" : "#c7bd93",
          borderRadius: reportTokens.radius,
          padding: compact ? "6px 10px" : "9px 14px",
          margin: compact ? "12px 0 8px" : "16px 0 10px",
          color: "#000",
          ...titleFont,
          fontSize: compact ? "0.78em" : "0.92em",
          // Best-effort hint against ending a printed page right on this
          // band -- Chromium's print pagination (the PDF pipeline's actual
          // renderer, see reportPdf.ts) doesn't reliably honor it on its
          // own, which is why ReportSection.tsx also wraps each heading
          // with the content right after it in a breakInside:avoid group.
          breakAfter: "avoid",
        }}
      >
        {children}
      </div>
    );
  }
  const bg = tone === "accent" ? reportTokens.accentSoft : "#f4f5f7";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: bg,
        borderRadius: reportTokens.radius,
        padding: compact ? "6px 10px" : "9px 14px",
        margin: compact ? "16px 0 9px" : "26px 0 14px",
        color: reportTokens.accent,
        ...titleFont,
        fontSize: compact ? "0.78em" : "0.92em",
        breakAfter: "avoid",
      }}
    >
      {children}
    </div>
  );
}

/**
 * A page title (Condition Summary, Scope, Conditions for the Provision of the
 * Report) -- the same size, weight and font on every page, left-aligned.
 */
export function PageTitle({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return (
    <h2
      style={{
        fontFamily: reportTokens.font,
        fontWeight: 700,
        fontSize: compact ? "15px" : "20px",
        color: reportTokens.ink,
        textAlign: "left",
        margin: "8px 0 8px",
      }}
    >
      {children}
    </h2>
  );
}

/**
 * Plain heading (no banner fill) — used for per-category names and
 * subheadings. Body-size bold with tight spacing and no rule, matching the
 * reference report's sub-headings ("Driveway", "Fences", ...) -- these are
 * not oversized/underlined the way a level-2 web heading usually is.
 */
export function Heading({
  children,
  level = 2,
  compact = false,
}: {
  children: ReactNode;
  level?: 2 | 3;
  compact?: boolean;
}) {
  return (
    <p
      style={{
        fontFamily: reportTokens.font,
        fontWeight: 700,
        fontSize: "1em",
        color: reportTokens.ink,
        margin: level === 2 ? "0 0 4px" : "10px 0 4px",
        // Best-effort hint only -- see the matching note on SectionBand above.
        breakAfter: "avoid",
      }}
    >
      {children}
    </p>
  );
}

/** Body paragraph. Left-aligned (ragged right) by default, matching the
 *  reference report -- only the Conditions appendix (which renders its own
 *  `<p>` tags directly, not this component) stays justified. */
export function Para({
  children,
  justify = false,
  style,
}: {
  children: ReactNode;
  justify?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <p
      style={{
        margin: "0 0 8px",
        textAlign: justify ? "justify" : "left",
        lineHeight: 1.45,
        color: reportTokens.ink,
        ...style,
      }}
    >
      {children}
    </p>
  );
}

/** Small italic explanatory note. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontStyle: "italic",
        fontSize: "0.86em",
        color: reportTokens.inkMuted,
        margin: "0 0 11px",
        lineHeight: 1.55,
      }}
    >
      {children}
    </p>
  );
}

/** Placeholder / template instruction — content the inspector still needs to fill in. Replaces the old harsh yellow-highlight box. */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        alignItems: "flex-start",
        background: reportTokens.placeholderBg,
        border: `1px dashed ${reportTokens.placeholderBorder}`,
        borderRadius: "6px",
        padding: "8px 11px",
        margin: "0 0 11px",
        lineHeight: 1.55,
        color: reportTokens.placeholderInk,
        fontSize: "0.92em",
      }}
    >
      {children}
    </div>
  );
}

/** Inline fill-in token (the old pink underline blanks). */
export function Blank() {
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: "38px",
        borderBottom: `1.5px dotted ${reportTokens.inkFaint}`,
        margin: "0 3px",
        verticalAlign: "baseline",
      }}
    >
      &nbsp;
    </span>
  );
}

/** Small "admin note" chip, e.g. next to a heading. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        background: reportTokens.accentSoft,
        color: reportTokens.accent,
        fontWeight: 600,
        fontSize: "0.78em",
        padding: "2px 8px",
        marginLeft: "8px",
        borderRadius: "999px",
      }}
    >
      {children}
    </span>
  );
}

/** A label/value meta row — replaces the old colon-separated table layout. */
export function MetaRow({
  label,
  labelWidth,
  compact = false,
  children,
}: {
  label: string;
  labelWidth: number;
  compact?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: "14px",
        padding: compact ? "4px 0" : "5px 0",
      }}
    >
      <span
        style={{
          width: `${labelWidth}px`,
          flexShrink: 0,
          fontWeight: 700,
          fontSize: "1em",
          color: reportTokens.ink,
          paddingTop: "1px",
        }}
      >
        {label}
        {/* Title-Case label + trailing colon, matching the reference report's cover field style. */}
        :
      </span>
      <div style={{ flex: 1, color: reportTokens.ink }}>{children}</div>
    </div>
  );
}

/**
 * The report's photo grid -- one reusable component for every group of photos
 * that sits under a title (a category's own photos, each crack/damage's
 * photos). It looks at each photo's real shape and packs them into tidy rows
 * (see photoLayout.ts): three portraits side by side in one row, two
 * portraits and a landscape in one row, two landscapes per row, a lone photo
 * at a sensible size. All photos in a row share one height and the row fills
 * the page width, so the edges line up; each photo is drawn at exactly its
 * own shape, so nothing is ever cropped or stretched -- these are evidence of
 * a specific defect, not decoration. Rows never split across a page break.
 * Each photo is a real hyperlink to its own full-size URL (matching the
 * reference report's convention), so it survives as a clickable link in the
 * exported PDF. Plain thin border only, as in the reference.
 *
 * The shapes are read from the images themselves, so the layout settles a
 * moment after load; while it hasn't, the grid carries `data-photo-grid-pending`
 * and the PDF generator waits for that to clear before printing.
 */
export function PhotoGrid({
  photos,
  compact,
  startNumber,
  caption,
}: {
  photos: string[];
  compact: boolean;
  /** Text that introduces the photos (a defect's sentence, a "Please refer to Photographs…" line). Printed above the first row and kept on the same page as it, so a caption is never left alone at the bottom of a page. */
  caption?: ReactNode;
  /** First number in this batch's sequential "Photo N" captions (see PhotoNumberContext) -- omitted outside the real printed report (e.g. the reviewer's isolated section preview), where a running count across the whole document doesn't make sense. */
  startNumber?: number;
}) {
  const urls = photos.map((p) => resolveMediaUrl(p));
  const { aspects, pending } = useImageAspects(urls);
  const options = compact ? COMPACT_PACK : PAGE_PACK;
  const rows = useMemo(() => packPhotoRows(aspects, options), [aspects.join(","), compact]);
  if (photos.length === 0) return null;
  return (
    <div
      data-photo-grid-pending={pending ? "" : undefined}
      style={{ display: "flex", flexDirection: "column", gap: `${options.gap}cm`, margin: "6px 0 12px" }}
    >
      {rows.map((row, ri) => (
        <div key={ri} style={{ breakInside: "avoid" }}>
          {ri === 0 && caption}
          <div style={{ display: "flex", gap: `${options.gap}cm`, alignItems: "flex-start" }}>
          {row.indices.map((i) => (
            <div
              key={i}
              style={
                // Full row: widths share the row in proportion to each photo's shape, which makes every height equal.
                // Short last row: each photo at the row's height, left-aligned.
                row.full ? { flex: `${aspects[i]} 1 0`, minWidth: 0 } : { flex: "0 0 auto", width: `${aspects[i] * row.height}cm` }
              }
            >
              <a href={urls[i]} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
                <img
                  src={urls[i]}
                  alt=""
                  style={{
                    width: "100%",
                    aspectRatio: `${aspects[i]}`,
                    objectFit: "cover",
                    border: `1px solid ${reportTokens.border}`,
                    display: "block",
                  }}
                />
              </a>
              {startNumber !== undefined && (
                <span style={{ display: "block", marginTop: "2px", fontSize: "0.82em", color: reportTokens.inkMuted }}>
                  Photo {startNumber + i}
                </span>
              )}
            </div>
          ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Assigns sequential "Photo N" numbers to every photo in the printed report,
 * in document order, so a section's prose can say "Please refer to
 * Photographs 9 to 12" instead of a generic "Please refer to Photographs:" --
 * matching the reference report's own per-item photo cross-referencing.
 * `next(count)` claims a contiguous block and returns its first number; it
 * must be called in render order (top to bottom) for the numbers to line up
 * with where each photo actually appears, which holds for this report's
 * single synchronous top-down render (both the live page and the Puppeteer
 * PDF render the same component tree once, not interactively).
 */
export const PhotoNumberContext = createContext<{ next: (count: number) => number } | null>(null);

export function PhotoNumberProvider({ children }: { children: ReactNode }) {
  const counter = useRef(1);
  const next = (count: number) => {
    const start = counter.current;
    counter.current += count;
    return start;
  };
  return <PhotoNumberContext.Provider value={{ next }}>{children}</PhotoNumberContext.Provider>;
}

/** "Please refer to Photographs 9 to 12:" / "Please refer to Photograph 9:" / falls back to the old generic line when no PhotoNumberProvider is in scope (e.g. the reviewer's isolated single-section preview, which doesn't represent the whole document's running order). */
export function usePhotoNumbering(count: number): { start?: number; label: string } {
  const ctx = useContext(PhotoNumberContext);
  if (!ctx || count === 0) return { label: "Please refer to Photographs:" };
  const start = ctx.next(count);
  const end = start + count - 1;
  const label = count === 1 ? `Please refer to Photograph ${start}:` : `Please refer to Photographs ${start} to ${end}:`;
  return { start, label };
}

/** A simple bordered data table (e.g. the Crack Categorisation Table) — nothing else in this report needs a real `<table>` yet. */
export function Table({
  columns,
  rows,
  compact = false,
}: {
  columns: string[];
  rows: (string | ReactNode)[][];
  compact?: boolean;
}) {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        margin: "8px 0 14px",
        fontSize: compact ? "0.85em" : "0.95em",
      }}
    >
      <thead>
        <tr>
          {columns.map((c, i) => (
            <th
              key={i}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderBottom: `2px solid ${reportTokens.accent}`,
                color: reportTokens.accent,
                fontWeight: 700,
              }}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td
                key={j}
                style={{
                  padding: "8px 10px",
                  borderBottom: `1px solid ${reportTokens.border}`,
                  color: reportTokens.ink,
                  verticalAlign: "top",
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Shared base text styles applied at the root of every report component. */
export function reportTextStyle(compact: boolean, size?: { normal: string; compact: string }): React.CSSProperties {
  const s = size ?? { normal: "12.5px", compact: "11px" };
  return {
    fontFamily: reportTokens.font,
    color: reportTokens.ink,
    fontSize: compact ? s.compact : s.normal,
    lineHeight: 1.4,
  };
}
