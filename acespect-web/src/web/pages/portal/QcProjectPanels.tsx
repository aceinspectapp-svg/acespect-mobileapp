import { useCallback, useEffect, useState } from "react";
import { Card, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, FormDialog, Modal, Select, btnGhost, btnLink, btnPrimary, cell, sub } from "../../components/QcUi";
import { inputStyle } from "../../components/SpecForm";
import { qcx, type PlanStage, type StageDef, type TemplateRow } from "../../qcApi";
import { useQc } from "../../qcContext";
import { api, resolveMediaUrl } from "../../api";
import type { QcLotRow, QcProjectRow } from "../../qcTypes";

const fmt = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }) : "—");

// ─── Inspection plan (E12) ───────────────────────────────────────────────────

export function PlanPanel({ project }: { project: QcProjectRow }) {
  const { can } = useQc();
  const [plan, setPlan] = useState<PlanStage[] | null>(null);
  const [stages, setStages] = useState<StageDef[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [inspectors, setInspectors] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const editable = can("projects.create");
  const load = useCallback(() => qcx.projects.plan(project.id).then(setPlan).catch((e) => setError(e.message)), [project.id]);
  useEffect(() => {
    load();
    qcx.stages.list().then(setStages).catch(() => undefined);
    qcx.templates.list({ status: "PUBLISHED" }).then(setTemplates).catch(() => undefined);
    qcx.people.inspectors().then(setInspectors).catch(() => undefined);
  }, [load]);
  const patch = async (row: PlanStage, body: Record<string, unknown>) => { try { setError(null); setPlan(await qcx.projects.updateStage(project.id, row.id, body)); } catch (e) { setError((e as Error).message); } };
  if (!plan) return <><ErrorNote message={error} /><p style={sub}>Loading…</p></>;
  if (plan.length === 0) {
    return (
      <Card style={{ padding: 20 }}>
        <p style={{ fontSize: 13, color: "#475569", marginTop: 0 }}>This project has no inspection plan yet. Create one from the standard stages, then choose the checklist template for each.</p>
        <ErrorNote message={error} />
        {editable && <button style={btnPrimary} onClick={() => qcx.projects.seedPlan(project.id).then(setPlan).catch((e) => setError(e.message))}>Create the plan from the standard stages</button>}
      </Card>
    );
  }
  const tplFor = (stageId: string) => templates.filter((t) => t.stageKey === stageId && (t.level === "BASE" || t.clientId === project.clientId) && (t.level !== "PROJECT" || t.projectId === project.id));
  return (
    <>
      <ErrorNote message={error} />
      <p style={{ ...sub, marginTop: 0 }}>Statutory notification stages cannot be switched off. A hold point stops the next stage on a lot until this one is complete and clear of Major and Safety Hazard defects.</p>
      <TableCard headers={["Stage", "On", "Checklist template", "Notice (days)", "Hold point", "Default inspector"]}>
        {plan.map((p) => (
          <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", opacity: p.enabled ? 1 : 0.55 }}>
            <td style={cell}><b>{p.stageNumber}. {p.stageName}</b>{p.mandatoryNotification && <div style={{ ...sub, color: "#92400e" }}>Mandatory notification stage</div>}</td>
            <td style={cell}><input type="checkbox" aria-label={`${p.stageName} enabled`} disabled={!editable || p.mandatoryNotification} checked={p.enabled} onChange={(e) => patch(p, { enabled: e.target.checked })} /></td>
            <td style={cell}>
              <Select value={p.templateId ?? ""} disabled={!editable} onChange={(v) => v && patch(p, { templateId: v })} placeholder="No template yet" options={tplFor(p.stageId).map((t) => ({ id: t.id, label: `${t.name} v${t.versionLabel}${t.level === "BASE" ? "" : ` (${t.level.toLowerCase()})`}` }))} />
            </td>
            <td style={cell}><input type="number" min={0} max={30} aria-label={`${p.stageName} notice days`} style={{ ...inputStyle, width: 70 }} disabled={!editable} defaultValue={p.noticeDays ?? ""} onBlur={(e) => e.target.value !== String(p.noticeDays ?? "") && patch(p, { noticeDays: e.target.value === "" ? null : Number(e.target.value) })} /></td>
            <td style={cell}><input type="checkbox" aria-label={`${p.stageName} hold point`} disabled={!can("projects.holdPoints")} checked={p.holdPoint} onChange={(e) => patch(p, { holdPoint: e.target.checked })} /></td>
            <td style={cell}><Select value={p.defaultInspectorId ?? ""} disabled={!editable} onChange={(v) => patch(p, { defaultInspectorId: v || null })} placeholder="None" options={inspectors.map((i) => ({ id: i.id, label: i.name ?? i.email }))} /></td>
          </tr>
        ))}
      </TableCard>
      {stages.length > plan.length && editable && <button style={{ ...btnGhost, marginTop: 10 }} onClick={() => qcx.projects.seedPlan(project.id).then(setPlan)}>Add stages added to the standard list</button>}
    </>
  );
}

// ─── Documents (E11) ─────────────────────────────────────────────────────────

export function DocumentsPanel({ project }: { project: QcProjectRow }) {
  const { can } = useQc();
  const [docs, setDocs] = useState<Array<Record<string, any>> | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => qcx.projects.documents(project.id).then(setDocs).catch((e) => setError(e.message)), [project.id]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {can("projects.docs.upload") && <button style={btnPrimary} onClick={() => setAdding(true)}>Upload a document</button>}
      </div>
      <ErrorNote message={error} />
      <TableCard headers={["Document", "Type", "Revision", "Applies to", "Visible to", "Status", ""]}>
        {docs?.map((d) => (
          <tr key={d.id} style={{ borderBottom: "1px solid #f1f5f9", opacity: d.status === "Superseded" ? 0.6 : 1 }}>
            <td style={cell}><b>{d.title}</b><div style={sub}>{d.fileName} · {fmt(d.uploadedAt)}</div></td>
            <td style={cell}>{d.document_type}</td><td style={cell}>{d.revision}</td><td style={cell}>{d.applies_to}</td>
            <td style={cell}>{(d.visible_to as string[] | undefined)?.join(", ")}</td><td style={cell}>{d.status}</td>
            <td style={{ ...cell, textAlign: "right" }}><button style={btnLink} onClick={async () => { try { const r = await fetch(resolveMediaUrl(String(d.fileUrl))); window.open(r.url, "_blank"); } catch { /* handled by link below */ } }}>Open</button></td>
          </tr>
        ))}
        {docs?.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No documents. Upload the permit, plans and certificates inspectors and builders need.</td></tr>}
      </TableCard>
      <p style={sub}>Uploading a new revision of a document with the same title marks the earlier one Superseded; nothing is deleted.</p>
      {adding && (
        <FormDialog title="Upload a document" formCode="E11" withFiles hide={["status", "uploaded_by_and_at"]} initial={{ applies_to: "Project", visible_to: ["Client roles", "Master Contractor roles", "Private Inspector"] }}
          onClose={() => setAdding(false)}
          onSubmit={async (p, files) => {
            const f = files.file?.[0];
            if (!f) throw new Error("Choose the file to upload");
            const { file: _drop, ...fields } = p;
            await qcx.projects.addDocument(project.id, { ...fields, visible_to: (fields.visible_to as string[]).join(",") }, f);
            setAdding(false); load();
          }} />
      )}
    </>
  );
}

