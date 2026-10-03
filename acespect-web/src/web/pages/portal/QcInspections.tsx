import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageShell, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, Modal, Select, btnGhost, btnLink, btnPrimary, cell, statusPill, sub } from "../../components/QcUi";
import { inputStyle } from "../../components/SpecForm";
import { qcx, type InspectionRow, type PlanStage } from "../../qcApi";
import { useQc } from "../../qcContext";
import { api } from "../../api";
import type { QcLotRow, QcProjectRow } from "../../qcTypes";

export const INSPECTION_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  REQUESTED: { label: "Requested", color: "#92400e", bg: "#fef3c7" },
  PLANNED: { label: "Planned", color: "#1e40af", bg: "#dbeafe" },
  IN_PROGRESS: { label: "In progress", color: "#5b21b6", bg: "#ede9fe" },
  COMPLETED: { label: "Completed", color: "#065f46", bg: "#d1fae5" },
  CANCELLED: { label: "Cancelled", color: "#475569", bg: "#e2e8f0" },
  NOT_PLANNED: { label: "Not planned", color: "#64748b", bg: "#f8fafc" },
  NOT_APPLICABLE: { label: "n/a", color: "#94a3b8", bg: "#f8fafc" },
};
export const InspectionStatus = ({ s }: { s: string }) => {
  const t = INSPECTION_STATUS[s] ?? { label: s, color: "#475569", bg: "#e2e8f0" };
  return <span style={{ padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, color: t.color, background: t.bg, whiteSpace: "nowrap" }}>{t.label}</span>;
};
const fmtWindow = (i: Pick<InspectionRow, "plannedFrom" | "plannedTo">) =>
  i.plannedFrom ? `${new Date(i.plannedFrom).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}${i.plannedTo ? ` – ${new Date(i.plannedTo).toLocaleDateString("en-AU", { day: "2-digit", month: "short" })}` : ""}` : "—";
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

// ─── Request an inspection (F09) ─────────────────────────────────────────────

