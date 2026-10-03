import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { PageShell, Card } from "../../components/WebLayout";
import { ErrorNote, Field, Modal, Select, btnGhost, btnLink, btnPrimary, sub } from "../../components/QcUi";
import { inputStyle } from "../../components/SpecForm";
import { qcx, type InspectionDetail, type InspectionResult, type ResultCode } from "../../qcApi";
import { useQc } from "../../qcContext";
import { resolveMediaUrl } from "../../api";
import { InspectionStatus } from "./QcInspections";

const GLYPH: Record<string, string> = { OK: "✓", "Minor Defect": "▲", "Major Defect": "◆", "Safety Hazard": "⚠", "Monitor / Serviceability": "◉", "N/A": "–", "Not Inspected": "⊘" };
const WEATHER = ["Fine", "Overcast", "Showers", "Rain", "Recent rain (ground wet)", "Hot (over 35 degrees C)", "Windy"];
const DEFECT_CODES = ["Minor Defect", "Major Defect", "Safety Hazard", "Monitor / Serviceability"];

function StartDialog({ id, onClose, onStarted }: { id: string; onClose: () => void; onStarted: () => void }) {
  const [f, setF] = useState({ weather: "Fine", temperature: "", site_access: "Full", access_limitations: "", persons_present: "", carriedForwardReviewed: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Start inspection" onClose={onClose} width={520}
      footer={<><button style={btnGhost} onClick={onClose}>Cancel</button><button style={btnPrimary} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await qcx.inspections.start(id, { weather: f.weather, temperature: f.temperature ? Number(f.temperature) : undefined, site_access: f.site_access, access_limitations: f.access_limitations || undefined, persons_present: f.persons_present || undefined, carriedForwardReviewed: f.carriedForwardReviewed, carried_forward_items_reviewed: f.carriedForwardReviewed }); onStarted(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? "Starting…" : "Start"}</button></>}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Weather" required><Select value={f.weather} onChange={(v) => setF({ ...f, weather: v })} options={WEATHER.map((w) => ({ id: w, label: w }))} /></Field>
          <Field label="Temperature (°C)"><input type="number" style={inputStyle} value={f.temperature} onChange={(e) => setF({ ...f, temperature: e.target.value })} /></Field>
        </div>
        <Field label="Site access" required><Select value={f.site_access} onChange={(v) => setF({ ...f, site_access: v })} options={["Full", "Partial", "Restricted"].map((w) => ({ id: w, label: w }))} /></Field>
        {f.site_access !== "Full" && <Field label="Access limitations" required><textarea style={{ ...inputStyle, minHeight: 56 }} value={f.access_limitations} onChange={(e) => setF({ ...f, access_limitations: e.target.value })} /></Field>}
        <Field label="Persons present"><input style={inputStyle} value={f.persons_present} onChange={(e) => setF({ ...f, persons_present: e.target.value })} placeholder="For example the builder's site supervisor" /></Field>
        <label style={{ fontSize: 13, display: "flex", gap: 8 }}><input type="checkbox" checked={f.carriedForwardReviewed} onChange={(e) => setF({ ...f, carriedForwardReviewed: e.target.checked })} /> I have reviewed any Monitor items carried forward from earlier inspections on this lot.</label>
      </div>
    </Modal>
  );
}

function CompleteDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [check, setCheck] = useState<Awaited<ReturnType<typeof qcx.inspections.completion>> | null>(null);
  const [f, setF] = useState({ overall_summary_notes: "", limitations_statement: "", recommended_next_inspection: "", declaration: false });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { qcx.inspections.completion(id).then(setCheck).catch((e) => setError(e.message)); }, [id]);
  return (
    <Modal title="Complete and sign" onClose={onClose} width={560}
      footer={<><button style={btnGhost} onClick={onClose}>Cancel</button><button style={btnPrimary} disabled={!check?.canComplete || !f.declaration} onClick={async () => {
        try { await qcx.inspections.complete(id, { ...f, recommended_next_inspection: f.recommended_next_inspection || undefined }); onDone(); } catch (e) { setError((e as Error).message); }
      }}>Sign and lock</button></>}>
      <ErrorNote message={error} />
      {check && (
        <div style={{ fontSize: 13, display: "grid", gap: 8, marginBottom: 12 }}>
          <div style={{ color: check.unanswered.length ? "#b91c1c" : "#15803d" }}>{check.unanswered.length ? `✗ ${check.unanswered.length} item(s) have no result: ${check.unanswered.slice(0, 10).join(", ")}` : "✓ Every item has a result"}</div>
          <div style={{ color: check.draftDefects.length ? "#b91c1c" : "#15803d" }}>
            {check.draftDefects.length ? <>✗ {check.draftDefects.length} defect(s) are still drafts: {check.draftDefects.map((d) => <Link key={d.id} to={`/qc/defects/${d.id}`} style={{ marginRight: 8 }}>{d.defectRef ?? "draft"}</Link>)} Confirm or withdraw each.</> : "✓ No draft defects"}
          </div>
          {!check.hasSignature && <div style={{ color: "#b91c1c" }}>✗ Your signature image is not on file. Ask the platform administrator to add it to your credentials.</div>}
        </div>
      )}
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Overall summary notes"><textarea style={{ ...inputStyle, minHeight: 64 }} value={f.overall_summary_notes} onChange={(e) => setF({ ...f, overall_summary_notes: e.target.value })} /></Field>
        {check && check.notInspected > 0 && <Field label={`Limitations statement (${check.notInspected} item(s) were not inspected)`} required><textarea style={{ ...inputStyle, minHeight: 56 }} value={f.limitations_statement} onChange={(e) => setF({ ...f, limitations_statement: e.target.value })} /></Field>}
        <Field label="Recommended next inspection"><input type="date" style={inputStyle} value={f.recommended_next_inspection} onChange={(e) => setF({ ...f, recommended_next_inspection: e.target.value })} /></Field>
        <label style={{ fontSize: 13, display: "flex", gap: 8 }}><input type="checkbox" checked={f.declaration} onChange={(e) => setF({ ...f, declaration: e.target.checked })} /> I inspected the items as recorded and the results are accurate.</label>
      </div>
    </Modal>
  );
}

