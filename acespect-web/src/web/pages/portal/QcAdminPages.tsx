import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { PageShell, Card, TableCard } from "../../components/WebLayout";
import { ErrorNote, Field, FormDialog, Modal, Select, btnDanger, btnGhost, btnLink, btnPrimary, cell, sub } from "../../components/QcUi";
import { inputStyle } from "../../components/SpecForm";
import { qcx, type Notification } from "../../qcApi";
import { useQc } from "../../qcContext";
import { api } from "../../api";
import { NotificationLink } from "../../components/QcLayout";

const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleString("en-AU") : "—");

// ─── Notifications and preferences (E29, E30) ────────────────────────────────

export function QcNotifications() {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [prefs, setPrefs] = useState<Awaited<ReturnType<typeof qcx.notifications.prefs>> | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => qcx.notifications.list().then((r) => setItems(r.notifications)).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); qcx.notifications.prefs().then(setPrefs).catch((e) => setError(e.message)); }, [load]);
  const setPref = (type: string, patch: Partial<{ inApp: boolean; email: "IMMEDIATE" | "DIGEST" | "OFF" }>) => { setSaved(false); setPrefs((p) => p?.map((e) => (e.type === type ? { ...e, ...patch } : e)) ?? null); };
  return (
    <PageShell title="Notifications" subtitle="Emails carry the event and a sign-in link only: no photos and no defect detail.">
      <ErrorNote message={error} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", borderBottom: "1px solid #f1f5f9" }}>
            <b style={{ fontSize: 13 }}>Recent</b>
            <button style={btnLink} onClick={() => qcx.notifications.readAll().then(load)}>Mark all read</button>
          </div>
          {items?.map((n) => (
            <div key={n.id} style={{ padding: "10px 16px", borderBottom: "1px solid #f8fafc", background: n.readAt ? "white" : "#f8fbff" }}>
              <NotificationLink n={n} onGo={() => qcx.notifications.read(n.id)} />
              {n.mandatory && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: "#b91c1c" }}>MANDATORY</span>}
              <div style={sub}>{dt(n.createdAt)}{n.ackedAt ? ` · acknowledged ${dt(n.ackedAt)}` : ""}</div>
              {n.type === "defect.safety_hazard" && !n.ackedAt && <button style={{ ...btnPrimary, background: "#b91c1c", marginTop: 6, padding: "4px 10px" }} onClick={() => qcx.notifications.ack(n.id).then(load)}>Acknowledge</button>}
            </div>
          ))}
          {items?.length === 0 && <p style={{ padding: 16, margin: 0, ...sub }}>Nothing yet.</p>}
        </Card>
        <Card style={{ padding: 16 }}>
          <b style={{ fontSize: 13 }}>How you are told</b>
          <table style={{ width: "100%", marginTop: 8, fontSize: 12, borderCollapse: "collapse" }}>
            <thead><tr style={{ textAlign: "left", color: "#94a3b8" }}><th style={{ padding: 4 }}>Event</th><th>In app</th><th>Email</th></tr></thead>
            <tbody>
              {prefs?.map((e) => (
                <tr key={e.type} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "6px 4px" }}>{e.label}{e.mandatory && <span title="Cannot be switched off"> 🔒</span>}</td>
                  <td><input type="checkbox" aria-label={`${e.label} in app`} disabled={e.mandatory} checked={e.inApp} onChange={(x) => setPref(e.type, { inApp: x.target.checked })} /></td>
                  <td>
                    <select aria-label={`${e.label} email`} disabled={e.mandatory} value={e.email} onChange={(x) => setPref(e.type, { email: x.target.value as "IMMEDIATE" | "DIGEST" | "OFF" })} style={{ ...inputStyle, padding: "3px 6px", fontSize: 12 }}>
                      <option value="IMMEDIATE">Straight away</option><option value="DIGEST">Daily summary (7 am)</option><option value="OFF">Off</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={{ ...btnPrimary, marginTop: 12 }} onClick={() => qcx.notifications.savePrefs((prefs ?? []).map((p) => ({ type: p.type, inApp: p.inApp, email: p.email }))).then(() => setSaved(true)).catch((e) => setError(e.message))}>Save preferences</button>
          {saved && <span role="status" style={{ marginLeft: 10, fontSize: 12, color: "#15803d" }}>Saved.</span>}
          <p style={{ ...sub, marginBottom: 0 }}>Safety Hazard and security alerts always reach you on every channel.</p>
        </Card>
      </div>
    </PageShell>
  );
}

