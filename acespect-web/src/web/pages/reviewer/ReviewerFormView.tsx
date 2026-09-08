import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft, CheckCircle, RotateCcw, Send, ChevronRight,
  Image as ImageIcon, FileText, AlertTriangle, Layers, Save,
} from "lucide-react";
import {
  STATUS_CONFIG,
  REVIEW_STATUS_CONFIG,
  type FormSection,
  type SectionReviewStatus,
} from "../../mockData";
import { useAppData } from "../../data";
import { StatusBadge } from "../../components/WebLayout";
import { ReportCover } from "../../components/ReportCover";
import { ReportDescription } from "../../components/ReportDescription";
import { ReportScope } from "../../components/ReportScope";
import { ReportConditions } from "../../components/ReportConditions";
import { ReportSection } from "../../components/ReportSection";
import { buildReportHeader } from "../../report";
import { SectionFieldView } from "../../components/SectionFieldView";
import { ActiveTemplate, AnswerTree, fetchActiveTemplate } from "../../templateFields";

/* ─── helpers ─────────────────────────────────────────────────────── */
function formatFieldKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

/* ─── column 1: section list item ───────────────────────────────────*/
function SectionListItem({
  section,
  isSelected,
  onClick,
}: {
  section: FormSection;
  isSelected: boolean;
  onClick: () => void;
}) {
  const rc = REVIEW_STATUS_CONFIG[section.reviewStatus];
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "11px 14px",
        background: isSelected ? "#f0f4ff" : "transparent",
        border: "none",
        borderLeft: isSelected ? "3px solid #2563eb" : "3px solid transparent",
        borderBottom: "1px solid #f9fafb",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.12s",
        boxSizing: "border-box",
      }}
      onMouseEnter={e => {
        if (!isSelected) e.currentTarget.style.background = "#f8fafc";
      }}
      onMouseLeave={e => {
        if (!isSelected) e.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ fontSize: "18px", lineHeight: 1, flexShrink: 0 }}>{section.icon}</span>
      <div style={{ flex: 1, overflow: "hidden" }}>
        <p style={{
          fontSize: "13px",
          fontWeight: isSelected ? 600 : 500,
          color: isSelected ? "#2563eb" : "#1a2a4a",
          margin: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {section.name}
        </p>
        <span style={{
          fontSize: "10px",
          fontWeight: 700,
          padding: "1px 6px",
          borderRadius: "8px",
          background: rc.bg,
          color: rc.color,
          marginTop: "3px",
          display: "inline-block",
        }}>
          {rc.label}
        </span>
      </div>
      <ChevronRight size={13} color={isSelected ? "#2563eb" : "#94a3b8"} />
    </button>
  );
}