export function RequestDialog({ projectId: fixedProject, onClose, onDone }: { projectId?: string; onClose: () => void; onDone: () => void }) {
  const [projects, setProjects] = useState<QcProjectRow[]>([]);
  const [projectId, setProjectId] = useState(fixedProject ?? "");
  const [plan, setPlan] = useState<PlanStage[]>([]);
  const [lots, setLots] = useState<QcLotRow[]>([]);
  const [stageId, setStageId] = useState("");
  const [lotIds, setLotIds] = useState<string[]>([]);
  const [f, setF] = useState({ ready_from_date: new Date().toISOString().slice(0, 10), site_contact_name_and_mobile: "", access_notes: "", rbsNotifiedOn: "", rbsName: "" });
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.qc.projects.list().then((p) => setProjects(p.filter((x) => ["CONSTRUCTION", "PRACTICAL_COMPLETION"].includes(x.status)))).catch(() => undefined); }, []);
  useEffect(() => {
    setStageId(""); setLotIds([]); setPlan([]); setLots([]);
    if (!projectId) return;
    qcx.projects.plan(projectId).then((p) => setPlan(p.filter((s) => s.enabled))).catch(() => undefined);
    api.qc.lots.list({ projectId }).then(setLots).catch(() => undefined);
  }, [projectId]);
  const stage = plan.find((s) => s.stageId === stageId);
  const toggle = (id: string) => setLotIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  return (
    <Modal title="Request a stage inspection" onClose={onClose} width={620}
      footer={<><button style={btnGhost} onClick={onClose}>Cancel</button>
        <button style={btnPrimary} disabled={busy || !stageId || lotIds.length === 0 || !confirm} onClick={async () => {
          setBusy(true); setError(null);
          try { await qcx.inspections.request({ projectId, stageId, lotIds, stage_complete_confirmation: confirm, ...f, rbsNotifiedOn: f.rbsNotifiedOn || undefined }); onDone(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
        }}>{busy ? "Sending…" : "Send request"}</button></>}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        {!fixedProject && <Field label="Project" required><Select value={projectId} onChange={setProjectId} options={projects.map((p) => ({ id: p.id, label: p.name }))} /></Field>}
        <Field label="Stage" required><Select value={stageId} disabled={!projectId} onChange={setStageId} options={plan.map((s) => ({ id: s.stageId, label: `${s.stageNumber}. ${s.stageName}${s.mandatoryNotification ? " (mandatory notification)" : ""}` }))} /></Field>
        <Field label="Lots that are ready" required>
          <div style={{ maxHeight: 150, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {lots.map((l) => <label key={l.id} style={{ fontSize: 13 }}><input type="checkbox" checked={lotIds.includes(l.id)} onChange={() => toggle(l.id)} /> {l.name}</label>)}
            {lots.length === 0 && <span style={sub}>Choose a project first.</span>}
          </div>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Ready from" required><input type="date" style={inputStyle} value={f.ready_from_date} onChange={(e) => setF({ ...f, ready_from_date: e.target.value })} /></Field>
          <Field label="Site contact name and mobile" required><input style={inputStyle} value={f.site_contact_name_and_mobile} onChange={(e) => setF({ ...f, site_contact_name_and_mobile: e.target.value })} /></Field>
        </div>
        {stage?.mandatoryNotification && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 10 }}>
            <Field label="Relevant Building Surveyor notified on" required><input type="date" style={inputStyle} value={f.rbsNotifiedOn} onChange={(e) => setF({ ...f, rbsNotifiedOn: e.target.value })} /></Field>
            <Field label="Surveyor name"><input style={inputStyle} value={f.rbsName} onChange={(e) => setF({ ...f, rbsName: e.target.value })} /></Field>
          </div>
        )}
        <Field label="Access notes"><textarea style={{ ...inputStyle, minHeight: 56 }} value={f.access_notes} onChange={(e) => setF({ ...f, access_notes: e.target.value })} /></Field>
        <label style={{ fontSize: 13, display: "flex", gap: 8 }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm the stage work is complete on these lots.</label>
      </div>
    </Modal>
  );
}

// ─── Plan and assign (F10) ───────────────────────────────────────────────────

export function PlanDialog({ inspectionIds = [], cells = [], onClose, onDone }: { inspectionIds?: string[]; cells?: Array<{ propertyId: string; stageId: string }>; onClose: () => void; onDone: () => void }) {
  const [inspectors, setInspectors] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [inspectorId, setInspectorId] = useState("");
  const now = new Date();
  const [from, setFrom] = useState(localInput(new Date(now.getTime() + 86_400_000)));
  const [to, setTo] = useState(localInput(new Date(now.getTime() + 86_400_000 + 4 * 3_600_000)));
  const [hours, setHours] = useState("");
  const [instructions, setInstructions] = useState("");
  const [notifyMc, setNotifyMc] = useState(true);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { qcx.people.inspectors().then(setInspectors).catch(() => undefined); }, []);
  const count = inspectionIds.length + cells.length;
  return (
    <Modal title={`Plan and assign ${count} inspection${count === 1 ? "" : "s"}`} onClose={onClose} width={540}
      footer={<><button style={btnGhost} onClick={onClose}>{warnings.length ? "Close" : "Cancel"}</button>
        {warnings.length > 0 ? <button style={btnPrimary} onClick={onDone}>Done</button> : (
          <button style={btnPrimary} disabled={busy || !inspectorId} onClick={async () => {
            setBusy(true); setError(null);
            try {
              const r = await qcx.inspections.plan({ inspectionIds, cells, inspectorId, plannedFrom: new Date(from).toISOString(), plannedTo: new Date(to).toISOString(), estimated_duration: hours ? Number(hours) : undefined, instructions_to_inspector: instructions || undefined, notifyMasterContractor: notifyMc });
              if (r.warnings.length) setWarnings(r.warnings); else onDone();
            } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }}>{busy ? "Saving…" : "Assign"}</button>
        )}</>}>
      <ErrorNote message={error} />
      {warnings.length > 0 && <div role="status" style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 10, fontSize: 13, marginBottom: 12 }}>Assigned. Note: {warnings.join(" ")}</div>}
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Inspector" required><Select value={inspectorId} onChange={setInspectorId} options={inspectors.map((i) => ({ id: i.id, label: i.name ?? i.email }))} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Window starts" required><input type="datetime-local" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Window ends" required><input type="datetime-local" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label="Estimated duration (hours)"><input type="number" min={0} step={0.5} style={inputStyle} value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        <Field label="Instructions to the inspector"><textarea style={{ ...inputStyle, minHeight: 60 }} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
        <label style={{ fontSize: 13, display: "flex", gap: 8 }}><input type="checkbox" checked={notifyMc} onChange={(e) => setNotifyMc(e.target.checked)} /> Tell the Master Contractor</label>
      </div>
    </Modal>
  );
}