// ─── Audit trail, security log, support sessions (E31, E32) ──────────────────

export function QcAudit() {
  const { can, me } = useQc();
  const [tab, setTab] = useState<"audit" | "security" | "support">("audit");
  const [rows, setRows] = useState<Array<Record<string, any>> | null>(null);
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof qcx.support.sessions>> | null>(null);
  const [f, setF] = useState({ action: "", entityType: "", from: "", to: "", type: "" });
  const [verify, setVerify] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    setRows(null); setError(null);
    if (tab === "audit" && can("audit.view")) qcx.audit.list(f).then(setRows).catch((e) => setError(e.message));
    if (tab === "security" && can("securitylog.view")) qcx.audit.security({ type: f.type, from: f.from }).then(setRows).catch((e) => setError(e.message));
    if (tab === "support" && me?.clientId) qcx.support.sessions().then(setSessions).catch((e) => setError(e.message));
  }, [tab, f, can, me?.clientId]);
  return (
    <PageShell title="Audit and security" subtitle="Every change to client data, every refused request and every Super Admin visit. Entries are never edited.">
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {([["audit", "Audit trail"], ["security", "Security log"], ["support", "Support access"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...btnGhost, ...(tab === k ? { background: "#1a2a4a", color: "white", borderColor: "#1a2a4a" } : {}) }}>{l}</button>
        ))}
        {tab === "audit" && <button style={btnGhost} onClick={() => qcx.audit.verify().then((v) => setVerify(v.ok ? `The chain is intact (${v.checked} entries checked).` : `The chain is broken at entry ${v.brokenAt}.`)).catch((e) => setError(e.message))}>Verify integrity</button>}
      </div>
      {verify && <p role="status" style={{ fontSize: 13, color: verify.includes("intact") ? "#15803d" : "#b91c1c" }}>{verify}</p>}
      <ErrorNote message={error} />
      {tab !== "support" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          {tab === "audit" ? <>
            <input style={{ ...inputStyle, width: 200 }} placeholder="Action, e.g. sla or defect" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} />
            <input style={{ ...inputStyle, width: 180 }} placeholder="Record type, e.g. Project" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} />
            <input type="date" aria-label="From" style={{ ...inputStyle, width: 160 }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
            <input type="date" aria-label="To" style={{ ...inputStyle, width: 160 }} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </> : <>
            <div style={{ width: 220 }}><Select value={f.type} onChange={(v) => setF({ ...f, type: v })} placeholder="All events" options={["LOGIN_OK", "LOGIN_FAILED", "LOCKOUT", "MFA_FAILED", "FORBIDDEN", "CROSS_TENANT", "SUPPORT_START", "SUPPORT_END", "FILE_ACCESS", "REPORT_DOWNLOAD", "MEDIA_DENIED", "PASSWORD_RESET", "SESSION_REVOKED"].map((x) => ({ id: x, label: x.replace(/_/g, " ").toLowerCase() }))} /></div>
            <input type="date" aria-label="From" style={{ ...inputStyle, width: 160 }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </>}
        </div>
      )}
      {tab === "audit" && (
        <TableCard headers={["When", "Who", "Action", "Record", "Reason", ""]}>
          {rows?.map((r) => (
            <Fragment key={r.id}>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={cell}>{dt(r.createdAt)}</td>
                <td style={cell}>{r.actor?.name ?? r.actor?.email ?? r.actorRole}<div style={sub}>{r.actorRole}{r.supportSessionId ? " · support mode" : ""}</div></td>
                <td style={cell}><b>{r.action}</b></td>
                <td style={cell}>{r.entityType}<div style={{ ...sub, fontFamily: "monospace" }}>{String(r.entityId).slice(0, 8)}</div></td>
                <td style={cell}>{r.reason ?? "—"}</td>
                <td style={cell}>{(r.before || r.after) && <button style={btnLink} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Before / after"}</button>}</td>
              </tr>
              {open === r.id && <tr><td colSpan={6} style={{ ...cell, background: "#f8fafc" }}><pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap" }}>{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre></td></tr>}
            </Fragment>
          ))}
          {rows?.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No entries.</td></tr>}
        </TableCard>
      )}
      {tab === "security" && (
        <TableCard headers={["When", "Event", "Who", "Detail", "IP"]}>
          {rows?.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}>{dt(r.createdAt)}</td><td style={cell}><b>{String(r.type).replace(/_/g, " ").toLowerCase()}</b></td>
              <td style={cell}>{r.user?.name ?? r.user?.email ?? "—"}</td>
              <td style={{ ...cell, fontSize: 12 }}>{Object.entries(r.detail ?? {}).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")}</td>
              <td style={{ ...cell, fontSize: 12 }}>{r.ip ?? "—"}</td>
            </tr>
          ))}
          {rows?.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No events.</td></tr>}
        </TableCard>
      )}
      {tab === "support" && (
        me?.clientId ? (
          <TableCard headers={["Who", "Started", "Ended or expires", "Reason", "Ticket", "Actions"]}>
            {sessions?.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={cell}>{s.user.name ?? s.user.email}</td><td style={cell}>{dt(s.startedAt)}</td><td style={cell}>{dt(s.endedAt ?? s.expiresAt)}</td>
                <td style={cell}>{s.reason}</td><td style={cell}>{s.ticketRef ?? "—"}</td><td style={cell}>{s.actionsPerformed}</td>
              </tr>
            ))}
            {sessions?.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No Super Admin has accessed this client.</td></tr>}
          </TableCard>
        ) : <p style={sub}>Enter a client through support mode to see its sessions.</p>
      )}
    </PageShell>
  );
}

