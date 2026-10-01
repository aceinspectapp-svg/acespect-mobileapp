import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../../api";
import { PageShell, PrimaryBtn, QcSubNav, StatusBadge, TableCard } from "../../components/WebLayout";
import type { QcConfigBundle, QcDefect, QcPerson } from "../../qcTypes";

const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e5e7eb",
  fontSize: "13px", color: "#1a2a4a", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const labelStyle: React.CSSProperties = { fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" };
const selectStyle: React.CSSProperties = { ...fieldStyle, padding: "5px 8px", fontSize: "12px", width: "auto" };

export function AdminQcDefects() {
  const [defects, setDefects] = useState<QcDefect[] | null>(null);
  const [config, setConfig] = useState<QcConfigBundle | null>(null);
  const [users, setUsers] = useState<QcPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  function reload() {
    Promise.all([api.qc.getDefects(), api.qc.getConfig(), api.qc.getAssignableUsers()])
      .then(([d, c, u]) => {
        setDefects(d);
        setConfig(c);
        setUsers(u);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }
  useEffect(reload, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setSavingId(id);
    try {
      await api.qc.updateDefect(id, body);
      reload();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <PageShell
      title="QC Defects"
      subtitle={defects ? `${defects.length} logged defect${defects.length === 1 ? "" : "s"}` : "Loading…"}
      actions={<PrimaryBtn onClick={() => setShowNew(true)}><Plus size={14} /> New Defect</PrimaryBtn>}
    >
      <QcSubNav />
      {error && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 14 }}>{error}</p>}

      <TableCard headers={["Property", "Defect", "Severity", "Status", "Assigned to", "Due"]}>
        {defects?.map((d, i) => (
          <tr key={d.id} style={{ borderBottom: defects.length - 1 > i ? "1px solid #f1f5f9" : "none" }}>
            <td style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2a4a" }}>{d.property.name}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>{d.project.name} · {d.client.name}</div>
            </td>
            <td style={{ padding: "14px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: d.summary ? "#1a2a4a" : "#94a3b8" }}>
                {d.summary ?? "Not yet detailed"}
              </div>
              {d.location && <div style={{ fontSize: 11, color: "#94a3b8" }}>{d.location}</div>}
            </td>
            <td style={{ padding: "14px 16px" }}>
              {d.severity ? (
                <StatusBadge label={d.severity.label} color={d.severity.color} bg={`${d.severity.color}18`} />
              ) : (
                <StatusBadge label="Not set" color="#94a3b8" bg="#f1f5f9" />
              )}
            </td>
            <td style={{ padding: "14px 16px" }}>
              <select
                value={d.status.id}
                disabled={savingId === d.id}
                onChange={(e) => patch(d.id, { statusId: e.target.value })}
                style={selectStyle}
              >
                {config?.statuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </td>
            <td style={{ padding: "14px 16px" }}>
              <select
                value={d.assignedTo?.id ?? ""}
                disabled={savingId === d.id}
                onChange={(e) => patch(d.id, { assignedToId: e.target.value || null })}
                style={selectStyle}
              >
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name ?? u.email}</option>
                ))}
              </select>
            </td>
            <td style={{ padding: "14px 16px", fontSize: 12, color: "#94a3b8" }}>
              {d.dueDate ? new Date(d.dueDate).toLocaleDateString() : "—"}
            </td>
          </tr>
        ))}
        {defects && defects.length === 0 && (
          <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No defects logged yet.</td></tr>
        )}
      </TableCard>

      {showNew && config && (
        <NewDefectModal
          config={config}
          users={users}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}
    </PageShell>
  );
}

/**
 * Admin only picks client → project → property and who it's assigned to --
 * location/location details/summary/severity/due date are deliberately left
 * out: the assigned field user fills those in on-site from the mobile app's
 * Defect screen, not the admin up front.
 */
function NewDefectModal({
  config,
  users,
  onClose,
  onCreated,
}: {
  config: QcConfigBundle;
  users: QcPerson[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projects = useMemo(() => config.clients.find((c) => c.id === clientId)?.projects ?? [], [config, clientId]);
  const properties = useMemo(() => projects.find((p) => p.id === projectId)?.properties ?? [], [projects, projectId]);
  const canSubmit = !!propertyId && !!assignedToId;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      await api.qc.createDefect({ propertyId, assignedToId });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create defect");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: "14px", width: "440px", maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)", overflowY: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>New Defect</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: "4px" }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 4px" }}>
            Location, description, and severity are filled in by the assigned field user on-site.
          </p>
          {error && <p style={{ fontSize: 12, color: "#dc2626", margin: 0 }}>{error}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelStyle}>Client</label>
              <select style={fieldStyle} value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(""); setPropertyId(""); }}>
                <option value="">Select…</option>
                {config.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Project</label>
              <select style={fieldStyle} value={projectId} disabled={!clientId} onChange={(e) => { setProjectId(e.target.value); setPropertyId(""); }}>
                <option value="">Select…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Property</label>
            <select style={fieldStyle} value={propertyId} disabled={!projectId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Select…</option>
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.propertyType.label})</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Assign to</label>
            <select style={fieldStyle} value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
              <option value="">Select…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email} ({u.role})</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", padding: "14px 20px", borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "white", fontSize: "12px", fontWeight: 600, color: "#374151", cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit || saving}
            style={{ padding: "8px 14px", borderRadius: "8px", border: "none", background: !canSubmit || saving ? "#94a3b8" : "#1a2a4a", fontSize: "12px", fontWeight: 600, color: "white", cursor: !canSubmit || saving ? "default" : "pointer" }}
          >
            {saving ? "Creating…" : "Create & assign"}
          </button>
        </div>
      </div>
    </div>
  );
}
