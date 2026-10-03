import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Plus } from "lucide-react";
import { api } from "../../api";
import { Card, PageShell, PrimaryBtn, QcSubNav, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, FormDialog, Select, btnDanger, btnLink, cell, statusPill, sub, showValue, useRefData } from "../../components/QcUi";
import type { RefOption } from "../../components/SpecForm";
import type { QcLotRow, QcProjectRow, QcSiteRow, QcTeamMember } from "../../qcTypes";
import { useQc } from "../../qcContext";
import { DlpPanel, DocumentsPanel, LotImportDialog, PlanPanel, StatusMover } from "../portal/QcProjectPanels";
import { PolicyPanel, SlaPanel } from "../portal/QcPolicy";

function projectInitial(p: QcProjectRow): Record<string, unknown> {
  return { ...p.data, developer: p.clientId, builder: p.builderId };
}

// ─── Project list ────────────────────────────────────────────────────────────

export function AdminQcProjects() {
  const { data, refOptions } = useRefData();
  const { me, can } = useQc();
  const navigate = useNavigate();
  const [rows, setRows] = useState<QcProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => api.qc.projects.list().then(setRows).catch((e) => setError(e.message)), []);
  useEffect(() => { reload(); }, [reload]);

  const builderOptions = (value: Record<string, unknown>): Record<string, RefOption[]> => ({
    builder: (data?.masterContractors ?? []).filter((m) => m.clientId === value.developer).map((m) => ({ id: m.id, label: m.name })),
  });

  return (
    <PageShell
      title="Projects"
      subtitle={rows ? `${rows.length} project${rows.length === 1 ? "" : "s"}` : "Loading…"}
      actions={can("projects.create") ? <PrimaryBtn onClick={() => setCreating(true)}><Plus size={14} /> New project</PrimaryBtn> : undefined}
    >
      <QcSubNav />
      <ErrorNote message={error} />
      <TableCard headers={["Project", "Job no.", "Client / developer", "Builder", "State", "Sites · Lots", "Status", ""]}>
        {rows?.map((p, i) => (
          <tr key={p.id} style={{ borderBottom: rows.length - 1 > i ? "1px solid #f1f5f9" : "none", cursor: "pointer" }} onClick={() => navigate(`/qc/projects/${p.id}`)}>
            <td style={cell}><b>{p.name}</b><div style={sub}>{p.projectRef}</div></td>
            <td style={cell}>{p.jobNumber ?? "—"}</td>
            <td style={cell}>{p.client.name}</td>
            <td style={cell}>{p.builder?.name ?? "—"}</td>
            <td style={cell}>{p.state ?? "—"}</td>
            <td style={cell}>{p._count.sites} · {p._count.properties}</td>
            <td style={cell}>{statusPill(p.status)}</td>
            <td style={{ ...cell, textAlign: "right" }}><span style={btnLink}>Open</span></td>
          </tr>
        ))}
        {rows?.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No projects yet.</td></tr>}
      </TableCard>

      {creating && data && (
        <FormDialog
          title="New project"
          formCode="E07"
          initial={{ dlp_length: 12, developer: me?.clientId ?? undefined }}
          hide={me?.isSA ? [] : ["developer"]}
          refOptions={refOptions}
          fieldOptions={builderOptions}
          note={<p style={{ ...sub, marginTop: 0 }}>Closure policy, service-level targets and escalation are set on the project's SLA and policy tab once it exists. The project starts in Set-up.</p>}
          onClose={() => setCreating(false)}
          onSubmit={async (payload) => {
            const created = await api.qc.projects.create(payload);
            setCreating(false);
            navigate(`/qc/projects/${created.id}`);
          }}
        />
      )}
    </PageShell>
  );
}

// ─── Project detail: sites, lots, team ───────────────────────────────────────

type DetailTab = "sites" | "lots" | "team" | "plan" | "documents" | "sla" | "policy" | "dlp";
const TAB_LABEL: Record<DetailTab, string> = { sites: "Sites", lots: "Lots", team: "Team", plan: "Inspection plan", documents: "Documents", sla: "Service levels", policy: "Escalation and policy", dlp: "DLP" };

