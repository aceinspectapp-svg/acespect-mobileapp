"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { TopBar, JobBadge, SummaryBadge, RiskBadge } from "@/lib/ui";
import type { Decision, InspectionDetail, Inspector } from "@/lib/types";

const AGENT_ORDER = ["FORM", "PHOTO", "RISK", "SUMMARY"] as const;

export default function InspectionDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<InspectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  // Post-Dilapidation: push this (submitted) inspection to an inspector as
  // the baseline for a new comparison job.
  const [inspectors, setInspectors] = useState<Inspector[] | null>(null);
  const [pickingBaseline, setPickingBaseline] = useState(false);
  const [selectedInspectorId, setSelectedInspectorId] = useState("");
  const [baselinePushed, setBaselinePushed] = useState(false);
  const [baselineError, setBaselineError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ inspection: InspectionDetail }>(`/review/inspections/${id}`)
      .then((d) => setData(d.inspection))
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) router.replace("/login");
        else setError(e.message);
      });
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(decision: Decision) {
    if (!data?.reviewSummary) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/review/summaries/${data.reviewSummary.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          notes: notes || undefined,
          summaryText: decision === "EDITED" ? editText : undefined,
        }),
      });
      setEditing(false);
      setNotes("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record decision");
    } finally {
      setBusy(false);
    }
  }

  function openBaselinePicker() {
    setBaselineError(null);
    setPickingBaseline(true);
    if (!inspectors) {
      api<{ inspectors: Inspector[] }>("/review/inspectors")
        .then((d) => setInspectors(d.inspectors))
        .catch((e) => setBaselineError(e instanceof Error ? e.message : "Failed to load inspectors"));
    }
  }

  async function pushBaseline() {
    if (!selectedInspectorId) return;
    setBusy(true);
    setBaselineError(null);
    try {
      await api(`/review/inspections/${id}/create-post-dilapidation`, {
        method: "POST",
        body: JSON.stringify({ inspectorId: selectedInspectorId }),
      });
      setPickingBaseline(false);
      setBaselinePushed(true);
    } catch (e) {
      setBaselineError(e instanceof Error ? e.message : "Failed to push baseline");
    } finally {
      setBusy(false);
    }
  }

  if (error) return (<><TopBar /><div className="container"><div className="error">{error}</div></div></>);
  if (!data) return (<><TopBar /><div className="container muted">Loading…</div></>);

  const job = data.reviewJobs[0];
  const summary = data.reviewSummary;
  const resultsByAgent = new Map(job?.results.map((r) => [r.agent, r]) ?? []);

  return (
    <>
      <TopBar />
      <div className="container">
        <button onClick={() => router.push("/inspections")} style={{ marginBottom: 16 }}>
          ← Back
        </button>

        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1 className="page-title" style={{ marginBottom: 2 }}>{data.inspectionType}</h1>
            <p className="page-sub" style={{ marginBottom: 0 }}>
              {data.propertyType} · {data.inspector?.name ?? data.inspector?.email ?? "—"} ·{" "}
              {new Date(data.submittedAt).toLocaleString()}
            </p>
          </div>
          <div className="row">
            <JobBadge status={job?.status ?? null} />
            <SummaryBadge status={summary?.status} />
          </div>
        </div>

        {/* Post-Dilapidation: use this report as a baseline */}
        <div className="card" style={{ marginTop: 18 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <label style={{ marginBottom: 2 }}>Post-Dilapidation baseline</label>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Push this report to an inspector as the baseline for a new comparison job — it'll
                appear in their app with each section's previous result shown for reference.
              </p>
            </div>
            {baselinePushed ? (
              <span className="muted">Pushed ✓</span>
            ) : !pickingBaseline ? (
              <button onClick={openBaselinePicker}>Use as baseline…</button>
            ) : null}
          </div>

          {pickingBaseline && !baselinePushed && (
            <>
              <div className="spacer" />
              {baselineError && <div className="error">{baselineError}</div>}
              {!inspectors ? (
                <span className="muted">Loading inspectors…</span>
              ) : inspectors.length === 0 ? (
                <span className="muted">No inspectors found.</span>
              ) : (
                <div className="row">
                  <select value={selectedInspectorId} onChange={(e) => setSelectedInspectorId(e.target.value)}>
                    <option value="">Select an inspector…</option>
                    {inspectors.map((i) => (
                      <option key={i.id} value={i.id}>{i.name ?? i.email}</option>
                    ))}
                  </select>
                  <button className="primary" disabled={busy || !selectedInspectorId} onClick={pushBaseline}>
                    Push
                  </button>
                  <button disabled={busy} onClick={() => setPickingBaseline(false)}>Cancel</button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Summary + risk + decision */}
        <div className="card" style={{ marginTop: 18 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 280 }}>
              <label>AI summary {summary && <span className="muted">(advisory)</span>}</label>
              {editing ? (
                <textarea rows={4} value={editText} onChange={(e) => setEditText(e.target.value)} />
              ) : (
                <p style={{ marginTop: 4 }}>{summary?.summaryText ?? <span className="muted">No summary yet — review still running.</span>}</p>
              )}
            </div>
            <div style={{ textAlign: "center", minWidth: 90 }}>
              <div className="muted" style={{ fontSize: 12 }}>RISK</div>
              <div className="risk-meter">{summary?.riskScore ?? "—"}</div>
              <RiskBadge score={summary?.riskScore} />
            </div>
          </div>

          {summary && summary.status === "PENDING" && (
            <>
              <div className="spacer" />
              <label>Reviewer notes (optional)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why approve / reject…" />
              <div className="spacer" />
              <div className="row">
                <button className="approve" disabled={busy} onClick={() => decide("APPROVED")}>Approve</button>
                <button className="reject" disabled={busy} onClick={() => decide("REJECTED")}>Reject</button>
                {editing ? (
                  <button className="primary" disabled={busy} onClick={() => decide("EDITED")}>Save edit</button>
                ) : (
                  <button disabled={busy} onClick={() => { setEditText(summary.summaryText ?? ""); setEditing(true); }}>Edit summary</button>
                )}
              </div>
            </>
          )}

          {summary && summary.decisions.length > 0 && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              {summary.decisions.map((d) => (
                <div key={d.id} className="kv">
                  <span className="k">
                    {d.reviewer?.name ?? d.reviewer?.email ?? "Reviewer"} — {d.decision.toLowerCase()}
                    {d.notes ? ` · ${d.notes}` : ""}
                  </span>
                  <span className="muted">{new Date(d.decidedAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Per-agent findings */}
        <h3 style={{ margin: "20px 0 10px" }}>Agent findings</h3>
        <div className="agent-grid">
          {AGENT_ORDER.map((agent) => {
            const r = resultsByAgent.get(agent);
            return (
              <div className="agent-card" key={agent}>
                <h4>
                  {agent}
                  {r?.model && <span className="muted" style={{ fontWeight: 400, textTransform: "none" }}> · {r.model}</span>}
                </h4>
                {r ? (
                  <pre className="json">{JSON.stringify(r.output, null, 2)}</pre>
                ) : (
                  <span className="muted">pending…</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
