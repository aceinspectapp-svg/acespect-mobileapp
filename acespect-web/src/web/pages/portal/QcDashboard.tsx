import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PageShell, StatCard, Card, TableCard } from "../../components/WebLayout";
import { ErrorNote, Select, cell, sub } from "../../components/QcUi";
import { qcx } from "../../qcApi";
import { useQc } from "../../qcContext";
import { api } from "../../api";
import type { QcProjectRow } from "../../qcTypes";

type Row = { name: string; count: number };

/** A bar with its number beside it, so the value never depends on colour alone. */
function Bars({ rows, color = "#2563eb" }: { rows: Row[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <p style={{ ...sub, margin: 0 }}>Nothing to show.</p>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {rows.slice(0, 8).map((r) => (
        <div key={r.name} style={{ display: "grid", gridTemplateColumns: "150px 1fr 36px", gap: 8, alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</span>
          <div style={{ background: "#f1f5f9", borderRadius: 4, height: 10 }}><div style={{ width: `${(r.count / max) * 100}%`, height: 10, borderRadius: 4, background: color }} /></div>
          <b style={{ color: "#1a2a4a", textAlign: "right" }}>{r.count}</b>
        </div>
      ))}
    </div>
  );
}

export function QcDashboard() {
  const { me, can } = useQc();
  const [data, setData] = useState<any | null>(null);
  const [projects, setProjects] = useState<QcProjectRow[]>([]);
  const [projectId, setProjectId] = useState("");
  const [portfolio, setPortfolio] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.qc.projects.list().then(setProjects).catch(() => undefined); }, []);
  useEffect(() => {
    setData(null);
    qcx.dashboard({ projectId }).then(setData).catch((e) => setError(e.message));
  }, [projectId]);
  useEffect(() => { if (can("reports.portfolio")) qcx.portfolio().then(setPortfolio).catch(() => undefined); }, [can]);

  const t = data?.totals;
  return (
    <PageShell title="Dashboard" subtitle={me?.isSA ? "The client you are working in" : "Defects and inspections across the projects you can see"}>
      <div style={{ width: 300, marginBottom: 16 }}><Select value={projectId} onChange={setProjectId} placeholder="All my projects" options={projects.map((p) => ({ id: p.id, label: p.name }))} /></div>
      <ErrorNote message={error} />
      {!data && !error && <p style={sub}>Loading…</p>}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 20 }}>
            <StatCard label="Open defects" value={t.open} color="#2563eb" />
            <StatCard label="Overdue" value={t.overdue} color="#d97706" sub={t.overdue ? "Past a service-level target" : undefined} />
            <StatCard label="Escalated" value={t.escalated} color="#ea580c" />
            <StatCard label="Urgent concerns" value={t.urgent} color="#dc2626" />
            <StatCard label="Open in the DLP" value={t.dlpOpen} color="#7c3aed" />
            <StatCard label="Closed" value={t.closed} color="#16a34a" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
            <Card style={{ padding: 16 }}><h2 style={h2}>Open defects by severity</h2><Bars rows={data.bySeverity} color="#dc2626" /></Card>
            <Card style={{ padding: 16 }}><h2 style={h2}>All defects by status</h2><Bars rows={data.byStatus} /></Card>
            <Card style={{ padding: 16 }}><h2 style={h2}>Open defects by trade</h2><Bars rows={data.byTrade} color="#0891b2" /></Card>
            <Card style={{ padding: 16 }}><h2 style={h2}>Open defects by builder</h2><Bars rows={data.byBuilder} color="#7c3aed" /></Card>
            <Card style={{ padding: 16 }}><h2 style={h2}>How long open defects have been open</h2><Bars rows={data.aging} color="#d97706" /></Card>
            <Card style={{ padding: 16 }}>
              <h2 style={h2}>Inspections</h2>
              <Bars rows={data.inspections.byStatus.map((s: Row) => ({ name: s.name.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), count: s.count }))} color="#16a34a" />
              <p style={{ ...sub, margin: "10px 0 0" }}>{data.inspections.upcoming14Days} planned in the next 14 days · {data.inspections.awaitingPlanning} requested and waiting to be planned</p>
            </Card>
          </div>
          <Card style={{ padding: 16, marginTop: 16 }}>
            <h2 style={h2}>Raised and closed by month</h2>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead><tr style={{ color: "#94a3b8", textAlign: "left" }}><th style={{ padding: 6 }}>Month</th><th style={{ padding: 6 }}>Raised</th><th style={{ padding: 6 }}>Closed</th></tr></thead>
              <tbody>{data.trend.map((m: { month: string; raised: number; closed: number }) => <tr key={m.month} style={{ borderTop: "1px solid #f1f5f9" }}><td style={{ padding: 6 }}>{m.month}</td><td style={{ padding: 6 }}>{m.raised}</td><td style={{ padding: 6 }}>{m.closed}</td></tr>)}</tbody>
            </table>
            {data.trend.length === 0 && <p style={sub}>No defects yet.</p>}
          </Card>
        </>
      )}
      {portfolio && portfolio.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ ...h2, fontSize: 15 }}>Portfolio</h2>
          <TableCard headers={["Project", "Status", "Builder", "Lots", "Open", "Overdue", "Escalated", "Safety open", "Avg days to close", "DLP ends"]}>
            {portfolio.map((p) => (
              <tr key={p.projectId} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={cell}><Link to={`/qc/projects/${p.projectId}`} style={{ color: "#1a2a4a", fontWeight: 700, textDecoration: "none" }}>{p.name}</Link></td>
                <td style={cell}>{String(p.status).replace(/_/g, " ").toLowerCase()}</td><td style={cell}>{p.builder ?? "—"}</td><td style={cell}>{p.lots}</td>
                <td style={cell}>{p.defects.open}</td><td style={cell}>{p.defects.overdue}</td><td style={cell}>{p.defects.escalated}</td><td style={cell}>{p.defects.safetyOpen}</td>
                <td style={cell}>{p.defects.avgDaysToClose ?? "—"}</td><td style={cell}>{p.dlpEnd ? new Date(p.dlpEnd).toLocaleDateString("en-AU") : "—"}</td>
              </tr>
            ))}
          </TableCard>
        </div>
      )}
    </PageShell>
  );
}
const h2: React.CSSProperties = { fontSize: 13, color: "#1a2a4a", margin: "0 0 12px" };
