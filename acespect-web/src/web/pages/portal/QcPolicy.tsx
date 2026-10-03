import { useCallback, useEffect, useState } from "react";
import { PageShell, Card, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, Modal, Select, btnGhost, btnLink, btnPrimary, cell, sub } from "../../components/QcUi";
import { inputStyle } from "../../components/SpecForm";
import { qcx, type Duration, type EscalationLevel, type PolicyView, type ProjectPolicy, type SlaRule, type SlaView } from "../../qcApi";
import { useQc } from "../../qcContext";
import { api } from "../../api";
import type { QcProjectRow } from "../../qcTypes";

const UNITS: Array<{ id: Duration["unit"]; label: string }> = [
  { id: "hours", label: "hours" }, { id: "business_days", label: "business days" }, { id: "calendar_days", label: "calendar days" },
];
const durText = (d: Duration | null) => (d ? `${d.value} ${d.unit === "hours" ? "hour" : d.unit === "business_days" ? "business day" : "day"}${d.value === 1 ? "" : "s"}` : "n/a");
const STATES = ["VIC", "NSW", "QLD", "SA", "WA", "TAS", "ACT", "NT"];
const TRIGGERS = ["Acknowledgement SLA missed", "Rectification SLA missed", "Previous level unresolved", "Failed re-inspections on the same item", "Developer elects", "Within N days of DLP expiry"];
const ACTIONS = ["Automatic reminder", "Formal in-app notice and flag Escalated", "Formal notice to Developer or project manager and flag for contract review", "Record referral outside the platform"];
const CLOSURE = [
  { id: "DEVELOPER_SIGNOFF", label: "The Developer closes each verified defect" },
  { id: "AUTO_CLOSE", label: "Closed automatically when verified" },
  { id: "INSPECTOR_CLOSE", label: "The Inspector closes" },
];
const SAFETY_RECIPIENTS = ["MC Project Manager", "MC Manager", "Client Admin", "Client User"];

const SourceChip = ({ s }: { s: "default" | "client" | "project" }) => (
  <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: s === "project" ? "#ede9fe" : s === "client" ? "#dbeafe" : "#f1f5f9", color: s === "project" ? "#5b21b6" : s === "client" ? "#1e40af" : "#64748b" }}>
    {s === "project" ? "Project override" : s === "client" ? "Client default" : "Platform default"}
  </span>
);

function DurationInput({ label, value, onChange, optional }: { label: string; value: Duration | null; onChange: (d: Duration | null) => void; optional?: boolean }) {
  return (
    <Field label={label} required={!optional}>
      <div style={{ display: "flex", gap: 8 }}>
        <input aria-label={`${label} amount`} type="number" min={1} style={{ ...inputStyle, width: 90 }} value={value?.value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : { value: Number(e.target.value), unit: value?.unit ?? "business_days" })} />
        <select aria-label={`${label} unit`} style={inputStyle} value={value?.unit ?? "business_days"} onChange={(e) => onChange({ value: value?.value ?? 1, unit: e.target.value as Duration["unit"] })}>
          {UNITS.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
        </select>
      </div>
    </Field>
  );
}