export function AdminQcProjectDetail() {
  const { id = "" } = useParams();
  const { data, refOptions } = useRefData();
  const [project, setProject] = useState<QcProjectRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("sites");
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const { me, can } = useQc();

  const reload = useCallback(() => api.qc.projects.get(id).then(setProject).catch((e) => setError(e.message)), [id]);
  useEffect(() => { reload(); }, [reload]);

  if (error) return <PageShell title="Project"><QcSubNav /><ErrorNote message={error} /></PageShell>;
  if (!project) return <PageShell title="Project"><QcSubNav /><p style={sub}>Loading…</p></PageShell>;

  const builderOptions = (value: Record<string, unknown>): Record<string, RefOption[]> => ({
    builder: (data?.masterContractors ?? []).filter((m) => m.clientId === value.developer).map((m) => ({ id: m.id, label: m.name })),
  });
  const policyLabel = ({ DEVELOPER_SIGNOFF: "Developer signs off", AUTO_CLOSE: "Closed automatically when verified", INSPECTOR_CLOSE: "Inspector closes" } as Record<string, string>)[project.closurePolicy] ?? project.closurePolicy;

  return (
    <PageShell
      title={project.name}
      subtitle={`${project.projectRef} · Job ${project.jobNumber ?? "—"} · ${project.client.name}`}
      actions={<div style={{ display: "flex", gap: 8, alignItems: "center" }}><StatusMover project={project} onChange={reload} />{can("projects.create") && <PrimaryBtn onClick={() => setEditing(true)}>Edit project</PrimaryBtn>}</div>}
    >
      <QcSubNav />
      <Link to="/qc/projects" style={{ ...btnLink, display: "inline-block", marginBottom: 12 }}>← All projects</Link>
      <Card style={{ padding: "16px 20px", marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <Summary label="Builder" value={project.builder?.name ?? "—"} />
        <Summary label="State / council" value={`${project.state ?? "—"} · ${showValue(project.data.local_government_area)}`} />
        <Summary label="Practical completion (expected)" value={showValue(project.data.expected_practical_completion_date)} />
        <Summary label="DLP length" value={`${showValue(project.data.dlp_length)} months`} />
        <Summary label="Status" value={statusPill(project.status)} />
        <Summary label="DLP ends" value={project.dlpEndDate ? new Date(project.dlpEndDate).toLocaleDateString("en-AU") : "Not started"} />
        <Summary label="Closure" value={policyLabel} />
        <Summary label="Safety Hazard auto-release" value={project.safetyAutoRelease ? "On" : "Off"} />
        <Summary label="Evidence-only re-inspection" value={project.deskReviewAllowed ? "Allowed (Minor, Monitor)" : "Not allowed"} />
      </Card>

      <div style={{ display: "flex", gap: 6, marginBottom: 16, borderBottom: "1px solid #e5e7eb" }}>
        {(["sites", "lots", "team", "plan", "documents", "sla", "policy", "dlp"] as DetailTab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} role="tab" aria-selected={tab === t} style={{
            padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "none", border: "none",
            color: tab === t ? "#1a2a4a" : "#94a3b8", borderBottom: tab === t ? "2px solid #1a2a4a" : "2px solid transparent", marginBottom: -1,
          }}>{TAB_LABEL[t]}</button>
        ))}
      </div>

      {tab === "sites" && <Sites project={project} onChange={reload} />}
      {tab === "lots" && <Lots project={project} onChange={reload} onImport={can("projects.create") ? () => setImporting(true) : undefined} />}
      {tab === "team" && <Team project={project} onChange={reload} />}
      {tab === "plan" && <PlanPanel project={project} />}
      {tab === "documents" && <DocumentsPanel project={project} />}
      {tab === "sla" && <SlaPanel projectId={project.id} />}
      {tab === "policy" && <PolicyPanel projectId={project.id} />}
      {tab === "dlp" && <DlpPanel project={project} onChange={reload} />}
      {importing && <LotImportDialog project={project} onClose={() => setImporting(false)} onDone={reload} />}

      {editing && data && (
        <FormDialog
          title={`Edit ${project.name}`}
          formCode="E07"
          initial={projectInitial(project)}
          refOptions={refOptions}
          fieldOptions={builderOptions}
          hide={me?.isSA ? [] : ["developer"]}
          onClose={() => setEditing(false)}
          onSubmit={async (payload) => {
            await api.qc.projects.update(project.id, payload);
            setEditing(false);
            reload();
          }}
        />
      )}
    </PageShell>
  );
}

function Summary({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#1a2a4a" }}>{value}</div>
    </div>
  );
}

// ─── Sites (E08) ─────────────────────────────────────────────────────────────

