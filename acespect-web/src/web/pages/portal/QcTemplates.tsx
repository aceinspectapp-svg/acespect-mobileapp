import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { PageShell, Card, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, FormDialog, Modal, Select, btnDanger, btnGhost, btnLink, btnPrimary, cell, sub } from "../../components/QcUi";
import { inputStyle } from "../../components/SpecForm";
import { qcx, type StageDef, type TemplateItem, type TemplateRow } from "../../qcApi";
import { useQc } from "../../qcContext";
import { API_BASE, getActiveClientId, getToken } from "../../api";
import type { QcProjectRow } from "../../qcTypes";
import { api } from "../../api";

const statusChip = (s: string) => (
  <span style={{ padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", background: s === "PUBLISHED" ? "#d1fae5" : s === "DRAFT" ? "#fef3c7" : "#e2e8f0", color: s === "PUBLISHED" ? "#065f46" : s === "DRAFT" ? "#92400e" : "#475569" }}>{s.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
);
const levelLabel = (l: string) => (l === "BASE" ? "Base (platform)" : l === "CLIENT" ? "Client" : "Project");

export function QcTemplates() {
  const { can, me } = useQc();
  const navigate = useNavigate();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [stages, setStages] = useState<StageDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [cloning, setCloning] = useState<TemplateRow | null>(null);
  const [level, setLevel] = useState("");
  useEffect(() => { qcx.stages.list().then(setStages).catch(() => undefined); }, []);
  const load = useCallback(() => qcx.templates.list({ level }).then(setRows).catch((e) => setError(e.message)), [level]);
  useEffect(() => { load(); }, [load]);
  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.stage_name ?? "—";
  // Show the newest version of each template line.
  const latest = (rows ?? []).filter((r, _i, all) => !all.some((o) => o.code === r.code && o.level === r.level && o.clientId === r.clientId && o.projectId === r.projectId && o.version > r.version));

  return (
    <PageShell title="Checklist templates" subtitle="Base templates are maintained by the platform. A client works from its own copy, which can add items but not remove locked ones."
      actions={me?.isSA ? <button style={btnPrimary} onClick={() => setCreating(true)}>New base template</button> : undefined}>
      <div style={{ width: 220, marginBottom: 12 }}><Select value={level} onChange={setLevel} placeholder="All levels" options={[{ id: "BASE", label: "Base" }, { id: "CLIENT", label: "Client" }, { id: "PROJECT", label: "Project" }]} /></div>
      <ErrorNote message={error} />
      <TableCard headers={["Template", "Stage", "Level", "Latest version", "Status", "Items", ""]}>
        {latest.map((t) => (
          <tr key={t.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
            <td style={cell}><Link to={`/qc/templates/${t.id}`} style={{ color: "#1a2a4a", fontWeight: 700, textDecoration: "none" }}>{t.name}</Link><div style={sub}>{t.code}</div></td>
            <td style={cell}>{stageName(t.stageKey)}</td>
            <td style={cell}>{levelLabel(t.level)}</td>
            <td style={cell}>{t.versionLabel}</td>
            <td style={cell}>{statusChip(t.versionStatus)}</td>
            <td style={cell}>{t.itemCount ?? "—"}</td>
            <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
              <button style={btnLink} onClick={() => navigate(`/qc/templates/${t.id}`)}>Open</button>
              {can("templates.customise") && t.versionStatus === "PUBLISHED" && !me?.isSA && <>{" "}<button style={btnLink} onClick={() => setCloning(t)}>Make a copy</button></>}
            </td>
          </tr>
        ))}
        {rows?.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No templates yet.</td></tr>}
      </TableCard>
      {creating && (
        <FormDialog title="New base template" formCode="E16" hide={["stage", "parent_template_and_version", "change_summary"]} initial={{}}
          extra={(v, set) => <Field label="Stage" required><Select value={String(v.stage ?? "")} onChange={(x) => set({ stage: x })} options={stages.map((s) => ({ id: s.id, label: `${s.stage_number}. ${s.stage_name}` }))} /></Field>}
          onClose={() => setCreating(false)} onSubmit={async (p) => { const t = await qcx.templates.create(p); setCreating(false); navigate(`/qc/templates/${t.id}`); }} />
      )}
      {cloning && (
        <FormDialog title={`Copy ${cloning.name}`} formCode="F08" hide={["source_template_and_version", "project", "level"]} initial={{ new_template_name: `${cloning.name} (our copy)`, level: "Client" }}
          note={<p style={{ ...sub, marginTop: 0 }}>You get your own copy of version {cloning.versionLabel}. Locked items stay locked; you can add items and change the rest.</p>}
          onClose={() => setCloning(null)} onSubmit={async (p) => { const t = await qcx.templates.clone(cloning.id, p); setCloning(null); navigate(`/qc/templates/${t.id}`); }} />
      )}
    </PageShell>
  );
}

export function QcTemplateDetail() {
  const { id = "" } = useParams();
  const { can, me } = useQc();
  const navigate = useNavigate();
  const [t, setT] = useState<TemplateRow | null>(null);
  const [versions, setVersions] = useState<TemplateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editItem, setEditItem] = useState<Partial<TemplateItem> | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [diff, setDiff] = useState<Record<string, any> | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<{ imported: number; rows: number; errors: Array<{ row: number; message: string }> } | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [cats, setCats] = useState<Array<{ id: string; label: string }>>([]);
  useEffect(() => { api.qc.tradeCategories.list().then((c) => setCats(c.filter((x) => x.active).map((x) => ({ id: x.id, label: x.name })))).catch(() => undefined); }, []);
  const load = useCallback(async () => {
    try {
      const tpl = await qcx.templates.get(id);
      setT(tpl);
      setVersions((await qcx.templates.list({ code: tpl.code })).filter((x) => x.level === tpl.level && x.clientId === tpl.clientId && x.projectId === tpl.projectId));
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (error) return <PageShell title="Template"><ErrorNote message={error} /></PageShell>;
  if (!t) return <PageShell title="Template"><p style={sub}>Loading…</p></PageShell>;

  const editable = t.versionStatus === "DRAFT" && (t.level === "BASE" ? !!me?.isSA : can("templates.customise"));
  const items = t.items ?? [];
  const sections = [...new Set(items.map((i) => i.section ?? "General"))];

  async function exportXlsx() {
    const res = await fetch(qcx.templates.exportUrl(id), { headers: { Authorization: `Bearer ${getToken()}`, ...(getActiveClientId() ? { "X-Client-Id": getActiveClientId()! } : {}) } });
    if (!res.ok) return setError(`Export failed (${res.status})`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = `${t!.code}-v${t!.versionLabel}.xlsx`; a.click(); URL.revokeObjectURL(url);
  }
  async function run<T>(fn: () => Promise<T>) { try { setError(null); return await fn(); } catch (e) { setError((e as Error).message); } }

  return (
    <PageShell title={`${t.name}`} subtitle={`${t.code} · ${levelLabel(t.level)} · version ${t.versionLabel}`}
      actions={<div style={{ display: "flex", gap: 8 }}>
        {versions.length > 1 && <select aria-label="Version" style={{ ...inputStyle, width: 170 }} value={t.id} onChange={(e) => navigate(`/qc/templates/${e.target.value}`)}>{versions.map((v) => <option key={v.id} value={v.id}>v{v.versionLabel} ({v.versionStatus.toLowerCase()})</option>)}</select>}
        <button style={btnGhost} onClick={exportXlsx}>Export to Excel</button>
        {editable && <button style={btnGhost} onClick={() => setImporting(true)}>Import from Excel</button>}
        {can("templates.customise") && t.versionStatus !== "DRAFT" && !versions.some((v) => v.versionStatus === "DRAFT") && (t.level === "BASE" ? !!me?.isSA : true) && <button style={btnGhost} onClick={() => run(async () => { const d = await qcx.templates.draft(t.id); navigate(`/qc/templates/${d.id}`); })}>New draft version</button>}
        {editable && <button style={btnPrimary} onClick={() => setPublishing(true)}>Publish…</button>}
        {t.versionStatus === "PUBLISHED" && can("templates.assign") && <button style={btnGhost} onClick={() => setAdopting(true)}>Adopt in projects</button>}
      </div>}>
      <Link to="/qc/templates" style={{ ...btnLink, display: "inline-block", marginBottom: 12 }}>← All templates</Link>
      <ErrorNote message={error} />
      <div style={{ marginBottom: 12 }}>{statusChip(t.versionStatus)} {t.changeSummary && <span style={{ ...sub, marginLeft: 8 }}>Change summary: {t.changeSummary}</span>}</div>

      {t.parentId && can("templates.customise") && t.versionStatus === "DRAFT" && (
        <Card style={{ padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 13 }}>Changes in the original template</b>
            <button style={btnLink} onClick={() => run(async () => { setDiff(await qcx.templates.diff(t.id)); setPicked([]); })}>Check for changes</button>
          </div>
          {diff && (diff.upToDate ? <p style={{ ...sub, margin: "8px 0 0" }}>This copy is up to date with version {String(diff.parentVersion)}.</p> : (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <p style={{ ...sub, margin: "0 0 6px" }}>Original is at version {String(diff.parentVersion)}. Tick what to bring in; items you changed yourself are kept unless you choose otherwise.</p>
              {(diff.added as TemplateItem[]).map((a) => <label key={`a${a.itemNumber}`} style={{ display: "block" }}><input type="checkbox" checked={picked.includes(a.itemNumber)} onChange={(e) => setPicked(e.target.checked ? [...picked, a.itemNumber] : picked.filter((x) => x !== a.itemNumber))} /> <b>New</b> {a.itemNumber}: {a.check_description}</label>)}
              {(diff.changed as Array<{ itemNumber: string; locallyModified: boolean; parent: TemplateItem }>).map((c) => <label key={`c${c.itemNumber}`} style={{ display: "block" }}><input type="checkbox" checked={picked.includes(c.itemNumber)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.itemNumber] : picked.filter((x) => x !== c.itemNumber))} /> <b>Changed</b> {c.itemNumber}: {c.parent.check_description}{c.locallyModified ? " (you also changed this item)" : ""}</label>)}
              {(diff.removed as TemplateItem[]).map((r) => <label key={`r${r.itemNumber}`} style={{ display: "block" }}><input type="checkbox" checked={picked.includes(r.itemNumber)} onChange={(e) => setPicked(e.target.checked ? [...picked, r.itemNumber] : picked.filter((x) => x !== r.itemNumber))} /> <b>Removed in original</b> {r.itemNumber}: {r.check_description}</label>)}
              <button style={{ ...btnPrimary, marginTop: 8 }} disabled={picked.length === 0} onClick={() => run(async () => { await qcx.templates.merge(t.id, picked); setDiff(null); load(); })}>Bring in {picked.length} change{picked.length === 1 ? "" : "s"}</button>
            </div>
          ))}
        </Card>
      )}
      {t.parentId && t.versionStatus !== "DRAFT" && <p style={sub}>This is a copy. To bring in changes from the original, start a new draft version and check for changes.</p>}

      {editable && <div style={{ marginBottom: 12 }}><button style={btnPrimary} onClick={() => setEditItem({})}>Add item</button></div>}
      {sections.map((s) => (
        <div key={s} style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, color: "#1a2a4a", margin: "0 0 8px" }}>{s}</h2>
          <TableCard headers={["No.", "Check", "Element", "Type", "Photo rule", "Flags", ""]}>
            {items.filter((i) => (i.section ?? "General") === s).map((i) => (
              <tr key={i.id} style={{ borderBottom: "1px solid #f1f5f9", opacity: i.active ? 1 : 0.5 }}>
                <td style={cell}>{i.itemNumber}</td>
                <td style={cell}><b>{i.check_description}</b><div style={sub}>{i.reference}</div></td>
                <td style={cell}>{i.location_or_element}</td>
                <td style={cell}>{i.itemType}{i.itemType === "Measurement" ? ` (${i.measurement_unit ?? ""})` : ""}</td>
                <td style={cell}>{i.photo_rule}</td>
                <td style={cell}>{i.locked ? "🔒 locked " : ""}{i.mandatory ? "" : "optional "}{i.active ? "" : "inactive"}</td>
                <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                  {editable && !(i.locked && t.level !== "BASE") && <button style={btnLink} onClick={() => setEditItem(i)}>Edit</button>}{" "}
                  {editable && !(i.locked && t.level !== "BASE") && <button style={btnDanger} onClick={() => { if (window.confirm(`Remove item ${i.itemNumber}?`)) run(async () => { await qcx.templates.removeItem(i.id); load(); }); }}>Remove</button>}
                </td>
              </tr>
            ))}
          </TableCard>
        </div>
      ))}
      {items.length === 0 && <Card style={{ padding: 20, fontSize: 13, color: "#64748b" }}>No items yet.</Card>}

      {editItem && (
        <FormDialog title={editItem.id ? `Edit item ${editItem.itemNumber}` : "Add item"} formCode="E17" width={820} refOptions={{ E19: cats }}
          hide={["origin_item", "sequence", ...(t.level === "BASE" ? [] : ["locked_by_super_admin"])]}
          initial={editItem.id ? { ...editItem } : { active: true, mandatory_item: true, locked_by_super_admin: false, photo_rule: "When result is not OK (default)", item_type: "Result only", applies_to_floor_systems: "All", applies_to_building_classes: "1a, 1b, 2, 10a, 10b" }}
          onClose={() => setEditItem(null)}
          onSubmit={async (p) => { if (editItem.id) await qcx.templates.updateItem(editItem.id, p); else await qcx.templates.addItem(t.id, p); setEditItem(null); load(); }} />
      )}
      {publishing && (
        <FormDialog title={`Publish ${t.name}`} formCode="F07" hide={["template", "adopt_projects_and_stages_to_apply"]} initial={{ notify_client_admins: true, effective_for_new_inspections_from: new Date().toISOString().slice(0, 10) }}
          note={<p style={{ ...sub, marginTop: 0 }}>A published version is frozen. Inspections that start after the effective date use it; inspections already started keep the version they began with.</p>}
          onClose={() => setPublishing(false)} onSubmit={async (p) => { await qcx.templates.publish(t.id, p); setPublishing(false); load(); }} />
      )}
      {importing && (
        <Modal title="Import items from Excel" onClose={() => { setImporting(false); setImportReport(null); }} width={560}
          footer={<button style={btnGhost} onClick={() => { setImporting(false); setImportReport(null); if (importReport?.imported) load(); }}>Close</button>}>
          <p style={{ ...sub, marginTop: 0 }}>The first sheet needs the columns <b>Item number</b> and <b>Check description</b>; the others are optional. Export a template to see all columns.</p>
          <input type="file" accept=".xlsx" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const r = await run(() => qcx.templates.import(t.id, f, false)); if (r) setImportReport(r.report); } }} />
          {importReport && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              {importReport.imported > 0 ? <p style={{ color: "#15803d" }}>Imported {importReport.imported} of {importReport.rows} rows.</p> : <p style={{ color: "#b91c1c" }}>Nothing was imported.</p>}
              {importReport.errors.map((er) => <div key={er.row} style={{ color: "#b91c1c" }}>Row {er.row}: {er.message}</div>)}
              {importReport.errors.length > 0 && importReport.imported === 0 && <p style={sub}>Fix the rows and upload again, or import only the good rows from the picker below.</p>}
              {importReport.errors.length > 0 && importReport.imported === 0 && <input type="file" accept=".xlsx" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const r = await run(() => qcx.templates.import(t.id, f, true)); if (r) setImportReport(r.report); } }} />}
            </div>
          )}
        </Modal>
      )}
      {adopting && <AdoptDialog template={t} onClose={() => setAdopting(false)} />}
    </PageShell>
  );
}

function AdoptDialog({ template, onClose }: { template: TemplateRow; onClose: () => void }) {
  const [projects, setProjects] = useState<QcProjectRow[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.qc.projects.list().then(setProjects).catch(() => undefined); }, []);
  return (
    <Modal title={`Adopt version ${template.versionLabel}`} onClose={onClose} width={480}
      footer={<><button style={btnGhost} onClick={onClose}>Close</button><button style={btnPrimary} disabled={picked.length === 0} onClick={async () => { try { const r = await qcx.templates.adopt(template.id, picked); setResult(`${r.adopted} stage${r.adopted === 1 ? "" : "s"} now use this version.`); } catch (e) { setError((e as Error).message); } }}>Adopt</button></>}>
      <ErrorNote message={error} />
      <p style={{ ...sub, marginTop: 0 }}>The projects' inspection plans switch to this version for inspections that have not started.</p>
      {projects.map((p) => <label key={p.id} style={{ display: "block", fontSize: 13, marginBottom: 6 }}><input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} /> {p.name}</label>)}
      {result && <p role="status" style={{ color: "#15803d", fontSize: 13 }}>{result}</p>}
    </Modal>
  );
}

export { API_BASE };
