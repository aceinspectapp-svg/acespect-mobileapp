"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { TopBar } from "@/lib/ui";
import { StatusBadge, AnswerValue, humanizeKey } from "@/lib/inspectorUi";
import type { WebInspection, WebSection, WebDamage } from "@/lib/types";

/**
 * One inspection, from the inspector's side. A draft is editable and can be
 * finalized (which hands it to a reviewer and locks it); anything already sent
 * is read-only.
 *
 * Editing covers the job details, each section's report text and its damage
 * records -- i.e. everything that ends up in the written report. The captured
 * field answers are shown read-only: they're rendered by template-driven form
 * controls that only exist in the mobile app, so correcting one there and
 * re-saving is the reliable path rather than a partial re-implementation here.
 */
export default function MyInspectionDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [insp, setInsp] = useState<WebInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  // Local edit buffer — only written back to the server on Save.
  const [draft, setDraft] = useState<WebInspection | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api<{ inspection: WebInspection }>(`/web/inspections/${id}`)
      .then((d) => {
        setInsp(d.inspection);
        setDraft(d.inspection);
      })
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) router.replace("/login");
        else setError(e.message);
      });
  }, [id, router]);

  useEffect(load, [load]);

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
  if (!insp || !draft) {
    return (
      <>
        <TopBar />
        <div className="container">
          <p className="muted">Loading…</p>
        </div>
      </>
    );
  }

  const isDraft = insp.status === "draft";

  function patch(p: Partial<WebInspection>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function patchSection(sectionId: string, p: Partial<WebSection>) {
    setDraft((d) =>
      d
        ? { ...d, sections: d.sections.map((s) => (s.id === sectionId ? { ...s, ...p } : s)) }
        : d,
    );
  }

  function patchDamage(sectionId: string, damageId: string, p: Partial<WebDamage>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            sections: d.sections.map((s) =>
              s.id === sectionId
                ? { ...s, damages: s.damages.map((x) => (x.id === damageId ? { ...x, ...p } : x)) }
                : s,
            ),
          }
        : d,
    );
  }

  function removeDamage(sectionId: string, damageId: string) {
    setDraft((d) =>
      d
        ? {
            ...d,
            sections: d.sections.map((s) =>
              s.id === sectionId ? { ...s, damages: s.damages.filter((x) => x.id !== damageId) } : s,
            ),
          }
        : d,
    );
  }

  async function save() {
    if (!draft || !id) return;
    setBusy(true);
    setError(null);
    try {
      // Sections are sent whole — the API replaces the stored set.
      await api(`/inspections/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          jobNo: draft.jobNo,
          address: draft.address,
          suburb: draft.suburb,
          client: draft.client,
          date: draft.date,
          notes: draft.notes,
          sections: draft.sections.map((s, idx) => ({
            key: s.key,
            name: s.name,
            icon: s.icon ?? "",
            order: idx,
            status: (s.status as "complete" | "partial" | "pending") ?? "pending",
            reportText: s.reportText ?? "",
            fields: s.fields ?? {},
            answers: s.answers ?? undefined,
            photos: s.photos ?? [],
            damages: (s.damages ?? []).map((dm, dIdx) => ({
              type: dm.type || "Damage",
              location: dm.location ?? "",
              direction: dm.direction ?? "",
              widthMm: Number(dm.widthMm) || 0,
              lengthMm: Number(dm.lengthMm) || 0,
              notes: dm.notes ?? "",
              photos: dm.photos ?? [],
              order: dIdx,
            })),
          })),
        }),
      });
      setEditing(false);
      setNotice("Changes saved.");
      load();
    } catch (e) {
      const err = e as ApiError;
      // The wrapper already tried a token refresh; a 401 here means the session
      // is genuinely gone, so send them to sign in rather than showing "token
      // expired" over a form full of unsaved edits.
      if (err.status === 401) router.replace("/login");
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!id) return;
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      await api(`/inspections/${id}/finalize`, { method: "POST" });
      setNotice("Sent for review.");
      load();
    } catch (e) {
      const err = e as ApiError;
      // The wrapper already tried a token refresh; a 401 here means the session
      // is genuinely gone, so send them to sign in rather than showing "token
      // expired" over a form full of unsaved edits.
      if (err.status === 401) router.replace("/login");
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const view = editing ? draft : insp;

  return (
    <>
      <TopBar />
      <div className="container">
        <button className="link" onClick={() => router.push("/my-inspections")}>
          ← Back to my inspections
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <h1 style={{ margin: 0 }}>{insp.jobNo || "Untitled job"}</h1>
          <StatusBadge status={insp.status} />
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          {insp.type} · {insp.propertyType.replace(/_/g, " ")} · {insp.sections.length} sections
        </p>

        {notice && <div className="ok-note">{notice}</div>}
        {error && <div className="error">{error}</div>}

        {!isDraft && (
          <div className="card" style={{ borderLeft: "3px solid var(--info, #2F6FED)" }}>
            <p style={{ margin: 0 }}>
              This inspection has been sent for review and can no longer be edited.
            </p>
          </div>
        )}

        {/* Actions */}
        {isDraft && (
          <div style={{ display: "flex", gap: 10, margin: "16px 0" }}>
            {!editing ? (
              <>
                <button className="primary" onClick={() => setEditing(true)} disabled={busy}>
                  Edit
                </button>
                <button className="primary" onClick={() => setConfirming(true)} disabled={busy}>
                  {busy ? "Working…" : "Finalize & send for review"}
                </button>
              </>
            ) : (
              <>
                <button className="primary" onClick={save} disabled={busy}>
                  {busy ? "Saving…" : "Save changes"}
                </button>
                <button
                  onClick={() => {
                    setDraft(insp);
                    setEditing(false);
                  }}
                  disabled={busy}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        )}

        {/* Finalizing is one-way, so it asks first — inline rather than a
            native confirm(), which is easy to dismiss by accident. */}
        {confirming && (
          <div className="card" style={{ borderLeft: "3px solid var(--amber)" }}>
            <h2 style={{ marginTop: 0 }}>Send this inspection for review?</h2>
            <p style={{ marginTop: 0 }}>
              This assigns a reviewer and locks the inspection. You will not be able
              to edit it afterwards.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="primary" onClick={finalize} disabled={busy}>
                {busy ? "Sending…" : "Yes, send for review"}
              </button>
              <button onClick={() => setConfirming(false)} disabled={busy}>
                Keep as draft
              </button>
            </div>
          </div>
        )}

        {/* Job details */}
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Job details</h2>
          <div className="grid2">
            <Field label="Job No" value={view.jobNo} editing={editing} onChange={(v) => patch({ jobNo: v })} />
            <Field label="Client" value={view.client} editing={editing} onChange={(v) => patch({ client: v })} />
            <Field label="Address" value={view.address} editing={editing} onChange={(v) => patch({ address: v })} />
            <Field label="Suburb" value={view.suburb} editing={editing} onChange={(v) => patch({ suburb: v })} />
            <Field label="Date" value={view.date} editing={editing} onChange={(v) => patch({ date: v })} type="date" />
          </div>
          <label style={{ marginTop: 12, display: "block" }}>Notes</label>
          {editing ? (
            <textarea rows={3} value={view.notes} onChange={(e) => patch({ notes: e.target.value })} />
          ) : (
            <p style={{ marginTop: 4 }}>{view.notes || <span className="muted">—</span>}</p>
          )}
        </div>

        {/* Sections */}
        {view.sections.map((s) => (
          <div className="card" key={s.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h2 style={{ margin: 0 }}>
                {s.icon} {s.name}
              </h2>
              <span className="badge">{s.status}</span>
            </div>

            <label style={{ marginTop: 12, display: "block" }}>Report text</label>
            {editing ? (
              <textarea
                rows={4}
                value={s.reportText}
                onChange={(e) => patchSection(s.id, { reportText: e.target.value })}
              />
            ) : (
              <p style={{ marginTop: 4 }}>{s.reportText || <span className="muted">—</span>}</p>
            )}

            {/* Damages */}
            {s.damages.length > 0 && (
              <>
                <h3 style={{ marginBottom: 6 }}>Damage records ({s.damages.length})</h3>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Location</th>
                        <th>Runs</th>
                        <th>Width</th>
                        <th>Length</th>
                        <th>Notes</th>
                        {editing && <th />}
                      </tr>
                    </thead>
                    <tbody>
                      {s.damages.map((dm) => (
                        <tr key={dm.id}>
                          <td>
                            <Cell v={dm.type} editing={editing} onChange={(v) => patchDamage(s.id, dm.id, { type: v })} />
                          </td>
                          <td>
                            <Cell v={dm.location} editing={editing} onChange={(v) => patchDamage(s.id, dm.id, { location: v })} />
                          </td>
                          <td>
                            <Cell v={dm.direction} editing={editing} onChange={(v) => patchDamage(s.id, dm.id, { direction: v })} />
                          </td>
                          <td>
                            <Cell v={String(dm.widthMm)} editing={editing} onChange={(v) => patchDamage(s.id, dm.id, { widthMm: Number(v) || 0 })} />
                          </td>
                          <td>
                            <Cell v={String(dm.lengthMm)} editing={editing} onChange={(v) => patchDamage(s.id, dm.id, { lengthMm: Number(v) || 0 })} />
                          </td>
                          <td>
                            <Cell v={dm.notes} editing={editing} onChange={(v) => patchDamage(s.id, dm.id, { notes: v })} />
                          </td>
                          {editing && (
                            <td>
                              <button className="link" onClick={() => removeDamage(s.id, dm.id)}>
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Captured answers — read-only, see the component doc above. */}
            {s.answers && Object.keys(s.answers).length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary className="muted">
                  Captured answers ({Object.keys(s.answers).length}) — edit these in the mobile app
                </summary>
                <table style={{ marginTop: 8 }}>
                  <tbody>
                    {Object.entries(s.answers).map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ width: "45%" }} className="muted">
                          {humanizeKey(k)}
                        </td>
                        <td>
                          <AnswerValue value={v} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {s.photos.length > 0 && (
              <p className="muted" style={{ marginTop: 10 }}>
                {s.photos.length} photo{s.photos.length === 1 ? "" : "s"} attached
              </p>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Field({
  label,
  value,
  editing,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label>{label}</label>
      {editing ? (
        <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <p style={{ marginTop: 4 }}>{value || <span className="muted">—</span>}</p>
      )}
    </div>
  );
}

function Cell({
  v,
  editing,
  onChange,
}: {
  v: string;
  editing: boolean;
  onChange: (v: string) => void;
}) {
  if (!editing) return <>{v || <span className="muted">—</span>}</>;
  return <input value={v ?? ""} onChange={(e) => onChange(e.target.value)} />;
}
