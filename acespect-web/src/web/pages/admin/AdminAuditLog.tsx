import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ChevronDown, ChevronUp, Download, RefreshCw, ShieldCheck } from "lucide-react";
import { PageShell, TableCard, GhostBtn } from "../../components/WebLayout";
import { AuditDetail, CategoryPill, OutcomePill, VerifyBanner } from "../../components/AuditParts";
import { auditApi, dotColor, downloadAuditFile, labelOf, when, type AuditEvent, type AuditFilters, type AuditHealth, type VerifyResult } from "../../auditApi";

const PRESETS: { label: string; filters: AuditFilters }[] = [
  { label: "Everything", filters: {} },
  { label: "Problems", filters: { severity: "warning,error", outcome: "failure,denied" } },
  { label: "Phone incidents", filters: { source: "mobile", severity: "notice,warning,error" } },
  { label: "Approvals & edits", filters: { action: "section.*,damage.*,inspection.*", category: "web" } },
  { label: "Downloads", filters: { action: "report.download,photos.download,audit.export,audit.report" } },
  { label: "Sign-ins & security", filters: { category: "security" } },
  { label: "Admin changes", filters: { category: "admin" } },
];

export function AdminAuditLog() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [preset, setPreset] = useState(0);
  const [rows, setRows] = useState<AuditEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [health, setHealth] = useState<AuditHealth | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [facets, setFacets] = useState<Awaited<ReturnType<typeof auditApi.facets>> | null>(null);
  const [mask, setMask] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [typed, setTyped] = useState({ q: "", jobNo: "", ip: "" });

  const key = JSON.stringify(filters);
  const load = useCallback(
    (more: boolean) => {
      setLoading(true);
      setError(null);
      auditApi
        .events(filters, more ? cursor : null, 100)
        .then((r) => {
          setRows((prev) => (more ? [...prev, ...r.events] : r.events));
          setCursor(r.nextCursor);
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, cursor],
  );
  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  useEffect(() => { auditApi.health().then(setHealth).catch(() => undefined); auditApi.facets().then(setFacets).catch(() => undefined); }, []);

  // free-text boxes apply a moment after typing stops
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, q: typed.q || undefined, jobNo: typed.jobNo || undefined, ip: typed.ip || undefined })), 450);
    return () => clearTimeout(t);
  }, [typed]);

  const set = (patch: AuditFilters) => { setPreset(-1); setFilters((f) => ({ ...f, ...patch })); };
  const choose = (i: number) => { setPreset(i); setTyped({ q: "", jobNo: "", ip: "" }); setFilters({ ...PRESETS[i]!.filters }); };

  async function runVerify() {
    setVerifying(true);
    try { setVerify(await auditApi.verify()); } catch (e) { setError(e instanceof Error ? e.message : "Check failed"); } finally { setVerifying(false); }
  }
  const params = useMemo(() => new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString(), [filters]);
  async function download(path: string, name: string, label: string) {
    setBusy(label);
    try { await downloadAuditFile(path, name); } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); } finally { setBusy(null); }
  }
  const range = `from=${filters.from ?? ""}&to=${filters.to ?? ""}${mask ? "&mask=1" : ""}`;

  const field = { padding: "8px 10px", borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px", color: "#374151", background: "white", boxSizing: "border-box" as const };
  const stat = (title: string, value: string, sub?: string, bad = false) => (
    <div style={{ background: "white", border: `1px solid ${bad ? "#fecaca" : "#e5e7eb"}`, borderRadius: "10px", padding: "10px 14px", minWidth: "150px" }}>
      <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</div>
      <div style={{ fontSize: "20px", fontWeight: 700, color: bad ? "#b91c1c" : "#1a2a4a" }}>{value}</div>
      {sub && <div style={{ fontSize: "11px", color: "#64748b" }}>{sub}</div>}
    </div>
  );

  return (
    <PageShell
      title="Audit log"
      subtitle="Everything that happens to an inspection and to the system — on the phone, in the portal and on the server. Entries are never edited or deleted."
      actions={<GhostBtn onClick={() => load(false)}><RefreshCw size={13} style={{ verticalAlign: "-2px", marginRight: "6px" }} />Refresh</GhostBtn>}
    >
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "14px" }}>
        {stat("Entries (24 h)", health ? health.eventsLast24h.toLocaleString() : "…", health ? `${health.totalEvents.toLocaleString()} in total` : undefined)}
        {stat("Problems (24 h)", health ? String(health.problemsLast24h) : "…", "failed or refused", !!health && health.problemsLast24h > 0)}
        {stat("Last entry", health?.lastEventAt ? when(health.lastEventAt, false) : "—")}
        {stat("Last seal", health?.lastAnchor ? when(health.lastAnchor.at, false) : "none yet", health?.lastAnchor ? `${health.lastAnchor.events.toLocaleString()} entries sealed` : "sealed hourly")}
        {stat("Write failures", health ? String(health.writer.failed) : "…", health?.writer.lastError ?? "none since the server started", !!health && health.writer.failed > 0)}
        {stat("Kept for", health ? `${Math.round(health.retentionDays / 365)} years` : "…", "then removed automatically")}
        <div style={{ display: "flex", alignItems: "center" }}>
          <button onClick={runVerify} disabled={verifying} style={{ ...field, display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 600, cursor: "pointer" }}>
            <ShieldCheck size={15} /> {verifying ? "Checking…" : "Verify integrity"}
          </button>
        </div>
      </div>
      {verify && <div style={{ marginBottom: "14px" }}><VerifyBanner result={verify} scope="the audit log" /></div>}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
        {PRESETS.map((p, i) => (
          <button key={p.label} onClick={() => choose(i)} style={{ padding: "6px 13px", borderRadius: "20px", border: `1px solid ${preset === i ? "#1a2a4a" : "#e5e7eb"}`, background: preset === i ? "#1a2a4a" : "white", color: preset === i ? "white" : "#475569", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>{p.label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: "8px", marginBottom: "12px" }}>
        <input type="date" aria-label="From" style={field} value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
        <input type="date" aria-label="To" style={field} value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
        <select aria-label="Source" style={field} value={filters.source ?? ""} onChange={(e) => set({ source: e.target.value || undefined })}>
          <option value="">Phone, portal, server</option><option value="mobile">Phone</option><option value="web">Portal</option><option value="api">API</option><option value="system">Server</option>
        </select>
        <select aria-label="Category" style={field} value={filters.category ?? ""} onChange={(e) => set({ category: e.target.value || undefined })}>
          <option value="">All categories</option>
          {(facets?.categories ?? []).map((c) => <option key={c.value} value={c.value}>{c.value} ({c.count})</option>)}
        </select>
        <select aria-label="Outcome" style={field} value={filters.outcome ?? ""} onChange={(e) => set({ outcome: e.target.value || undefined })}>
          <option value="">Any outcome</option><option value="success">OK</option><option value="failure">Failed</option><option value="denied">Refused</option>
        </select>
        <select aria-label="Action" style={field} value={filters.action ?? ""} onChange={(e) => set({ action: e.target.value || undefined })}>
          <option value="">Any action</option>
          {(facets?.actions ?? []).map((a) => <option key={a.value} value={a.value}>{a.value} ({a.count})</option>)}
        </select>
        <select aria-label="Person" style={field} value={filters.actorId ?? ""} onChange={(e) => set({ actorId: e.target.value || undefined })}>
          <option value="">Anyone</option>
          {(facets?.actors ?? []).filter((a) => a.id).map((a) => <option key={a.id!} value={a.id!}>{a.name ?? a.id} ({a.count})</option>)}
        </select>
        <select aria-label="App version" style={field} value={filters.appVersion ?? ""} onChange={(e) => set({ appVersion: e.target.value || undefined })}>
          <option value="">Any app version</option>
          {(facets?.appVersions ?? []).filter((v) => v.value).map((v) => <option key={v.value!} value={v.value!}>{v.value} ({v.count})</option>)}
        </select>
        <input placeholder="Job number" style={field} value={typed.jobNo} onChange={(e) => setTyped({ ...typed, jobNo: e.target.value })} />
        <input placeholder="IP address" style={field} value={typed.ip} onChange={(e) => setTyped({ ...typed, ip: e.target.value })} />
        <input placeholder="Search text" style={{ ...field, gridColumn: "span 2" }} value={typed.q} onChange={(e) => setTyped({ ...typed, q: e.target.value })} />
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        <button style={{ ...field, cursor: "pointer", display: "inline-flex", gap: "6px", alignItems: "center" }} disabled={busy !== null} onClick={() => download(`/audit/export?format=csv&${params}${mask ? "&mask=1" : ""}`, "audit-log.csv", "csv")}><Download size={14} /> {busy === "csv" ? "Preparing…" : "Export these entries (CSV)"}</button>
        <button style={{ ...field, cursor: "pointer", display: "inline-flex", gap: "6px", alignItems: "center" }} disabled={busy !== null} onClick={() => download(`/audit/reports/activity?format=pdf&${range}`, "audit-activity-report.pdf", "act")}><Download size={14} /> {busy === "act" ? "Preparing…" : "Activity report (PDF)"}</button>
        <button style={{ ...field, cursor: "pointer", display: "inline-flex", gap: "6px", alignItems: "center" }} disabled={busy !== null} onClick={() => download(`/audit/reports/incidents?format=pdf&${range}`, "audit-incident-report.pdf", "inc")}><Download size={14} /> {busy === "inc" ? "Preparing…" : "Incident report (PDF)"}</button>
        <button style={{ ...field, cursor: "pointer", display: "inline-flex", gap: "6px", alignItems: "center" }} disabled={busy !== null} onClick={() => download(`/audit/reports/security?format=pdf&${range}`, "audit-security-report.pdf", "sec")}><Download size={14} /> {busy === "sec" ? "Preparing…" : "Security & access report (PDF)"}</button>
        <label style={{ fontSize: "12px", color: "#475569", display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <input type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} /> Mask IP addresses and device details in exports
        </label>
      </div>
      {error && <p role="alert" style={{ color: "#b91c1c", fontSize: "13px" }}>{error}</p>}

      <TableCard headers={["", "When", "What happened", "Who", "From", "Job", "Result", ""]}>
        {rows.map((e) => {
          const isOpen = open === e.id;
          return (
            <Fragment key={e.id}>
              <tr style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : e.id)}>
                <td style={{ padding: "10px 0 10px 14px", width: "14px" }}><span style={{ display: "inline-block", width: "9px", height: "9px", borderRadius: "50%", background: dotColor(e) }} /></td>
                <td style={{ padding: "10px 12px", fontSize: "12px", color: "#475569", whiteSpace: "nowrap" }}>{when(e.occurredAt)}</td>
                <td style={{ padding: "10px 12px", fontSize: "13px", color: "#1a2a4a", maxWidth: "420px" }}>
                  <strong>{labelOf(e)}</strong>
                  {e.message && <div style={{ fontSize: "12px", color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.message}</div>}
                </td>
                <td style={{ padding: "10px 12px", fontSize: "12px", color: "#374151" }}>{e.actor.name ?? "System"}<div style={{ color: "#94a3b8" }}>{e.actor.role?.toLowerCase() ?? ""}</div></td>
                <td style={{ padding: "10px 12px", fontSize: "12px" }}><CategoryPill category={e.category} /><div style={{ color: "#94a3b8", marginTop: "2px" }}>{[e.client.version && `v${e.client.version}`, e.client.device].filter(Boolean).join(" · ")}</div></td>
                <td style={{ padding: "10px 12px", fontSize: "12px" }}>{e.jobNo ?? "—"}</td>
                <td style={{ padding: "10px 12px" }}><OutcomePill outcome={e.outcome} /></td>
                <td style={{ padding: "10px 12px" }}>{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={8} style={{ padding: "14px 18px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                    <AuditDetail e={e} />
                    {e.inspectionId && (
                      <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                        <GhostBtn onClick={() => navigate(`/admin/inspections/${e.inspectionId}`)}>Open inspection</GhostBtn>
                        <GhostBtn onClick={() => { setPreset(-1); setFilters({ inspectionId: e.inspectionId! }); }}>Show only this inspection's history</GhostBtn>
                        {e.correlationId && <GhostBtn onClick={() => { setPreset(-1); setFilters({ correlationId: e.correlationId! }); }}>Show the whole story (same submit)</GhostBtn>}
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
        {!loading && rows.length === 0 && <tr><td colSpan={8} style={{ padding: "26px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>No entries match.</td></tr>}
        {loading && <tr><td colSpan={8} style={{ padding: "18px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>Loading…</td></tr>}
      </TableCard>
      {cursor && !loading && (
        <div style={{ textAlign: "center", marginTop: "14px" }}><GhostBtn onClick={() => load(true)}>Load older entries</GhostBtn></div>
      )}
    </PageShell>
  );
}
