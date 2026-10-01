import { createContext, useContext, useRef, type ReactNode } from "react";
import { resolveMediaUrl } from "../api";

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
          padding: compact ? "5px 10px" : "6px 14px",
          margin: compact ? "12px 0 8px" : "16px 0 10px",
          color: "#000",
          fontWeight: 700,
          fontSize: compact ? "0.82em" : "0.95em",
          letterSpacing: "0.02em",
          textTransform: "uppercase",
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
        borderRadius: "4px",
        padding: compact ? "6px 10px" : "9px 14px",
        margin: compact ? "16px 0 9px" : "26px 0 14px",
        color: reportTokens.accent,
        fontWeight: 700,
        fontSize: compact ? "0.78em" : "0.92em",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
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
        fontWeight: 700,
        fontSize: "1em",
        color: reportTokens.ink,
        margin: level === 2 ? "0 0 4px" : "10px 0 4px",
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
 * Photo list — one photo per row (stacked), matching the reference report's
 * own layout (it never runs two across, unlike this grid used to for
 * Fences specifically once its content happened to be narrow enough).
 * Sized to the reference's own admin note: 5.9cm wide for a landscape
 * photo, 5.2cm for portrait -- there's no orientation metadata to pick
 * between the two per photo, so this uses the landscape width (the more
 * common case) and lets `aspect-ratio` size the height. Each photo is a
 * real hyperlink to its own full-size URL (matching the reference report's
 * convention of linking inserted photos), so it opens full-size in a new
 * tab on screen and survives as an actual clickable link annotation in the
 * exported PDF (Puppeteer/Chromium turns an `<a>` around an image into a
 * real PDF link, not just a picture). Plain thin border only -- no rounded
 * corners or shadow, which the reference doesn't use either.
 */
export function PhotoGrid({
  photos,
  compact,
  startNumber,
  layout = "grid",
}: {
  photos: string[];
  compact: boolean;
  /** First number in this batch's sequential "Photo N" captions (see PhotoNumberContext) -- omitted outside the real printed report (e.g. the reviewer's isolated section preview), where a running count across the whole document doesn't make sense. */
  startNumber?: number;
  /**
   * "grid" (default, used everywhere in the report): a 2-column layout --
   * every photo group (a category's general photos, and each crack/damage's
   * own photos) renders this way, each photo noticeably larger than the old
   * always-one-per-row layout since it fills half the page width instead of
   * a fixed 5.9cm. "stack" (one large photo per row, full page width) is
   * kept as an option for a case that genuinely needs a single oversized
   * photo, but nothing currently uses it.
   */
  layout?: "stack" | "grid";
}) {
  if (photos.length === 0) return null;
  const widthCm = compact ? 4.6 : 7;
  return (
    <div
      style={
        layout === "grid"
          ? { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", margin: "6px 0 12px" }
          : { display: "flex", flexDirection: "column", gap: "8px", margin: "6px 0 12px" }
      }
    >
      {photos.map((url, i) => (
        <div key={i} style={layout === "grid" ? undefined : { width: `${widthCm}cm` }}>
          <a href={resolveMediaUrl(url)} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
            <img
              src={resolveMediaUrl(url)}
              alt=""
              style={{
                width: "100%",
                aspectRatio: "4 / 3",
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
