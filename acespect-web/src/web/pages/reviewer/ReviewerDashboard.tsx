import { useNavigate } from "react-router";
import { ClipboardList, Clock, CheckCircle, AlertCircle, Eye } from "lucide-react";
import { STATUS_CONFIG, type Inspection } from "../../mockData";
import { useAppData } from "../../data";
import { PageShell, StatusBadge, StatCard, TableCard } from "../../components/WebLayout";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

export function ReviewerDashboard() {
  const navigate = useNavigate();
  const { currentUser, getInspectionsForReviewer, getUser } = useAppData();
  const inspections = currentUser ? getInspectionsForReviewer(currentUser.id) : [];
  const getInspectorName = (id: string): string => getUser(id)?.name ?? id;

  const assignedCount   = inspections.length;
  const inReviewCount   = inspections.filter(i => i.status === "in-review").length;
  const approvedCount   = inspections.filter(i => i.status === "approved").length;
  const revisionCount   = inspections.filter(i =>
    i.sections.some(s => s.reviewStatus === "revision-requested")
  ).length;

  return (
    <PageShell title="Dashboard" subtitle={`Welcome back, ${currentUser?.name ?? "reviewer"}`}>
      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "28px" }}>
        <StatCard
          label="Assigned to Review"
          value={assignedCount}
          sub="Total assigned"
          color="#2563eb"
          icon={<ClipboardList size={18} />}
        />
        <StatCard
          label="In Review"
          value={inReviewCount}
          sub="Currently reviewing"
          color="#f59e0b"
          icon={<Clock size={18} />}
        />
        <StatCard
          label="Approved"
          value={approvedCount}
          sub="Completed reviews"
          color="#16a34a"
          icon={<CheckCircle size={18} />}
        />
        <StatCard
          label="Needs Revision"
          value={revisionCount}
          sub="Awaiting correction"
          color="#e63329"
          icon={<AlertCircle size={18} />}
        />
      </div>

      {/* Section heading */}
      <h2 style={{ fontSize: "14px", fontWeight: 700, color: "#1a2a4a", margin: "0 0 12px" }}>
        Assigned Inspections
      </h2>

      {/* Table */}
      <TableCard headers={["Job No.", "Address", "Inspector", "Date", "Type", "Status", "Action"]}>
        {inspections.length === 0 ? (
          <tr>
            <td
              colSpan={7}
              style={{ padding: "48px", textAlign: "center", color: "#94a3b8", fontSize: "14px" }}
            >
              No inspections assigned
            </td>
          </tr>
        ) : (
          inspections.map((ins, idx) => (
            <InspectionRow
              key={ins.id}
              inspection={ins}
              isLast={idx === inspections.length - 1}
              inspectorName={getInspectorName(ins.inspectorId)}
              onReview={() => navigate(`/reviewer/review/${ins.id}`)}
            />
          ))
        )}
      </TableCard>
    </PageShell>
  );
}

function InspectionRow({
  inspection,
  isLast,
  inspectorName,
  onReview,
}: {
  inspection: Inspection;
  isLast: boolean;
  inspectorName: string;
  onReview: () => void;
}) {
  const sc = STATUS_CONFIG[inspection.status];
  const isApproved = inspection.status === "approved";

  return (
    <tr
      style={{ borderBottom: isLast ? "none" : "1px solid #f1f5f9" }}
      onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {/* Job No. */}
      <td style={{ padding: "13px 16px", fontSize: "13px" }}>
        <span style={{
          background: "#f1f5f9",
          borderRadius: "6px",
          padding: "3px 7px",
          fontSize: "11px",
          fontWeight: 700,
          color: "#1a2a4a",
          fontFamily: "monospace",
        }}>
          {inspection.jobNo}
        </span>
      </td>

      {/* Address */}
      <td style={{ padding: "13px 16px", fontSize: "13px" }}>
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#1a2a4a", margin: 0 }}>{inspection.address}</p>
        <p style={{ fontSize: "11px", color: "#94a3b8", margin: "2px 0 0" }}>{inspection.suburb}</p>
      </td>

      {/* Inspector */}
      <td style={{ padding: "13px 16px", fontSize: "13px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "28px", height: "28px", borderRadius: "50%",
            background: "#1a2a4a", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: "10px", fontWeight: 700,
            color: "white", flexShrink: 0,
          }}>
            {inspectorName.split(" ").map(n => n[0]).join("").slice(0, 2)}
          </div>
          <span style={{ fontSize: "13px", color: "#374151" }}>{inspectorName}</span>
        </div>
      </td>

      {/* Date */}
      <td style={{ padding: "13px 16px", fontSize: "13px", color: "#374151", whiteSpace: "nowrap" }}>
        {formatDate(inspection.date)}
      </td>

      {/* Type */}
      <td style={{ padding: "13px 16px", fontSize: "13px" }}>
        <span style={{
          fontSize: "12px", color: "#64748b",
          background: "#f1f5f9", padding: "3px 10px", borderRadius: "8px",
        }}>
          {inspection.type}
        </span>
      </td>

      {/* Status */}
      <td style={{ padding: "13px 16px", fontSize: "13px" }}>
        <StatusBadge label={sc.label} color={sc.color} bg={sc.bg} />
      </td>

      {/* Action */}
      <td style={{ padding: "13px 16px", fontSize: "13px", textAlign: "center" }}>
        {!isApproved && (
          <button
            onClick={onReview}
            style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              padding: "6px 14px", borderRadius: "7px",
              background: "#1a2a4a", color: "white",
              fontSize: "12px", fontWeight: 600,
              border: "none", cursor: "pointer",
              transition: "background 0.12s",
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "#243b5a")}
            onMouseLeave={e => (e.currentTarget.style.background = "#1a2a4a")}
          >
            <Eye size={13} />
            Review
          </button>
        )}
      </td>
    </tr>
  );
}
