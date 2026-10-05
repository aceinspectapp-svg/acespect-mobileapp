import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { api } from "../../api";
import { PageShell, PrimaryBtn, QcSubNav, StatusBadge, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, Modal, Select, btnGhost, btnPrimary, cell, sub } from "../../components/QcUi";
import { inputStyle, type RefOption } from "../../components/SpecForm";
import type { QcConfigBundle, QcDefect, QcLotRow, QcPerson } from "../../qcTypes";
import { useQc } from "../../qcContext";

export const FLAG_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  urgent: { label: "Urgent", color: "#991b1b", bg: "#fee2e2" },
  escalated: { label: "Escalated", color: "#9a3412", bg: "#ffedd5" },
  overdue: { label: "Overdue", color: "#92400e", bg: "#fef3c7" },
};

export function SeverityBadge({ severity }: { severity: QcDefect["severity"] }) {
  return severity ? <StatusBadge label={severity.label} color={severity.color} bg={`${severity.color}18`} /> : <StatusBadge label="Not set" color="#94a3b8" bg="#f1f5f9" />;
}
export function StatusChip({ status }: { status: QcDefect["status"] }) {
  return <StatusBadge label={status.label} color={status.color} bg={`${status.color}18`} />;
}
export function FlagChips({ defect }: { defect: QcDefect }) {
  return (
    <>
      {defect.flags.map((f) => FLAG_STYLE[f] && <span key={f} style={{ marginLeft: 4 }}><StatusBadge label={FLAG_STYLE[f].label} color={FLAG_STYLE[f].color} bg={FLAG_STYLE[f].bg} /></span>)}
      {defect.reworkCount > 0 && <span style={{ marginLeft: 4 }}><StatusBadge label={`Rework ×${defect.reworkCount}`} color="#7c2d12" bg="#ffedd5" /></span>}
    </>
  );
}