// ─── Client settings, usage, legal holds, export and offboarding ─────────────

export function QcSettings() {
  const { me } = useQc();
  const clientId = me?.clientId ?? "";
  const [defaults, setDefaults] = useState<Record<string, any> | null>(null);
  const [usage, setUsage] = useState<{ users: number; projects: number; plan: unknown } | null>(null);
  const [holds, setHolds] = useState<Array<Record<string, any>> | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const load = useCallback(() => {
    if (!clientId) return;
    qcx.settings.defaults(clientId).then((d) => setDefaults(d.defaults)).catch((e) => setError(e.message));
    qcx.settings.usage().then(setUsage).catch(() => undefined);
    qcx.settings.holds().then(setHolds).catch(() => undefined);
  }, [clientId]);
  useEffect(() => { load(); api.qc.projects.list().then((p) => setProjects(p.map((x) => ({ id: x.id, name: x.name })))).catch(() => undefined); }, [load]);
  if (!defaults) return <PageShell title="Settings"><ErrorNote message={error} /><p style={sub}>Loading…</p></PageShell>;
  const plan = (usage?.plan as unknown[] | null) ?? null;
  const set = (patch: Record<string, unknown>) => { setDefaults({ ...defaults, ...patch }); setSaved(false); };
  return (
    <PageShell title="Settings" subtitle="Defaults for everyone in your organisation.">
      <ErrorNote message={error} />
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <b style={{ fontSize: 14 }}>Sign-in and sessions</b>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
          <Field label="Sign people out after this many minutes of inactivity (5 to 120)"><input type="number" min={5} max={120} style={inputStyle} value={defaults.idle_session_timeout} onChange={(e) => set({ idle_session_timeout: Number(e.target.value) })} /></Field>
          <Field label="Report footer text"><input style={inputStyle} value={defaults.report_footer_text ?? ""} onChange={(e) => set({ report_footer_text: e.target.value })} /></Field>
          <Field label="Privacy contact email"><input type="email" style={inputStyle} value={defaults.privacy_contact_email ?? ""} onChange={(e) => set({ privacy_contact_email: e.target.value })} /></Field>
        </div>
        <label style={{ display: "flex", gap: 8, marginTop: 12, fontSize: 13 }}><input type="checkbox" checked={!!defaults.mfa_required_for_all_roles} onChange={(e) => set({ mfa_required_for_all_roles: e.target.checked })} /> Require two-step verification for every role (Client Admins always need it)</label>
        <div style={{ marginTop: 14 }}>
          <button style={btnPrimary} onClick={() => qcx.settings.saveDefaults(clientId, { idle_session_timeout: defaults.idle_session_timeout, mfa_required_for_all_roles: defaults.mfa_required_for_all_roles, report_footer_text: defaults.report_footer_text, privacy_contact_email: defaults.privacy_contact_email }).then(() => setSaved(true)).catch((e) => setError(e.message))}>Save</button>
          {saved && <span role="status" style={{ marginLeft: 10, fontSize: 12, color: "#15803d" }}>Saved and recorded in the audit trail.</span>}
        </div>
      </Card>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <b style={{ fontSize: 14 }}>Your plan</b>
        <p style={{ fontSize: 13, color: "#475569" }}>{usage ? `${usage.users} active users${plan?.[1] ? ` of ${plan[1]}` : ""} · ${usage.projects} active projects${plan?.[2] ? ` of ${plan[2]}` : ""}` : "Loading…"}{plan?.[0] ? ` · ${String(plan[0])} plan` : ""}</p>
      </Card>
      <Card style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ fontSize: 14 }}>Legal holds</b>
          <button style={btnLink} onClick={() => setHoldOpen(true)}>Place a hold</button>
        </div>
        <p style={{ ...sub, margin: "4px 0 10px" }}>A hold keeps a project, lot or defect and everything attached to it from being deleted or retired while a dispute is open.</p>
        {holds?.map((h) => (
          <div key={h.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #f1f5f9", fontSize: 13 }}>
            <span><b>{h.data.scope}</b> · {h.data.reason}{h.data.dispute_body ? ` (${h.data.dispute_body})` : ""} <span style={sub}>placed {dt(h.data.placedAt)}</span> {h.status === "RELEASED" && <span style={{ color: "#15803d" }}> · released</span>}</span>
            {h.status === "ACTIVE" && <button style={btnDanger} onClick={() => setReleasing(h.id)}>Release</button>}
          </div>
        ))}
        {holds?.length === 0 && <p style={{ ...sub, margin: 0 }}>No holds.</p>}
      </Card>
      <Card style={{ padding: 18 }}>
        <b style={{ fontSize: 14 }}>Your data</b>
        <p style={{ ...sub, margin: "4px 0 10px" }}>Export everything your organisation holds (defects with history, projects, people, inspections, audit trail) as a JSON file.</p>
        <button style={btnGhost} onClick={() => setExportOpen(true)}>Export our data</button>
      </Card>
      {holdOpen && (
        <FormDialog title="Place a legal hold" formCode="E36" hide={["subject", "placed_by_and_at", "released_by_at_and_reason"]} initial={{ scope: "Project" }}
          extra={(v, setV) => <Field label={`${String(v.scope ?? "Project")} to hold`} required><Select value={String(v.subject ?? "")} onChange={(x) => setV({ subject: x })} options={v.scope === "Project" || !v.scope ? projects.map((p) => ({ id: p.id, label: p.name })) : []} placeholder={v.scope === "Project" || !v.scope ? "Choose…" : "Enter the id below"} /></Field>}
          onClose={() => setHoldOpen(false)} onSubmit={async (p) => { await qcx.settings.placeHold(p); setHoldOpen(false); load(); }} />
      )}
      {releasing && <ReleaseDialog onClose={() => setReleasing(null)} onRelease={async (reason) => { await qcx.settings.releaseHold(releasing, reason); setReleasing(null); load(); }} />}
      {exportOpen && (
        <Modal title="Export our data" onClose={() => setExportOpen(false)} width={460} footer={<button style={btnPrimary} onClick={async () => {
          try { const blob = await qcx.settings.exportTenant(clientId, ["Data (CSV, JSON)", "Audit trail"]); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "our-data.json"; a.click(); URL.revokeObjectURL(url); setExportOpen(false); } catch (e) { setError((e as Error).message); setExportOpen(false); }
        }}>Download JSON</button>}>
          <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>The file includes the audit trail. The export is recorded in the audit trail and you should keep it secure.</p>
        </Modal>
      )}
    </PageShell>
  );
}

