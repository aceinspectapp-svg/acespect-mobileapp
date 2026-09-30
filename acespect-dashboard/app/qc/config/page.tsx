"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, getRole } from "@/lib/api";
import { TopBar, QcNav } from "@/lib/ui";
import type { QcConfigBundle } from "@/lib/qcTypes";

export default function QcConfigPage() {
  const router = useRouter();
  const [config, setConfig] = useState<QcConfigBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api<QcConfigBundle>("/qc/config")
      .then(setConfig)
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) router.replace("/login");
        else setError(e.message);
      });
  }

  useEffect(() => {
    if (getRole() !== "ADMIN") {
      router.replace("/inspections");
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (error) {
    return (
      <>
        <TopBar />
        <div className="container">
          <div className="error">{error}</div>
        </div>
      </>
    );
  }
  if (!config) {
    return (
      <>
        <TopBar />
        <div className="container muted">Loading…</div>
      </>
    );
  }

  const allProjects = config.clients.flatMap((c) => c.projects.map((p) => ({ ...p, clientName: c.name })));
  const allProperties = allProjects.flatMap((p) =>
    p.properties.map((prop) => ({ ...prop, projectName: p.name, clientName: p.clientName })),
  );

  return (
    <>
      <TopBar />
      <div className="container">
        <h1 className="page-title">QC Configuration</h1>
        <p className="page-sub">Everything here drives what inspectors and field users see on mobile — edit freely.</p>
        <QcNav />

        <ClientsSection clients={config.clients} onChange={reload} />
        <ProjectsSection projects={allProjects} clients={config.clients} onChange={reload} />
        <PropertiesSection properties={allProperties} projects={allProjects} propertyTypes={config.propertyTypes} onChange={reload} />
        <PropertyTypesSection propertyTypes={config.propertyTypes} onChange={reload} />
        <SeveritiesSection severities={config.severities} onChange={reload} />
        <StatusesSection statuses={config.statuses} onChange={reload} />
      </div>
    </>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────

function SectionCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0, marginBottom: 2 }}>{title}</h3>
      {sub && <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>{sub}</p>}
      {children}
    </div>
  );
}

async function deleteEntity(path: string, onChange: () => void, label: string) {
  if (!window.confirm(`Delete this ${label}? This can't be undone.`)) return;
  try {
    await api(path, { method: "DELETE" });
    onChange();
  } catch (e) {
    window.alert(e instanceof Error ? e.message : "Delete failed");
  }
}

// ─── Clients ────────────────────────────────────────────────────────────────

function ClientsSection({ clients, onChange }: { clients: QcConfigBundle["clients"]; onChange: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/qc/clients", { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      setName("");
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create client");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Clients" sub="The top level of the client → project → property hierarchy.">
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      <table>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="muted">{c.projects.length} project{c.projects.length === 1 ? "" : "s"}</td>
              <td style={{ textAlign: "right" }}>
                <button className="link" onClick={() => deleteEntity(`/qc/clients/${c.id}`, onChange, "client")}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {clients.length === 0 && (
            <tr><td className="muted">No clients yet.</td></tr>
          )}
        </tbody>
      </table>
      <form onSubmit={create} className="row" style={{ marginTop: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New client name" style={{ flex: 1 }} />
        <button className="primary" disabled={busy}>Add</button>
      </form>
    </SectionCard>
  );
}

// ─── Projects ───────────────────────────────────────────────────────────────

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
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !clientId) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/qc/projects", { method: "POST", body: JSON.stringify({ name: name.trim(), clientId }) });
      setName("");
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Projects">
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      <table>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="muted">{p.clientName}</td>
              <td style={{ textAlign: "right" }}>
                <button className="link" onClick={() => deleteEntity(`/qc/projects/${p.id}`, onChange, "project")}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {projects.length === 0 && <tr><td className="muted">No projects yet.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={create} className="row" style={{ marginTop: 12 }}>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ flex: "0 0 200px" }}>
          <option value="">Client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" style={{ flex: 1 }} />
        <button className="primary" disabled={busy || !clientId}>Add</button>
      </form>
    </SectionCard>
  );
}

// ─── Properties ─────────────────────────────────────────────────────────────

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
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !projectId || !propertyTypeId) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/qc/properties", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), projectId, propertyTypeId }),
      });
      setName("");
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create property");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Properties" sub="A lot, unit, or address within a project.">
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      <table>
        <tbody>
          {properties.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td className="muted">{p.projectName} · {p.clientName}</td>
              <td><span className="badge slate">{p.propertyType.label}</span></td>
              <td style={{ textAlign: "right" }}>
                <button className="link" onClick={() => deleteEntity(`/qc/properties/${p.id}`, onChange, "property")}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {properties.length === 0 && <tr><td className="muted">No properties yet.</td></tr>}
        </tbody>
      </table>
      <form onSubmit={create} className="row" style={{ marginTop: 12 }}>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ flex: "0 0 200px" }}>
          <option value="">Project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.clientName} / {p.name}</option>
          ))}
        </select>
        <select value={propertyTypeId} onChange={(e) => setPropertyTypeId(e.target.value)} style={{ flex: "0 0 160px" }}>
          <option value="">Type…</option>
          {propertyTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New property name (e.g. Lot 4677)" style={{ flex: 1 }} />
        <button className="primary" disabled={busy || !projectId || !propertyTypeId}>Add</button>
      </form>
    </SectionCard>
  );
}

