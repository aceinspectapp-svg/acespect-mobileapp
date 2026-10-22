import { useState } from "react";
import { useNavigate } from "react-router";
import { ClipboardList, Clock, CheckCircle, AlertCircle, Eye, Users, Lock } from "lucide-react";
import { STATUS_CONFIG, type Inspection } from "../../mockData";
import { useAppData } from "../../data";
import { api } from "../../api";
import { splitReviewerQueue } from "../../reviewerQueue";
import { useAssignments } from "../../useAssignments";
import { PageShell, StatusBadge, StatCard, TableCard } from "../../components/WebLayout";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

const smallBtn = (bg: string, fg = "white", border = "none"): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: "5px", padding: "6px 12px", borderRadius: "7px",
  background: bg, color: fg, fontSize: "12px", fontWeight: 600, border, cursor: "pointer", whiteSpace: "nowrap",
});

const sectionHeading: React.CSSProperties = { fontSize: "14px", fontWeight: 700, color: "#1a2a4a", margin: "28px 0 12px" };

export function ReviewerDashboard() {
  const navigate = useNavigate();
  const { currentUser, inspections: all, getUser, refresh } = useAppData();
  const { overview, error: overviewError, reload } = useAssignments(!!currentUser);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const { mine: inspections, unassigned, others } = splitReviewerQueue(all, currentUser?.id ?? "");
  const getInspectorName = (id: string): string => getUser(id)?.name ?? id;
  const reviewerName = (id: string | null): string =>
    !id ? "Unassigned" : id === currentUser?.id ? "You" : overview?.reviewers.find((r) => r.id === id)?.name ?? getUser(id)?.name ?? "Another reviewer";

  const assignedCount   = inspections.length;
  const inReviewCount   = inspections.filter(i => i.status === "in-review").length;
  const approvedCount   = inspections.filter(i => i.status === "approved").length;
  const revisionCount   = inspections.filter(i =>
    i.sections.some(s => s.reviewStatus === "revision-requested")
  ).length;

  /** Runs one assignment action, then refreshes the list and the counts so the page matches the server. */
  async function act(key: string, fn: () => Promise<unknown>, okText: string) {
    setBusyKey(key);
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: "ok", text: okText });
    } catch (e) {
      setNotice({ kind: "err", text: (e as Error).message || "That did not work." });
    } finally {
      await Promise.all([refresh(), reload()]);
      setBusyKey(null);
    }
  }

  const otherReviewers = (overview?.reviewers ?? []).filter((r) => r.id !== currentUser?.id);
  const myIn = (overview?.requests ?? []).filter((r) => r.fromReviewerId === currentUser?.id);
  const myOut = (overview?.requests ?? []).filter((r) => r.toReviewerId === currentUser?.id);
  const pendingFor = (inspectionId: string) => myOut.find((r) => r.inspectionId === inspectionId);

  return (
    <PageShell title="Dashboard" subtitle={`Welcome back, ${currentUser?.name ?? "reviewer"}`}>
      {notice && (
        <div role="status" style={{ marginBottom: "16px", padding: "10px 14px", borderRadius: "8px", fontSize: "13px", background: notice.kind === "ok" ? "#f0fdf4" : "#fef2f2", color: notice.kind === "ok" ? "#166534" : "#991b1b", border: `1px solid ${notice.kind === "ok" ? "#bbf7d0" : "#fecaca"}` }}>
          {notice.text}
        </div>
      )}

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

      {/* Who has how many */}
      <h2 style={{ ...sectionHeading, marginTop: 0, display: "flex", alignItems: "center", gap: "8px" }}><Users size={16} /> Inspections per reviewer</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px" }}>
        {(overview?.reviewers ?? []).map((r) => (
          <div key={r.id} data-testid="reviewer-count" style={{ background: "white", border: `1px solid ${r.id === currentUser?.id ? "#93c5fd" : "#e5e7eb"}`, borderRadius: "10px", padding: "12px 14px" }}>
            <p style={{ margin: 0, fontSize: "12px", color: "#64748b", fontWeight: 600 }}>{r.id === currentUser?.id ? `${r.name} (you)` : r.name}</p>
            <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 700, color: "#1a2a4a" }}>{r.assigned}</p>
            <p style={{ margin: 0, fontSize: "11px", color: "#94a3b8" }}>{r.open} still open</p>
          </div>
        ))}
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "10px", padding: "12px 14px" }}>
          <p style={{ margin: 0, fontSize: "12px", color: "#92400e", fontWeight: 600 }}>Unassigned</p>
          <p style={{ margin: "4px 0 0", fontSize: "22px", fontWeight: 700, color: "#92400e" }}>{overview?.unassigned ?? unassigned.length}</p>
          <p style={{ margin: 0, fontSize: "11px", color: "#b45309" }}>waiting for a reviewer</p>
        </div>
      </div>
      {overviewError && <p style={{ fontSize: "12px", color: "#b91c1c", margin: "8px 0 0" }}>{overviewError}</p>}

      {/* Hand-over requests */}
      {(myIn.length > 0 || myOut.length > 0) && (
        <>
          <h2 style={sectionHeading}>Hand-over requests</h2>
          <div style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "6px 16px" }}>
            {myIn.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: "1px solid #f1f5f9", fontSize: "13px" }}>
                <span style={{ flex: 1, color: "#374151" }}>
                  <b>{reviewerName(r.toReviewerId)}</b> would like to take over <b>{r.jobNo || "an inspection"}</b>{r.address ? ` (${r.address})` : ""}. Nothing changes unless you agree.
                </span>
                <button disabled={busyKey === r.id} onClick={() => act(r.id, () => api.respondTransfer(r.id, true), "Handed over.")} style={smallBtn("#16a34a")}>Agree</button>
                <button disabled={busyKey === r.id} onClick={() => act(r.id, () => api.respondTransfer(r.id, false), "Request declined.")} style={smallBtn("white", "#374151", "1px solid #e5e7eb")}>Decline</button>
              </div>
            ))}
            {myOut.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: "1px solid #f1f5f9", fontSize: "13px" }}>
                <span style={{ flex: 1, color: "#374151" }}>
                  You asked <b>{reviewerName(r.fromReviewerId)}</b> for <b>{r.jobNo || "an inspection"}</b>. Waiting for their answer.
                </span>
                <button disabled={busyKey === r.id} onClick={() => act(r.id, () => api.cancelTransfer(r.id), "Request withdrawn.")} style={smallBtn("white", "#374151", "1px solid #e5e7eb")}>Withdraw</button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Mine */}
      <h2 style={sectionHeading}>My Inspections</h2>
      <TableCard headers={["Job No.", "Address", "Inspector", "Date", "Type", "Status", "Action"]}>
        {inspections.length === 0 ? (
          <tr>
            <td
              colSpan={7}
              style={{ padding: "48px", textAlign: "center", color: "#94a3b8", fontSize: "14px" }}
            >
              No inspections assigned to you
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
              handOver={
                otherReviewers.length > 0 && ins.status !== "approved" ? (
                  <select
                    aria-label="Hand over to another reviewer"
                    value=""
                    disabled={busyKey === ins.id}
                    onChange={(e) => {
                      const target = otherReviewers.find((r) => r.id === e.target.value);
                      if (target && window.confirm(`Hand ${ins.jobNo || "this inspection"} over to ${target.name}? They will be emailed and you will no longer be able to edit it.`)) {
                        void act(ins.id, () => api.assignInspection(ins.id, target.id), `Handed over to ${target.name}.`);
                      }
                    }}
                    style={{ fontSize: "12px", padding: "5px 6px", borderRadius: "7px", border: "1px solid #e5e7eb", color: "#374151", marginLeft: "6px" }}
                  >
                    <option value="">Hand over…</option>
                    {otherReviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                ) : null
              }
            />
          ))
        )}
      </TableCard>

      {/* Unassigned */}
      <h2 style={sectionHeading}>Unassigned — take one to start reviewing</h2>
      <TableCard headers={["Job No.", "Address", "Inspector", "Date", "Type", "Status", "Action"]}>
        {unassigned.length === 0 ? (
          <tr><td colSpan={7} style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: "14px" }}>No unassigned inspections</td></tr>
        ) : (
          unassigned.map((ins, idx) => (
            <InspectionRow
              key={ins.id}
              inspection={ins}
              isLast={idx === unassigned.length - 1}
              inspectorName={getInspectorName(ins.inspectorId)}
              onReview={() => navigate(`/reviewer/review/${ins.id}`)}
              reviewLabel="View"
              handOver={
<>
                <button
                  disabled={busyKey === ins.id}
                  onClick={() => act(ins.id, () => api.assignInspection(ins.id), `${ins.jobNo || "Inspection"} is now assigned to you.`)}
                  style={{ ...smallBtn("#2563eb"), marginLeft: "6px" }}
                >
                  Assign to me
                </button>
                  {otherReviewers.length > 0 && (
                    <select
                      aria-label="Assign to another reviewer"
                      value=""
                      disabled={busyKey === ins.id}
                      onChange={(e) => {
                        const target = otherReviewers.find((r) => r.id === e.target.value);
                        if (target && window.confirm(`Assign ${ins.jobNo || "this inspection"} to ${target.name}? They will be emailed.`)) {
                          void act(ins.id, () => api.assignInspection(ins.id, target.id), `Assigned to ${target.name}.`);
                        }
                      }}
                      style={{ fontSize: "12px", padding: "5px 6px", borderRadius: "7px", border: "1px solid #e5e7eb", color: "#374151", marginLeft: "6px" }}
                    >
                      <option value="">Assign to…</option>
                      {otherReviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  )}
</>
              }
            />
          ))
        )}
      </TableCard>

      {/* Held by other reviewers: listed, details withheld */}
      <h2 style={sectionHeading}>Assigned to other reviewers</h2>
      <TableCard headers={["Job No.", "Address", "Assigned to", "Date", "Type", "Status", "Action"]}>
        {others.length === 0 ? (
          <tr><td colSpan={7} style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: "14px" }}>Nothing is assigned to other reviewers</td></tr>
        ) : (
          others.map((ins, idx) => {
            const sc = STATUS_CONFIG[ins.status];
            const asked = pendingFor(ins.id);
            return (
              <tr key={ins.id} style={{ borderBottom: idx === others.length - 1 ? "none" : "1px solid #f1f5f9" }}>
                <td style={{ padding: "13px 16px", fontSize: "13px" }}><span style={{ background: "#f1f5f9", borderRadius: "6px", padding: "3px 7px", fontSize: "11px", fontWeight: 700, color: "#1a2a4a", fontFamily: "monospace" }}>{ins.jobNo}</span></td>
                <td style={{ padding: "13px 16px", fontSize: "13px" }}>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "#1a2a4a", margin: 0 }}>{ins.address}</p>
                  <p style={{ fontSize: "11px", color: "#94a3b8", margin: "2px 0 0" }}>{ins.suburb}</p>
                </td>
                <td style={{ padding: "13px 16px", fontSize: "13px", fontWeight: 600, color: "#1a2a4a" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}><Lock size={12} color="#94a3b8" />{reviewerName(ins.reviewerId)}</span>
                </td>
                <td style={{ padding: "13px 16px", fontSize: "13px", color: "#374151", whiteSpace: "nowrap" }}>{formatDate(ins.date)}</td>
                <td style={{ padding: "13px 16px", fontSize: "13px" }}><span style={{ fontSize: "12px", color: "#64748b", background: "#f1f5f9", padding: "3px 10px", borderRadius: "8px" }}>{ins.type}</span></td>
                <td style={{ padding: "13px 16px", fontSize: "13px" }}><StatusBadge label={sc.label} color={sc.color} bg={sc.bg} /></td>
                <td style={{ padding: "13px 16px", fontSize: "13px", textAlign: "center" }}>
                  {asked ? (
                    <span style={{ fontSize: "12px", color: "#64748b" }}>Requested — waiting</span>
                  ) : (
                    <button
                      disabled={busyKey === ins.id}
                      onClick={() => act(ins.id, () => api.requestTransfer(ins.id), `Request sent to ${reviewerName(ins.reviewerId)}.`)}
                      style={smallBtn("white", "#1a2a4a", "1px solid #cbd5e1")}
                    >
                      Request transfer
                    </button>
                  )}
                </td>
              </tr>
            );
          })
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
  reviewLabel = "Review",
  handOver,
}: {
  inspection: Inspection;
  isLast: boolean;
  inspectorName: string;
  onReview: () => void;
  reviewLabel?: string;
  handOver?: React.ReactNode;
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
            {reviewLabel}
          </button>
        )}
        {handOver}
      </td>
    </tr>
  );
}
