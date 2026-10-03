import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, resolveMediaUrl } from "../../api";
import { Card, PageShell, QcSubNav, StatusBadge } from "../../components/WebLayout";
import { ErrorNote, FormDialog, Select, btnGhost, btnLink, btnPrimary, sub, showValue, useRefData } from "../../components/QcUi";
import { inputStyle, type RefOption } from "../../components/SpecForm";
import { FlagChips, SeverityBadge, StatusChip } from "./AdminQcDefects";
import type { QcAllowedAction, QcDefect, QcDefectDetail, QcDefectEvent } from "../../qcTypes";
import { qcx, type Escalation } from "../../qcApi";
import { useQc } from "../../qcContext";

const ROLE_LABEL: Record<string, string> = {
  SA: "Super Admin", CLIENT_ADMIN: "Client Admin", CLIENT_USER: "Client User", MC_MANAGER: "MC Manager", MC_SITE_SUPERVISOR: "MC Site Supervisor",
  MC_PROJECT_MANAGER: "MC Project Manager", TRADE_USER: "Trade User", PRIVATE_INSPECTOR: "Private Inspector",
};
const VISIBILITY: RefOption[] = [
  { id: "ALL", label: "All parties on this defect" },
  { id: "CLIENT_INSPECTOR", label: "Client and Inspector only" },
  { id: "BUILDER_TRADE", label: "Builder and Trade only" },
  { id: "INSPECTOR_ONLY", label: "Inspector only" },
];

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-AU") : "—");
const fmtTime = (v: string) => new Date(v).toLocaleString("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** The F16 form's values for a defect that already has some of them saved. */
function f16Initial(d: QcDefect): Record<string, unknown> {
  return {
    defect_title: d.title ?? "",
    description: d.summary ?? "",
    room_or_area: d.roomArea ?? d.location ?? "",
    element: d.element ?? "",
    location_detail: d.locationDetails ?? "",
    severity: d.severity?.label ?? "",
    nature_of_defect: d.nature ?? "",
    code_or_standard_reference: d.codeRef ?? "",
    trade_category: d.tradeCategory?.id ?? "",
  };
}

export function AdminQcDefectDetail() {
  const { id = "" } = useParams();
  const { data: refData, refOptions } = useRefData();
  const [detail, setDetail] = useState<QcDefectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<QcAllowedAction | null>(null);
  const [editing, setEditing] = useState(false);
  const { can } = useQc();
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [escalating, setEscalating] = useState(false);
  const [referral, setReferral] = useState<Escalation | null>(null);
  const [pack, setPack] = useState<{ url: string; name: string } | null>(null);
  const [packError, setPackError] = useState<string | null>(null);

  const load = useCallback(() => api.qc.defects.get(id).then(setDetail).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const loadEscalations = useCallback(() => qcx.escalations.forDefect(id).then(setEscalations).catch(() => setEscalations([])), [id]);
  useEffect(() => { loadEscalations(); }, [loadEscalations, detail?.defect.updatedAt]);

  if (error) return <PageShell title="Defect"><QcSubNav /><ErrorNote message={error} /></PageShell>;
  if (!detail) return <PageShell title="Defect"><QcSubNav /><p style={sub}>Loading…</p></PageShell>;
  const { defect: d, events, comments } = detail;
  const actions = d.allowedActions ?? [];

  return (
    <PageShell title={d.title ?? "Draft defect"} subtitle={`${d.defectRef ?? ""} · ${d.property.name} · ${d.project.name} · ${d.client.name}`}>
      <QcSubNav />
      <Link to="/qc/defects" style={{ ...btnLink, display: "inline-block", marginBottom: 12 }}>← All defects</Link>

      <Card style={{ padding: "16px 20px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: actions.length || d.isDraft ? 14 : 0 }}>
          <StatusChip status={d.status} />
          <SeverityBadge severity={d.severity} />
          {d.isDraft && <StatusBadge label="Draft" color="#475569" bg="#e2e8f0" />}
          <FlagChips defect={d} />
          <span style={{ ...sub, marginLeft: "auto" }}>Acting as {ROLE_LABEL[detail.actorRole] ?? detail.actorRole}{detail.actorRole === "SA" ? " (logged as on behalf of)" : ""}</span>
        </div>
        {d.isDraft && (
          <p style={{ fontSize: 12, color: "#475569", margin: "0 0 12px", lineHeight: 1.45 }}>
            This defect is a draft. Fill in its details and at least one photo, then confirm it as Open. Nothing else can happen to it until then.
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {d.isDraft && <button style={btnGhost} onClick={() => setEditing(true)}>Edit details</button>}
          {actions.map((a) => (
            <button key={a.key} style={a.key === "confirm" ? btnPrimary : btnGhost} onClick={() => setAction(a)}>{a.label}</button>
          ))}
          {actions.length === 0 && !d.isDraft && <span style={sub}>No actions available in this status.</span>}
          {!d.isDraft && can("sla.escalate") && !["closed", "withdrawn", "accepted_exception"].includes(d.status.key) && <button style={btnGhost} onClick={() => setEscalating(true)}>Escalate manually</button>}
          {!d.isDraft && can("evidence.export") && (
            <button style={btnGhost} onClick={async () => {
              setPackError(null);
              try { const r = await qcx.reports.evidencePack(d.id); const l = await qcx.reports.link(String(r.id)); setPack({ url: l.url, name: l.fileName }); } catch (e) { setPackError((e as Error).message); }
            }}>Evidence pack (ZIP)</button>
          )}
        </div>
        <ErrorNote message={packError} />
        {pack && <p role="status" style={{ fontSize: 12, margin: "10px 0 0" }}>Ready: <a href={resolveMediaUrl(pack.url)} target="_blank" rel="noreferrer">{pack.name}</a> (link valid for 15 minutes). It holds the files, the full history with its hash chain, and a manifest of SHA-256 hashes.</p>}
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 16 }}>
          <Card style={{ padding: "16px 20px" }}>
            <Heading>Defect</Heading>
            <Rows rows={[
              ["Description", d.summary],
              ["Room or area", d.roomArea ?? d.location],
              ["Element", d.element],
              ["Location detail", d.locationDetails],
              ["Nature of defect", d.nature],
              ["Code or standard", d.codeRef],
              ["Trade category", d.tradeCategory?.name],
            ]} />
          </Card>
          <Card style={{ padding: "16px 20px" }}>
            <Heading>Workflow</Heading>
            <Rows rows={[
              ["Assigned inspector", d.assignedTo?.name ?? d.assignedTo?.email],
              ["Builder", d.builder?.name],
              ["Builder contact", d.builderContact?.name ?? d.builderContact?.email],
              ["Allocated trade", d.allocatedTradeCompany?.name],
              ["Trade user", d.allocatedTradeUser?.name ?? d.allocatedTradeUser?.email],
              ["Acknowledge by", d.ackDueAt ? `${fmtTime(d.ackDueAt)}${d.acknowledgedAt ? ` (acknowledged ${fmtTime(d.acknowledgedAt)})` : ""}` : null],
              ["Rectify by", d.rectifyDueAt ? `${fmtTime(d.rectifyDueAt)}${d.rectifiedAt ? ` (rectified ${fmtTime(d.rectifiedAt)})` : ""}` : null],
              ["Re-inspect by", d.reinspectDueAt ? fmtTime(d.reinspectDueAt) : null],
              ["Found at stage", d.foundAtStage ? `${d.foundAtStage}${d.sourceItemNumber ? `, item ${d.sourceItemNumber}` : ""}` : null],
              ["Raised during the DLP", d.dlpDefect ? "Yes" : null],
              ["Target rectification", fmtDate(d.targetRectificationDate)],
              ["Scheduled attendance", fmtDate(d.scheduledAttendanceDate)],
              ["Rework count", String(d.reworkCount)],
              ["On hold", d.holdReason ? `${d.holdReason}${d.holdReviewDate ? ` (review ${fmtDate(d.holdReviewDate)})` : ""}` : null],
              ["Withdrawn because", d.withdrawnReason],
              ["Accepted because", d.exceptionReason],
              ["Closed", d.closedAt ? `${fmtTime(d.closedAt)} by ${d.closedBy?.name ?? d.closedBy?.email ?? "—"}` : null],
              ["Logged by", d.createdBy.name ?? d.createdBy.email],
              ["Closure policy", d.project.closurePolicy.replace(/_/g, " ").toLowerCase()],
            ]} />
          </Card>
          {escalations.length > 0 && (
            <Card style={{ padding: "16px 20px" }}>
              <Heading>Escalations ({escalations.length})</Heading>
              {escalations.map((e) => (
                <div key={e.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "8px 0", fontSize: 13 }}>
                  <b>Level {e.level}</b> <span style={sub}>· {e.manual ? "manual" : "automatic"} · {fmtTime(e.triggeredAt)}</span>
                  <div style={{ color: "#374151" }}>{e.trigger}{e.reason ? `: ${e.reason}` : ""}</div>
                  <div style={sub}>{e.resolvedAt ? `Resolved ${fmtTime(e.resolvedAt)}${e.resolveNote ? `: ${e.resolveNote}` : ""}` : "Open"}{e.referralType ? ` · Referred to ${e.referralType}${e.referralRef ? ` (${e.referralRef})` : ""}` : ""}</div>
                  {!e.resolvedAt && !e.ackAt && <button style={btnLink} onClick={() => qcx.escalations.ack(e.id).then(loadEscalations)}>Acknowledge</button>}
                  {e.level === 4 && !e.referralType && can("sla.escalate") && <button style={{ ...btnLink, marginLeft: 8 }} onClick={() => setReferral(e)}>Record external referral</button>}
                </div>
              ))}
              {can("sla.escalate") && escalations.some((e) => !e.resolvedAt) && <button style={{ ...btnGhost, marginTop: 10 }} onClick={async () => { const note = window.prompt("Mark the escalations resolved. Note:"); if (note?.trim()) { try { await qcx.escalations.escalate(d.id, { action: "Mark resolved", reason_or_resolution_note: note }); load(); loadEscalations(); } catch (e) { window.alert((e as Error).message); } } }}>Mark resolved</button>}
            </Card>
          )}
          <Card style={{ padding: "16px 20px" }}>
            <Heading>Photos ({d.photoUrls.length})</Heading>
            {d.photoUrls.length === 0 ? <p style={sub}>No photos yet.</p> : <PhotoGrid urls={d.photoUrls} />}
            {(d.isDraft || detail.actorRole === "SA") && <AddPhotos id={d.id} onAdded={load} />}
          </Card>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <Card style={{ padding: "16px 20px" }}>
            <Heading>History ({events.length})</Heading>
            <Timeline events={events} />
          </Card>
          <Card style={{ padding: "16px 20px" }}>
            <Heading>Comments ({comments.length})</Heading>
            {comments.map((c) => (
              <div key={c.id} style={{ borderBottom: "1px solid #f1f5f9", padding: "9px 0" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#1a2a4a" }}>
                  {c.author.name ?? c.author.email} <span style={{ ...sub, fontWeight: 500 }}>· {ROLE_LABEL[c.authorRole] ?? c.authorRole} · {fmtTime(c.createdAt)}</span>
                </div>
                <div style={{ fontSize: 13, color: "#374151", marginTop: 3, whiteSpace: "pre-wrap" }}>{c.text}</div>
                {c.visibleTo !== "ALL" && <div style={sub}>{VISIBILITY.find((v) => v.id === c.visibleTo)?.label}</div>}
                {c.attachments.length > 0 && <PhotoGrid urls={c.attachments} small />}
              </div>
            ))}
            <CommentBox id={d.id} onPosted={load} />
          </Card>
        </div>
      </div>

      {escalating && (
        <FormDialog title="Escalate manually" formCode="F34" hide={["action"]} initial={{ action: "Escalate", target_level: 2 }} onClose={() => setEscalating(false)}
          note={<p style={{ ...sub, marginTop: 0 }}>Choose the level (2 formal notice, 3 developer notice, 4 external referral). The people that level names are notified and the escalation is recorded.</p>}
          onSubmit={async (p) => { await qcx.escalations.escalate(d.id, { ...p, action: "Escalate" }); setEscalating(false); load(); loadEscalations(); }} />
      )}
      {referral && (
        <FormDialog title="Record external referral" formCode="F35" initial={{}} onClose={() => setReferral(null)}
          onSubmit={async (p) => { await qcx.escalations.referral(referral.id, p); setReferral(null); loadEscalations(); }} />
      )}
      {editing && (
        <FormDialog
          title="Edit draft details"
          formCode="F16"
          initial={f16Initial(d)}
          refOptions={refOptions}
          submitLabel="Save draft"
          onClose={() => setEditing(false)}
          onSubmit={async (payload) => {
            await api.qc.defects.update(d.id, payload);
            setEditing(false);
            load();
          }}
        />
      )}
      {action && (
        <ActionDialog
          defect={d}
          action={action}
          refOptions={refOptions}
          people={refData?.people ?? []}
          onClose={() => setAction(null)}
          onDone={(next) => {
            setAction(null);
            setDetail(next);
          }}
        />
      )}
    </PageShell>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: "#1a2a4a", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>{children}</div>;
}

function Rows({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "7px 12px", fontSize: 13 }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>{k}</div>
          <div style={{ color: "#1a2a4a", whiteSpace: "pre-wrap" }}>{showValue(v)}</div>
        </div>
      ))}
    </div>
  );
}

function PhotoGrid({ urls, small }: { urls: string[]; small?: boolean }) {
  const size = small ? 54 : 96;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {urls.map((u) => (
        <a key={u} href={resolveMediaUrl(u)} target="_blank" rel="noreferrer">
          <img src={resolveMediaUrl(u)} alt="" style={{ width: size, height: size, objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb", background: "#f1f5f9" }} />
        </a>
      ))}
    </div>
  );
}

function AddPhotos({ id, onAdded }: { id: string; onAdded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 12 }}>
      <ErrorNote message={error} />
      <label style={{ ...btnGhost, display: "inline-block", opacity: busy ? 0.6 : 1 }}>
        {busy ? "Uploading…" : "Add photos"}
        <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) return;
          setBusy(true);
          setError(null);
          try {
            await api.qc.defects.addPhotos(id, files);
            onAdded();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
            e.target.value = "";
          }
        }} />
      </label>
    </div>
  );
}