// ─── Lot import (F06) ────────────────────────────────────────────────────────

export function LotImportDialog({ project, onClose, onDone }: { project: QcProjectRow; onClose: () => void; onDone: () => void }) {
  const [siteId, setSiteId] = useState(project.sites?.length === 1 ? project.sites[0]!.id : "");
  const [mode, setMode] = useState<"add" | "update">("add");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<{ rows: number; added: number; updated: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (partial: boolean) => { if (!file) return; try { setError(null); setReport((await qcx.projects.importLots(siteId, file, mode, partial)).report); } catch (e) { setError((e as Error).message); } };
  const done = report && (report.added > 0 || report.updated > 0);
  return (
    <Modal title="Import lots from CSV" onClose={() => { onClose(); if (done) onDone(); }} width={600}
      footer={<><button style={btnGhost} onClick={() => { onClose(); if (done) onDone(); }}>Close</button><button style={btnPrimary} disabled={!siteId || !file} onClick={() => run(false)}>Import</button></>}>
      <ErrorNote message={error} />
      <p style={{ ...sub, marginTop: 0 }}>Columns: Lot number, Unit number, Building, Level, Street address, Dwelling type, NCC class, Storeys, Floor system, Frame. Lots imported without every spec field are flagged to be completed. <a href={qcx.projects.lotCsvTemplateUrl()} style={{ color: "#2563eb" }}>Download the template</a>.</p>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Site" required><Select value={siteId} onChange={setSiteId} options={(project.sites ?? []).map((s) => ({ id: s.id, label: s.name }))} /></Field>
        <Field label="Mode"><Select value={mode} onChange={(v) => setMode(v as "add" | "update")} options={[{ id: "add", label: "Add new lots only" }, { id: "update", label: "Add and update existing" }]} /></Field>
        <Field label="CSV file" required><input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} /></Field>
      </div>
      {report && (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          <p style={{ color: report.errors.length ? "#b91c1c" : "#15803d" }}>{report.added + report.updated > 0 ? `Imported: ${report.added} added, ${report.updated} updated.` : report.errors.length ? "Nothing was imported because some rows have problems." : "Nothing to import."}</p>
          {report.errors.map((e) => <div key={e.row} style={{ color: "#b91c1c" }}>Row {e.row}: {e.message}</div>)}
          {report.errors.length > 0 && report.added + report.updated === 0 && <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => run(true)}>Import the good rows anyway</button>}
        </div>
      )}
    </Modal>
  );
}

