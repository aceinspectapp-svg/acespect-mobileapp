import type { ReportHeader } from "../report";
import { MetaRow, Para, reportTokens } from "./reportKit";

// Puppeteer's page.pdf() (see acespect-backend/src/lib/reportPdf.ts) reserves
// a 225mm-tall content area per printed page: A4's 297mm minus the 30mm top /
// 42mm bottom margins it sets aside for the header/footer templates. The
// cover anchors its signature against this same budget so the signature
// lands at a fixed spot near the bottom of page 1, matching the reference
// report, instead of trailing wherever the fields happen to end.
const PAGE1_CONTENT_MM = 225;

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

  const hasSignature = Boolean(r.signatureUrl || r.signatureName);

  const signatureBlock = hasSignature && (
    <>
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
    </>
  );

  return (
    <div style={{ fontFamily: reportTokens.font, color: reportTokens.ink, fontSize: `${fontSize}px`, lineHeight: 1.5 }}>
      {/* Fields + purpose + signature all sit in one normal-flow column,
          given a 225mm floor (page 1's real content height -- see
          PAGE1_CONTENT_MM) so `marginTop: "auto"` on the signature below
          pulls it down to sit flush with the bottom of page 1 when the
          fields above leave room, instead of trailing right after Purpose
          with a short, content-dependent gap.

          An earlier version pinned the signature with `position: absolute`
          instead, so it couldn't be pushed down by its own height. That
          worked in isolation, but Chromium's print pagination doesn't
          reliably confine an absolutely positioned box to the physical page
          its containing block started on -- adding an unrelated page (the
          Condition Summary) right after the cover was enough to make the
          same absolute signature render on *that* next page, printed
          directly on top of its heading. Plain normal-flow layout doesn't
          have that failure mode: an element's own position can never cross
          a `break-before` on a later sibling, so this can't overlap
          whatever page the cover is followed by, no matter what that is.

          The trade-off: if the fields + purpose content is itself long
          enough to leave no room at all for the signature once combined
          with `breakInside: "avoid"` below, the whole signature block
          flows onto page 2 with it, naturally and without any extra code
          -- which is exactly what the "must also appear on page 2" case
          needs anyway. */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: compact ? undefined : `${PAGE1_CONTENT_MM}mm` }}>
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
          <MetaRow label="Report Date" labelWidth={labelW} compact={compact}>{r.reportDate}</MetaRow>
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
            matching the reference's own placement. `marginTop: "auto"`
            (non-compact only) is what pins it to the bottom of the 225mm
            column above instead of trailing right after Purpose. */}
        {hasSignature && (
          <div
            style={{
              marginTop: compact ? "20px" : "auto",
              paddingLeft: `${labelW + 14}px`,
              // Keeps the signature image, name and title together as one
              // unbreakable block -- without this, Chromium's print
              // pagination can split the block mid-way (e.g. the name on
              // one page, the title alone at the top of the next), which is
              // wrong since they're one signature, not separate content.
              breakInside: "avoid",
            }}
          >
            {signatureBlock}
          </div>
        )}
      </div>
    </div>
  );
}