function Timeline({ events }: { events: QcDefectEvent[] }) {
  return (
    <div>
      {events.map((e, i) => (
        <div key={e.id} style={{ display: "flex", gap: 10, paddingBottom: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ width: 9, height: 9, borderRadius: 99, background: e.to ? "#2563eb" : "#94a3b8", marginTop: 4 }} />
            {i < events.length - 1 && <div style={{ width: 2, flex: 1, background: "#e5e7eb", marginTop: 2 }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a2a4a" }}>
              {e.type}
              {e.to && e.from?.key !== e.to.key && <span style={{ ...sub, fontWeight: 500 }}> · {e.from?.label ?? "—"} → {e.to.label}</span>}
            </div>
            <div style={sub}>
              {e.actor.name ?? e.actor.email} · {ROLE_LABEL[e.actorRole] ?? e.actorRole}{e.onBehalf ? " (on behalf)" : ""} · {fmtTime(e.createdAt)}
            </div>
            {e.note && <div style={{ fontSize: 12.5, color: "#374151", marginTop: 3, whiteSpace: "pre-wrap" }}>{e.note}</div>}
            {e.attachments.length > 0 && <PhotoGrid urls={e.attachments} small />}
            <div style={{ ...sub, fontFamily: "monospace", fontSize: 10, marginTop: 2 }} title="Each entry stores the hash of the one before it, so edits to history are detectable">#{e.hash.slice(0, 10)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CommentBox({ id, onPosted }: { id: string; onPosted: () => void }) {
  const [text, setText] = useState("");
  const [visibleTo, setVisibleTo] = useState("ALL");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    setBusy(true);
    setError(null);
    try {
      await api.qc.defects.comment(id, { text, visibleTo }, files);
      setText("");
      setFiles([]);
      onPosted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 12 }}>
      <ErrorNote message={error} />
      <textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} placeholder="Add a comment. Comments are never edited; a correction is a new comment." value={text} onChange={(e) => setText(e.target.value)} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <div style={{ width: 210 }}><Select value={visibleTo} onChange={setVisibleTo} options={VISIBILITY} placeholder="Visible to" /></div>
        <input type="file" accept="image/*" multiple style={{ fontSize: 11, flex: 1 }} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        <button style={{ ...btnPrimary, opacity: !text.trim() || busy ? 0.6 : 1 }} disabled={!text.trim() || busy} onClick={post}>{busy ? "Posting…" : "Post"}</button>
      </div>
    </div>
  );
}

/** A lifecycle action: the form comes from the spec (F16...F33), the rules from the server. */
function ActionDialog({ defect, action, refOptions, people, onClose, onDone }: {
  defect: QcDefect;
  action: QcAllowedAction;
  refOptions: Record<string, RefOption[]>;
  people: Array<{ id: string; name: string | null; email: string; qcMemberships: Array<{ role: string; tradeCompany: { id: string } | null }> }>;
  onClose: () => void;
  onDone: (d: QcDefectDetail) => void;
}) {
  const hide = action.key === "hold" ? ["action"] : action.key === "resume" ? ["action", "reason_category", "review_date", "client_admin_confirmation"] : [];
  const initial: Record<string, unknown> =
    action.key === "confirm" ? f16Initial(defect)
    : action.key === "allocate" ? { target_rectification_date: defect.targetRectificationDate?.slice(0, 10) ?? "" }
    : {};

  const fieldOptions = (value: Record<string, unknown>): Record<string, RefOption[]> => ({
    trade_user: people
      .filter((p) => p.qcMemberships.some((m) => m.role === "TRADE_USER" && m.tradeCompany?.id === value.trade_company))
      .map((p) => ({ id: p.id, label: p.name ?? p.email })),
    new_trade: refOptions.E03 ?? [],
    builder_recipient: people
      .filter((p) => p.qcMemberships.some((m) => m.role === "MC_PROJECT_MANAGER" || m.role === "MC_MANAGER"))
      .map((p) => ({ id: p.id, label: p.name ?? p.email })),
  });

  return (
    <FormDialog
      title={action.label}
      formCode={action.form}
      initial={initial}
      hide={hide}
      refOptions={refOptions}
      fieldOptions={fieldOptions}
      withFiles
      submitLabel={action.label}
      note={
        action.key === "confirm" && defect.photoUrls.length > 0 ? (
          <p style={{ ...sub, marginTop: 0 }}>{defect.photoUrls.length} photo(s) already attached; add more here if you like.</p>
        ) : null
      }
      onClose={onClose}
      onSubmit={async (payload, files) => {
        const all = Object.values(files).flat();
        const attempt = (extra: Record<string, unknown> = {}) => api.qc.defects.act(defect.id, action.key, { ...payload, ...extra, expectedUpdatedAt: defect.updatedAt }, all);
        try {
          onDone(await attempt());
        } catch (e) {
          const err = e as Error & { code?: string };
          if (err.code === "CATEGORY_MISMATCH" && window.confirm(`${err.message}`)) {
            onDone(await attempt({ confirm_mismatch: true }));
            return;
          }
          throw e;
        }
      }}
    />
  );
}
