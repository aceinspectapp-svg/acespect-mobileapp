import { useCallback, useEffect, useState } from "react";
import { PageShell, Card, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, Select, btnGhost, btnLink, btnPrimary, cell, sub } from "../../components/QcUi";
import { inputStyle } from "../../components/SpecForm";
import { qcx, type ReportRow } from "../../qcApi";
import { useQc } from "../../qcContext";
import { api, resolveMediaUrl } from "../../api";
import type { QcProjectRow } from "../../qcTypes";

const kb = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function QcReports() {
  const { can } = useQc();
  const [projects, setProjects] = useState<QcProjectRow[]>([]);
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { api.qc.projects.list().then(setProjects).catch(() => undefined); }, []);
  const load = useCallback(() => qcx.reports.list().then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<Record<string, unknown>>) {
    setBusy(key); setError(null); setNotice(null);
    try {
      const r = await fn();
      setNotice(`Generated ${String(r.fileName)}. Download it below.`);
      load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function download(id: string) {
    try {
      const link = await qcx.reports.link(id);
      window.open(resolveMediaUrl(link.url), "_blank", "noopener");
    } catch (e) { setError((e as Error).message); }
  }
  const filters = { projectId: projectId || undefined, from: from || undefined, to: to || undefined };

  return (
    <PageShell title="Reports" subtitle="Reports are generated once, stored, and opened through a link that works for 15 minutes. Each download is logged.">
      <Card style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
          <Field label="Project"><Select value={projectId} onChange={setProjectId} placeholder="All my projects" options={projects.map((p) => ({ id: p.id, label: p.name }))} /></Field>
          <Field label="From"><input type="date" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {can("reports.openItems") && <>
            <button style={btnPrimary} disabled={!!busy} onClick={() => run("oi-pdf", () => qcx.reports.openItems(filters, "pdf"))}>{busy === "oi-pdf" ? "Working…" : "Open Items Register (PDF)"}</button>
            <button style={btnGhost} disabled={!!busy} onClick={() => run("oi-xlsx", () => qcx.reports.openItems(filters, "xlsx"))}>{busy === "oi-xlsx" ? "Working…" : "Open Items Register (Excel)"}</button>
          </>}
          {can("reports.dlpEscalation") && <>
            <button style={btnGhost} disabled={!!busy} onClick={() => run("esc-pdf", () => qcx.reports.escalations(filters, "pdf"))}>Escalation log (PDF)</button>
            <button style={btnGhost} disabled={!!busy} onClick={() => run("esc-xlsx", () => qcx.reports.escalations(filters, "xlsx"))}>Escalation log (Excel)</button>
            <button style={btnGhost} disabled={!!busy || !projectId} title={projectId ? "" : "Choose a project"} onClick={() => run("dlp", () => qcx.reports.dlp(projectId))}>DLP close-out report</button>
          </>}
          {can("reports.portfolio") && <button style={btnGhost} disabled={!!busy} onClick={() => run("pf", () => qcx.reports.portfolio())}>Portfolio (Excel)</button>}
        </div>
        <p style={{ ...sub, margin: "10px 0 0" }}>Stage inspection reports are produced from each completed inspection; evidence packs from each defect.</p>
      </Card>
      <ErrorNote message={error} />
      {notice && <p role="status" style={{ fontSize: 13, color: "#15803d" }}>{notice}</p>}
      <TableCard headers={["Report", "Format", "Generated", "Size", "SHA-256", "Downloads", ""]}>
        {rows?.map((r) => (
          <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
            <td style={cell}><b>{r.report_type}</b><div style={sub}>{r.fileName}</div></td>
            <td style={cell}>{r.format}</td>
            <td style={cell}>{new Date(r.generatedAt).toLocaleString("en-AU")}</td>
            <td style={cell}>{kb(r.fileSize)}</td>
            <td style={{ ...cell, fontFamily: "monospace", fontSize: 11 }} title={r.fileHash}>{r.fileHash.slice(0, 12)}…</td>
            <td style={cell}>{r.downloadCount}</td>
            <td style={{ ...cell, textAlign: "right" }}><button style={btnLink} onClick={() => download(r.id)}>Download</button></td>
          </tr>
        ))}
        {rows?.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No reports generated yet.</td></tr>}
      </TableCard>
    </PageShell>
  );
}
