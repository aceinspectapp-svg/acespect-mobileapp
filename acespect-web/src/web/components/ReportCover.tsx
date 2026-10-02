import { useLayoutEffect, useRef, useState } from "react";
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
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowsPage1, setOverflowsPage1] = useState(false);

  // Detects the rare inspection where the fields + purpose text above are
  // tall enough on their own to spill onto page 2 -- in that case the
  // anchored copy below can no longer land on page 1's physical bottom in
  // any meaningful sense, so a second, naturally-flowing copy renders after
  // it to keep the signature on whichever page the cover's own text
  // continues onto.
  useLayoutEffect(() => {
    if (compact || !hasSignature) return;
    const budgetPx = PAGE1_CONTENT_MM * (96 / 25.4);
    const recompute = () => {
      const height = contentRef.current?.getBoundingClientRect().height ?? 0;
      setOverflowsPage1(height > budgetPx);
      // Puppeteer switches this page into print media right before
      // generating the PDF (see reportPdf.ts) and waits on this marker --
      // the cover's print-mode width is narrower than its on-screen
      // preview, which re-wraps the Purpose paragraph and can change
      // whether it overflows, so the check has to re-run when that happens.
      document.body.dataset.coverMeasuredFor = window.matchMedia("print").matches ? "print" : "screen";
    };
    recompute();
    const printQuery = window.matchMedia("print");
    printQuery.addEventListener("change", recompute);
    // Puppeteer's own render never resizes mid-flow, but the live on-screen
    // view (e.g. a reviewer's browser window) can -- re-check then too, so
    // this doesn't get stuck on a measurement taken at a since-changed width.
    window.addEventListener("resize", recompute);
    return () => {
      printQuery.removeEventListener("change", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [compact, hasSignature, r]);

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
      <div style={{ position: compact ? undefined : "relative" }}>
      <div ref={contentRef}>
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
      </div>

      {/* Signature -- left-aligned with the value column (not centered),
          matching the reference's own placement. In compact mode (the
          reviewer's narrow preview panel) this just follows the fields in
          normal flow, as before. In the full-size report, it's pinned to a
          fixed spot near the bottom of page 1 via this absolutely
          positioned 225mm-tall overlay (Puppeteer's actual page-1 content
          height -- see PAGE1_CONTENT_MM above): `alignItems:"flex-end"`
          anchors the signature to the overlay's own bottom edge regardless
          of how much or little room the fields + purpose content above
          actually uses, instead of trailing right after it with a
          content-dependent gap. The overlay is absolutely positioned (out
          of normal flow) so it can't push later content down or collide
          with it. */}
      {!compact && hasSignature && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: `${PAGE1_CONTENT_MM}mm`,
            display: "flex",
            alignItems: "flex-end",
            paddingBottom: "3mm",
            pointerEvents: "none",
          }}
        >
          <div style={{ paddingLeft: `${labelW + 14}px`, breakInside: "avoid" }}>{signatureBlock}</div>
        </div>
      )}
      </div>

      {compact && hasSignature && (
        <div style={{ marginTop: "20px", paddingLeft: `${labelW + 14}px` }}>{signatureBlock}</div>
      )}

      {/* Overflow fallback: on the rare inspection where the fields +
          purpose text above are tall enough on their own to spill onto
          page 2, the anchored copy above can no longer meaningfully sit on
          page 1 -- repeat the signature here, in normal document flow right
          after that overflowing content, so it still appears on whichever
          page the cover's own text continues onto. */}
      {!compact && overflowsPage1 && hasSignature && (
        <div style={{ marginTop: "24px", paddingLeft: `${labelW + 14}px`, breakInside: "avoid" }}>
          {signatureBlock}
        </div>
      )}
    </div>
  );
}