// ─── Practical completion and the DLP (F36, F37) ─────────────────────────────

export function DlpPanel({ project, onChange }: { project: QcProjectRow; onChange: () => void }) {
  const { can } = useQc();
  const [dlp, setDlp] = useState<Record<string, any> | null>(null);
  const [starting, setStarting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [lots, setLots] = useState<QcLotRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const load = useCallback(() => qcx.projects.dlp(project.id).then(setDlp).catch((e) => setError(e.message)), [project.id]);
  useEffect(() => { load(); api.qc.lots.list({ projectId: project.id }).then(setLots).catch(() => undefined); }, [load, project.id]);
  if (!dlp) return <><ErrorNote message={error} /><p style={sub}>Loading…</p></>;
  const s = dlp.summary;
  const manage = can("dlp.manage");
  return (
    <>
      <ErrorNote message={error} />
      {!dlp.dlpStartDate ? (
        <Card style={{ padding: 20 }}>
          <p style={{ fontSize: 13, color: "#475569", marginTop: 0 }}>Practical completion has not been recorded. Recording it starts the defects liability period; defects raised from then on are flagged as DLP defects.</p>
          {manage && <button style={btnPrimary} onClick={() => setStarting(true)}>Record practical completion</button>}
        </Card>
      ) : (
        <>
          <Card style={{ padding: "16px 20px", marginBottom: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 13 }}>
            <div><div style={sub}>Practical completion</div><b>{fmt(dlp.practicalCompletionDate)}</b></div>
            <div><div style={sub}>DLP ends</div><b>{fmt(dlp.dlpEndDate)}</b>{s.daysLeft !== null && !dlp.dlpSignedOffAt && <div style={sub}>{s.daysLeft >= 0 ? `${s.daysLeft} days left` : `${-s.daysLeft} days past`}</div>}</div>
            <div><div style={sub}>Defects raised in the DLP</div><b>{s.total}</b></div>
            <div><div style={sub}>Still open</div><b style={{ color: s.nonTerminal ? "#b91c1c" : "#15803d" }}>{s.nonTerminal}</b></div>
            <div><div style={sub}>Closed</div><b>{s.closed}</b></div>
            <div><div style={sub}>Accepted as exceptions</div><b>{s.exceptions}</b></div>
            <div style={{ gridColumn: "span 2" }}>{dlp.dlpSignedOffAt ? <b style={{ color: "#15803d" }}>Signed off {fmt(dlp.dlpSignedOffAt)}</b> : manage && <button style={btnPrimary} onClick={() => setSigning(true)}>Developer sign-off…</button>}</div>
          </Card>
          {s.nonTerminal > 0 && !dlp.dlpSignedOffAt && <p style={{ fontSize: 12, color: "#92400e" }}>Sign-off is blocked until every DLP defect is closed or accepted as an exception.</p>}
          {can("reports.dlpEscalation") && <button style={btnGhost} onClick={async () => { try { const r = await qcx.reports.dlp(project.id); const l = await qcx.reports.link(String(r.id)); setReport(l.url); } catch (e) { setError((e as Error).message); } }}>Generate the DLP close-out report</button>}
          {report && <p role="status" style={{ fontSize: 13 }}>Ready: <a href={resolveMediaUrl(report)} target="_blank" rel="noreferrer">open the report</a> (link valid for 15 minutes).</p>}
        </>
      )}
      {starting && (
        <FormDialog title="Record practical completion" formCode="F36" hide={["dlp_end_date"]} initial={{ dlp_length: Number(project.data.dlp_length ?? 12), applies_to: "Whole project" }}
          extra={(v, set) => String(v.applies_to) === "Selected lots" ? <Field label="Lots" required><div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{lots.map((l) => <label key={l.id} style={{ fontSize: 13 }}><input type="checkbox" checked={((v.lotIds as string[]) ?? []).includes(l.id)} onChange={(e) => set({ lotIds: e.target.checked ? [...((v.lotIds as string[]) ?? []), l.id] : ((v.lotIds as string[]) ?? []).filter((x) => x !== l.id) })} /> {l.name}</label>)}</div></Field> : null}
          onClose={() => setStarting(false)} onSubmit={async (p) => { await qcx.projects.startDlp(project.id, p); setStarting(false); load(); onChange(); }} />
      )}
      {signing && (
        <FormDialog title="Developer close-out sign-off" formCode="F37" hide={["defect_position", "exceptions_list"]} initial={{}}
          note={<p style={{ ...sub, marginTop: 0 }}>This closes the DLP and records the exceptions you accepted. It cannot be undone.</p>}
          onClose={() => setSigning(false)} onSubmit={async (p) => { await qcx.projects.closeOutDlp(project.id, p); setSigning(false); load(); onChange(); }} />
      )}
    </>
  );
}

// ─── Status moves ────────────────────────────────────────────────────────────

const NEXT: Record<string, Array<{ id: string; label: string }>> = {
  SETUP: [{ id: "CONSTRUCTION", label: "Start construction" }, { id: "ARCHIVED", label: "Archive" }],
  CONSTRUCTION: [{ id: "PRACTICAL_COMPLETION", label: "Mark practical completion reached" }, { id: "SETUP", label: "Back to set-up" }],
  PRACTICAL_COMPLETION: [{ id: "CONSTRUCTION", label: "Back to construction" }],
  DLP: [{ id: "ARCHIVED", label: "Archive" }],
  DLP_COMPLETE: [{ id: "ARCHIVED", label: "Archive" }],
  ARCHIVED: [{ id: "CONSTRUCTION", label: "Reopen" }],
};

export function StatusMover({ project, onChange }: { project: QcProjectRow; onChange: () => void }) {
  const { can } = useQc();
  const [error, setError] = useState<string | null>(null);
  const options = NEXT[project.status] ?? [];
  if (!can("projects.status") || options.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {options.map((o) => (
        <button key={o.id} style={btnGhost} onClick={async () => {
          const reason = o.id === "ARCHIVED" || project.status === "ARCHIVED" ? window.prompt(`${o.label}. Reason:`) : "";
          if (reason === null) return;
          try { await qcx.projects.transition(project.id, o.id, reason || undefined); onChange(); } catch (e) { setError((e as Error).message); window.alert((e as Error).message); }
        }}>{o.label}</button>
      ))}
      {error && <span style={{ fontSize: 11, color: "#b91c1c" }} />}
    </span>
  );
}
