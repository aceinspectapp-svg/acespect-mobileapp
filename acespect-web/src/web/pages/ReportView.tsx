import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Printer, Download, FileText } from "lucide-react";
import type { FormSection } from "../mockData";
import { buildReportHeader, withExcludedPhotosRemoved } from "../report";
import { useAppData, useInspectionDetail } from "../data";
import { API_BASE, fetchWithRefresh, getToken } from "../api";
import { ReportCover } from "../components/ReportCover";
import { sectionPhotoArchiveUrl } from "../photoArchive";
import { ReportDescription } from "../components/ReportDescription";
import { ReportScope } from "../components/ReportScope";
import { ReportConditions } from "../components/ReportConditions";
import { ReportAgreement } from "../components/ReportAgreement";
import { printsAgreement } from "../reportAgreement";
import { ReportSection } from "../components/ReportSection";
import { ReportConditionSummary, type ConditionSummaryCategory } from "../components/ReportConditionSummary";
import { ReportPoolSpaDisclaimer } from "../components/ReportPoolSpaDisclaimer";
import { reportProfileOf } from "../wording/profile";
import { wordingFor } from "../wording/registry";
import type { ConditionSummaryRow } from "../templateFields";
import { DILAPIDATION_BRAND, PhotoNumberProvider, ReportWordingStyleContext, reportTextStyle, reportTokens, SectionBand } from "../components/reportKit";
import { ConstructionReportBody, constructionFileName, useConstructionReport } from "../construction/ConstructionReport";
import { orderedPieces, type ReportPiece } from "../reportParts";

/** Slug used to group sections — backend `key`, or `id` for mock data. */
const slug = (s: Pick<FormSection, "id" | "key">): string => s.key ?? s.id;

/** The `id` each report section carries, so the Condition Summary's topics can link straight to it. */
const sectionAnchorId = (id: string): string => `section-${id}`;