function ReleaseDialog({ onClose, onRelease }: { onClose: () => void; onRelease: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Release legal hold" onClose={onClose} width={440} footer={<><button style={btnGhost} onClick={onClose}>Cancel</button><button style={btnPrimary} disabled={reason.trim().length < 5} onClick={() => onRelease(reason.trim()).catch((e) => setError(e.message))}>Release</button></>}>
      <ErrorNote message={error} />
      <Field label="Why is the hold being released?" required><textarea style={{ ...inputStyle, minHeight: 70 }} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Modal>
  );
}

// ─── Privacy and records (Super Admin) ───────────────────────────────────────

export function QcPrivacy() {
  const [tab, setTab] = useState<"requests" | "breaches" | "subs" | "retention">("requests");
  const [rows, setRows] = useState<Array<Record<string, any>> | null>(null);
  const [retention, setRetention] = useState<{ due: Array<Record<string, any>>; destroyed: Array<Record<string, any>> } | null>(null);
  const [dialog, setDialog] = useState<null | "request" | "breach" | "sub">(null);
  const [editSub, setEditSub] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setRows(null);
    const p = tab === "requests" ? qcx.privacy.requests() : tab === "breaches" ? qcx.privacy.breaches() : tab === "subs" ? qcx.privacy.subProcessors() : null;
    if (p) p.then(setRows).catch((e) => setError(e.message));
    else qcx.privacy.retention().then(setRetention).catch((e) => setError(e.message));
  }, [tab]);
  useEffect(() => { load(); }, [load]);
  async function download(id: string, userId: string) {
    try { const blob = await qcx.privacy.exportPersonal(id, userId); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "personal-data.json"; a.click(); URL.revokeObjectURL(url); } catch (e) { setError((e as Error).message); }
  }
  return (
    <PageShell title="Privacy and records" subtitle="Privacy requests, data breaches, sub-processors and retention for the whole platform."
      actions={<div style={{ display: "flex", gap: 8 }}>{tab === "requests" && <button style={btnPrimary} onClick={() => setDialog("request")}>Log a request</button>}{tab === "breaches" && <button style={btnPrimary} onClick={() => setDialog("breach")}>Log an incident</button>}{tab === "subs" && <button style={btnPrimary} onClick={() => { setEditSub(null); setDialog("sub"); }}>Add a sub-processor</button>}</div>}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {([["requests", "Privacy requests"], ["breaches", "Breach register"], ["subs", "Sub-processors"], ["retention", "Retention"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ ...btnGhost, ...(tab === k ? { background: "#1a2a4a", color: "white", borderColor: "#1a2a4a" } : {}) }}>{l}</button>
        ))}
      </div>
      <ErrorNote message={error} />
      {tab === "requests" && (
        <TableCard headers={["Request", "From", "Received", "Due", "Status", ""]}>
          {rows?.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}><b>{r.data.request_type}</b><div style={sub}>{r.data.relationship_to_platform}</div></td>
              <td style={cell}>{r.data.requester_name_and_contact}</td><td style={cell}>{r.data.date_received}</td>
              <td style={{ ...cell, color: r.overdue ? "#b91c1c" : undefined, fontWeight: r.overdue ? 700 : 400 }}>{r.data.due_date}{r.overdue ? " (overdue)" : ""}</td>
              <td style={cell}>{r.status}{r.data.identityVerified ? " · ID verified" : ""}</td>
              <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>
                {!r.data.identityVerified && <button style={btnLink} onClick={() => qcx.privacy.updateRequest(r.id, { identityVerified: true, status: "Identity check" }).then(load).catch((e) => setError(e.message))}>Mark ID verified</button>}{" "}
                {r.data.identityVerified && !["Completed", "Refused (with reason)"].includes(r.status) && <button style={btnLink} onClick={() => { const id = window.prompt("User id (from People) to export:"); if (id) download(r.id, id); }}>Export data</button>}{" "}
                {!["Completed", "Refused (with reason)"].includes(r.status) && r.data.identityVerified && <button style={btnLink} onClick={() => qcx.privacy.updateRequest(r.id, { status: "Completed" }).then(load).catch((e) => setError(e.message))}>Complete</button>}
              </td>
            </tr>
          ))}
          {rows?.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No privacy requests.</td></tr>}
        </TableCard>
      )}
      {tab === "breaches" && (
        <TableCard headers={["Incident", "Detected", "Description", "Decision", "Assessment due", ""]}>
          {rows?.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}><b>{r.data.incident_id}</b><div style={sub}>{r.status}</div></td><td style={cell}>{dt(r.data.detected_at_and_by)}</td>
              <td style={cell}>{r.data.description}</td><td style={cell}>{r.data.assessment_decision}</td><td style={cell}>{r.data.assessment_due}</td>
              <td style={{ ...cell, textAlign: "right" }}>{r.status !== "Closed" && <button style={btnLink} onClick={() => { const d = window.prompt("Assessment decision (Pending, Eligible data breach, Not eligible):", r.data.assessment_decision); if (d) qcx.privacy.updateBreach(r.id, { assessment_decision: d, ...(d === "Eligible data breach" ? { regulator_notified: window.prompt("Date the regulator was notified (YYYY-MM-DD):") || undefined } : {}) }).then(load).catch((e) => setError(e.message)); }}>Update assessment</button>}</td>
            </tr>
          ))}
          {rows?.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No incidents.</td></tr>}
        </TableCard>
      )}
      {tab === "subs" && (
        <TableCard headers={["Sub-processor", "Purpose", "Data", "Location", "Outside Australia", "Status", ""]}>
          {rows?.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}><b>{r.data.name}</b></td><td style={cell}>{r.data.purpose}</td><td style={cell}>{r.data.data_types}</td><td style={cell}>{r.data.processing_location}</td>
              <td style={cell}>{r.data.outside_australia ? "Yes (APP 8)" : "No"}</td><td style={cell}>{r.status}</td>
              <td style={{ ...cell, textAlign: "right" }}><button style={btnLink} onClick={() => { setEditSub(r); setDialog("sub"); }}>Edit</button></td>
            </tr>
          ))}
          {rows?.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 28, fontSize: 13, color: "#94a3b8" }}>No sub-processors recorded. List every service that handles personal information: hosting, email, SMS, file storage and any AI service.</td></tr>}
        </TableCard>
      )}
      {tab === "retention" && retention && (
        <>
          <h3 style={{ fontSize: 13 }}>Projects past their retention period</h3>
          <TableCard headers={["Project", "Reason", "Flagged"]}>
            {retention.due.map((r) => <tr key={r.id}><td style={cell}>{r.title}</td><td style={cell}>{r.data.reason}</td><td style={cell}>{dt(r.createdAt)}</td></tr>)}
            {retention.due.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", padding: 20, fontSize: 13, color: "#94a3b8" }}>Nothing is due for review.</td></tr>}
          </TableCard>
          <h3 style={{ fontSize: 13, marginTop: 20 }}>Destruction records</h3>
          <TableCard headers={["Client", "Destroyed", "Counts"]}>
            {retention.destroyed.map((r) => <tr key={r.id}><td style={cell}>{r.data.clientName}</td><td style={cell}>{dt(r.data.destroyedAt)}</td><td style={cell}>{JSON.stringify(r.data.counts)}</td></tr>)}
            {retention.destroyed.length === 0 && <tr><td colSpan={3} style={{ textAlign: "center", padding: 20, fontSize: 13, color: "#94a3b8" }}>No client data has been destroyed.</td></tr>}
          </TableCard>
        </>
      )}
      {dialog === "request" && <FormDialog title="Log a privacy request" formCode="E33" hide={["identity_verified_by_and_date", "clients_involved", "due_date", "status", "export_file"]} initial={{ date_received: new Date().toISOString().slice(0, 10) }} onClose={() => setDialog(null)} onSubmit={async (p) => { await qcx.privacy.createRequest(p); setDialog(null); load(); }} />}
      {dialog === "breach" && <FormDialog title="Log a data breach incident" formCode="E34" hide={["incident_id", "assessment_due", "clients_affected", "regulator_notified", "individuals_notified", "clients_notified", "closed_at_and_lessons_learned"]} initial={{ assessment_decision: "Pending" }} onClose={() => setDialog(null)} onSubmit={async (p) => { await qcx.privacy.createBreach(p); setDialog(null); load(); }} />}
      {dialog === "sub" && <FormDialog title={editSub ? "Edit sub-processor" : "Add a sub-processor"} formCode="E35" hide={["approved_by_and_date", "app_8_assessment", "clients_notified_on", "status"]} initial={editSub?.data ?? {}} extra={(v, set) => <Field label="Status"><Select value={String(v.status ?? editSub?.status ?? "Proposed")} onChange={(x) => set({ status: x })} options={["Proposed", "Approved", "Retired"].map((x) => ({ id: x, label: x }))} /></Field>} onClose={() => setDialog(null)} onSubmit={async (p) => { await qcx.privacy.saveSubProcessor(editSub?.id ?? null, p); setDialog(null); load(); }} />}
    </PageShell>
  );
}