/* ─── column 2: form content renderers ──────────────────────────────*/
function FieldsView({ section }: { section: FormSection }) {
  const entries = Object.entries(section.fields);
  if (entries.length === 0) return <EmptyState message="No fields recorded" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {entries.map(([key, val], idx) => (
        <div key={key} style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          padding: "10px 16px",
          borderBottom: idx < entries.length - 1 ? "1px solid #f1f5f9" : "none",
        }}>
          <span style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#94a3b8",
            minWidth: "140px",
            flexShrink: 0,
            paddingTop: "1px",
          }}>
            {formatFieldKey(key)}
          </span>
          <span style={{ fontSize: "13px", fontWeight: 500, color: "#1a2a4a" }}>
            {formatFieldValue(val)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Job Information: editable field data (feeds the report header) ── */
const JOB_INFO_FIELDS: { key: string; label: string; type: "text" | "email" | "date" | "textarea" }[] = [
  { key: "date", label: "Date", type: "date" },
  { key: "clientName", label: "Client Name", type: "text" },
  { key: "clientEmail", label: "Client Email", type: "email" },
  { key: "yourReference", label: "Client Project Reference", type: "text" },
  { key: "jobNo", label: "Job Number", type: "text" },
  { key: "propertyOwner", label: "Property Owner Name", type: "text" },
  { key: "propertyOwnerEmail", label: "Property Owner Email", type: "email" },
  { key: "address", label: "Property Address", type: "text" },
  { key: "weather", label: "Weather", type: "text" },
  { key: "inspector", label: "Inspector Name", type: "text" },
  { key: "inspectorRegistration", label: "Inspector DBU License", type: "text" },
  { key: "purpose", label: "General Statement (Inspection Summary)", type: "textarea" },
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: "8px",
  border: "1.5px solid #e5e7eb",
  background: "white",
  fontSize: "13px",
  color: "#1a2a4a",
  fontFamily: "Inter, -apple-system, sans-serif",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.12s",
};

function JobInfoFieldsForm({
  section,
  onSave,
}: {
  section: FormSection;
  onSave: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Reseed the draft whenever the reviewer switches to a different section.
  useEffect(() => {
    setDraft(
      Object.fromEntries(JOB_INFO_FIELDS.map(({ key }) => [key, formatFieldValue(section.fields[key] ?? "")])),
    );
    setSavedAt(null);
  }, [section.id]);

  const dirty = JOB_INFO_FIELDS.some(
    ({ key }) => (draft[key] ?? "") !== formatFieldValue(section.fields[key] ?? ""),
  );

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "14px 16px" }}>
      {JOB_INFO_FIELDS.map(({ key, label, type }) => (
        <div key={key}>
          <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
            {label}
          </label>
          {type === "textarea" ? (
            <textarea
              rows={3}
              value={draft[key] ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
              style={{ ...inputStyle, resize: "vertical" }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e7eb")}
            />
          ) : (
            <input
              type={type}
              value={draft[key] ?? ""}
              onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "#2563eb")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "#e5e7eb")}
            />
          )}
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            padding: "8px 16px",
            borderRadius: "8px",
            background: !dirty || saving ? "#94a3b8" : "#1a2a4a",
            color: "white",
            fontSize: "12px",
            fontWeight: 700,
            border: "none",
            cursor: !dirty || saving ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Save size={13} />
          {saving ? "Saving…" : "Save Changes"}
        </button>
        {!dirty && savedAt && (
          <span style={{ fontSize: "11px", color: "#16a34a", fontWeight: 600 }}>Saved</span>
        )}
      </div>
    </div>
  );
}

function DamageCard({ damage }: { damage: FormSection["damages"][0] }) {
  return (
    <div style={{
      background: "white",
      border: "1px solid #e5e7eb",
      borderRadius: "10px",
      overflow: "hidden",
      marginBottom: "12px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    }}>
      {/* red-tinted header */}
      <div style={{
        background: "#fff5f5",
        borderLeft: "3px solid #e63329",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        borderBottom: "1px solid #fee2e2",
      }}>
        <AlertTriangle size={14} color="#e63329" />
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#1a2a4a" }}>{damage.type}</span>
        <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
          <span style={{
            fontSize: "11px", fontWeight: 600,
            background: "#f1f5f9", color: "#64748b",
            padding: "2px 8px", borderRadius: "6px",
          }}>
            {damage.widthMm}mm
          </span>
          <span style={{
            fontSize: "11px", fontWeight: 600,
            background: "#f1f5f9", color: "#64748b",
            padding: "2px 8px", borderRadius: "6px",
          }}>
            {damage.lengthMm}mm
          </span>
        </div>
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px", marginBottom: "8px" }}>
          <div>
            <p style={{ fontSize: "10px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 2px" }}>Location</p>
            <p style={{ fontSize: "12px", color: "#374151", margin: 0 }}>{damage.location}</p>
          </div>
          <div>
            <p style={{ fontSize: "10px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 2px" }}>Direction</p>
            <p style={{ fontSize: "12px", color: "#374151", margin: 0 }}>{damage.direction}</p>
          </div>
        </div>
        {damage.notes && (
          <p style={{ fontSize: "12px", color: "#64748b", background: "#f8fafc", padding: "8px 10px", borderRadius: "6px", margin: "8px 0 0" }}>
            {damage.notes}
          </p>
        )}
        {damage.photos.length > 0 && (
          <div style={{ display: "flex", gap: "6px", marginTop: "10px", flexWrap: "wrap" }}>
            {damage.photos.map((url, i) => (
              <img
                key={i}
                src={url}
                alt={`Damage photo ${i + 1}`}
                style={{ width: "80px", height: "60px", objectFit: "cover", borderRadius: "10px", border: "1px solid #e5e7eb" }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PhotosGrid({ photos }: { photos: string[] }) {
  if (photos.length === 0) return null;
  return (
    <div style={{ marginTop: "16px" }}>
      <p style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px" }}>
        <ImageIcon size={12} style={{ display: "inline", marginRight: "5px" }} />
        Photos ({photos.length})
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "6px" }}>
        {photos.map((url, i) => (
          <img
            key={i}
            src={url}
            alt={`Photo ${i + 1}`}
            style={{
              width: "100%",
              aspectRatio: "4/3",
              objectFit: "cover",
              borderRadius: "10px",
              border: "1px solid #e5e7eb",
              cursor: "zoom-in",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
      {message}
    </div>
  );
}

/* ─── column 3: review status badge pill ────────────────────────────*/
function ReviewStatusPill({ status }: { status: SectionReviewStatus }) {
  const rc = REVIEW_STATUS_CONFIG[status];
  return (
    <span style={{
      fontSize: "11px",
      fontWeight: 700,
      padding: "3px 10px",
      borderRadius: "12px",
      background: rc.bg,
      color: rc.color,
    }}>
      {rc.label}
    </span>
  );
}

/* ─── main component ─────────────────────────────────────────────── */
export function ReviewerFormView() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { currentUser, loading, getInspectionById, getUser, patchSection } = useAppData();
  const inspection = getInspectionById(id ?? "");

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [, setBusy] = useState(false);
  // sectionKey -> its current published template (or null once we know none
  // exists for that key, e.g. a legacy/custom section).
  const [templates, setTemplates] = useState<Record<string, ActiveTemplate | null>>({});

  // Seed selection + comment drafts once the inspection is loaded.
  useEffect(() => {
    if (!inspection) return;
    setSelectedSectionId((prev) => prev || inspection.sections[0]?.id || "");
    setReviewComments((prev) =>
      Object.keys(prev).length
        ? prev
        : Object.fromEntries(inspection.sections.map((s) => [s.id, s.reviewComment])),
    );
  }, [inspection]);

  // Load each distinct section's active template, so the "Inspector's Form"
  // column can show every field captured on mobile instead of a flat
  // one-line-per-key summary.
  useEffect(() => {
    if (!inspection) return;
    const keys = Array.from(new Set(inspection.sections.map((s) => s.key ?? s.id)));
    const missing = keys.filter((k) => !(k in templates));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((key) => fetchActiveTemplate(inspection.type, inspection.propertyType, key).then((t) => [key, t] as const)),
    ).then((pairs) => {
      if (cancelled) return;
      setTemplates((prev) => {
        const next = { ...prev };
        for (const [key, t] of pairs) next[key] = t;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection]);

  if (!inspection) {
    return (
      <div style={{ padding: "48px", textAlign: "center", color: "#94a3b8", fontSize: "16px" }}>
        {loading || !currentUser ? "Loading…" : "Inspection not found."}
      </div>
    );
  }

  const sections = inspection.sections;
  const inspectorName = getUser(inspection.inspectorId)?.name ?? inspection.inspectorId;
  const sc = STATUS_CONFIG[inspection.status];
  const selectedSection = sections.find((s) => s.id === selectedSectionId) ?? sections[0];
  const reviewedCount = sections.filter((s) => s.reviewStatus !== "pending").length;

  /* section mutations → backend (provider refreshes the inspection) */
  async function updateSectionReportText(sectionId: string, text: string) {
    setBusy(true);
    try {
      await patchSection(inspection!.id, sectionId, { reportText: text });
    } finally {
      setBusy(false);
    }
  }

  async function updateSectionFields(sectionId: string, fields: Record<string, unknown>) {
    setBusy(true);
    try {
      await patchSection(inspection!.id, sectionId, { fields });
    } finally {
      setBusy(false);
    }
  }

  async function setReviewStatus(sectionId: string, status: SectionReviewStatus) {
    setBusy(true);
    try {
      await patchSection(inspection!.id, sectionId, {
        reviewStatus: status,
        reviewComment: reviewComments[sectionId] ?? "",
      });
    } finally {
      setBusy(false);
    }
  }

  async function approveAll() {
    setBusy(true);
    try {
      for (const s of sections) {
        await patchSection(inspection!.id, s.id, { reviewStatus: "approved" });
      }
    } finally {
      setBusy(false);
    }
  }

  /* layout constants */
  const HEADER_H    = 56;
  const PANEL_HDR_H = 52;
  const CONTENT_H   = `calc(100vh - ${HEADER_H}px - ${PANEL_HDR_H}px)`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: `calc(100vh - ${HEADER_H}px)`, overflow: "hidden", fontFamily: "Inter, -apple-system, sans-serif" }}>

      {/* ── Page header bar ── */}
      <div style={{
        height: `${PANEL_HDR_H}px`,
        flexShrink: 0,
        background: "white",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "0 24px",
      }}>
        <button
          onClick={() => navigate("/reviewer/dashboard")}
          style={{
            height: "32px",
            padding: "0 12px",
            borderRadius: "8px",
            background: "white",
            border: "1px solid #e5e7eb",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: "#374151",
            fontSize: "12px",
            fontWeight: 600,
            transition: "background 0.12s",
            flexShrink: 0,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
          onMouseLeave={e => (e.currentTarget.style.background = "white")}
          title="Back to dashboard"
        >
          <ArrowLeft size={15} color="#374151" />
          Back
        </button>

        <div style={{ width: "1px", height: "20px", background: "#e5e7eb" }} />

        <div style={{ flex: 1, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Review
            </span>
            <h1 style={{ fontSize: "16px", fontWeight: 700, color: "#1a2a4a", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {inspection.address}, {inspection.suburb}
            </h1>
            <span style={{ fontSize: "12px", color: "#94a3b8", flexShrink: 0 }}>
              {inspection.jobNo}
            </span>
          </div>
        </div>

        <StatusBadge label={sc.label} color={sc.color} bg={sc.bg} />

        <button
          onClick={() => navigate(`/report/${inspection.id}`)}
          style={{
            height: "32px",
            padding: "0 12px",
            borderRadius: "8px",
            background: "#1a2a4a",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: "white",
            fontSize: "12px",
            fontWeight: 600,
            flexShrink: 0,
          }}
          title="Generate Dilapidation Report"
        >
          <FileText size={14} />
          Report
        </button>

        <div style={{ fontSize: "12px", color: "#94a3b8", flexShrink: 0 }}>
          Inspector: <strong style={{ color: "#374151" }}>
            {inspectorName}
          </strong>
        </div>
      </div>

      {/* ── 3-column body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", height: CONTENT_H }}>

        {/* ═══ Column 1 — Areas list (220px, white) ═══ */}
        <div style={{
          width: "220px",
          flexShrink: 0,
          background: "white",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: "1px solid #e5e7eb",
        }}>
          {/* col1 header */}
          <div style={{
            padding: "14px 16px",
            borderBottom: "1px solid #f1f5f9",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Layers size={13} color="#94a3b8" />
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Inspection Areas
              </span>
            </div>
          </div>

          {/* sections list */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {sections.length === 0 ? (
              <p style={{ padding: "20px 14px", fontSize: "12px", color: "#94a3b8", textAlign: "center" }}>
                No sections available
              </p>
            ) : (
              sections.map(s => (
                <SectionListItem
                  key={s.id}
                  section={s}
                  isSelected={s.id === selectedSectionId}
                  onClick={() => setSelectedSectionId(s.id)}
                />
              ))
            )}
          </div>

          {/* progress bar footer */}
          <div style={{
            padding: "12px 14px",
            borderTop: "1px solid #f1f5f9",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>Review Progress</span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#1a2a4a" }}>
                {reviewedCount} / {sections.length}
              </span>
            </div>
            <div style={{ height: "4px", background: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: sections.length > 0 ? `${(reviewedCount / sections.length) * 100}%` : "0%",
                background: "#2563eb",
                borderRadius: "2px",
                transition: "width 0.3s ease",
              }} />
            </div>
            <p style={{ fontSize: "11px", color: "#94a3b8", margin: "6px 0 0", textAlign: "center" }}>
              {reviewedCount} of {sections.length} sections reviewed
            </p>
          </div>
        </div>

        {/* ═══ Column 2 — Inspector's Form (flex:1) ═══ */}
        <div style={{
          flex: 1,
          minWidth: "380px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "#f5f6fa",
          borderRight: "1px solid #e5e7eb",
        }}>
          {/* col2 header — white card with icon + name + status */}
          <div style={{
            padding: "14px 20px",
            background: "white",
            borderBottom: "1px solid #e5e7eb",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}>
            {selectedSection ? (
              <>
                <span style={{ fontSize: "20px" }}>{selectedSection.icon}</span>
                <div>
                  <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>
                    {selectedSection.name}
                  </h2>
                  <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                    Inspector's recorded data
                  </span>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                  {selectedSection.damages.length > 0 && (
                    <span style={{
                      fontSize: "11px", fontWeight: 600, color: "#d97706",
                      background: "#fef3c7", padding: "3px 8px", borderRadius: "6px",
                      display: "flex", alignItems: "center", gap: "4px",
                      border: "1px solid #fde68a",
                    }}>
                      <AlertTriangle size={11} />
                      {selectedSection.damages.length} damage{selectedSection.damages.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  <ReviewStatusPill status={selectedSection.reviewStatus} />
                </div>
              </>
            ) : (
              <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#94a3b8", margin: 0 }}>
                Select a section
              </h2>
            )}
          </div>

          {/* col2 scrollable body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
            {!selectedSection ? (
              <EmptyState message="Select an area from the list to view its data" />
            ) : (() => {
              const template = templates[selectedSection.key ?? selectedSection.id];
              const isJobInfo = (selectedSection.key ?? selectedSection.id).startsWith("job-info");
              return (
                <>
                  {/* Fields card — the full template-driven view of every field
                      the inspector filled in on mobile, not a flat summary.
                      Job Information keeps its editable form (feeds the report
                      header) since a reviewer can correct it directly. */}
                  {isJobInfo ? (
                    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                        <p style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0, display: "flex", alignItems: "center", gap: "5px" }}>
                          <FileText size={12} /> Field Data — editable, feeds the report header
                        </p>
                      </div>
                      <JobInfoFieldsForm
                        section={selectedSection}
                        onSave={(fields) => updateSectionFields(selectedSection.id, fields)}
                      />
                    </div>
                  ) : template ? (
                    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                        <p style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0, display: "flex", alignItems: "center", gap: "5px" }}>
                          <FileText size={12} /> Field Data
                        </p>
                      </div>
                      <SectionFieldView fields={template.fields} scope={(selectedSection.answers ?? {}) as AnswerTree} />
                    </div>
                  ) : Object.keys(selectedSection.fields).length > 0 && (
                    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
                        <p style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0, display: "flex", alignItems: "center", gap: "5px" }}>
                          <FileText size={12} /> Field Data
                        </p>
                      </div>
                      <FieldsView section={selectedSection} />
                    </div>
                  )}

                  {/* Damages — shown as its own card only when there's no
                      template (a template-backed section already shows every
                      damage-list instance, in full, inside the Field Data card). */}
                  {!template && selectedSection.damages.length > 0 && (
                    <div style={{ marginBottom: "16px" }}>
                      <p style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px", display: "flex", alignItems: "center", gap: "5px" }}>
                        <AlertTriangle size={12} /> Damage Records ({selectedSection.damages.length})
                      </p>
                      {selectedSection.damages.map(d => <DamageCard key={d.id} damage={d} />)}
                    </div>
                  )}

                  {/* Photos */}
                  {selectedSection.photos.length > 0 && (
                    <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "16px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                      <PhotosGrid photos={selectedSection.photos} />
                    </div>
                  )}

                  {!template && Object.keys(selectedSection.fields).length === 0 && selectedSection.damages.length === 0 && selectedSection.photos.length === 0 && (
                    <EmptyState message="No data recorded for this section" />
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* ═══ Column 3 — Report Editor (360px, white) ═══ */}
        <div style={{
          width: "360px",
          flexShrink: 0,
          background: "white",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderLeft: "1px solid #e5e7eb",
        }}>
          {/* col3 header */}
          <div style={{
            padding: "14px 18px",
            borderBottom: "1px solid #f1f5f9",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Report Content
            </span>
            <button
              onClick={approveAll}
              style={{
                padding: "5px 11px",
                borderRadius: "7px",
                background: "#1a2a4a",
                color: "white",
                fontSize: "11px",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "5px",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#0f1d35")}
              onMouseLeave={e => (e.currentTarget.style.background = "#1a2a4a")}
            >
              <CheckCircle size={12} />
              Approve All
            </button>
          </div>

          {/* col3 scrollable body */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "flex", flexDirection: "column", gap: "16px" }}>
            {!selectedSection ? (
              <p style={{ color: "#94a3b8", fontSize: "13px", textAlign: "center", paddingTop: "32px" }}>
                Select a section to edit its report
              </p>
            ) : (
              <>
                {/* ── Branch: Job Info & Description keep original style ── */}
                {(selectedSection.key ?? selectedSection.id).startsWith("job-info") ? (
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "8px" }}>
                      Report Text
                    </label>
                    {/* Generated report cover — exactly what prints on the official report */}
                    <div style={{
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      padding: "16px 18px",
                      borderLeft: "3px solid #2563eb",
                    }}>
                      <ReportCover header={buildReportHeader(inspection)} compact />
                    </div>
                  </div>
                ) : (selectedSection.key ?? selectedSection.id).startsWith("description") ? (
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "8px" }}>
                      Report Text
                    </label>
                    {/* Description & Overview — same template that prints on the report */}
                    <div style={{
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      padding: "16px 18px",
                      borderLeft: "3px solid #2563eb",
                    }}>
                      <ReportDescription inspection={inspection} reportText={selectedSection.reportText} compact />
                      <button
                        onClick={() => {
                          const newText = prompt("Edit the property description paragraph:", selectedSection.reportText);
                          if (newText !== null) updateSectionReportText(selectedSection.id, newText);
                        }}
                        style={{ marginTop: "12px", fontSize: "11px", color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
                      >
                        ✏ Edit description text
                      </button>
                    </div>
                  </div>
                ) : (selectedSection.key ?? selectedSection.id).startsWith("notes") ? (
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "8px" }}>
                      Report Text
                    </label>
                    <div style={{
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      padding: "16px 18px",
                      borderLeft: "3px solid #2563eb",
                    }}>
                      {selectedSection.reportText
                        .split(/\n{2,}|\n/)
                        .map((p) => p.trim())
                        .filter(Boolean)
                        .map((p, j) => (
                          <p key={j} style={{ fontSize: "13px", lineHeight: 1.7, color: "#374151", margin: "0 0 10px", textAlign: "justify" }}>
                            {p}
                          </p>
                        ))}
                      <button
                        onClick={() => {
                          const newText = prompt("Edit the notes text:", selectedSection.reportText);
                          if (newText !== null) updateSectionReportText(selectedSection.id, newText);
                        }}
                        style={{ fontSize: "11px", color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
                      >
                        ✏ Edit notes text
                      </button>
                      {/* Standard SCOPE + Conditions appendices that print with this section */}
                      <div style={{ marginTop: "16px", borderTop: "1px solid #f1f5f9", paddingTop: "14px" }}>
                        <ReportScope compact />
                        <div style={{ marginTop: "20px" }}>
                          <ReportConditions compact />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Every category: description → photographs → cracks (described + imaged).
                     The exact ReportSection that prints on the official report. */
                  <div>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "8px" }}>
                      Report Content
                    </label>
                    <div style={{
                      background: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "10px",
                      padding: "16px 18px",
                      borderLeft: "3px solid #2563eb",
                    }}>
                      <ReportSection section={selectedSection} compact />
                      <button
                        onClick={() => {
                          const newText = prompt("Edit report text:", selectedSection.reportText);
                          if (newText !== null) updateSectionReportText(selectedSection.id, newText);
                        }}
                        style={{ marginTop: "12px", fontSize: "11px", color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
                      >
                        ✏ Edit report text
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Divider before review controls ── */}
                <div style={{ height: "1px", background: "#e5e7eb", margin: "4px 0" }} />

                {/* Reviewer comment */}
                <div>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: "6px" }}>
                    Reviewer Comment
                  </label>
                  <textarea
                    value={reviewComments[selectedSection.id] ?? ""}
                    onChange={e => setReviewComments(prev => ({ ...prev, [selectedSection.id]: e.target.value }))}
                    placeholder="Add a comment for the inspector…"
                    rows={3}
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: "1.5px solid #e5e7eb",
                      background: "white",
                      fontSize: "13px",
                      lineHeight: 1.7,
                      color: "#1a2a4a",
                      resize: "vertical",
                      fontFamily: "Inter, -apple-system, sans-serif",
                      outline: "none",
                      boxSizing: "border-box",
                      transition: "border-color 0.12s",
                    }}
                    onFocus={e => (e.currentTarget.style.borderColor = "#2563eb")}
                    onBlur={e => (e.currentTarget.style.borderColor = "#e5e7eb")}
                  />
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Section Decision
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setReviewStatus(selectedSection.id, "approved")}
                      style={{
                        flex: 1,
                        padding: "9px 8px",
                        borderRadius: "8px",
                        background: selectedSection.reviewStatus === "approved" ? "#16a34a" : "#dcfce7",
                        color: selectedSection.reviewStatus === "approved" ? "white" : "#16a34a",
                        fontSize: "12px",
                        fontWeight: 700,
                        border: `1.5px solid ${selectedSection.reviewStatus === "approved" ? "#16a34a" : "#bbf7d0"}`,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "5px",
                        transition: "all 0.12s",
                      }}
                    >
                      <CheckCircle size={13} />
                      Approve
                    </button>
                    <button
                      onClick={() => setReviewStatus(selectedSection.id, "revision-requested")}
                      style={{
                        flex: 1,
                        padding: "9px 8px",
                        borderRadius: "8px",
                        background: selectedSection.reviewStatus === "revision-requested" ? "#d97706" : "#fef3c7",
                        color: selectedSection.reviewStatus === "revision-requested" ? "white" : "#d97706",
                        fontSize: "12px",
                        fontWeight: 700,
                        border: `1.5px solid ${selectedSection.reviewStatus === "revision-requested" ? "#d97706" : "#fde68a"}`,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "5px",
                        transition: "all 0.12s",
                      }}
                    >
                      <RotateCcw size={13} />
                      Revision
                    </button>
                  </div>
                  {/* Current review status pill */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingTop: "2px" }}>
                    <span style={{ fontSize: "11px", color: "#94a3b8" }}>Section status:</span>
                    <ReviewStatusPill status={selectedSection.reviewStatus} />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* col3 footer — Submit Review */}
          <div style={{
            padding: "14px 18px",
            borderTop: "1px solid #e5e7eb",
            background: "white",
            flexShrink: 0,
          }}>
            <div style={{ marginBottom: "10px", padding: "8px 12px", background: "#f8fafc", borderRadius: "8px", display: "flex", justifyContent: "space-between", border: "1px solid #f1f5f9" }}>
              <span style={{ fontSize: "11px", color: "#94a3b8" }}>Sections reviewed</span>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#1a2a4a" }}>
                {reviewedCount} / {sections.length}
              </span>
            </div>
            <button
              onClick={() => {
                alert("Review submitted successfully!");
                navigate("/reviewer/dashboard");
              }}
              disabled={sections.length === 0}
              style={{
                width: "100%",
                padding: "13px",
                borderRadius: "10px",
                background: sections.length === 0 ? "#94a3b8" : "linear-gradient(135deg, #0f1d35, #1a2a4a)",
                color: "white",
                fontSize: "13px",
                fontWeight: 700,
                border: "none",
                cursor: sections.length === 0 ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                transition: "opacity 0.12s",
              }}
              onMouseEnter={e => {
                if (sections.length > 0) e.currentTarget.style.opacity = "0.9";
              }}
              onMouseLeave={e => {
                if (sections.length > 0) e.currentTarget.style.opacity = "1";
              }}
            >
              <Send size={14} />
              Submit Review
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