// ─── Property Types ─────────────────────────────────────────────────────────

function PropertyTypesSection({ propertyTypes, onChange }: { propertyTypes: QcConfigBundle["propertyTypes"]; onChange: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [icon, setIcon] = useState("home-outline");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !label.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/qc/property-types", { method: "POST", body: JSON.stringify({ key: key.trim(), label: label.trim(), icon: icon.trim() || undefined }) });
      setKey("");
      setLabel("");
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create property type");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Property Types" sub="House / Apartment / Townhouse / Duplex — shown as a picker on mobile.">
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      <table>
        <tbody>
          {propertyTypes.map((t) => (
            <tr key={t.id}>
              <td>{t.label}</td>
              <td className="muted">{t.key}</td>
              <td className="muted">{t.icon}</td>
              <td style={{ textAlign: "right" }}>
                <button className="link" onClick={() => deleteEntity(`/qc/property-types/${t.id}`, onChange, "property type")}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} className="row" style={{ marginTop: 12 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Studio)" style={{ flex: 1 }} />
        <input value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="key" style={{ flex: "0 0 140px" }} />
        <input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="Ionicons name" style={{ flex: "0 0 160px" }} />
        <button className="primary" disabled={busy}>Add</button>
      </form>
    </SectionCard>
  );
}

// ─── Severities ─────────────────────────────────────────────────────────────

function SeveritiesSection({ severities, onChange }: { severities: QcConfigBundle["severities"]; onChange: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#DC2626");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !label.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/qc/severities", { method: "POST", body: JSON.stringify({ key: key.trim(), label: label.trim(), color }) });
      setKey("");
      setLabel("");
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create severity");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Severities" sub="Major / Moderate / Minor / Observation — also drives a task's auto-assigned priority.">
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      <table>
        <tbody>
          {severities.map((s) => (
            <tr key={s.id}>
              <td><span className="badge" style={{ background: `${s.color}22`, color: s.color }}>{s.label}</span></td>
              <td className="muted">{s.key}</td>
              <td style={{ textAlign: "right" }}>
                <button className="link" onClick={() => deleteEntity(`/qc/severities/${s.id}`, onChange, "severity")}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} className="row" style={{ marginTop: 12 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" style={{ flex: 1 }} />
        <input value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="key" style={{ flex: "0 0 140px" }} />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ flex: "0 0 56px", padding: 2 }} />
        <button className="primary" disabled={busy}>Add</button>
      </form>
    </SectionCard>
  );
}

// ─── Statuses ───────────────────────────────────────────────────────────────

function StatusesSection({ statuses, onChange }: { statuses: QcConfigBundle["statuses"]; onChange: () => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#2563EB");
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !label.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api("/qc/statuses", {
        method: "POST",
        body: JSON.stringify({ key: key.trim(), label: label.trim(), color, meaning: meaning.trim() || undefined }),
      });
      setKey("");
      setLabel("");
      setMeaning("");
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create status");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Defect Statuses" sub="The lifecycle stages a defect moves through, in order — Open through Verified/Closed.">
      {err && <div className="error" style={{ marginBottom: 10 }}>{err}</div>}
      <table>
        <thead>
          <tr><th>Status</th><th>Meaning</th><th></th></tr>
        </thead>
        <tbody>
          {statuses.map((s) => (
            <tr key={s.id}>
              <td><span className="badge" style={{ background: `${s.color}22`, color: s.color }}>{s.label}</span></td>
              <td className="muted">{s.meaning}</td>
              <td style={{ textAlign: "right" }}>
                <button className="link" onClick={() => deleteEntity(`/qc/statuses/${s.id}`, onChange, "status")}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={create} style={{ marginTop: 12 }}>
        <div className="row">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" style={{ flex: 1 }} />
          <input value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} placeholder="key" style={{ flex: "0 0 140px" }} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ flex: "0 0 56px", padding: 2 }} />
        </div>
        <div className="spacer" />
        <div className="row">
          <input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder="Meaning (shown in the status-change sheet)" style={{ flex: 1 }} />
          <button className="primary" disabled={busy}>Add</button>
        </div>
      </form>
    </SectionCard>
  );
}