function ChangeDialog({ inspection, onClose, onDone }: { inspection: InspectionRow; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = useState("Reschedule");
  const [inspectors, setInspectors] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [newInspectorId, setNewInspectorId] = useState("");
  const [from, setFrom] = useState(localInput(new Date(Date.now() + 86_400_000)));
  const [to, setTo] = useState(localInput(new Date(Date.now() + 86_400_000 + 4 * 3_600_000)));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { qcx.people.inspectors().then(setInspectors).catch(() => undefined); }, []);
  return (
    <Modal title={`Change ${inspection.ref}`} onClose={onClose} width={480}
      footer={<><button style={btnGhost} onClick={onClose}>Close</button><button style={btnPrimary} disabled={!reason.trim()} onClick={async () => {
        try { await qcx.inspections.change(inspection.id, { action, reason, newInspectorId, newFrom: new Date(from).toISOString(), newTo: new Date(to).toISOString() }); onDone(); } catch (e) { setError((e as Error).message); }
      }}>Apply</button></>}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Action" required><Select value={action} onChange={setAction} options={["Reassign", "Reschedule", "Cancel"].map((x) => ({ id: x, label: x }))} /></Field>
        {action === "Reassign" && <Field label="New inspector" required><Select value={newInspectorId} onChange={setNewInspectorId} options={inspectors.map((i) => ({ id: i.id, label: i.name ?? i.email }))} /></Field>}
        {action === "Reschedule" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="New start" required><input type="datetime-local" style={inputStyle} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="New end" required><input type="datetime-local" style={inputStyle} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>}
        <Field label="Reason" required><textarea style={{ ...inputStyle, minHeight: 60 }} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function AdHocDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const { me } = useQc();
  const [projects, setProjects] = useState<QcProjectRow[]>([]);
  const [projectId, setProjectId] = useState("");
  const [lots, setLots] = useState<QcLotRow[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [type, setType] = useState("Ad-hoc visit");
  const [purpose, setPurpose] = useState("");
  const [inspectors, setInspectors] = useState<Array<{ id: string; name: string | null; email: string }>>([]);
  const [inspectorId, setInspectorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.qc.projects.list().then(setProjects).catch(() => undefined); qcx.people.inspectors().then(setInspectors).catch(() => undefined); }, []);
  useEffect(() => { setPropertyId(""); if (projectId) api.qc.lots.list({ projectId }).then(setLots).catch(() => setLots([])); }, [projectId]);
  return (
    <Modal title="Ad-hoc visit" onClose={onClose} width={500}
      footer={<><button style={btnGhost} onClick={onClose}>Cancel</button><button style={btnPrimary} disabled={!projectId} onClick={async () => {
        try { const r = await qcx.inspections.adhoc({ projectId, propertyId: propertyId || undefined, type, purpose, inspectorId: me?.role === "PRIVATE_INSPECTOR" ? undefined : inspectorId }); onDone((r.inspection as { id: string }).id); } catch (e) { setError((e as Error).message); }
      }}>Create</button></>}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Project" required><Select value={projectId} onChange={setProjectId} options={projects.map((p) => ({ id: p.id, label: p.name }))} /></Field>
        <Field label="Lot"><Select value={propertyId} onChange={setPropertyId} options={lots.map((l) => ({ id: l.id, label: l.name }))} placeholder="Whole site / no lot" /></Field>
        <Field label="Type"><Select value={type} onChange={setType} options={["Ad-hoc visit", "Re-inspection", "DLP inspection", "Combined stage visit"].map((x) => ({ id: x, label: x }))} /></Field>
        {me?.role !== "PRIVATE_INSPECTOR" && <Field label="Inspector" required><Select value={inspectorId} onChange={setInspectorId} options={inspectors.map((i) => ({ id: i.id, label: i.name ?? i.email }))} /></Field>}
        <Field label="Purpose"><textarea style={{ ...inputStyle, minHeight: 56 }} value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

// ─── Planning matrix (REQ-INP-001) ───────────────────────────────────────────

function Matrix() {
  const { can } = useQc();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<QcProjectRow[]>([]);
  const [projectId, setProjectId] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof qcx.projects.matrix>> | null>(null);
  const [picked, setPicked] = useState<Array<{ propertyId: string; stageId: string }>>([]);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.qc.projects.list().then((p) => { setProjects(p); if (p[0]) setProjectId(p[0].id); }).catch(() => undefined); }, []);
  const load = useCallback(() => { if (projectId) qcx.projects.matrix(projectId).then((d) => { setData(d); setPicked([]); }).catch((e) => setError(e.message)); }, [projectId]);
  useEffect(() => { load(); }, [load]);
  const isPicked = (p: string, s: string) => picked.some((x) => x.propertyId === p && x.stageId === s);
  return (
    <>
      <ErrorNote message={error} />
      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "center" }}>
        <div style={{ width: 280 }}><Select value={projectId} onChange={setProjectId} options={projects.map((p) => ({ id: p.id, label: p.name }))} /></div>
        {can("inspections.plan") && <button style={btnPrimary} disabled={picked.length === 0} onClick={() => setPlanning(true)}>Plan {picked.length || ""} selected</button>}
        <span style={sub}>Tick empty cells to plan them; click a status to open the inspection.</span>
      </div>
      <div style={{ overflowX: "auto", background: "white", border: "1px solid #e5e7eb", borderRadius: 12 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr style={{ background: "#f8fafc" }}>
            <th style={{ ...cell, textAlign: "left", fontSize: 11, color: "#94a3b8" }}>LOT</th>
            {data?.stages.map((s) => <th key={s.stageId} style={{ ...cell, fontSize: 11, color: "#94a3b8", textAlign: "left" }}>{s.stageNumber}. {s.stageName}{s.holdPoint ? " ⛔" : ""}</th>)}
          </tr></thead>
          <tbody>
            {data?.lots.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid #f1f5f9" }}>
                <td style={cell}><b>{l.name}</b></td>
                {l.cells.map((c) => (
                  <td key={c.stageId} style={cell}>
                    {c.status === "NOT_APPLICABLE" ? <InspectionStatus s="NOT_APPLICABLE" />
                      : c.inspectionId ? <button style={{ ...btnLink, background: "none" }} onClick={() => navigate(`/qc/inspections/${c.inspectionId}`)}><InspectionStatus s={c.status} /></button>
                      : can("inspections.plan") ? <label style={{ fontSize: 12, color: "#64748b" }}><input type="checkbox" checked={isPicked(l.id, c.stageId)} onChange={() => setPicked((p) => (isPicked(l.id, c.stageId) ? p.filter((x) => !(x.propertyId === l.id && x.stageId === c.stageId)) : [...p, { propertyId: l.id, stageId: c.stageId }]))} /> plan</label>
                      : <InspectionStatus s="NOT_PLANNED" />}
                  </td>
                ))}
              </tr>
            ))}
            {data?.lots.length === 0 && <tr><td style={{ ...cell, color: "#94a3b8" }} colSpan={9}>No lots in this project yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {planning && <PlanDialog cells={picked} onClose={() => setPlanning(false)} onDone={() => { setPlanning(false); load(); }} />}
    </>
  );
}