function Sites({ project, onChange }: { project: QcProjectRow; onChange: () => void }) {
  const [dialog, setDialog] = useState<{ row?: QcSiteRow } | null>(null);
  const sites = project.sites ?? [];

  async function toggleArchive(site: QcSiteRow) {
    try {
      await api.qc.sites.update(site.id, { status: site.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" });
      onChange();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }
  async function remove(site: QcSiteRow) {
    if (!window.confirm(`Delete ${site.name}?`)) return;
    try {
      await api.qc.sites.remove(site.id);
      onChange();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <PrimaryBtn onClick={() => setDialog({})}><Plus size={14} /> Add site</PrimaryBtn>
      </div>
      <TableCard headers={["Site", "Address", "Site contact", "Induction", "Status", ""]}>
        {sites.map((s, i) => (
          <tr key={s.id} style={{ borderBottom: sites.length - 1 > i ? "1px solid #f1f5f9" : "none" }}>
            <td style={cell}><b>{s.name}</b></td>
            <td style={cell}>{showValue(s.data.site_address)}</td>
            <td style={cell}>{showValue(s.data.site_contact_name)}<div style={sub}>{showValue(s.data.site_contact_mobile)}</div></td>
            <td style={cell}>{showValue(s.data.site_induction_required)}</td>
            <td style={cell}>{statusPill(s.status)}</td>
            <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
              <button style={btnLink} onClick={() => setDialog({ row: s })}>Edit</button>{" "}
              <button style={btnLink} onClick={() => toggleArchive(s)}>{s.status === "ACTIVE" ? "Archive" : "Restore"}</button>{" "}
              <button style={btnDanger} onClick={() => remove(s)}>Delete</button>
            </td>
          </tr>
        ))}
        {sites.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No sites yet. A project can have several.</td></tr>}
      </TableCard>
      {dialog && (
        <FormDialog
          title={dialog.row ? `Edit ${dialog.row.name}` : "Add site"}
          formCode="E08"
          initial={dialog.row?.data ?? { site_induction_required: false }}
          onClose={() => setDialog(null)}
          onSubmit={async (payload) => {
            if (dialog.row) await api.qc.sites.update(dialog.row.id, payload);
            else await api.qc.sites.create({ ...payload, projectId: project.id });
            setDialog(null);
            onChange();
          }}
        />
      )}
    </>
  );
}

// ─── Lots (E09) ──────────────────────────────────────────────────────────────

function Lots({ project, onChange, onImport }: { project: QcProjectRow; onChange: () => void; onImport?: () => void }) {
  const [lots, setLots] = useState<QcLotRow[] | null>(null);
  const [siteFilter, setSiteFilter] = useState("");
  const [dialog, setDialog] = useState<{ row?: QcLotRow } | null>(null);
  const siteOptions = useMemo(() => (project.sites ?? []).map((s) => ({ id: s.id, label: s.name })), [project.sites]);

  const load = useCallback(() => api.qc.lots.list({ projectId: project.id, siteId: siteFilter || undefined }).then(setLots), [project.id, siteFilter]);
  useEffect(() => { load(); }, [load]);

  async function remove(lot: QcLotRow) {
    if (!window.confirm(`Delete ${lot.name}?`)) return;
    try {
      await api.qc.lots.remove(lot.id);
      load();
      onChange();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ width: 240 }}>
          <Select value={siteFilter} onChange={setSiteFilter} options={siteOptions} placeholder="All sites" />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {onImport && <button style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", fontSize: 13, fontWeight: 600, cursor: "pointer" }} onClick={() => (siteOptions.length ? onImport() : window.alert("Add a site first; every lot belongs to a site."))}>Import from CSV</button>}
          <PrimaryBtn onClick={() => (siteOptions.length ? setDialog({}) : window.alert("Add a site first; every lot belongs to a site."))}><Plus size={14} /> Add lot</PrimaryBtn>
        </div>
      </div>
      <TableCard headers={["Lot", "Site", "Dwelling", "NCC class", "Storeys", "Floor system", "Lot status", ""]}>
        {lots?.map((l, i) => (
          <tr key={l.id} style={{ borderBottom: lots.length - 1 > i ? "1px solid #f1f5f9" : "none" }}>
            <td style={cell}><b>{l.name}</b></td>
            <td style={cell}>{l.site?.name ?? "—"}</td>
            <td style={cell}>{showValue(l.data.dwelling_type)}</td>
            <td style={cell}>{showValue(l.data.ncc_building_class)}</td>
            <td style={cell}>{showValue(l.data.storeys)}</td>
            <td style={cell}>{showValue(l.data.floor_system)}</td>
            <td style={cell}>{l.lotStatus.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</td>
            <td style={{ ...cell, whiteSpace: "nowrap", textAlign: "right" }}>
              <button style={btnLink} onClick={() => setDialog({ row: l })}>Edit</button>{" "}
              <button style={btnDanger} onClick={() => remove(l)}>Delete</button>
            </td>
          </tr>
        ))}
        {lots?.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No lots yet.</td></tr>}
      </TableCard>
      {dialog && (
        <FormDialog
          title={dialog.row ? `Edit ${dialog.row.name}` : "Add lot"}
          formCode="E09"
          initial={dialog.row ? { ...dialog.row.data, siteId: dialog.row.siteId } : { siteId: siteFilter || (siteOptions.length === 1 ? siteOptions[0]!.id : "") }}
          extra={(v, set) => (
            <Field label="Site" required>
              <Select value={String(v.siteId ?? "")} disabled={!!dialog.row} onChange={(x) => set({ siteId: x })} options={siteOptions} />
            </Field>
          )}
          onClose={() => setDialog(null)}
          onSubmit={async (payload) => {
            if (dialog.row) await api.qc.lots.update(dialog.row.id, payload);
            else await api.qc.lots.create(payload);
            setDialog(null);
            load();
            onChange();
          }}
        />
      )}
    </>
  );
}

// ─── Team (E10) ──────────────────────────────────────────────────────────────

const ASSIGNEE_TYPES: RefOption[] = [
  { id: "PERSON", label: "Person" },
  { id: "TRADE_COMPANY", label: "Trade company" },
  { id: "MASTER_CONTRACTOR", label: "Master Contractor organisation" },
];

function Team({ project, onChange }: { project: QcProjectRow; onChange: () => void }) {
  const { data, refOptions } = useRefData();
  const [team, setTeam] = useState<QcTeamMember[] | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => api.qc.projects.team(project.id).then(setTeam), [project.id]);
  useEffect(() => { load(); }, [load]);

  async function remove(m: QcTeamMember) {
    const reason = window.prompt("Remove from the project team. Reason (required if they have open items):") ?? null;
    if (reason === null) return;
    try {
      await api.qc.projects.removeTeamMember(m.id, reason);
      load();
    } catch (e) {
      window.alert((e as Error).message);
    }
  }

  const assigneeOptions = (type: string): RefOption[] => {
    if (!data) return [];
    if (type === "PERSON") {
      return data.people
        .filter((p) => p.qcMemberships.some((m) => m.client.id === project.clientId && m.status === "ACTIVE"))
        .map((p) => ({ id: p.id, label: `${p.name ?? p.email} (${p.qcMemberships.find((m) => m.client.id === project.clientId)?.role.replace(/_/g, " ").toLowerCase()})` }));
    }
    if (type === "TRADE_COMPANY") return data.tradeCompanies.map((t) => ({ id: t.id, label: t.name }));
    return data.masterContractors.filter((m) => m.clientId === project.clientId).map((m) => ({ id: m.id, label: m.name }));
  };
  const nameOf = (m: QcTeamMember) => m.user?.name ?? m.user?.email ?? m.tradeCompany?.name ?? m.masterContractor?.name ?? "—";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <PrimaryBtn onClick={() => setAdding(true)}><Plus size={14} /> Assign to project</PrimaryBtn>
      </div>
      <TableCard headers={["Assignee", "Type", "Project role", "Start", "End", ""]}>
        {team?.map((m, i) => (
          <tr key={m.id} style={{ borderBottom: team.length - 1 > i ? "1px solid #f1f5f9" : "none" }}>
            <td style={cell}><b>{nameOf(m)}</b></td>
            <td style={cell}>{ASSIGNEE_TYPES.find((t) => t.id === m.assigneeType)?.label ?? m.assigneeType}</td>
            <td style={cell}>{m.projectRole}</td>
            <td style={cell}>{showValue(m.data.start_date)}</td>
            <td style={cell}>{showValue(m.data.end_date)}</td>
            <td style={{ ...cell, textAlign: "right" }}><button style={btnDanger} onClick={() => remove(m)}>Remove</button></td>
          </tr>
        ))}
        {team?.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>Nobody assigned yet.</td></tr>}
      </TableCard>
      {adding && data && (
        <FormDialog
          title="Assign to project"
          formCode="E10"
          initial={{ assigneeType: "PERSON", start_date: new Date().toISOString().slice(0, 10) }}
          hide={["project", "assignee_type", "assignee"]}
          refOptions={{ ...refOptions, E08: (project.sites ?? []).map((s) => ({ id: s.id, label: s.name })) }}
          extra={(v, set) => (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Assign a" required>
                <Select value={String(v.assigneeType ?? "PERSON")} onChange={(x) => set({ assigneeType: x, assigneeId: "" })} options={ASSIGNEE_TYPES} placeholder="Choose…" />
              </Field>
              <Field label="Assignee" required>
                <Select value={String(v.assigneeId ?? "")} onChange={(x) => set({ assigneeId: x })} options={assigneeOptions(String(v.assigneeType ?? "PERSON"))} />
              </Field>
            </div>
          )}
          onClose={() => setAdding(false)}
          onSubmit={async (payload) => {
            await api.qc.projects.addTeamMember(project.id, payload);
            setAdding(false);
            load();
            onChange();
          }}
        />
      )}
    </>
  );
}

