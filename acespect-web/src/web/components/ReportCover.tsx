import type { ReportHeader } from "../report";
import { MetaRow, Para, reportTokens } from "./reportKit";

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

      {/* Title */}
      <div
        style={{
          textAlign: "center",
          padding: compact ? "18px 0 14px" : "34px 0 26px",
          margin: compact ? "18px 0" : "32px 0",
          borderTop: `2px solid ${reportTokens.accent}`,
          borderBottom: `2px solid ${reportTokens.accent}`,
        }}
      >
        <span
          style={{
            fontSize: `${titleSize}px`,
            fontWeight: 800,
            letterSpacing: "0.01em",
            color: reportTokens.accent,
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
    </div>
  );
}