// ─── Inspections list ────────────────────────────────────────────────────────

export function QcInspections() {
  const { can, me } = useQc();
  const navigate = useNavigate();
  const [rows, setRows] = useState<InspectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<QcProjectRow[]>([]);
  const [tab, setTab] = useState<"list" | "matrix">("list");
  const [dialog, setDialog] = useState<"request" | "adhoc" | null>(null);
  const [planFor, setPlanFor] = useState<string[] | null>(null);
  const [changeFor, setChangeFor] = useState<InspectionRow | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { api.qc.projects.list().then(setProjects).catch(() => undefined); }, []);
  const load = useCallback(() => qcx.inspections.list({ status, projectId }).then((r) => { setRows(r); setSelected([]); }).catch((e) => setError(e.message)), [status, projectId]);
  useEffect(() => { load(); }, [load]);
  const planable = useMemo(() => (rows ?? []).filter((r) => ["REQUESTED", "PLANNED"].includes(r.status)), [rows]);
  const isPi = me?.role === "PRIVATE_INSPECTOR";

  return (
    <PageShell
      title="Inspections"
      subtitle={rows ? `${rows.length} inspection${rows.length === 1 ? "" : "s"}` : "Loading…"}
      actions={<div style={{ display: "flex", gap: 8 }}>
        {can("inspections.adhoc") && <button style={btnGhost} onClick={() => setDialog("adhoc")}>Ad-hoc visit</button>}
        {can("inspections.plan") && <button style={btnGhost} disabled={selected.length === 0} onClick={() => setPlanFor(selected)}>Plan and assign {selected.length || ""}</button>}
        {can("inspections.request") && <button style={btnPrimary} onClick={() => setDialog("request")}>Request an inspection</button>}
      </div>}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {(["list", "matrix"] as const).filter((t) => t === "list" || can("projects.view")).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btnGhost, ...(tab === t ? { background: "#1a2a4a", color: "white", borderColor: "#1a2a4a" } : {}) }}>{t === "list" ? "Inspections" : "Planning matrix"}</button>
        ))}
        {tab === "list" && <>
          <div style={{ width: 170 }}><Select value={status} onChange={setStatus} placeholder="Any status" options={Object.entries(INSPECTION_STATUS).filter(([k]) => !k.startsWith("NOT_")).map(([k, v]) => ({ id: k, label: v.label }))} /></div>
          <div style={{ width: 240 }}><Select value={projectId} onChange={setProjectId} placeholder="All projects" options={projects.map((p) => ({ id: p.id, label: p.name }))} /></div>
        </>}
      </div>
      <ErrorNote message={error} />
      {tab === "matrix" ? <Matrix /> : (
        <TableCard headers={["", "Inspection", "Stage", "Lot", "Inspector", "Window", "Status", "Results", ""]}>
          {rows?.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}>{can("inspections.plan") && planable.some((p) => p.id === r.id) && <input aria-label={`Select ${r.ref}`} type="checkbox" checked={selected.includes(r.id)} onChange={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} />}</td>
              <td style={cell}><Link to={`/qc/inspections/${r.id}`} style={{ color: "#1a2a4a", fontWeight: 700, textDecoration: "none" }}>{r.ref}</Link><div style={sub}>{r.type}{r.holdPoint ? " · hold point" : ""}</div></td>
              <td style={cell}>{r.stage ? `${r.stage.stage_number}. ${r.stage.stage_name}` : "—"}</td>
              <td style={cell}>{r.lot?.name ?? "—"}<div style={sub}>{r.project?.name}</div></td>
              <td style={cell}>{r.inspector?.name ?? r.inspector?.email ?? <span style={sub}>Unassigned</span>}</td>
              <td style={cell}>{fmtWindow(r)}</td>
              <td style={cell}><InspectionStatus s={r.status} />{r.locked && <span style={{ marginLeft: 6 }} title="Signed and locked">🔒</span>}</td>
              <td style={cell}>{r.counts ? `${(r.counts["Major Defect"] ?? 0) + (r.counts["Minor Defect"] ?? 0) + (r.counts["Safety Hazard"] ?? 0) + (r.counts["Monitor / Serviceability"] ?? 0)} defects` : <span style={sub}>—</span>}</td>
              <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
                {isPi && r.status === "PLANNED" && <button style={btnLink} onClick={() => navigate(`/qc/inspections/${r.id}`)}>Open</button>}
                {can("inspections.plan") && ["REQUESTED", "PLANNED"].includes(r.status) && <>{" "}<button style={btnLink} onClick={() => setChangeFor(r)}>Change</button></>}
              </td>
            </tr>
          ))}
          {rows?.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No inspections yet.</td></tr>}
        </TableCard>
      )}
      {dialog === "request" && <RequestDialog onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />}
      {dialog === "adhoc" && <AdHocDialog onClose={() => setDialog(null)} onDone={(id) => navigate(`/qc/inspections/${id}`)} />}
      {planFor && <PlanDialog inspectionIds={planFor} onClose={() => setPlanFor(null)} onDone={() => { setPlanFor(null); load(); }} />}
      {changeFor && <ChangeDialog inspection={changeFor} onClose={() => setChangeFor(null)} onDone={() => { setChangeFor(null); load(); }} />}
    </PageShell>
  );
}
export { statusPill };
