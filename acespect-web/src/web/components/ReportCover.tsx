import type { ReportHeader } from "../report";
import { MetaRow, Para, reportTokens } from "./reportKit";
import { resolveMediaUrl } from "../api";

// Acespect Pty Ltd trades AS Houspect Victoria -- this report should carry
// that real trading identity, not the internal ACESPECT app's own logo.
// TODO: replace with the real Houspect Victoria logo image once supplied
// (swap this lockup for an <img>); this is a visual placeholder in the same
// position/style as the wordmark on Houspect Victoria's own report template.
function HouspectVictoriaLogo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <span style={{ fontSize: "10px", color: reportTokens.inkMuted, letterSpacing: "0.03em" }}>
        Building Inspections
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ width: "16px", height: "16px", borderRadius: "4px", background: "#dc2626", display: "inline-block" }} />
        <span style={{ fontSize: "20px", fontWeight: 800, color: reportTokens.accent }}>Houspect</span>
      </div>
    </div>
  );
}

/**
 * The Dilapidation Report front matter (cover), generated from Job Information.
 * `compact` shrinks it for the reviewer's narrow Report Text panel; the default
 * full size is used on the official report page.
 */
export function ReportCover({ header: r, compact = false }: { header: ReportHeader; compact?: boolean }) {
  const labelW = compact ? 100 : 150;
  const fontSize = compact ? 12.5 : 15;
  const titleSize = compact ? 19 : 32;

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

      {/* Title -- a plain bordered box, matching the reference report's cover exactly (not colored rule lines). */}
      <div
        style={{
          textAlign: "center",
          padding: compact ? "16px 0" : "22px 0",
          margin: compact ? "18px 0" : "32px 0",
          border: `1.5px solid ${reportTokens.ink}`,
        }}
      >
        <span
          style={{
            fontSize: `${titleSize}px`,
            fontWeight: 700,
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

      {/* Front-of-property photo -- matches the reference report's cover, which embeds this photo directly below Purpose. */}
      {r.coverPhotoUrl && (
        <div style={{ marginTop: compact ? "16px" : "24px" }}>
          <a href={resolveMediaUrl(r.coverPhotoUrl)} target="_blank" rel="noopener noreferrer">
            <img
              src={resolveMediaUrl(r.coverPhotoUrl)}
              alt="Front of property"
              style={{
                width: compact ? "160px" : "260px",
                aspectRatio: "4 / 3",
                objectFit: "cover",
                borderRadius: "4px",
                border: `1px solid ${reportTokens.border}`,
                display: "block",
              }}
            />
          </a>
        </div>
      )}

      {/* Signature */}
      {(r.signatureUrl || r.signatureName) && (
        <div style={{ marginTop: compact ? "24px" : "48px" }}>
          {r.signatureUrl && (
            <img
              src={r.signatureUrl}
              alt="Signature"
              style={{ height: compact ? "36px" : "56px", display: "block", marginBottom: "4px" }}
            />
          )}
          {r.signatureName && (
            <div style={{ fontWeight: 700, color: reportTokens.accent, fontSize: compact ? "0.95em" : "1.05em" }}>
              {r.signatureName}
            </div>
          )}
          {r.signatureTitle && (
            <div style={{ color: reportTokens.inkMuted, fontSize: "0.85em" }}>{r.signatureTitle}</div>
          )}
        </div>
      )}
    </div>
  );
}
