import type { CSSProperties, ReactNode } from "react";

/**
 * The cover page of every Houspect report -- Construction and Dilapidation alike: the report date, the Client and the references, a navy
 * banner with the kind of report and its title, ruled rows of details, and the sign-off. One component draws it, so the two covers
 * cannot drift apart; each report only says what goes in it (construction/ConstructionReport.tsx, components/ReportCover.tsx).
 * Its colours are the colours of the whole report.
 */
export const COVER_COLORS = { navy: "#1b3a6b", red: "#d1262b", ink: "#1f2937", grey: "#6b7280", rule: "#e5e7eb", font: "Arial, Helvetica, sans-serif" };
const C = COVER_COLORS;

export interface CoverPageProps {
  reportDate: string;
  clientName: string;
  /** Smaller grey lines under the client's name: "Attn: ...", "Via email: ...". */
  clientNotes?: string[];
  /** "Our Reference", "Your Reference": a label and its value each, in the right-hand column. */
  references: [string, string][];
  /** The small spaced line over the title ("CONSTRUCTION REPORT", "DILAPIDATION REPORT"). */
  kicker: string;
  /** The big title in the banner ("Lock-up Stage", "Residential House"). */
  title: string;
  /** The ruled rows of details. */
  rows: [string, ReactNode][];
  signatureName?: string;
  signatureTitle?: string;
  /** The smaller layout of the reviewer's narrow Report Text panel; the page itself is full size. */
  compact?: boolean;
  /** The logo, shown in the live browser view only (the PDF's own page header already carries it on every page). */
  logo?: ReactNode;
}

export function CoverPage(p: CoverPageProps) {
  const compact = !!p.compact;
  const base = compact ? 12 : 14;
  const label: CSSProperties = { fontSize: compact ? "9px" : "10px", fontWeight: 700, letterSpacing: "0.14em", color: C.grey, textTransform: "uppercase" };
  const [firstRef, ...moreRefs] = p.references;

  return (
    <div style={{ fontFamily: C.font, color: C.ink, fontSize: `${base}px`, lineHeight: 1.45 }}>
      {p.logo && !compact && (
        <div className="screen-only" style={{ display: "flex", justifyContent: "flex-end", marginBottom: "18px" }}>
          {p.logo}
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: `${base + 1}px`, margin: "0 0 14px" }}>{p.reportDate}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div>
          <div style={label}>Client</div>
          <div style={{ fontSize: `${base}px`, marginTop: "3px" }}>{p.clientName}</div>
          {(p.clientNotes ?? []).map((n) => (
            <div key={n} style={{ fontSize: `${base - 2}px`, color: C.grey }}>{n}</div>
          ))}
        </div>
        <div>
          {firstRef && (
            <>
              <div style={label}>{firstRef[0]}</div>
              <div style={{ fontSize: `${base}px`, marginTop: "3px" }}>{firstRef[1]}</div>
            </>
          )}
          {moreRefs.map(([k, v]) => (
            <div key={k} style={{ marginTop: "8px" }}>
              <div style={label}>{k}</div>
              <div style={{ fontSize: `${base}px`, marginTop: "3px" }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ background: C.navy, borderRight: `${compact ? 6 : 9}px solid ${C.red}`, color: "white", padding: compact ? "14px 18px 16px" : "22px 26px 24px", margin: compact ? "22px 0 20px" : "34px 0 30px" }}>
        <div style={{ fontSize: compact ? "10px" : "12.5px", fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", opacity: 0.92 }}>{p.kicker}</div>
        <div style={{ fontSize: compact ? "24px" : "36px", fontWeight: 700, marginTop: "6px", lineHeight: 1.1 }}>{p.title}</div>
      </div>
      <div>
        {p.rows.map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: `${compact ? 120 : 166}px 1fr`, gap: "14px", padding: "9px 0", borderBottom: `1px solid ${C.rule}`, breakInside: "avoid" }}>
            <div style={{ ...label, paddingTop: "3px" }}>{k}</div>
            <div style={{ fontSize: `${base}px` }}>{v}</div>
          </div>
        ))}
      </div>
      {(p.signatureName || p.signatureTitle) && (
        // One unbreakable block, so the name is never left on one page and the title on the next.
        <div style={{ marginTop: "28px", breakInside: "avoid" }}>
          {p.signatureName && <div style={{ color: C.navy, fontSize: compact ? "14px" : "17px" }}>{p.signatureName}</div>}
          {p.signatureTitle && <div style={{ color: C.navy, fontSize: compact ? "11px" : "13px", fontWeight: 700 }}>{p.signatureTitle}</div>}
        </div>
      )}
    </div>
  );
}