export function ReportView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getUser, loading } = useAppData();
  const { inspection, loadingDetail } = useInspectionDetail(id);
  // The report type decides which wording applies (see wording/registry.ts).
  const reportWording = wordingFor(reportProfileOf(inspection?.type ?? "", inspection?.propertyType ?? ""));
  // A Construction Stage inspection has its own report layout (undefined while its templates load).
  const construction = useConstructionReport(inspection);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // The actual branded PDF (real logo, per-page footer, page breaks) --
  // generated server-side by the backend's own Puppeteer pipeline, not the
  // browser's own Print dialog (which the toolbar's other button still
  // uses, and which has none of that branding). Needs a manual fetch with
  // the auth header, since a plain <a href> can't attach one and the
  // endpoint requires it.
  // The same report as a PDF or an editable Word file -- both made server-side from this same report page.
  // Opens in a new tab. The tab is opened straight away (inside the click, so the browser does not block it as a pop-up) and shows a
  // short "Preparing" note while the server builds the file; then a PDF shows in the browser's own viewer, and a Word file (which a
  // browser cannot show) is saved from that tab under its proper name. If the browser blocks new tabs, the file downloads here as before.
  async function handleDownload(format: "pdf" | "docx") {
    if (!id) return;
    const label = format === "pdf" ? "PDF" : "Word document";
    const pdfName = construction ? constructionFileName(inspection?.jobNo || id) : `${(inspection?.jobNo || id).replace(/[^a-z0-9.-]+/gi, "-")}-dilapidation-report.pdf`;
    const fileName = format === "pdf" ? pdfName : pdfName.replace(/\.pdf$/, ".docx");
    const win = window.open("", "_blank");
    const note = (title: string, text: string) => {
      if (!win || win.closed) return;
      win.document.title = title;
      win.document.body.style.cssText = "font-family: Inter, system-ui, sans-serif; color: #1a2a4a; padding: 48px; text-align: center;";
      win.document.body.textContent = text;
    };
    note(fileName, `Preparing the ${label}… this can take a few seconds.`);
    setDownloading(true);
    setDownloadError(null);
    try {
      const token = getToken();
      const res = await fetchWithRefresh(`${API_BASE}/inspections/${id}/report.${format}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        // The server says why (for example the report page could not be opened); show that instead of a bare status code.
        const why = (await res.json().catch(() => null))?.error?.message;
        throw new Error(`Failed to generate ${format === "pdf" ? "PDF" : "Word document"}${why ? `: ${why}` : ` (HTTP ${res.status})`}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // Kept for a while so the new tab can finish loading (and the viewer can save) the file; freed with this page at the latest.
      setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
      if (win && !win.closed && format === "pdf") {
        win.location.href = url;
        return;
      }
      const doc = win && !win.closed ? win.document : document;
      const a = doc.createElement("a");
      a.href = url;
      a.download = fileName;
      doc.body.appendChild(a);
      a.click();
      a.remove();
      note(fileName, `${fileName} has been downloaded. You can close this tab.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : `Failed to download the ${label}`;
      setDownloadError(message);
      note("Report not available", message);
    } finally {
      setDownloading(false);
    }
  }

  if (!inspection || construction === undefined) {
    return (
      <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8", fontFamily: "Inter, sans-serif" }}>
        {loading || loadingDetail || (inspection && construction === undefined) ? "Loading…" : "Inspection not found."}
      </div>
    );
  }

  const r = buildReportHeader(inspection, getUser(inspection.inspectorId));

  // Body = non-cover sections the reviewer has APPROVED (real data from the backend).
  const bodySections = inspection.sections
    .filter((s) => !slug(s).startsWith("job-info"))
    .filter((s) => s.reviewStatus === "approved" && s.reportText.trim().length > 0);

  // Group the approved categories under EXTERNAL / INTERNAL banners, keeping the
  // report order: description → EXTERNAL categories → INTERNAL → notes.
  const EXTERNAL_IDS = ["driveway", "paving", "fences", "elevations", "roof"];
  type RenderItem = { type: "banner"; label: string } | ({ type: "section"; section: (typeof bodySections)[number] } & Omit<ReportPiece, "section">);
  const renderList: RenderItem[] = [];
  let externalBanner = false;
  let internalBanner = false;
  const bandOf = (s: (typeof bodySections)[number]) =>
    EXTERNAL_IDS.some((k) => slug(s).startsWith(k)) ? "EXTERNAL" : slug(s).startsWith("internal") ? "INTERNAL" : undefined;
  // A report type laid out as its template is (Apartment): each of the template's headings in the template's order, wherever the form asks about it.
  const description = bodySections.find((s) => slug(s).startsWith("description"));
  const pieces: ReportPiece[] =
    orderedPieces(bodySections.filter((s) => s !== description), reportWording, slug) ?? bodySections.filter((s) => s !== description).map((s) => ({ section: s }));
  if (description) renderList.push({ type: "section", section: description });
  for (const piece of pieces) {
    const band = piece.band ?? bandOf(piece.section);
    if (band === "EXTERNAL" && !externalBanner) {
      renderList.push({ type: "banner", label: "EXTERNAL" });
      externalBanner = true;
    }
    if (band === "INTERNAL" && !internalBanner) {
      renderList.push({ type: "banner", label: "INTERNAL" });
      internalBanner = true;
    }
    renderList.push({ type: "section", ...piece });
  }

  // Page order after the cover: the Description block first (Description and
  // Overview, Photographs, Scope of Inspection and Comments), then the
  // Condition Summary, then every other category. The Description section is
  // pulled out of the list here so it can sit above the summary.
  const descriptionItem = renderList.find((it) => it.type === "section" && slug(it.section).startsWith("description"));
  const restList = renderList.filter((it) => it !== descriptionItem);

  // Executive Summary (Condition Summary page) -- one category per approved
  // section that actually has condition-graded rows (derived and stored at
  // save time, see templateFields.ts's ConditionSummaryRow); Description
  // and Notes never produce any, so they're naturally excluded without
  // needing their own filter here.
  const conditionSummaryCategories: ConditionSummaryCategory[] = bodySections
    .map((s) => ({
      sectionName: reportWording.sectionTitle?.(slug(s)) ?? s.name,
      anchorId: sectionAnchorId(s.id),
      rows: (s.fields as unknown as { conditionSummary?: ConditionSummaryRow[] }).conditionSummary ?? [],
    }))
    .filter((c) => c.rows.length > 0);

  return (
    <div
      className="report-scroll"
      style={{ minHeight: "100vh", background: "#eef1f6", padding: "24px 16px", fontFamily: reportTokens.font }}
    >
      {/* Toolbar (hidden when printing) */}
      <div
        className="report-toolbar"
        style={{
          maxWidth: "820px",
          margin: "0 auto 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            background: "white",
            color: "#374151",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <ArrowLeft size={15} /> Back
        </button>
        <span style={{ fontSize: "12px", color: "#64748b", fontFamily: "monospace" }}>{r.ourReference}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {downloadError && (
            <span style={{ fontSize: "12px", color: "#dc2626", fontWeight: 600 }}>{downloadError}</span>
          )}
          <button
            onClick={() => handleDownload("pdf")}
            disabled={downloading}
            title="The real branded report (logo, per-page footer, page breaks) -- generated server-side, not a browser print."
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 18px",
              borderRadius: "8px",
              border: "none",
              background: `linear-gradient(135deg, #0f1d35, ${reportTokens.accent})`,
              color: "white",
              fontSize: "13px",
              fontWeight: 700,
              cursor: downloading ? "wait" : "pointer",
              opacity: downloading ? 0.7 : 1,
              boxShadow: "0 2px 8px rgba(26,42,74,0.3)",
            }}
          >
            <Download size={15} /> {downloading ? "Generating…" : "Download PDF"}
          </button>
          <button
            onClick={() => handleDownload("docx")}
            disabled={downloading}
            title="The same report as an editable Word document -- generated server-side."
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 18px",
              borderRadius: "8px",
              border: `1.5px solid ${reportTokens.accent}`,
              background: "white",
              color: reportTokens.accent,
              fontSize: "13px",
              fontWeight: 700,
              cursor: downloading ? "wait" : "pointer",
              opacity: downloading ? 0.7 : 1,
            }}
          >
            <FileText size={15} /> {downloading ? "Generating…" : "Download Word"}
          </button>
          <button
            onClick={() => window.print()}
            title="Your browser's own print dialog -- not the branded report; use Download PDF for that."
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 18px",
              borderRadius: "8px",
              border: "1px solid #e5e7eb",
              background: "white",
              color: "#374151",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {/* The document page */}
      <div
        className="report-page"
        style={{
          maxWidth: "820px",
          margin: "0 auto",
          background: "white",
          padding: "64px 72px",
          borderRadius: "10px",
          boxShadow: "0 4px 28px rgba(0,0,0,0.12)",
          ...reportTextStyle(false),
          ...(construction ? {} : DILAPIDATION_BRAND),
        }}
      >
        {construction ? (
          <ConstructionReportBody inspection={inspection} model={construction} header={r} />
        ) : (
          <>
        {/* Cover / front matter, generated from Job Information */}
        <ReportCover header={r} />

        {/* Report body — approved section report text, written on approval.
            Wrapped in PhotoNumberProvider so every photo across the whole
            document gets one running "Photo N" count in render order,
            letting each section's "Please refer to Photographs X to Y:"
            cite exactly the photos that follow it -- matching the reference
            report's per-item photo cross-referencing instead of one vague
            "Please refer to Photographs:" line repeated everywhere. */}
        <PhotoNumberProvider>
          <ReportWordingStyleContext.Provider value={{ nov2026: printsAgreement(reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "")) }}>
          {/* 1-3. Description and Overview, Photographs, Scope of Inspection
              and Comments -- all rendered by ReportDescription, straight after
              the cover and ABOVE the Condition Summary. */}
          {descriptionItem && descriptionItem.type === "section" && (
            <div className="report-page-break" style={{ marginTop: "40px" }}>
              {renderSection(descriptionItem.section, 0)}
            </div>
          )}

          {/* 4. Condition Summary (formerly "Executive Summary") -- its own
              dedicated page after the Description block. Renders nothing
              (including this wrapper) when there's nothing to summarise yet,
              so an inspection with no approved sections never prints a lone
              near-empty page. */}
          {conditionSummaryCategories.length > 0 && reportWording.conditionSummary !== false && (
            <div className="report-page-break">
              <ReportConditionSummary categories={conditionSummaryCategories} nov2026={printsAgreement(reportProfileOf(inspection.type ?? "", inspection.propertyType ?? ""))} />
            </div>
          )}

          {restList.length > 0 ? (
            <div className="report-page-break" style={{ marginTop: "40px" }}>
              {restList.map((item, i) =>
                item.type === "banner" ? (
                  <SectionBand key={item.label} tone="peach" compact={false}>
                    {item.label}
                  </SectionBand>
                ) : (
                  renderSection(item.section, i, item)
                ),
              )}
            </div>
          ) : (
            renderList.length === 0 && (
              <p
                className="screen-only"
                style={{ marginTop: "32px", fontStyle: "italic", color: reportTokens.inkFaint, fontSize: "13px" }}
              >
                No section report text has been approved yet — once the reviewer approves a section, its
                report text appears here on the official report.
              </p>
            )
          )}

          {/* SCOPE / Conditions always print, on their own fresh page,
              independent of whether Notes (or anything else) has content --
              previously these only rendered as a side effect of iterating
              into the "notes" section inside renderList, so a genuinely
              empty Notes section (the `notes` composer now produces no text
              at all when nothing was notable -- see the report type's wording (src/web/wording/)) would
              have silently dropped this entire legal appendix along with it. */}
          {printsAgreement(reportProfileOf(inspection.type ?? "", inspection.propertyType ?? "")) ? (
            // Dilapidation / Residential House: the office template's Agreement (Nov 2026), which covers both the scope and the conditions.
            <div className="report-page-break">
              <ReportAgreement />
            </div>
          ) : (
            <>
              <div className="report-page-break">
                <ReportScope />
              </div>
              {/* Conditions starts on its own fresh page too, separate from
                  Scope -- previously they shared one page-break (before Scope
                  only), so Conditions just ran on wherever Scope happened to
                  end. */}
              <div className="report-page-break" style={{ marginTop: "20px" }}>
                <ReportConditions />
              </div>
            </>
          )}
          </ReportWordingStyleContext.Provider>
        </PhotoNumberProvider>
          </>
        )}
      </div>
    </div>
  );

  function renderSection(s: (typeof bodySections)[number], i: number, piece?: Omit<ReportPiece, "section">) {
    return (
      <div key={s.id} id={sectionAnchorId(s.id)} style={{ marginTop: i === 0 ? 0 : "16px" }}>
        {slug(s).startsWith("description") ? (
          /* Description & Overview uses the full template layout */
          <ReportDescription inspection={inspection!} reportText={s.reportText} />
        ) : slug(s).startsWith("notes") ? (
          /* Notes & Post Project: a bold "NOTES" heading + numbered list
             (matching the reference exactly, rather than this section's own
             name and plain paragraphs). SCOPE/Conditions are NOT rendered
             here -- they always print unconditionally further down in this
             file, regardless of whether this section exists or has content.
             The `notes` composer (the report type's wording (src/web/wording/)) only produces text for
             genuinely notable findings -- a checklist item answered "No"
             contributes nothing -- so an inspection with nothing notable
             ends up with empty reportText, and `bodySections`' own filter
             (reportText.trim().length > 0) keeps this branch from ever
             rendering at all, matching the reference report (which omits
             this section entirely rather than printing a page of "Observed?
             No" boilerplate). */
          <>
            <p style={{ fontWeight: 700, margin: "0 0 10px", color: reportTokens.ink, breakAfter: "avoid" }}>NOTES</p>
            <ol style={{ margin: "0 0 10px", paddingLeft: "20px" }}>
              {s.reportText
                .split(/\n{2,}|\n/)
                .map((para) => para.trim())
                .filter(Boolean)
                .map((para, j) => (
                  <li key={j} style={{ margin: "0 0 6px", lineHeight: 1.45, breakInside: "avoid" }}>
                    {para}
                  </li>
                ))}
            </ol>
          </>
        ) : (
          /* Every inspection category: description → photographs → cracks (described + imaged).
             Filtered first so any photo the reviewer excluded never reaches the printed report. */
          <>
            <ReportSection
              // The heading the report type's template uses for this section, where it differs from the form's name (a part of a
              // section laid out as the template is already carries its heading).
              section={{ ...withExcludedPhotosRemoved(s), name: reportWording.reportParts ? s.name : reportWording.sectionTitle?.(slug(s)) ?? s.name }}
              hideDamageText={slug(s) in reportWording.composers}
              // A part printed under its own heading: the photos and defects it does not mark itself print with the section's last part.
              generalPhotos={piece?.generalPhotos?.filter((url) => withExcludedPhotosRemoved(s).photos.includes(url))}
              untaggedDefects={piece?.untaggedDefects ?? true}
              showHeading={piece?.showHeading ?? true}
              archiveUrl={
                // Only for sections that have photos at all (judged on the unfiltered section, so a section whose
                // photos were all left out of the report still points to its archive).
                piece?.archiveLink !== false && (s.photos.length > 0 || s.damages.some((d) => d.photos.length > 0))
                  ? sectionPhotoArchiveUrl(inspection!.photoArchiveUrl, s.key)
                  : null
              }
            />
            {slug(s).startsWith("pool") && reportWording.poolSpaDisclaimer !== false && <ReportPoolSpaDisclaimer nov2026={printsAgreement(reportProfileOf(inspection?.type ?? "", inspection?.propertyType ?? ""))} />}
          </>
        )}
      </div>
    );
  }
}