function ItemCard({ inspectionId, result, codes, editable, onSaved, defects }: { inspectionId: string; result: InspectionResult; codes: ResultCode[]; editable: boolean; onSaved: () => void; defects: InspectionDetail["defects"] }) {
  const item = result.item as Record<string, any>;
  const [code, setCode] = useState<string | null>(result.resultCode);
  const [comments, setComments] = useState(result.comments ?? "");
  const [location, setLocation] = useState(result.locationDetail ?? "");
  const [reason, setReason] = useState(result.reason ?? "");
  const [value, setValue] = useState(result.measurement ? String(result.measurement.value) : "");
  const [photos, setPhotos] = useState<Array<{ raw: string; url: string }>>(result.photoUrls.map((u) => ({ raw: u.split("?")[0]!, url: u })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const def = codes.find((c) => c.code === code);
  const isDefect = !!code && DEFECT_CODES.includes(code);
  const mine = defects.filter((d) => d.sourceItemNumber === result.itemNumber);
  const tol = item.tolerance_minimum_and_maximum as unknown[] | undefined;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    try {
      const r = await qcx.evidence.upload({ linkedType: "Inspection", linkedId: inspectionId, phase: "Identification", capturedVia: "Device library" }, Array.from(files));
      setPhotos((p) => [...p, ...r.evidence.map((e) => ({ raw: e.rawUrl, url: e.url }))]);
    } catch (e) { setError((e as Error).message); }
  }
  async function save() {
    if (!code) return;
    setBusy(true); setError(null);
    try {
      await qcx.inspections.saveResult(inspectionId, result.itemNumber, {
        result: code, comments, locationDetail: location, reason, photoUrls: photos.map((p) => p.raw),
        measurement: item.item_type === "Measurement" && value !== "" ? { value: Number(value), unit: item.measurement_unit } : undefined,
        clientUpdatedAt: new Date().toISOString(),
      });
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const answered = !!result.resultCode;
  return (
    <Card style={{ padding: 14, marginBottom: 10, borderLeft: `4px solid ${answered ? codes.find((c) => c.code === result.resultCode)?.colour ?? "#cbd5e1" : "#e2e8f0"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <div>
          <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>{result.itemNumber}{item.mandatory_item === false ? " · optional" : ""}{result.carriedFromId ? " · carried forward" : ""}</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1a2a4a" }}>{item.check_description}</div>
          <div style={sub}>{item.location_or_element} · {item.reference}</div>
        </div>
        <div style={{ whiteSpace: "nowrap", fontSize: 13, color: answered ? "#1a2a4a" : "#94a3b8", fontWeight: 600 }}>{answered ? `${GLYPH[result.resultCode!]} ${result.resultCode}` : "No result yet"}</div>
      </div>
      {(open || !answered) && editable && (
        <div style={{ marginTop: 10 }}>
          <p style={{ ...sub, margin: "0 0 8px" }}>{item.what_to_check_and_method} <b>Guide:</b> {item.guide_value_or_acceptable_tolerance}{tol ? ` (${tol[0] ?? "–"} to ${tol[1] ?? "–"} ${item.measurement_unit ?? ""})` : ""}</p>
          <div role="radiogroup" aria-label="Result" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {codes.map((c) => (
              <button key={c.code} role="radio" aria-checked={code === c.code} title={c.definition} onClick={() => setCode(c.code)} style={{
                padding: "7px 11px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                border: `2px solid ${c.colour}`, background: code === c.code ? c.colour : "white", color: code === c.code ? "white" : "#1a2a4a",
              }}>{GLYPH[c.code]} {c.label}</button>
            ))}
          </div>
          {def && <p style={{ ...sub, margin: "6px 0 0" }}>{def.definition}</p>}
          {item.item_type === "Measurement" && (
            <Field label={`Measured value (${item.measurement_unit ?? ""})`}><input type="number" step="any" style={{ ...inputStyle, width: 160 }} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          )}
          {code && (isDefect || comments) && <Field label={isDefect ? "Describe the defect" : "Comments"} required={isDefect}><textarea style={{ ...inputStyle, minHeight: 56 }} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>}
          {code && !isDefect && !comments && <button style={{ ...btnLink, marginTop: 6 }} onClick={() => setComments(" ")}>Add a comment</button>}
          {isDefect && <Field label="Location detail" required><input style={inputStyle} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="For example Bed 2 north wall" /></Field>}
          {(code === "N/A" || code === "Not Inspected") && <Field label="Reason" required><input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
          {code && (isDefect || item.photo_rule === "Always" || photos.length > 0) && (
            <div style={{ marginTop: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Photos {isDefect && <span style={{ color: "#dc2626" }}>*</span>}</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0" }}>
                {photos.map((p) => (
                  <div key={p.raw} style={{ position: "relative" }}>
                    <img src={resolveMediaUrl(p.url)} alt={`Evidence for item ${result.itemNumber}`} width={88} height={88} style={{ objectFit: "cover", borderRadius: 8, border: "1px solid #e5e7eb" }} />
                    <button aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x.raw !== p.raw))} style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10, border: "none", background: "#dc2626", color: "white", cursor: "pointer", fontSize: 12 }}>×</button>
                  </div>
                ))}
              </div>
              <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => upload(e.target.files)} />
            </div>
          )}
          <ErrorNote message={error} />
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
            <button style={btnPrimary} disabled={!code || busy} onClick={save}>{busy ? "Saving…" : "Save result"}</button>
            {answered && isDefect && <button style={btnGhost} onClick={async () => { try { await qcx.inspections.raiseAnother(inspectionId, result.itemNumber); onSaved(); } catch (e) { setError((e as Error).message); } }}>Raise another defect from this item</button>}
          </div>
        </div>
      )}
      {mine.length > 0 && <div style={{ marginTop: 8, fontSize: 12 }}>{mine.map((d) => <Link key={d.id} to={`/qc/defects/${d.id}`} style={{ marginRight: 10 }}>{d.defectRef ?? "Defect"}{d.isDraft ? " (draft)" : ""}</Link>)}</div>}
      {!editable && result.photoUrls.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {result.photoUrls.map((u) => <a key={u} href={resolveMediaUrl(u)} target="_blank" rel="noreferrer"><img src={resolveMediaUrl(u)} alt={`Evidence for item ${result.itemNumber}`} width={72} height={72} style={{ objectFit: "cover", borderRadius: 8 }} /></a>)}
        </div>
      )}
      {!editable && (result.comments || result.locationDetail || result.reason) && <p style={{ fontSize: 12, color: "#475569", margin: "8px 0 0" }}>{[result.comments, result.locationDetail && `(${result.locationDetail})`, result.reason].filter(Boolean).join(" ")}</p>}
    </Card>
  );
}

export function QcInspectionDetail() {
  const { id = "" } = useParams();
  const { me, can } = useQc();
  const [data, setData] = useState<InspectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [addendum, setAddendum] = useState(false);
  const [report, setReport] = useState<{ url: string; fileName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => qcx.inspections.get(id).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const insp = data?.inspection;
  const mineToDo = !!insp && (me?.isSA || insp.inspectorId === me?.userId);
  const editable = !!insp && insp.status === "IN_PROGRESS" && !insp.locked && mineToDo && can("inspections.perform");
  const sections = useMemo(() => {
    const m = new Map<string, InspectionResult[]>();
    for (const r of insp?.results ?? []) {
      const s = String((r.item as Record<string, unknown>).section ?? "General");
      m.set(s, [...(m.get(s) ?? []), r]);
    }
    return [...m.entries()];
  }, [insp]);

  if (error) return <PageShell title="Inspection"><ErrorNote message={error} /></PageShell>;
  if (!data || !insp) return <PageShell title="Inspection"><p style={sub}>Loading…</p></PageShell>;
  const c = insp.counts ?? {};

  async function makeReport() {
    setBusy(true);
    try {
      const r = await qcx.inspections.report(id);
      const link = await qcx.reports.link(String(r.id));
      setReport({ url: link.url, fileName: link.fileName });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <PageShell
      title={`${insp.ref}: ${insp.stage?.stage_name ?? insp.type}`}
      subtitle={`${insp.project?.name ?? ""}${insp.lot ? ` · Lot ${insp.lot.name}` : ""} · ${insp.inspector?.name ?? "Unassigned"}`}
      actions={<div style={{ display: "flex", gap: 8 }}>
        {insp.status === "PLANNED" && mineToDo && can("inspections.perform") && <button style={btnPrimary} onClick={() => setStarting(true)}>Start inspection</button>}
        {editable && <button style={btnPrimary} onClick={() => setCompleting(true)}>Complete and sign</button>}
        {insp.status === "COMPLETED" && can("inspections.reports") && <button style={btnGhost} disabled={busy} onClick={makeReport}>{busy ? "Preparing…" : "Generate report (PDF)"}</button>}
      </div>}
    >
      <Link to="/qc/inspections" style={{ ...btnLink, display: "inline-block", marginBottom: 12 }}>← All inspections</Link>
      <Card style={{ padding: "16px 20px", marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 13 }}>
        <div><div style={sub}>Status</div><InspectionStatus s={insp.status} />{insp.locked && <span title="Signed and locked"> 🔒</span>}</div>
        <div><div style={sub}>Planned window</div>{insp.plannedFrom ? `${new Date(insp.plannedFrom).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : "—"}</div>
        <div><div style={sub}>Template</div>{data.template ? `${data.template.name} v${data.template.version}` : "None (ad-hoc)"}</div>
        <div><div style={sub}>Site conditions</div>{insp.header?.weather ? `${insp.header.weather}${insp.header.temperature ? `, ${insp.header.temperature}°C` : ""} · ${insp.header.site_access}` : "—"}</div>
        {insp.counts && <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#475569" }}>{Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${GLYPH[k] ?? "·"} ${k}: ${n}`).join("   ")}</div>}
        {insp.request?.rbsNotifiedOn && <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#475569" }}>Surveyor notified {String(insp.request.rbsNotifiedOn)}{insp.request.rbsName ? ` (${insp.request.rbsName})` : ""}</div>}
      </Card>
      {report && <div role="status" style={{ background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>Report ready: <a href={resolveMediaUrl(report.url)} target="_blank" rel="noreferrer">{report.fileName}</a>. The link works for 15 minutes; open it again from Reports.</div>}

      {insp.status === "COMPLETED" && insp.summary?.overall_summary_notes && <Card style={{ padding: 14, marginBottom: 14, fontSize: 13 }}><b>Summary.</b> {String(insp.summary.overall_summary_notes)}{insp.summary.limitations_statement ? <><br /><b>Limitations.</b> {String(insp.summary.limitations_statement)}</> : null}</Card>}

      {sections.map(([section, rs]) => (
        <div key={section} style={{ marginBottom: 18 }}>
          <h2 style={{ fontSize: 14, color: "#1a2a4a", margin: "0 0 8px" }}>{section}</h2>
          {rs.map((r) => <ItemCard key={r.id + (r.answeredAt ?? "")} inspectionId={id} result={r} codes={data.resultCodes} editable={editable} defects={data.defects} onSaved={load} />)}
        </div>
      ))}
      {sections.length === 0 && <Card style={{ padding: 20, fontSize: 13, color: "#64748b" }}>{insp.status === "IN_PROGRESS" || insp.status === "COMPLETED" ? "This visit has no checklist items. Defects are logged from the Defects page." : "The checklist appears when the inspection starts."}</Card>}

      {data.defects.length > 0 && (
        <Card style={{ padding: 14, marginTop: 8 }}>
          <b style={{ fontSize: 13 }}>Defects from this inspection</b>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13 }}>
            {data.defects.map((d) => <li key={d.id}><Link to={`/qc/defects/${d.id}`}>{d.defectRef ?? "Defect"}</Link>: {d.title} <span style={sub}>({d.severity?.label ?? "no severity"}, {d.isDraft ? "draft" : d.status.label})</span></li>)}
          </ul>
        </Card>
      )}

      {insp.status === "COMPLETED" && (
        <Card style={{ padding: 14, marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 13 }}>Addenda</b>
            {mineToDo && can("inspections.perform") && <button style={btnLink} onClick={() => setAddendum(true)}>Add an addendum</button>}
          </div>
          {data.addenda.length === 0 && <p style={{ ...sub, margin: "6px 0 0" }}>The signed inspection cannot be changed. Corrections and late evidence are added here.</p>}
          {data.addenda.map((a, i) => <p key={i} style={{ fontSize: 13, margin: "8px 0 0" }}><span style={sub}>{new Date(a.at).toLocaleString()} · {a.reason}</span><br />{a.text}</p>)}
        </Card>
      )}
      {starting && <StartDialog id={id} onClose={() => setStarting(false)} onStarted={() => { setStarting(false); load(); }} />}
      {completing && <CompleteDialog id={id} onClose={() => setCompleting(false)} onDone={() => { setCompleting(false); load(); }} />}
      {addendum && <AddendumDialog id={id} onClose={() => setAddendum(false)} onDone={() => { setAddendum(false); load(); }} />}
    </PageShell>
  );
}

function AddendumDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [reason, setReason] = useState("Additional information");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Add an addendum" onClose={onClose} width={480}
      footer={<><button style={btnGhost} onClick={onClose}>Cancel</button><button style={btnPrimary} disabled={!text.trim()} onClick={async () => { try { await qcx.inspections.addendum(id, { addendum_text: text, reason }, files); onDone(); } catch (e) { setError((e as Error).message); } }}>Add</button></>}>
      <ErrorNote message={error} />
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Reason" required><Select value={reason} onChange={setReason} options={["Correction", "Additional information", "Late evidence", "Other"].map((x) => ({ id: x, label: x }))} /></Field>
        <Field label="Addendum" required><textarea style={{ ...inputStyle, minHeight: 90 }} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <Field label="Attachments"><input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></Field>
      </div>
    </Modal>
  );
}
