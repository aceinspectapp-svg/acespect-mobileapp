import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { RefreshCw, Search, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../api";
import type { SubmissionLogEntry } from "../../api";
import { PageShell, TableCard, StatusBadge, GhostBtn } from "../../components/WebLayout";

const EVENT_META: Record<SubmissionLogEntry["event"], { label: string; color: string; bg: string }> = {
  received: { label: "Received", color: "#2563eb", bg: "#eff6ff" },
  saved: { label: "Saved", color: "#16a34a", bg: "#f0fdf4" },
  updated: { label: "Updated", color: "#0891b2", bg: "#ecfeff" },
  finalized: { label: "Finalized", color: "#7c3aed", bg: "#faf5ff" },
  photo_uploaded: { label: "Photo Uploaded", color: "#ca8a04", bg: "#fefce8" },
  rejected: { label: "Rejected", color: "#dc2626", bg: "#fef2f2" },
};

const EVENT_OPTIONS: { key: string; label: string }[] = [
  { key: "", label: "All events" },
  { key: "received", label: "Received" },
  { key: "saved", label: "Saved" },
  { key: "updated", label: "Updated" },
  { key: "finalized", label: "Finalized" },
  { key: "photo_uploaded", label: "Photo Uploaded" },
  { key: "rejected", label: "Rejected" },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Admin-only troubleshooting view of acespect-backend's SubmissionLogEntry
 * trail -- the same "did this inspector's job actually arrive, and if not,
 * why" question that previously meant tunneling into production Postgres or
 * grepping `railway logs` by hand. A "rejected" row with a jobNo and field
 * error detail is the single most useful thing this page can show: it's
 * exactly the case that used to fail completely invisibly (see
 * errorHandler.ts's [reject] logging).
 */
export function AdminSubmissionLogs() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<SubmissionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState("");
  const [jobNo, setJobNo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .getSubmissionLogs({ event: event || undefined, jobNo: jobNo || undefined })
      .then(setLogs)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load logs"))
      .finally(() => setLoading(false));
  };

  // Re-fetches when the event filter changes; jobNo is search-on-demand
  // (Enter or the Search button) rather than on every keystroke.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);

  const rejectedCount = useMemo(() => logs.filter((l) => l.event === "rejected").length, [logs]);

  return (
    <PageShell
      title="Submission Troubleshooting"
      subtitle="Trace of the mobile app's submit / update / finalize / photo pipeline reaching -- or failing to reach -- the database"
      actions={
        <GhostBtn onClick={load}>
          <RefreshCw size={13} /> Refresh
        </GhostBtn>
      }
    >
      <div style={{ display: "flex", gap: "10px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
        <select value={event} onChange={(e) => setEvent(e.target.value)} style={selectStyle}>
          {EVENT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: "280px" }}>
          <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
          <input
            value={jobNo}
            onChange={(e) => setJobNo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") load();
            }}
            placeholder="Search job number…"
            style={{ ...inputStyle, paddingLeft: "30px" }}
          />
        </div>
        <GhostBtn onClick={load}>Search</GhostBtn>
        {rejectedCount > 0 && (
          <span style={{ marginLeft: "auto", fontSize: "12px", color: "#dc2626", fontWeight: 600 }}>
            {rejectedCount} rejected in this view
          </span>
        )}
      </div>

      {error && (
        <div
          style={{
            padding: "12px 16px",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "10px",
            color: "#dc2626",
            fontSize: "13px",
            marginBottom: "16px",
          }}
        >
          {error}
        </div>
      )}

      <TableCard headers={["Time", "Event", "Job No", "Inspector", "Status", "Message", ""]}>
        {loading ? (
          <tr>
            <td colSpan={7} style={emptyCellStyle}>
              Loading…
            </td>
          </tr>
        ) : logs.length === 0 ? (
          <tr>
            <td colSpan={7} style={emptyCellStyle}>
              No submission activity yet.
            </td>
          </tr>
        ) : (
          logs.map((log) => {
            const meta = EVENT_META[log.event];
            const isOpen = expandedId === log.id;
            return (
              <Fragment key={log.id}>
                <tr
                  style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                  onClick={() => setExpandedId(isOpen ? null : log.id)}
                >
                  <td style={cellStyle}>{formatTime(log.createdAt)}</td>
                  <td style={cellStyle}>
                    <StatusBadge label={meta.label} color={meta.color} bg={meta.bg} />
                  </td>
                  <td style={cellStyle}>{log.jobNo ?? "—"}</td>
                  <td style={cellStyle}>{log.inspector?.name ?? log.inspector?.email ?? "—"}</td>
                  <td style={cellStyle}>{log.statusCode ?? "—"}</td>
                  <td style={{ ...cellStyle, maxWidth: "260px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {log.message ?? "—"}
                  </td>
                  <td style={cellStyle}>{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} style={{ padding: "12px 16px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                        <pre style={{ margin: 0, fontSize: "11px", color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
                          {JSON.stringify(log.detail ?? {}, null, 2)}
                        </pre>
                        {log.inspectionId && (
                          <GhostBtn onClick={() => navigate(`/admin/inspections/${log.inspectionId}`)}>Open Inspection</GhostBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })
        )}
      </TableCard>
    </PageShell>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: "8px",
  border: "1px solid #e5e7eb",
  fontSize: "13px",
  color: "#374151",
  background: "white",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: "8px",
  border: "1px solid #e5e7eb",
  fontSize: "13px",
  color: "#374151",
  background: "white",
  boxSizing: "border-box",
};
const cellStyle: React.CSSProperties = {
  padding: "10px 16px",
  fontSize: "13px",
  color: "#374151",
};
const emptyCellStyle: React.CSSProperties = {
  padding: "24px",
  textAlign: "center",
  color: "#94a3b8",
  fontSize: "13px",
};
