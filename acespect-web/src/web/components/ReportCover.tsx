import type { CSSProperties, ReactNode } from "react";
import type { ReportHeader } from "../report";

// The cover is laid out the same way as the Construction Report's (construction/ConstructionReport.tsx, the Houspect Lock-up design
// sample): the report date, Client / References, a navy banner with the report title, then ruled rows of details and the sign-off.
// Its colours are the Construction report's own.
const C = { navy: "#1b3a6b", red: "#d1262b", ink: "#1f2937", grey: "#6b7280", rule: "#e5e7eb", font: "Arial, Helvetica, sans-serif" };

// Acespect Pty Ltd trades AS Houspect Victoria -- this report carries that
// real trading identity, not the internal ACESPECT app's own logo. The image
// is served from acespect-web/public/houspect-logo.png (see also the
// separately-embedded copy the PDF pipeline's own page header/footer use, in
// acespect-backend/src/lib/assets/houspect-logo.png -- Puppeteer's
// header/footer templates can't reach this page's own asset URL).
function HouspectVictoriaLogo() {
  return <img src="/houspect-logo.png" alt="Houspect Building Inspections" style={{ height: "56px", width: "auto", display: "block" }} />;
}

/**
 * The Dilapidation Report front matter (cover), generated from Job Information.
 * `compact` shrinks it for the reviewer's narrow Report Text panel; the default
 * full size is used on the official report page.
 */
export function ReportCover({ header: r, compact = false }: { header: ReportHeader; compact?: boolean }) {
  const base = compact ? 12 : 14;
  const label: CSSProperties = { fontSize: compact ? "9px" : "10px", fontWeight: 700, letterSpacing: "0.14em", color: C.grey, textTransform: "uppercase" };

  const rows: [string, ReactNode][] = [
    ["Property", r.property],
    [
      "Property Owner",
      <>
        <div>{r.propertyOwner ?? "—"}</div>
        {r.propertyOwnerEmail && <div style={{ fontSize: "0.86em", color: C.grey }}>Via email: {r.propertyOwnerEmail}</div>}
      </>,
    ],
    ["Inspection Date", r.inspectionDate],
    ["Weather Conditions", r.weather],
    ["Inspector", `${r.inspector}${r.inspectorRegistration ? ` (Builder Registration No ${r.inspectorRegistration})` : ""}`],
    ["Purpose", r.purpose],
  ];

  return (
    <div style={{ fontFamily: C.font, color: C.ink, fontSize: `${base}px`, lineHeight: 1.45 }}>
      {!compact && (
        // Hidden when printed/exported to PDF: the PDF pipeline's own
        // per-page header (see acespect-backend/src/lib/reportPdf.ts)
        // already puts this same logo on every page, cover included --
        // showing both here would double it up on page 1. Still shown in
        // the live browser view, which has no per-page header of its own.
        <div className="screen-only" style={{ display: "flex", justifyContent: "flex-end", marginBottom: "18px" }}>
          <HouspectVictoriaLogo />
        </div>
      )}

      <div style={{ fontWeight: 700, fontSize: `${base + 1}px`, margin: "0 0 14px" }}>{r.reportDate}</div>

      {/* Client, and the two references */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div>
          <div style={label}>Client</div>
          <div style={{ marginTop: "3px" }}>{r.clientName}</div>
          {r.clientAttn && <div style={{ fontSize: "0.86em", color: C.grey }}>Attn: {r.clientAttn}</div>}
          {r.clientEmail && <div style={{ fontSize: "0.86em", color: C.grey }}>Via email: {r.clientEmail}</div>}
        </div>
        <div>
          <div style={label}>Our Reference</div>
          <div style={{ marginTop: "3px" }}>{r.ourReference}</div>
          {r.yourReference && (
            <div style={{ marginTop: "8px" }}>
              <div style={label}>Your Reference</div>
              <div style={{ marginTop: "3px" }}>{r.yourReference}</div>
            </div>
          )}
        </div>
      </div>

      {/* Title banner: "DILAPIDATION REPORT" over the kind of report ("Residential House") */}
      <div style={{ background: C.navy, borderRight: `${compact ? 6 : 9}px solid ${C.red}`, color: "white", padding: compact ? "14px 18px 16px" : "22px 26px 24px", margin: compact ? "22px 0 20px" : "34px 0 30px" }}>
        <div style={{ fontSize: compact ? "10px" : "12.5px", fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", opacity: 0.92 }}>{r.reportTitle}</div>
        <div style={{ fontSize: compact ? "24px" : "36px", fontWeight: 700, marginTop: "6px", lineHeight: 1.1 }}>{r.reportType || r.reportTitle}</div>
      </div>

      {/* The details, one ruled row each */}
      <div>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: `${compact ? 120 : 166}px 1fr`, gap: "14px", padding: "9px 0", borderBottom: `1px solid ${C.rule}`, breakInside: "avoid" }}>
            <div style={{ ...label, paddingTop: "3px" }}>{k}</div>
            <div>{v}</div>
          </div>
        ))}
      </div>

      {/* No front-of-property photo here -- it belongs in the Description & Overview section (see ReportDescription's own photo slot). */}

      {(r.signatureName || r.signatureTitle) && (
        // One unbreakable block, so the name is never left on one page and the title on the next.
        <div style={{ marginTop: "28px", breakInside: "avoid" }}>
          {r.signatureName && <div style={{ color: C.navy, fontSize: compact ? "14px" : "17px" }}>{r.signatureName}</div>}
          {r.signatureTitle && <div style={{ color: C.navy, fontSize: compact ? "11px" : "13px", fontWeight: 700 }}>{r.signatureTitle}</div>}
        </div>
      )}
    </div>
  );
}
