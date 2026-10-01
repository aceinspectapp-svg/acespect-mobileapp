import { useEffect, useState } from "react";
import { api } from "../../api";
import { Card, PageShell, QcSubNav } from "../../components/WebLayout";
import type { QcConfigBundle } from "../../qcTypes";

const fieldStyle: React.CSSProperties = {
  padding: "8px 10px", borderRadius: "8px", border: "1.5px solid #e5e7eb",
  fontSize: "13px", color: "#1a2a4a", outline: "none", boxSizing: "border-box", fontFamily: "inherit",
};
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f1f5f9" };
const deleteBtnStyle: React.CSSProperties = { background: "none", border: "none", color: "#dc2626", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const addBtnStyle: React.CSSProperties = { padding: "8px 16px", borderRadius: "8px", border: "none", background: "#1a2a4a", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer" };

async function confirmDelete(what: string, fn: () => Promise<unknown>, after: () => void) {
  if (!window.confirm(`Delete this ${what}? This can't be undone.`)) return;
  try {
    await fn();
    after();
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "Delete failed");
  }
}

export function AdminQcConfig() {
  const [config, setConfig] = useState<QcConfigBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.qc.getConfig().then(setConfig).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }
  useEffect(reload, []);

  if (error) return <PageShell title="QC Configuration"><p style={{ color: "#dc2626" }}>{error}</p></PageShell>;
  if (!config) return <PageShell title="QC Configuration"><p style={{ color: "#94a3b8" }}>Loading…</p></PageShell>;

  const allProjects = config.clients.flatMap((c) => c.projects.map((p) => ({ ...p, clientName: c.name })));
  const allProperties = allProjects.flatMap((p) => p.properties.map((prop) => ({ ...prop, projectName: p.name, clientName: p.clientName })));

  return (
    <PageShell title="QC Configuration" subtitle="Everything here drives what inspectors and field users see on mobile — edit freely.">
      <QcSubNav />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <ClientsSection clients={config.clients} onChange={reload} />
        <ProjectsSection projects={allProjects} clients={config.clients} onChange={reload} />
        <PropertiesSection properties={allProperties} projects={allProjects} propertyTypes={config.propertyTypes} onChange={reload} />
        <PropertyTypesSection propertyTypes={config.propertyTypes} onChange={reload} />
      </div>
    </PageShell>
  );
}

function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Card style={{ padding: "18px 22px" }}>
      <h3 style={{ marginTop: 0, marginBottom: 2, fontSize: 15, color: "#1a2a4a" }}>{title}</h3>
      {sub && <p style={{ marginTop: 0, marginBottom: 12, fontSize: 12, color: "#94a3b8" }}>{sub}</p>}
      {children}
    </Card>
  );
}

function ClientsSection({ clients, onChange }: { clients: QcConfigBundle["clients"]; onChange: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.qc.createClient({ name: name.trim() });
      setName("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Clients" sub="The top level of the client → project → property hierarchy.">
      {clients.map((c) => (
        <div key={c.id} style={rowStyle}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2a4a" }}>{c.name}</span>
            <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 10 }}>{c.projects.length} project{c.projects.length === 1 ? "" : "s"}</span>
          </div>
          <button style={deleteBtnStyle} onClick={() => confirmDelete("client", () => api.qc.deleteClient(c.id), onChange)}>Delete</button>
        </div>
      ))}
      <form onSubmit={create} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input style={{ ...fieldStyle, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="New client name" />
        <button style={addBtnStyle} disabled={busy}>Add</button>
      </form>
    </SectionCard>
  );
}

function ProjectsSection({
  projects,
  clients,
  onChange,
}: {
  projects: { id: string; name: string; clientName: string }[];
  clients: QcConfigBundle["clients"];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !clientId) return;
    setBusy(true);
    try {
      await api.qc.createProject({ name: name.trim(), clientId });
      setName("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Projects">
      {projects.map((p) => (
        <div key={p.id} style={rowStyle}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2a4a" }}>{p.name}</span>
            <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 10 }}>{p.clientName}</span>
          </div>
          <button style={deleteBtnStyle} onClick={() => confirmDelete("project", () => api.qc.deleteProject(p.id), onChange)}>Delete</button>
        </div>
      ))}
      <form onSubmit={create} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <select style={{ ...fieldStyle, flex: "0 0 180px" }} value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Client…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input style={{ ...fieldStyle, flex: 1 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" />
        <button style={addBtnStyle} disabled={busy || !clientId}>Add</button>
      </form>
    </SectionCard>
  );
}

function PropertiesSection({
  properties,
  projects,
  propertyTypes,
  onChange,
}: {
  properties: { id: string; name: string; projectName: string; clientName: string; propertyType: { label: string } }[];
  projects: { id: string; name: string; clientName: string }[];
  propertyTypes: QcConfigBundle["propertyTypes"];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [propertyTypeId, setPropertyTypeId] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !projectId || !propertyTypeId) return;
    setBusy(true);
    try {
      await api.qc.createProperty({ name: name.trim(), projectId, propertyTypeId });
      setName("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Properties" sub="A lot, unit, or address within a project.">
      {properties.map((p) => (
        <div key={p.id} style={rowStyle}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2a4a" }}>{p.name}</span>
            <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 10 }}>{p.projectName} · {p.clientName} · {p.propertyType.label}</span>
          </div>
          <button style={deleteBtnStyle} onClick={() => confirmDelete("property", () => api.qc.deleteProperty(p.id), onChange)}>Delete</button>
        </div>
      ))}
      <form onSubmit={create} style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <select style={{ ...fieldStyle, flex: "0 0 180px" }} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.clientName} / {p.name}</option>)}
        </select>
        <select style={{ ...fieldStyle, flex: "0 0 140px" }} value={propertyTypeId} onChange={(e) => setPropertyTypeId(e.target.value)}>
          <option value="">Type…</option>
          {propertyTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <input style={{ ...fieldStyle, flex: 1, minWidth: 160 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="New property name (e.g. Lot 4677)" />
        <button style={addBtnStyle} disabled={busy || !projectId || !propertyTypeId}>Add</button>
      </form>
    </SectionCard>
  );
}

function PropertyTypesSection({ propertyTypes, onChange }: { propertyTypes: QcConfigBundle["propertyTypes"]; onChange: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("home-outline");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !label.trim()) return;
    setBusy(true);
    try {
      await api.qc.createPropertyType({ key: key.trim(), label: label.trim(), icon: icon.trim() || undefined });
      setKey("");
      setLabel("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Property Types" sub="House / Apartment / Townhouse / Duplex — shown as a picker on mobile.">
      {propertyTypes.map((t) => (
        <div key={t.id} style={rowStyle}>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#1a2a4a" }}>{t.label}</span>
            <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 10 }}>{t.key} · {t.icon}</span>
          </div>
          <button style={deleteBtnStyle} onClick={() => confirmDelete("property type", () => api.qc.deletePropertyType(t.id), onChange)}>Delete</button>
        </div>
      ))}
      <form onSubmit={create} style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input style={{ ...fieldStyle, flex: 1 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Studio)" />
        <input style={{ ...fieldStyle, flex: "0 0 120px" }} value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="key" />
        <input style={{ ...fieldStyle, flex: "0 0 140px" }} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="Ionicons name" />
        <button style={addBtnStyle} disabled={busy}>Add</button>
      </form>
    </SectionCard>
  );
}

