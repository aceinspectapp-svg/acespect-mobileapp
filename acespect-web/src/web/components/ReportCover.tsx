import type { ReportHeader } from "../report";
import { COVER_COLORS, CoverPage } from "./CoverPage";

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
 * The Dilapidation Report front matter (cover), generated from Job Information. It is drawn by the same cover page as the Construction
 * Report's (CoverPage.tsx) -- this only says what goes in it. `compact` shrinks it for the reviewer's narrow Report Text panel; the
 * default full size is used on the official report page.
 */
export function ReportCover({ header: r, compact = false }: { header: ReportHeader; compact?: boolean }) {
  return (
    <CoverPage
      compact={compact}
      logo={<HouspectVictoriaLogo />}
      reportDate={r.reportDate}
      clientName={r.clientName}
      clientNotes={[...(r.clientAttn ? [`Attn: ${r.clientAttn}`] : []), ...(r.clientEmail ? [`Via email: ${r.clientEmail}`] : [])]}
      references={[
        ["Our Reference", r.ourReference],
        ...(r.yourReference ? ([["Your Reference", r.yourReference]] as [string, string][]) : []),
      ]}
      kicker={r.reportTitle}
      title={r.reportType || r.reportTitle}
      rows={[
        ["Property", r.property],
        [
          "Property Owner",
          <>
            <div>{r.propertyOwner ?? "—"}</div>
            {r.propertyOwnerEmail && <div style={{ fontSize: "0.86em", color: COVER_COLORS.grey }}>Via email: {r.propertyOwnerEmail}</div>}
          </>,
        ],
        ["Inspection Date", r.inspectionDate],
        ["Weather Conditions", r.weather],
        ["Inspector", `${r.inspector}${r.inspectorRegistration ? ` (Builder Registration No ${r.inspectorRegistration})` : ""}`],
        ["Purpose", r.purpose],
      ]}
      signatureName={r.signatureName}
      signatureTitle={r.signatureTitle}
    />
  );
}
