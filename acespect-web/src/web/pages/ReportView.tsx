import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Printer } from "lucide-react";
import type { FormSection } from "../mockData";
import { buildReportHeader } from "../report";
import { useAppData } from "../data";
import { ReportCover } from "../components/ReportCover";
import { ReportDescription } from "../components/ReportDescription";
import { ReportScope } from "../components/ReportScope";
import { ReportConditions } from "../components/ReportConditions";
import { ReportSection } from "../components/ReportSection";
import { Para, reportTextStyle, reportTokens, SectionBand } from "../components/reportKit";

/** Slug used to group sections — backend `key`, or `id` for mock data. */
const slug = (s: Pick<FormSection, "id" | "key">): string => s.key ?? s.id;

export function ReportView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getInspectionById, loading } = useAppData();
  const inspection = id ? getInspectionById(id) : undefined;

  if (!inspection) {
    return (
      <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8", fontFamily: "Inter, sans-serif" }}>
        {loading ? "Loading…" : "Inspection not found."}
      </div>
    );
  }

  const r = buildReportHeader(inspection);

  // Body = non-cover sections the reviewer has APPROVED (real data from the backend).
  const bodySections = inspection.sections
    .filter((s) => !slug(s).startsWith("job-info"))
    .filter((s) => s.reviewStatus === "approved" && s.reportText.trim().length > 0);

  // Group the approved categories under EXTERNAL / INTERNAL banners, keeping the
  // report order: description → EXTERNAL categories → INTERNAL → notes.
  const EXTERNAL_IDS = ["driveway", "paving", "fences", "elevations", "roof"];
  type RenderItem = { type: "banner"; label: string } | { type: "section"; section: (typeof bodySections)[number] };
  const renderList: RenderItem[] = [];
  let externalBanner = false;
  let internalBanner = false;
  for (const s of bodySections) {
    if (EXTERNAL_IDS.some((k) => slug(s).startsWith(k)) && !externalBanner) {
      renderList.push({ type: "banner", label: "EXTERNAL" });
      externalBanner = true;
    }
    if (slug(s).startsWith("internal") && !internalBanner) {
      renderList.push({ type: "banner", label: "INTERNAL" });
      internalBanner = true;
    }
    renderList.push({ type: "section", section: s });
  }

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
        <button
          onClick={() => window.print()}
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
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(26,42,74,0.3)",
          }}
        >
          <Printer size={15} /> Print / Save as PDF
        </button>
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
        }}
      >
        {/* Cover / front matter, generated from Job Information */}
        <ReportCover header={r} />

        {/* Report body — approved section report text, written on approval */}
        {renderList.length > 0 ? (
          <div style={{ marginTop: "40px" }}>
            {renderList.map((item, i) =>
              item.type === "banner" ? (
                <SectionBand key={item.label} compact={false}>
                  {item.label}
                </SectionBand>
              ) : (
                renderSection(item.section, i)
              ),
            )}
          </div>
        ) : (
          <p
            className="screen-only"
            style={{ marginTop: "32px", fontStyle: "italic", color: reportTokens.inkFaint, fontSize: "13px" }}
          >
            No section report text has been approved yet — once the reviewer approves a section, its
            report text appears here on the official report.
          </p>
        )}
      </div>
    </div>
  );

  function renderSection(s: (typeof bodySections)[number], i: number) {
    return (
      <div key={s.id} style={{ marginTop: i === 0 ? 0 : "20px", breakInside: "avoid" }}>
        {slug(s).startsWith("description") ? (
          /* Description & Overview uses the full template layout */
          <ReportDescription inspection={inspection!} reportText={s.reportText} />
        ) : slug(s).startsWith("notes") ? (
          /* Notes & Post Project: notes text + standard SCOPE / Conditions appendices */
          <>
            <p style={{ fontWeight: 700, margin: "0 0 10px", color: reportTokens.ink }}>{s.name}</p>
            {s.reportText
              .split(/\n{2,}|\n/)
              .map((para) => para.trim())
              .filter(Boolean)
              .map((para, j) => (
                <Para key={j}>{para}</Para>
              ))}
            <div style={{ marginTop: "18px" }}>
              <ReportScope />
              <div style={{ marginTop: "28px" }}>
                <ReportConditions />
              </div>
            </div>
          </>
        ) : (
          /* Every inspection category: description → photographs → cracks (described + imaged) */
          <ReportSection section={s} />
        )}
      </div>
    );
  }
}
