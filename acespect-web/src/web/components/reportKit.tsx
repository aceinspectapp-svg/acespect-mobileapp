import type { ReactNode } from "react";

/**
 * Shared visual language for the generated inspection report — one modern,
 * consistent design system (typography/color/spacing) used by every Report*
 * component, replacing the old per-component ad hoc "Word document" styling
 * (mixed Calibri/Times New Roman, solid-color banners, colon tables, pink
 * fill-in underlines). Content/data driving each report is unchanged — this
 * file only changes how it's presented.
 */

export const reportTokens = {
  font: "'Inter', 'Segoe UI', system-ui, sans-serif",
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

/** Section banner — full-width label with a colored left accent bar, replacing the old solid-fill banners. */
export function SectionBand({
  children,
  tone = "accent",
  compact = false,
}: {
  children: ReactNode;
  tone?: "accent" | "neutral";
  compact?: boolean;
}) {
  const bg = tone === "accent" ? reportTokens.accentSoft : "#f4f5f7";
  const bar = tone === "accent" ? reportTokens.accent : "#9aa3b0";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        background: bg,
        borderLeft: `4px solid ${bar}`,
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

/** Plain heading (no banner fill) — used for per-category names and subheadings. */
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
        fontSize: level === 2 ? (compact ? "1.02em" : "1.08em") : "1em",
        color: reportTokens.ink,
        margin: level === 2 ? "0 0 10px" : "14px 0 6px",
        paddingBottom: level === 2 ? "6px" : 0,
        borderBottom: level === 2 ? `1.5px solid ${reportTokens.border}` : "none",
      }}
    >
      {children}
    </p>
  );
}

/** Body paragraph. */
export function Para({
  children,
  justify = true,
  style,
}: {
  children: ReactNode;
  justify?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <p
      style={{
        margin: "0 0 11px",
        textAlign: justify ? "justify" : "left",
        lineHeight: 1.65,
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
        padding: compact ? "5px 0" : "7px 0",
        borderBottom: `1px solid ${reportTokens.border}`,
      }}
    >
      <span
        style={{
          width: `${labelWidth}px`,
          flexShrink: 0,
          fontWeight: 600,
          fontSize: "0.82em",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          color: reportTokens.inkMuted,
          paddingTop: "1px",
        }}
      >
        {label}
      </span>
      <div style={{ flex: 1, color: reportTokens.ink }}>{children}</div>
    </div>
  );
}

/** Modern photo grid — rounded thumbnails with a subtle shadow. */
export function PhotoGrid({ photos, compact }: { photos: string[]; compact: boolean }) {
  if (photos.length === 0) return null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${compact ? 88 : 152}px, 1fr))`,
        gap: "10px",
        margin: "8px 0 14px",
      }}
    >
      {photos.map((url, i) => (
        <img
          key={i}
          src={url}
          alt=""
          style={{
            width: "100%",
            aspectRatio: "4 / 3",
            objectFit: "cover",
            borderRadius: "8px",
            border: `1px solid ${reportTokens.border}`,
            boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
          }}
        />
      ))}
    </div>
  );
}

/** Shared base text styles applied at the root of every report component. */
export function reportTextStyle(compact: boolean, size?: { normal: string; compact: string }): React.CSSProperties {
  const s = size ?? { normal: "15px", compact: "12.5px" };
  return {
    fontFamily: reportTokens.font,
    color: reportTokens.ink,
    fontSize: compact ? s.compact : s.normal,
    lineHeight: 1.55,
  };
}
