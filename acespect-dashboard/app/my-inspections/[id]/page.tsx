"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { TopBar } from "@/lib/ui";
import { StatusBadge, AnswerValue as AnswerValueDisplay, humanizeKey } from "@/lib/inspectorUi";
import type { WebInspection, WebSection } from "@/lib/types";
import { SectionFieldEditor } from "@/lib/SectionFieldEditor";
import {
  ActiveTemplate,
  AnswerTree,
  AnswerValue,
  fetchActiveTemplate,
  flattenSectionToDraft,
  listMissingRequiredFields,
  meetsAllRequireWhen,
} from "@/lib/templateFields";

/**
 * One inspection, from the inspector's side. A draft is editable and can be
 * finalized (which hands it to a reviewer and locks it); anything already
 * sent is read-only.
 *
 * Each section's captured answers are rendered with SectionFieldEditor --
 * the same template-field-driven form the mobile app uses -- rather than a
 * flat key/value dump, so a section started on mobile can be reviewed and
 * finished here field-by-field, in the same layout the inspector already
 * knows. A section's `reportText`/`damages` are derived from its answers on
 * save (matching how the mobile app derives them), so they're shown
 * read-only for any section backed by a template.
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

  // sectionKey -> its current published template (or null if that section
  // key isn't template-backed, e.g. an older/custom section).
  const [templates, setTemplates] = useState<Record<string, ActiveTemplate | null>>({});
  // sectionId -> labels of required fields still missing, shown after a
  // "Mark complete" attempt that couldn't succeed yet.
  const [sectionIssues, setSectionIssues] = useState<Record<string, string[]>>({});

  // Which section's full detail shows in the right-hand column. Tracked by
  // `key` rather than `id` -- saving replaces every section row server-side
  // (new ids), so an id-based selection would silently reset after every
  // Save.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

  // Load each distinct section's active template once we know what sections
  // exist. Missing templates (404) resolve to null and just fall back to the
  // old flat view for that section.
  useEffect(() => {
    if (!insp) return;
    const keys = Array.from(new Set(insp.sections.map((s) => s.key)));
    const missing = keys.filter((k) => !(k in templates));
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((key) => fetchActiveTemplate(insp.type, insp.propertyType, key).then((t) => [key, t] as const)),
    ).then((pairs) => {
      if (cancelled) return;
      setTemplates((prev) => {
        const next = { ...prev };
        for (const [key, t] of pairs) next[key] = t;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insp]);

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

  function setAnswer(sectionId: string, key: string, value: AnswerValue) {
    setDraft((d) =>
      d
        ? {
            ...d,
            sections: d.sections.map((s) =>
              s.id === sectionId ? { ...s, answers: { ...(s.answers ?? {}), [key]: value } } : s,
            ),
          }
        : d,
    );
  }

  function markComplete(section: WebSection) {
    const template = templates[section.key];
    if (!template) {
      // No template to validate against — nothing to check, just mark it.
      patchSection(section.id, { status: "complete" });
      setSectionIssues((prev) => ({ ...prev, [section.id]: [] }));
      return;
    }
    const scope = (section.answers ?? {}) as AnswerTree;
    if (!meetsAllRequireWhen(template.fields, scope)) {
      setSectionIssues((prev) => ({
        ...prev,
        [section.id]: ["Add at least one recorded defect where required — see the warning above."],
      }));
      return;
    }
    const missing = listMissingRequiredFields(template.fields, scope);
    if (missing.length > 0) {
      setSectionIssues((prev) => ({ ...prev, [section.id]: missing }));
      return;
    }
    setSectionIssues((prev) => ({ ...prev, [section.id]: [] }));
    patchSection(section.id, { status: "complete" });
  }

  async function save() {
    if (!draft || !id) return;
    setBusy(true);
    setError(null);
    try {
      // Sections are sent whole — the API replaces the stored set. Any
      // template-backed section has its report fields/damages/text
      // re-derived from its (possibly just-edited) answers, so the report
      // never drifts out of sync with what's shown here.
      const sections = draft.sections.map((s, idx) => {
        const template = templates[s.key];
        const answers = s.answers ?? undefined;
        const derived = template && answers ? flattenSectionToDraft(template.fields, answers as AnswerTree) : null;
        const status = (s.status as "complete" | "partial" | "pending") ?? "pending";
        return {
          key: s.key,
          name: s.name,
          icon: s.icon ?? "",
          order: idx,
          status,
          reportText: derived ? derived.reportText : s.reportText ?? "",
          fields: derived ? derived.fields : s.fields ?? {},
          answers,
          photos: s.photos ?? [],
          damages: (derived ? derived.damages : s.damages ?? []).map((dm, dIdx) => ({
            type: dm.type || "Damage",
            location: dm.location ?? "",
            direction: dm.direction ?? "",
            widthMm: Number(dm.widthMm) || 0,
            lengthMm: Number(dm.lengthMm) || 0,
            notes: dm.notes ?? "",
            photos: dm.photos ?? [],
            order: dIdx,
          })),
        };
      });
      await api(`/inspections/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          jobNo: draft.jobNo,
          address: draft.address,
          suburb: draft.suburb,
          client: draft.client,
          date: draft.date,
          notes: draft.notes,
          sections,
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

        {/* Sections — a list on the left, the selected section's full detail
            on the right (the same layout the inspector fills in on mobile,
            not a summary). */}
        <div className="section-layout">
          <div className="section-nav">
            {view.sections.map((s) => {
              const active = (selectedKey ?? view.sections[0]?.key) === s.key;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`section-nav-item${active ? " active" : ""}`}
                  onClick={() => setSelectedKey(s.key)}
                >
                  <span className="section-nav-icon">{s.icon}</span>
                  <span className="section-nav-text">
                    <span className="section-nav-name">{s.name}</span>
                    {s.photos.length > 0 && (
                      <span className="section-nav-sub">
                        {s.photos.length} photo{s.photos.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                  <span className={`badge${s.status === "complete" ? " green" : s.status === "partial" ? " amber" : " slate"}`}>
                    {s.status}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="section-detail">
            {(() => {
              const s = view.sections.find((sec) => sec.key === (selectedKey ?? view.sections[0]?.key)) ?? view.sections[0];
              if (!s) return <div className="card muted">No sections.</div>;
              return <SectionDetail s={s} />;
            })()}
          </div>
        </div>
      </div>
    </>
  );

  function SectionDetail({ s }: { s: WebSection }) {
    const template = templates[s.key];
    const issues = sectionIssues[s.id] ?? [];
    return (
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>
            {s.icon} {s.name}
          </h2>
          <span className={`badge${s.status === "complete" ? " green" : s.status === "partial" ? " amber" : " slate"}`}>
            {s.status}
          </span>
        </div>

        {isDraft && editing && (
                <div className="section-status-row">
                  <button
                    onClick={() => markComplete(s)}
                    disabled={s.status === "complete"}
                  >
                    {s.status === "complete" ? "Section complete ✓" : "Mark section complete"}
                  </button>
                  {s.status !== "pending" && (
                    <button onClick={() => patchSection(s.id, { status: "pending" })}>Reset to pending</button>
                  )}
                </div>
              )}
              {issues.length > 0 && (
                <p className="missing-note">
                  Still needed: {issues.slice(0, 6).join(", ")}
                  {issues.length > 6 ? `, +${issues.length - 6} more` : ""}
                </p>
              )}

              {template ? (
                <>
                  <div style={{ marginTop: 12 }}>
                    <SectionFieldEditor
                      fields={template.fields}
                      scope={(s.answers ?? {}) as AnswerTree}
                      onChange={(key, value) => setAnswer(s.id, key, value)}
                      path={[s.key]}
                      readOnly={!(isDraft && editing)}
                    />
                  </div>
                  {s.reportText && (
                    <details style={{ marginTop: 8 }}>
                      <summary className="muted">Report text (derived)</summary>
                      <p style={{ marginTop: 6 }}>{s.reportText}</p>
                    </details>
                  )}
                </>
              ) : (
                <>
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
                                  <Cell v={dm.type} editing={editing} onChange={(v) => patchDamageLegacy(dm.id, s.id, "type", v, setDraft)} />
                                </td>
                                <td>
                                  <Cell v={dm.location} editing={editing} onChange={(v) => patchDamageLegacy(dm.id, s.id, "location", v, setDraft)} />
                                </td>
                                <td>
                                  <Cell v={dm.direction} editing={editing} onChange={(v) => patchDamageLegacy(dm.id, s.id, "direction", v, setDraft)} />
                                </td>
                                <td>
                                  <Cell v={String(dm.widthMm)} editing={editing} onChange={(v) => patchDamageLegacy(dm.id, s.id, "widthMm", Number(v) || 0, setDraft)} />
                                </td>
                                <td>
                                  <Cell v={String(dm.lengthMm)} editing={editing} onChange={(v) => patchDamageLegacy(dm.id, s.id, "lengthMm", Number(v) || 0, setDraft)} />
                                </td>
                                <td>
                                  <Cell v={dm.notes} editing={editing} onChange={(v) => patchDamageLegacy(dm.id, s.id, "notes", v, setDraft)} />
                                </td>
                                {editing && (
                                  <td>
                                    <button
                                      className="link"
                                      onClick={() =>
                                        setDraft((d) =>
                                          d
                                            ? {
                                                ...d,
                                                sections: d.sections.map((sec) =>
                                                  sec.id === s.id
                                                    ? { ...sec, damages: sec.damages.filter((x) => x.id !== dm.id) }
                                                    : sec,
                                                ),
                                              }
                                            : d,
                                        )
                                      }
                                    >
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

                  {s.answers && Object.keys(s.answers).length > 0 && (
                    <details style={{ marginTop: 12 }}>
                      <summary className="muted">Captured answers ({Object.keys(s.answers).length})</summary>
                      <table style={{ marginTop: 8 }}>
                        <tbody>
                          {Object.entries(s.answers).map(([k, v]) => (
                            <tr key={k}>
                              <td style={{ width: "45%" }} className="muted">
                                {humanizeKey(k)}
                              </td>
                              <td>
                                <AnswerValueDisplay value={v} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  )}
                </>
              )}

        {s.photos.length > 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            {s.photos.length} photo{s.photos.length === 1 ? "" : "s"} attached
          </p>
        )}
      </div>
    );
  }
}

/** Helper for the legacy (no-template) damages table, kept out of the main body for readability. */
function patchDamageLegacy(
  damageId: string,
  sectionId: string,
  key: "type" | "location" | "direction" | "widthMm" | "lengthMm" | "notes",
  value: string | number,
  setDraft: (fn: (d: WebInspection | null) => WebInspection | null) => void,
) {
  setDraft((d) =>
    d
      ? {
          ...d,
          sections: d.sections.map((s) =>
            s.id === sectionId
              ? {
                  ...s,
                  damages: s.damages.map((x) => (x.id === damageId ? { ...x, [key]: value } : x)),
                }
              : s,
          ),
        }
      : d,
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
