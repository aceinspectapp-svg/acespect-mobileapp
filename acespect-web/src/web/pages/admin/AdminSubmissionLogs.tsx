import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { RefreshCw, Search, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../../api";
import type { SubmissionHealth, SubmissionLogEntry } from "../../api";
import { PageShell, TableCard, StatusBadge, GhostBtn } from "../../components/WebLayout";

const EVENT_META: Record<SubmissionLogEntry["event"], { label: string; color: string; bg: string }> = {
  received: { label: "Received", color: "#2563eb", bg: "#eff6ff" },
  saved: { label: "Saved", color: "#16a34a", bg: "#f0fdf4" },
  updated: { label: "Updated", color: "#0891b2", bg: "#ecfeff" },
  finalized: { label: "Finalized", color: "#7c3aed", bg: "#faf5ff" },
  photo_uploaded: { label: "Photo Uploaded", color: "#ca8a04", bg: "#fefce8" },
  rejected: { label: "Rejected", color: "#dc2626", bg: "#fef2f2" },
  failed: { label: "Server error", color: "#b91c1c", bg: "#fee2e2" },
  warning: { label: "Warning", color: "#b45309", bg: "#fffbeb" },
};

const EVENT_OPTIONS: { key: string; label: string }[] = [
  { key: "", label: "All events" },
  { key: "received", label: "Received" },
  { key: "saved", label: "Saved" },
  { key: "updated", label: "Updated" },
  { key: "finalized", label: "Finalized" },
  { key: "photo_uploaded", label: "Photo Uploaded" },
  { key: "rejected", label: "Rejected" },
  { key: "failed", label: "Server error" },
  { key: "warning", label: "Warning" },
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

/** Is email set up on the server? Alerts about failed or incomplete submissions are sent by email, so this shows the state and lets an admin send a test. */
function MailPanel() {
  const [st, setSt] = useState<{ configured: boolean; from: string; host: string | null; recipients: string[]; customRecipients: boolean } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.getMailStatus().then(setSt).catch(() => undefined); }, []);
  if (!st) return null;
  return (
    <div style={{ ...card, borderColor: st.configured ? "#bbf7d0" : "#fecaca", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: "240px", fontSize: "12px", color: "#374151" }}>
        <strong style={{ color: st.configured ? "#15803d" : "#b91c1c" }}>Email alerts: {st.configured ? "set up" : "NOT set up"}</strong>
        {st.configured
          ? ` — sent from ${st.from} through ${st.host}.`
          : " — alerts are recorded here but nobody is emailed. Set SMTP_URL (and MAIL_FROM) on the server."}
        <div style={{ marginTop: "3px", color: "#64748b" }}>
          Alerts go to: {st.recipients.length ? st.recipients.join(", ") : "nobody (no active admin accounts)"}{st.customRecipients ? "" : " (the admin accounts' own email addresses; set ALERT_EMAILS on the server to use others)"}.
        </div>
      </div>
      {msg && <span style={{ fontSize: "12px", color: msg.ok ? "#15803d" : "#b91c1c", maxWidth: "420px" }}>{msg.text}</span>}
      <GhostBtn
        onClick={async () => {
          setBusy(true); setMsg(null);
          try {
            const r = await api.sendTestMail();
            setMsg(r.result === "SENT" ? { ok: true, text: `Test email sent to ${r.to}. Check that inbox (and spam).` } : { ok: false, text: r.error ?? (r.result === "SKIPPED" ? "Email is not set up on the server." : "Sending failed.") });
          } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not send" }); }
          setBusy(false);
        }}
      >
        {busy ? "Sending…" : "Send test email"}
      </GhostBtn>
    </div>
  );
}

/** What looks wrong right now: submissions that came in incomplete, Egnyte folders that need a look, and photos whose inspection never arrived. */
function HealthPanel() {
  const [health, setHealth] = useState<SubmissionHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const navigate = useNavigate();
  useEffect(() => { api.getSubmissionHealth().then(setHealth).catch((e) => setErr(e instanceof Error ? e.message : "Could not load")); }, []);
  if (err) return <div style={{ ...card, color: "#dc2626" }}>Could not load submission health: {err}</div>;
  if (!health) return null;
  const clean = health.flagged.length === 0 && health.orphanUploads.length === 0;
  return (
    <div style={{ ...card, borderColor: clean ? "#bbf7d0" : "#fde68a" }}>
      <div style={{ fontWeight: 700, fontSize: "13px", color: "#1a2a4a", marginBottom: "6px" }}>
        Needs attention {clean ? "— nothing right now" : `— ${health.flagged.length} inspection${health.flagged.length === 1 ? "" : "s"}, ${health.orphanUploads.length} upload${health.orphanUploads.length === 1 ? "" : "s"} without an inspection`}
      </div>
      {health.flagged.map((f) => (
        <div key={f.id} style={{ display: "flex", gap: "10px", padding: "6px 0", borderTop: "1px solid #f1f5f9", fontSize: "12px", alignItems: "baseline" }}>
          <button onClick={() => navigate(`/admin/inspections/${f.id}`)} style={{ ...linkBtn, minWidth: "96px" }}>{f.jobNo || f.id.slice(0, 8)}</button>
          <span style={{ color: "#94a3b8", minWidth: "120px" }}>{formatTime(f.createdAt)} · {f.inspector}</span>
          <span style={{ flex: 1, color: "#374151" }}>{f.reasons.join(" ")}</span>
        </div>
      ))}
      {health.orphanUploads.length > 0 && (
        <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#92400e", marginBottom: "4px" }}>
            Photos uploaded to Egnyte whose inspection never arrived (the phone uploaded them, but the submission did not land — the full inspection may still be waiting in that phone's sync queue):
          </div>
          {health.orphanUploads.map((o) => (
            <div key={o.draftId} style={{ display: "flex", gap: "10px", fontSize: "12px", padding: "3px 0", color: "#374151" }}>
              <code style={{ minWidth: "96px" }}>{o.draftId.slice(0, 8)}…</code>
              <span style={{ minWidth: "120px", color: "#94a3b8" }}>{formatTime(o.lastAt)}</span>
              <span>{o.photos} photo{o.photos === 1 ? "" : "s"} · {o.sections.join(", ")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = { background: "white", border: "1px solid #e5e7eb", borderRadius: "10px", padding: "12px 16px", marginBottom: "16px" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: 0, color: "#2563eb", fontWeight: 600, cursor: "pointer", textAlign: "left", fontSize: "12px" };

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
      <MailPanel />
      <HealthPanel />
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