function SlaDialog({ severity, label, rule, projectId, onClose, onSaved }: { severity: string; label: string; rule: SlaRule; projectId?: string; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<SlaRule>(rule);
  const [error, setError] = useState<string | null>(null);
  const monitor = severity === "monitor";
  return (
    <Modal title={`${label}: ${projectId ? "project override" : "client default"}`} onClose={onClose} width={520}
      footer={<><button style={btnGhost} onClick={onClose}>Cancel</button><button style={btnPrimary} onClick={async () => { try { await qcx.sla.save(severity, r as never, projectId); onSaved(); } catch (e) { setError((e as Error).message); } }}>Save</button></>}>
      <ErrorNote message={error} />
      <p style={{ ...sub, marginTop: 0 }}>New targets apply to defects released from now on. Defects already running keep the due dates they were given.</p>
      <div style={{ display: "grid", gap: 12 }}>
        {!monitor && <DurationInput label="Acknowledge within" value={r.acknowledge} onChange={(d) => setR({ ...r, acknowledge: d })} />}
        <DurationInput label="Rectify within" value={r.rectifyFrom} onChange={(d) => setR({ ...r, rectifyFrom: d })} optional={monitor} />
        <DurationInput label="Rectify within: upper end of range" value={r.rectifyTo} onChange={(d) => setR({ ...r, rectifyTo: d })} optional />
        <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={r.orByNextStage} onChange={(e) => setR({ ...r, orByNextStage: e.target.checked })} /> Or by the next stage inspection, whichever is sooner</label>
        <DurationInput label="Re-inspect within" value={r.reinspect} onChange={(d) => setR({ ...r, reinspect: d })} optional={monitor} />
        {monitor && <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={r.reviewAtNextStage} onChange={(e) => setR({ ...r, reviewAtNextStage: e.target.checked })} /> Review at the next stage inspection</label>}
        <Field label="Effective from"><input type="date" style={inputStyle} value={r.effectiveFrom} onChange={(e) => setR({ ...r, effectiveFrom: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export function SlaPanel({ projectId }: { projectId?: string }) {
  const { can } = useQc();
  const [view, setView] = useState<{ sla: SlaView; severities: Array<{ key: string; label: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const load = useCallback(() => qcx.sla.get(projectId).then(setView).catch((e) => setError(e.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  const editable = can("sla.configure");
  return (
    <>
      <ErrorNote message={error} />
      <TableCard headers={["Severity", "Acknowledge within", "Rectify within", "Next-stage limit", "Re-inspect within", "Source", ""]}>
        {view?.severities.map((s) => {
          const r = view.sla.effective[s.key]!;
          const src = view.sla.source[s.key]!;
          return (
            <tr key={s.key} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}><b>{s.label}</b></td>
              <td style={cell}>{durText(r.acknowledge)}</td>
              <td style={cell}>{r.rectifyFrom ? `${durText(r.rectifyFrom)}${r.rectifyTo ? ` to ${durText(r.rectifyTo)}` : ""}` : r.reviewAtNextStage ? "Review at next stage" : "n/a"}</td>
              <td style={cell}>{r.orByNextStage ? "Yes" : "No"}</td>
              <td style={cell}>{durText(r.reinspect)}</td>
              <td style={cell}><SourceChip s={src} /></td>
              <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
                {editable && <button style={btnLink} onClick={() => setEdit(s.key)}>Edit</button>}{" "}
                {editable && projectId && src === "project" && <button style={btnLink} onClick={async () => { await qcx.sla.revert(projectId, s.key); load(); }}>Revert to default</button>}
              </td>
            </tr>
          );
        })}
      </TableCard>
      {edit && view && <SlaDialog severity={edit} label={view.severities.find((s) => s.key === edit)!.label} rule={view.sla.effective[edit]!} projectId={projectId} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function LevelsDialog({ levels, onClose, onSave }: { levels: EscalationLevel[]; onClose: () => void; onSave: (l: EscalationLevel[]) => Promise<void> }) {
  const [rows, setRows] = useState<EscalationLevel[]>(levels);
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, patch: Partial<EscalationLevel>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Modal title="Escalation levels" onClose={onClose} width={860}
      footer={<><button style={btnGhost} onClick={onClose}>Cancel</button><button style={btnPrimary} onClick={async () => { try { await onSave(rows.map((r, i) => ({ ...r, level: i + 1 }))); } catch (e) { setError((e as Error).message); } }}>Save</button></>}>
      <ErrorNote message={error} />
      {rows.map((r, i) => (
        <Card key={i} style={{ padding: 12, marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: 10 }}>
            <Field label="Level"><input style={inputStyle} value={i + 1} readOnly /></Field>
            <Field label="Name" required><input style={inputStyle} value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
            <Field label="Trigger" required><Select value={r.trigger} onChange={(v) => set(i, { trigger: v })} options={TRIGGERS.map((t) => ({ id: t, label: t }))} /></Field>
            <div />
            <Field label="Wait (business days)"><input type="number" min={0} style={inputStyle} value={r.waitDays ?? ""} onChange={(e) => set(i, { waitDays: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
            <Field label="Failed re-inspections"><input type="number" min={1} style={inputStyle} value={r.failedCount ?? ""} onChange={(e) => set(i, { failedCount: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
            <Field label="Action" required><Select value={r.action} onChange={(v) => set(i, { action: v })} options={ACTIONS.map((t) => ({ id: t, label: t }))} /></Field>
            <Field label="Additional notification emails"><input style={inputStyle} value={r.extraEmails} onChange={(e) => set(i, { extraEmails: e.target.value })} /></Field>
          </div>
          {rows.length > 1 && <button style={{ ...btnLink, color: "#dc2626", marginTop: 8 }} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove level</button>}
        </Card>
      ))}
      {rows.length < 4 && <button style={btnGhost} onClick={() => setRows([...rows, { level: rows.length + 1, name: "", trigger: "Previous level unresolved", waitDays: 5, failedCount: null, action: ACTIONS[1]!, notifyRoles: ["Any of the eight roles"], extraEmails: "" }])}>Add level</button>}
    </Modal>
  );
}

export function PolicyPanel({ projectId }: { projectId?: string }) {
  const { can } = useQc();
  const [view, setView] = useState<PolicyView | null>(null);
  const [draft, setDraft] = useState<ProjectPolicy | null>(null);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(() => qcx.policy.get(projectId).then((v) => { setView(v); setDraft(v.effective); }).catch((e) => setError(e.message)), [projectId]);
  useEffect(() => { load(); }, [load]);
  const editable = can("sla.configure");
  if (!view || !draft) return <><ErrorNote message={error} /><p style={sub}>Loading…</p></>;
  const set = (patch: Partial<ProjectPolicy>) => { setDraft({ ...draft, ...patch }); setSaved(false); };
  const flag = (k: string) => projectId && view.overridden.includes(k) ? <span style={{ marginLeft: 6 }}><SourceChip s="project" /></span> : null;

  async function save() {
    if (!draft || !view) return;
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as Array<keyof ProjectPolicy>) {
      if (k !== "levels" && JSON.stringify(draft[k]) !== JSON.stringify(view.effective[k])) patch[k] = draft[k];
    }
    if (Object.keys(patch).length === 0) return;
    try { const v = await qcx.policy.save(patch, projectId); setView(v); setDraft(v.effective); setSaved(true); setError(null); } catch (e) { setError((e as Error).message); }
  }

  const dis = !editable;
  return (
    <>
      <ErrorNote message={error} />
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <b style={{ fontSize: 14, color: "#1a2a4a" }}>Escalation levels{flag("levels")}</b>
          {editable && <button style={btnLink} onClick={() => setLevelsOpen(true)}>Edit levels</button>}
        </div>
        <TableCard headers={["Level", "Name", "Trigger", "Wait", "Action"]}>
          {draft.levels.map((l) => (
            <tr key={l.level} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}>{l.level}</td><td style={cell}><b>{l.name}</b></td><td style={cell}>{l.trigger}{l.failedCount ? ` (${l.failedCount})` : ""}</td>
              <td style={cell}>{l.waitDays === null ? "n/a" : `${l.waitDays} business days`}</td><td style={cell}>{l.action}</td>
            </tr>
          ))}
        </TableCard>
      </Card>

      <Card style={{ padding: 18 }}>
        <b style={{ fontSize: 14, color: "#1a2a4a" }}>{projectId ? "Project policies" : "Client policies"}</b>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
          <Field label="Who closes a verified defect"><Select value={draft.closurePolicy} disabled={dis} onChange={(v) => set({ closurePolicy: v })} options={CLOSURE} />{flag("closurePolicy")}</Field>
          <Field label="Business-day calendar (state)"><Select value={draft.calendarState} disabled={dis} onChange={(v) => set({ calendarState: v })} options={STATES.map((s) => ({ id: s, label: s }))} />{flag("calendarState")}</Field>
          <Field label="Safety Hazard acknowledge target (hours)"><input type="number" min={1} max={72} style={inputStyle} disabled={dis} value={draft.safetyAckHours} onChange={(e) => set({ safetyAckHours: Number(e.target.value) })} />{flag("safetyAckHours")}</Field>
          <Field label="Repeat-failure escalation (failed re-inspections)"><input type="number" min={1} max={10} style={inputStyle} disabled={dis} value={draft.repeatFailureCount} onChange={(e) => set({ repeatFailureCount: Number(e.target.value) })} />{flag("repeatFailureCount")}</Field>
          <Field label="DLP reminder days before expiry"><input style={inputStyle} disabled={dis} value={draft.dlpReminderDays.join(", ")} onChange={(e) => set({ dlpReminderDays: e.target.value.split(/[,\s]+/).filter(Boolean).map(Number) })} />{flag("dlpReminderDays")}</Field>
          <Field label="DLP expiry escalation window (days)"><input type="number" min={1} max={90} style={inputStyle} disabled={dis} value={draft.dlpEscalationWindowDays} onChange={(e) => set({ dlpEscalationWindowDays: Number(e.target.value) })} />{flag("dlpEscalationWindowDays")}</Field>
        </div>
        <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 13, color: "#374151" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" disabled={dis} checked={draft.autoReleaseSafety} onChange={(e) => set({ autoReleaseSafety: e.target.checked })} /> Release Safety Hazards to the Builder as soon as the Inspector confirms them{flag("autoReleaseSafety")}</label>
          <div>Evidence-only (desk) re-inspection allowed for:{" "}
            {["minor", "monitor"].map((k) => (
              <label key={k} style={{ marginLeft: 12 }}><input type="checkbox" disabled={dis} checked={draft.evidenceOnlyFor.includes(k)} onChange={(e) => set({ evidenceOnlyFor: e.target.checked ? [...draft.evidenceOnlyFor, k] : draft.evidenceOnlyFor.filter((x) => x !== k) })} /> {k === "minor" ? "Minor Defect" : "Monitor"}</label>
            ))}
            <span style={sub}> (never Major or Safety Hazard)</span>{flag("evidenceOnlyFor")}
          </div>
          <div>Safety Hazard alerts go to:{" "}
            {SAFETY_RECIPIENTS.map((k) => (
              <label key={k} style={{ marginLeft: 12 }}><input type="checkbox" disabled={dis} checked={draft.safetyRecipients.includes(k)} onChange={(e) => set({ safetyRecipients: e.target.checked ? [...draft.safetyRecipients, k] : draft.safetyRecipients.filter((x) => x !== k) })} /> {k}</label>
            ))}{flag("safetyRecipients")}
          </div>
        </div>
        <Field label="Extra non-working dates (one per line, YYYY-MM-DD)">
          <textarea style={{ ...inputStyle, minHeight: 56, marginTop: 6 }} disabled={dis} value={draft.extraDates.join("\n")} onChange={(e) => set({ extraDates: e.target.value.split(/\s+/).filter(Boolean) })} />
        </Field>
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" disabled={dis} checked={draft.includeShutdowns} onChange={(e) => set({ includeShutdowns: e.target.checked })} /> Exclude industry shutdown periods from business days{flag("includeShutdowns")}</label>
          {draft.shutdowns.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input aria-label="Shutdown name" style={inputStyle} disabled={dis} value={s.name} onChange={(e) => set({ shutdowns: draft.shutdowns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input aria-label="Shutdown start" type="date" style={inputStyle} disabled={dis} value={s.start} onChange={(e) => set({ shutdowns: draft.shutdowns.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
              <input aria-label="Shutdown end" type="date" style={inputStyle} disabled={dis} value={s.end} onChange={(e) => set({ shutdowns: draft.shutdowns.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
              {!dis && <button style={btnLink} onClick={() => set({ shutdowns: draft.shutdowns.filter((_, j) => j !== i) })}>Remove</button>}
            </div>
          ))}
          {!dis && <button style={{ ...btnGhost, marginTop: 8 }} onClick={() => set({ shutdowns: [...draft.shutdowns, { name: "Builders' shutdown", start: "", end: "" }] })}>Add shutdown period</button>}
        </div>
        <Field label="Severity label overrides (rename only; the meaning is fixed)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 6 }}>
            {[["safety_hazard", "Safety Hazard"], ["major", "Major Defect"], ["minor", "Minor Defect"], ["monitor", "Monitor / Serviceability"]].map(([k, l]) => (
              <input key={k} aria-label={`Label for ${l}`} placeholder={l} style={inputStyle} disabled={dis} value={draft.severityLabels[k!] ?? ""} onChange={(e) => set({ severityLabels: { ...draft.severityLabels, [k!]: e.target.value } })} />
            ))}
          </div>
        </Field>
        {editable && (
          <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
            <button style={btnPrimary} onClick={save}>Save policies</button>
            {projectId && view.overridden.length > 0 && <button style={btnGhost} onClick={async () => { setView(await qcx.policy.revert(projectId)); await load(); }}>Revert all to the client defaults</button>}
            {saved && <span role="status" style={{ fontSize: 12, color: "#15803d" }}>Saved and recorded in the audit trail.</span>}
          </div>
        )}
      </Card>
      {levelsOpen && <LevelsDialog levels={draft.levels} onClose={() => setLevelsOpen(false)} onSave={async (levels) => { const v = await qcx.policy.save({ levels }, projectId); setView(v); setDraft(v.effective); setLevelsOpen(false); }} />}
    </>
  );
}

export function QcPolicy() {
  const [projects, setProjects] = useState<QcProjectRow[]>([]);
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<"sla" | "policy">("sla");
  useEffect(() => { api.qc.projects.list().then(setProjects).catch(() => setProjects([])); }, []);
  return (
    <PageShell title="SLA and escalation" subtitle="Service-level targets, escalation levels and project policies. Set a client default; any project can override it and revert at any time.">
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ width: 300 }}><Select value={projectId} onChange={setProjectId} placeholder="Client default (all projects)" options={projects.map((p) => ({ id: p.id, label: `Override for: ${p.name}` }))} /></div>
        {(["sla", "policy"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ ...btnGhost, ...(tab === t ? { background: "#1a2a4a", color: "white", borderColor: "#1a2a4a" } : {}) }}>{t === "sla" ? "Service-level targets" : "Escalation and policies"}</button>
        ))}
      </div>
      {tab === "sla" ? <SlaPanel key={projectId} projectId={projectId || undefined} /> : <PolicyPanel key={projectId} projectId={projectId || undefined} />}
    </PageShell>
  );
}