// ─── My account: password, two-step verification ─────────────────────────────

export function QcAccount() {
  const { me } = useQc();
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mfa, setMfa] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState("");
  useEffect(() => { api.mfaEnabled().then(setMfa).catch(() => undefined); }, []);
  const err = (e: unknown) => setMsg({ ok: false, text: (e as Error).message });
  return (
    <PageShell title="My account" subtitle={me ? `Signed in as ${me.role.replace(/_/g, " ").toLowerCase()}` : undefined}>
      {msg && <p role={msg.ok ? "status" : "alert"} style={{ fontSize: 13, color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</p>}
      <Card style={{ padding: 18, marginBottom: 16, maxWidth: 520 }}>
        <b style={{ fontSize: 14 }}>Change password</b>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <Field label="Current password"><input type="password" autoComplete="current-password" style={inputStyle} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password (at least 12 characters)"><input type="password" autoComplete="new-password" style={inputStyle} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Confirm new password"><input type="password" autoComplete="new-password" style={inputStyle} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
        </div>
        <button style={{ ...btnPrimary, marginTop: 12 }} disabled={pw.next.length < 12 || pw.next !== pw.confirm || !pw.current} onClick={() => api.auth.changePassword(pw.current, pw.next).then(() => { setMsg({ ok: true, text: "Password changed. Your other sessions were signed out; sign in again on those devices." }); setPw({ current: "", next: "", confirm: "" }); }).catch(err)}>Change password</button>
      </Card>
      <Card style={{ padding: 18, maxWidth: 520 }}>
        <b style={{ fontSize: 14 }}>Two-step verification</b>
        {mfa === null && <p style={sub}>Loading…</p>}
        {mfa === true && (
          <>
            <p style={{ fontSize: 13, color: "#15803d" }}>On. You are asked for a code from your authenticator app when you sign in.</p>
            <Field label="Enter your password to turn it off"><input type="password" style={inputStyle} value={disablePw} onChange={(e) => setDisablePw(e.target.value)} /></Field>
            <button style={{ ...btnDanger, marginTop: 8 }} onClick={() => api.auth.disableMfa(disablePw).then(() => { setMfa(false); setMsg({ ok: true, text: "Two-step verification is off." }); }).catch(err)}>Turn off</button>
            <p style={sub}>Roles that require it cannot turn it off.</p>
          </>
        )}
        {mfa === false && !setup && !codes && (
          <>
            <p style={{ fontSize: 13, color: "#475569" }}>Off. Add a second step with an authenticator app.</p>
            <button style={btnPrimary} onClick={async () => { try { const s = await api.auth.setupMfa(); const q = await import("../../qr").then((m) => m.qrDataUrl(s.otpauthUri)).catch(() => null); setSetup({ secret: s.secret, uri: s.otpauthUri, qr: q }); } catch (e) { err(e); } }}>Set up</button>
          </>
        )}
        {setup && (
          <div>
            {setup.qr && <img src={setup.qr} alt="QR code to scan with your authenticator app" width={176} height={176} />}
            <p style={{ fontSize: 12, wordBreak: "break-all" }}>Key: <code>{setup.secret}</code></p>
            <input aria-label="6-digit code" inputMode="numeric" style={{ ...inputStyle, width: 160 }} value={code} onChange={(e) => setCode(e.target.value)} />{" "}
            <button style={btnPrimary} disabled={code.trim().length < 6} onClick={() => api.auth.confirmMfa(code.trim()).then((r) => { setCodes(r.backupCodes); setSetup(null); setMfa(true); }).catch(err)}>Confirm</button>
          </div>
        )}
        {codes && (
          <div>
            <p style={{ fontSize: 13 }}>Save these backup codes. Each works once, and they are shown only now.</p>
            <pre style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>{codes.join("\n")}</pre>
            <button style={btnGhost} onClick={() => setCodes(null)}>I have saved them</button>
          </div>
        )}
      </Card>
      <p style={{ marginTop: 16, fontSize: 12 }}><Link to="/qc/notifications" style={{ color: "#2563eb" }}>Notification preferences</Link></p>
    </PageShell>
  );
}