export function AdminQcDefects() {
  const navigate = useNavigate();
  const { can } = useQc();
  const [defects, setDefects] = useState<QcDefect[] | null>(null);
  const [config, setConfig] = useState<QcConfigBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [filters, setFilters] = useState({ q: "", status: "", severity: "", projectId: "", flag: "", draft: "" });
  const [picked, setPicked] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Saved views live in this browser only: a named set of filters.
  const VIEWS_KEY = "acespect_defect_views";
  const readViews = (): Record<string, typeof filters> => { try { return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "{}"); } catch { return {}; } };
  const [views, setViews] = useState<Record<string, typeof filters>>(readViews);
  const saveView = () => {
    const name = window.prompt("Name this view:")?.trim();
    if (!name) return;
    const next = { ...views, [name]: filters };
    try { localStorage.setItem(VIEWS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    setViews(next);
  };

  useEffect(() => { api.qc.getConfig().then(setConfig).catch((e) => setError(e.message)); }, []);
  const load = useCallback(() => {
    api.qc.defects.list(filters).then(setDefects).catch((e) => setError(e.message));
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof typeof filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const releasable = (defects ?? []).filter((d) => !d.isDraft && d.status.key === "open");
  async function releaseSelected() {
    const r = await api.qc.defects.bulkRelease(picked);
    const failed = r.results.filter((x) => !x.ok);
    setNotice(`${r.results.length - failed.length} released${failed.length ? `, ${failed.length} not released: ${failed.map((f) => f.message).join("; ")}` : ""}.`);
    setPicked([]);
    load();
  }
  const projects = (config?.clients ?? []).flatMap((c) => c.projects.map((p) => ({ id: p.id, label: `${c.name} / ${p.name}` })));

  return (
    <PageShell
      title="Defects"
      subtitle={defects ? `${defects.length} defect${defects.length === 1 ? "" : "s"}` : "Loading…"}
      actions={can("defects.create") ? <PrimaryBtn onClick={() => setShowNew(true)}><Plus size={14} /> New defect</PrimaryBtn> : undefined}
    >
      <QcSubNav />
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <input style={{ ...inputStyle, width: 230 }} placeholder="Search ref, title or location" value={filters.q} onChange={(e) => set("q")(e.target.value)} />
        <div style={{ width: 180 }}><Select value={filters.status} onChange={set("status")} placeholder="All statuses" options={(config?.statuses ?? []).map((s) => ({ id: s.key, label: s.label }))} /></div>
        <div style={{ width: 180 }}><Select value={filters.severity} onChange={set("severity")} placeholder="All severities" options={(config?.severities ?? []).map((s) => ({ id: s.key, label: s.label }))} /></div>
        <div style={{ width: 240 }}><Select value={filters.projectId} onChange={set("projectId")} placeholder="All projects" options={projects} /></div>
        <div style={{ width: 150 }}><Select value={filters.flag} onChange={set("flag")} placeholder="Any flag" options={Object.entries(FLAG_STYLE).map(([id, f]) => ({ id, label: f.label }))} /></div>
        {Object.keys(views).length > 0 && <div style={{ width: 170 }}><Select value="" onChange={(n) => n && setFilters(views[n]!)} placeholder="Saved views" options={Object.keys(views).map((n) => ({ id: n, label: n }))} /></div>}
        <button style={btnGhost} onClick={saveView}>Save this view</button>
        <div style={{ width: 150 }}>
          <Select value={filters.draft} onChange={set("draft")} placeholder="Drafts & open" options={[{ id: "true", label: "Drafts only" }, { id: "false", label: "Confirmed only" }]} />
        </div>
      </div>
      <ErrorNote message={error} />
      {notice && <p role="status" style={{ fontSize: 13, color: "#15803d" }}>{notice}</p>}
      {can("defects.create") && releasable.length > 0 && <div style={{ marginBottom: 10 }}><button style={btnPrimary} disabled={picked.length === 0} onClick={releaseSelected}>Release {picked.length || ""} selected to the Builder</button> <span style={sub}>Tick confirmed (Open) defects to release them together.</span></div>}
      <TableCard headers={["", "Ref", "Defect", "Lot", "Severity", "Status", "Assigned to", "Updated"]}>
        {defects?.map((d, i) => (
          <tr key={d.id} style={{ borderBottom: defects.length - 1 > i ? "1px solid #f1f5f9" : "none", cursor: "pointer" }} onClick={() => navigate(`/qc/defects/${d.id}`)}>
            <td style={cell} onClick={(e) => e.stopPropagation()}>{!d.isDraft && d.status.key === "open" && can("defects.create") && <input type="checkbox" aria-label={`Select ${d.defectRef ?? "defect"}`} checked={picked.includes(d.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, d.id] : picked.filter((x) => x !== d.id))} />}</td>
            <td style={{ ...cell, fontFamily: "monospace", fontSize: 12, whiteSpace: "nowrap" }}>{d.defectRef ?? "—"}</td>
            <td style={cell}>
              <b style={{ color: d.title || d.summary ? "#1a2a4a" : "#94a3b8" }}>{d.title ?? d.summary ?? "Draft: details pending"}</b>
              {d.isDraft && <span style={{ marginLeft: 6 }}><StatusBadge label="Draft" color="#475569" bg="#e2e8f0" /></span>}
              {d.location && <div style={sub}>{d.location}</div>}
            </td>
            <td style={cell}>{d.property.name}<div style={sub}>{d.project.name} · {d.client.name}</div></td>
            <td style={cell}><SeverityBadge severity={d.severity} /></td>
            <td style={cell}><StatusChip status={d.status} /><FlagChips defect={d} /></td>
            <td style={cell}>{d.assignedTo?.name ?? d.assignedTo?.email ?? "—"}</td>
            <td style={{ ...cell, fontSize: 12, color: "#94a3b8" }}>{new Date(d.updatedAt).toLocaleDateString("en-AU")}</td>
          </tr>
        ))}
        {defects?.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No defects match.</td></tr>}
      </TableCard>

      {showNew && config && (
        <NewDefectModal config={config} onClose={() => setShowNew(false)} onCreated={(id) => navigate(`/qc/defects/${id}`)} />
      )}
    </PageShell>
  );
}

/**
 * The admin picks client, project, lot and who is assigned. Everything else
 * (title, location, severity, photos...) is filled in on site and confirmed as
 * Open by the Private Inspector, or by the admin acting for them from the
 * defect page.
 */
function NewDefectModal({ config, onClose, onCreated }: { config: QcConfigBundle; onClose: () => void; onCreated: (id: string) => void }) {
  const [clientId, setClientId] = useState(config.clients.length === 1 ? config.clients[0]!.id : "");
  const [projectId, setProjectId] = useState("");
  const [lotId, setLotId] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [lots, setLots] = useState<QcLotRow[]>([]);
  const [users, setUsers] = useState<QcPerson[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.qc.getAssignableUsers().then(setUsers).catch(() => setUsers([])); }, []);
  useEffect(() => {
    setLotId("");
    if (projectId) api.qc.lots.list({ projectId }).then(setLots).catch(() => setLots([]));
    else setLots([]);
  }, [projectId]);

  const projects = config.clients.find((c) => c.id === clientId)?.projects ?? [];
  const assignees: RefOption[] = users.map((u) => {
    const role = u.qcMemberships?.find((m) => !clientId || m.client.id === clientId)?.role;
    return { id: u.id, label: `${u.name ?? u.email}${role ? ` (${role.replace(/_/g, " ").toLowerCase()})` : ""}` };
  });

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const d = await api.qc.defects.create({ propertyId: lotId, assignedToId });
      onCreated(d.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = !!lotId && !!assignedToId;
  return (
    <Modal
      title="New defect"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: !canSubmit || saving ? 0.6 : 1 }} disabled={!canSubmit || saving} onClick={submit}>{saving ? "Creating…" : "Create & assign"}</button>
        </>
      }
    >
      <ErrorNote message={error} />
      <p style={{ ...sub, marginTop: 0 }}>The defect starts as a draft. The assigned inspector adds the description, severity and photos, then confirms it as Open.</p>
      <div style={{ display: "grid", gap: 12 }}>
        {config.clients.length > 1 && <Field label="Client" required>
          <Select value={clientId} onChange={(v) => { setClientId(v); setProjectId(""); }} options={config.clients.map((c) => ({ id: c.id, label: c.name }))} />
        </Field>}
        <Field label="Project" required>
          <Select value={projectId} disabled={!clientId} onChange={setProjectId} options={projects.map((p) => ({ id: p.id, label: p.name }))} />
        </Field>
        <Field label="Lot" required>
          <Select value={lotId} disabled={!projectId} onChange={setLotId} options={lots.map((l) => ({ id: l.id, label: `${l.name}${l.site ? ` · ${l.site.name}` : ""}` }))} />
        </Field>
        <Field label="Assign to" required>
          <Select value={assignedToId} onChange={setAssignedToId} options={assignees} />
        </Field>
      </div>
    </Modal>
  );
}
