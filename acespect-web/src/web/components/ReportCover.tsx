import type { ReportHeader } from "../report";
import { MetaRow, Para, reportTokens } from "./reportKit";

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
  // Wide enough that "Weather Conditions" (the longest label) never wraps.
  const labelW = compact ? 120 : 170;
  const fontSize = compact ? 12.5 : 15;
  const titleSize = compact ? 22 : 38;

  return (
    <div style={{ fontFamily: reportTokens.font, color: reportTokens.ink, fontSize: `${fontSize}px`, lineHeight: 1.5 }}>
      {!compact && (
        // Hidden when printed/exported to PDF: the PDF pipeline's own
        // per-page header (see acespect-backend/src/lib/reportPdf.ts)
        // already puts this same logo on every page, cover included --
        // showing both here would double it up on page 1. Still shown in
        // the live browser view, which has no per-page header of its own.
        <div className="screen-only" style={{ display: "flex", justifyContent: "flex-end", marginBottom: "24px" }}>
          <HouspectVictoriaLogo />
        </div>
      )}

      {/* Client + references */}
      <div>
        <MetaRow label="Client" labelWidth={labelW} compact={compact}>
          <div>{r.clientName}</div>
          {r.clientAttn && <div style={{ color: reportTokens.inkMuted, fontSize: "0.92em" }}>Attn: {r.clientAttn}</div>}
          {r.clientEmail && <div style={{ color: reportTokens.inkMuted, fontSize: "0.92em" }}>Via email: {r.clientEmail}</div>}
        </MetaRow>
        <MetaRow label="Your Reference" labelWidth={labelW} compact={compact}>{r.yourReference}</MetaRow>
        <MetaRow label="Our Reference" labelWidth={labelW} compact={compact}>{r.ourReference}</MetaRow>
      </div>

      {/* Title -- a plain bordered box. Regular weight and a tighter box
          than a typical web heading, matching the reference report's own
          (larger type, less padding, not bold). */}
      <div
        style={{
          textAlign: "center",
          padding: compact ? "10px 0" : "12px 0",
          margin: compact ? "14px 0" : "20px 0",
          border: `1.5px solid ${reportTokens.ink}`,
        }}
      >
        <span
          style={{
            fontSize: `${titleSize}px`,
            fontWeight: 400,
            color: reportTokens.ink,
          }}
        >
          {r.reportTitle}
        </span>
      </div>

      {/* Property details */}
      <div>
        <MetaRow label="Property" labelWidth={labelW} compact={compact}>{r.property}</MetaRow>
        <MetaRow label="Property Owner" labelWidth={labelW} compact={compact}>
          <div>{r.propertyOwner ?? "—"}</div>
          {r.propertyOwnerEmail && (
            <div style={{ color: reportTokens.inkMuted, fontSize: "0.92em" }}>Via email: {r.propertyOwnerEmail}</div>
          )}
        </MetaRow>
        <MetaRow label="Inspection Date" labelWidth={labelW} compact={compact}>{r.inspectionDate}</MetaRow>
        <MetaRow label="Weather Conditions" labelWidth={labelW} compact={compact}>{r.weather}</MetaRow>
        <MetaRow label="Inspector" labelWidth={labelW} compact={compact}>
          {r.inspector}
          {r.inspectorRegistration ? ` (Builder Registration No ${r.inspectorRegistration})` : ""}
        </MetaRow>
      </div>

      {/* Purpose */}
      <div style={{ marginTop: compact ? "16px" : "24px" }}>
        <MetaRow label="Purpose" labelWidth={labelW} compact={compact}>
          <Para style={{ margin: 0 }}>{r.purpose}</Para>
        </MetaRow>
      </div>

      {/* No front-of-property photo here -- it belongs in the Description &
          Overview section instead (see ReportDescription's own photo slot),
          matching the reference report exactly: its cover carries no photo
          at all, and the front-of-property image sits on the Description
          page. `coverPhotoUrl` is no longer read by this component. */}

      {/* Signature -- left-aligned with the value column (not centered),
          matching the reference's own placement. The reference actually
          repeats this at the bottom of both cover pages; Chromium's print
          pagination doesn't expose "where will page 1 end" to this static
          HTML, so reliably anchoring a second copy to that exact spot isn't
          practical here -- this renders once, in the reference's own style. */}
      {(r.signatureUrl || r.signatureName) && (
        <div style={{ marginTop: compact ? "20px" : "36px", paddingLeft: `${labelW + 14}px` }}>
          {r.signatureUrl && (
            <img
              src={r.signatureUrl}
              alt="Signature"
              style={{ height: compact ? "36px" : "56px", display: "block", marginBottom: "4px" }}
            />
          )}
          {r.signatureName && (
            <div style={{ fontWeight: 400, color: "#5b7ba8", fontSize: compact ? "0.95em" : "1.05em" }}>
              {r.signatureName}
            </div>
          )}
          {r.signatureTitle && (
            <div style={{ fontWeight: 700, color: reportTokens.accent, fontSize: "0.85em" }}>{r.signatureTitle}</div>
          )}
        </div>
      )}
    </div>
  );
}
