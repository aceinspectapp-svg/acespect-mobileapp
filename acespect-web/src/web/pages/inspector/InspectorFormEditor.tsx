import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Plus, Camera, Save, Send, CheckCircle, MessageSquare } from "lucide-react";
import { STATUS_CONFIG } from "../../mockData";
import { useAppData } from "../../data";
import { resolveMediaUrl } from "../../api";
import { StatusBadge } from "../../components/WebLayout";
import { SectionFieldEditor, PhotoUploadContext } from "../../components/SectionFieldEditor";
import {
  ActiveTemplate,
  AnswerTree,
  AnswerValue,
  fetchActiveTemplate,
  flattenSectionToDraft,
  meetsAllRequireWhen,
  meetsAllRequiredFields,
} from "../../templateFields";
import type { FormSection } from "../../mockData";
import { inspectionIdFromTitle, propertyIdFromTitle } from "../../constants/inspectionData";
import { api } from "../../api";

// Sections are deleted + recreated wholesale on every draft save (see
// inspections.service.ts `update`), so `section.id` is a new DB row id after
// each save/autosave. `key` (falling back to `id` for legacy/custom sections
// that predate it) is the stable identity that survives across saves -- used
// here to key selection + in-progress edits so autosaving mid-edit doesn't
// knock the inspector back out of the section they're editing.
function sectionKeyOf(s: Pick<FormSection, "id" | "key">): string {
  return s.key ?? s.id;
}

export function InspectorFormEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getInspectionById, saveInspectionDraft, finalizeInspection } = useAppData();
  const inspection = id ? getInspectionById(id) ?? null : null;
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [photoHover, setPhotoHover] = useState(false);
  const [selectedSectionKey, setSelectedSectionKey] = useState<string | null>(null);
  // sectionKey -> its current published template (or null once we know none
  // exists for that key, e.g. a legacy/custom section).
  const [templates, setTemplates] = useState<Record<string, ActiveTemplate | null>>({});
  // sectionKey -> its answers as edited here, not yet saved. Overrides
  // section.answers only for display/save purposes until Save Draft succeeds.
  // Keyed by the stable section key (not the DB row id -- see sectionKeyOf).
  const [answerEdits, setAnswerEdits] = useState<Record<string, AnswerTree>>({});
  // Off until the inspector actually tries to Submit an incomplete
  // inspection -- same "don't show errors on a fresh screen" rule mobile's
  // DynamicSectionScreen follows, just gated on Submit here instead of on
  // leaving each section (the web editor shows every section on one page,
  // not a linear per-section flow).
  const [showMissing, setShowMissing] = useState(false);
  // sectionKey -> its "additional photos" (not tied to any template field --
  // e.g. extra shots from an external camera), as edited here. Overrides
  // section.photos the same way answerEdits overrides section.answers.
  const [photoEdits, setPhotoEdits] = useState<Record<string, string[]>>({});

  const isDraft = inspection?.status === "draft";
  const isCompleted = inspection ? (inspection.status === "approved" || inspection.status === "in-review") : false;
  const selectedSection = inspection?.sections.find(s => sectionKeyOf(s) === selectedSectionKey) ?? null;

  // A different inspection loaded (or none) -- drop any unsaved edits so
  // they can't bleed from one job into another.
  useEffect(() => {
    setAnswerEdits({});
    setShowMissing(false);
    setPhotoEdits({});
  }, [id]);

  // Same required-field + mandatory-defect rules mobile's DynamicSectionScreen
  // enforces before letting the inspector leave a section, applied here to
  // every template-backed section before Submit is allowed to go through. A
  // section with no matching template (legacy/custom data) has nothing to
  // validate against, so it's never treated as incomplete.
  function isSectionComplete(section: FormSection): boolean {
    const template = templates[sectionKeyOf(section)];
    if (!template) return true;
    const answers = answerEdits[sectionKeyOf(section)] ?? (section.answers as AnswerTree | null | undefined) ?? {};
    return meetsAllRequireWhen(template.fields, answers) && meetsAllRequiredFields(template.fields, answers);
  }

  // Load each distinct section's active template once the inspection is
  // known, so the detail panel can show every field the inspector filled in
  // on mobile instead of a flat one-line-per-key summary.
  useEffect(() => {
    if (!inspection) return;
    const keys = Array.from(new Set(inspection.sections.map(s => s.key ?? s.id)));
    const missing = keys.filter(k => !(k in templates));
    if (missing.length === 0) return;
    let cancelled = false;
    const inspectionTypeId = inspectionIdFromTitle(inspection.type);
    const propertyTypeId = propertyIdFromTitle(inspection.propertyType);
    Promise.all(missing.map(key => fetchActiveTemplate(inspectionTypeId, propertyTypeId, key).then(t => [key, t] as const)))
      .then(pairs => {
        if (cancelled) return;
        setTemplates(prev => {
          const next = { ...prev };
          for (const [key, t] of pairs) next[key] = t;
          return next;
        });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection]);

  // Autosave: any unsaved answer/photo edit is written to the server ~1s
  // after the inspector stops typing/uploading, so a reload (or navigating
  // away without remembering to hit "Save Draft") never loses work the way
  // it did when Save Draft was the only path to persistence. Declared above
  // the early "not found" return so hook order stays stable across renders.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPendingEdits = Object.keys(answerEdits).length > 0 || Object.keys(photoEdits).length > 0;
  useEffect(() => {
    if (!isDraft || !hasPendingEdits) return;
    autosaveTimer.current = setTimeout(() => {
      saveDraft();
    }, 1000);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerEdits, photoEdits, isDraft]);

  if (!inspection) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8", fontFamily: "Inter, sans-serif", background: "#f5f6fa", minHeight: "100vh" }}>
        <p style={{ fontSize: "18px", fontWeight: 600, color: "#1a2a4a" }}>Inspection not found</p>
        <button
          onClick={() => navigate("/inspector/dashboard")}
          style={{ marginTop: "16px", padding: "8px 18px", borderRadius: "8px", background: "linear-gradient(135deg, #0f1d35, #1a2a4a)", color: "white", border: "none", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
        >
          ← Back to Dashboard
        </button>
      </div>
    );
  }

  const sc = STATUS_CONFIG[inspection.status];

  function setAnswer(sectionKey: string, key: string, value: AnswerValue) {
    setAnswerEdits(prev => {
      const base = prev[sectionKey] ?? ((inspection!.sections.find(s => sectionKeyOf(s) === sectionKey)?.answers as AnswerTree | undefined) ?? {});
      return { ...prev, [sectionKey]: { ...base, [key]: value } };
    });
  }

  function setSectionPhotos(sectionKey: string, photos: string[]) {
    setPhotoEdits(prev => ({ ...prev, [sectionKey]: photos }));
  }

  // Sections are sent whole — the API replaces the stored set. Any
  // template-backed section has its report fields/damages/text re-derived
  // from its (possibly just-edited) answers, so the report view and the
  // damages list never drift out of sync with what was edited here.
  function buildSectionsPayload() {
    return inspection!.sections.map((s, idx) => {
      const sKey = sectionKeyOf(s);
      const template = templates[sKey];
      const answers = answerEdits[sKey] ?? (s.answers as AnswerTree | null | undefined) ?? undefined;
      const derived = template && answers ? flattenSectionToDraft(template.fields, answers) : null;
      return {
        key: sKey,
        name: s.name,
        icon: s.icon ?? "",
        order: idx,
        status: s.status ?? "pending",
        reportText: derived ? derived.reportText : s.reportText ?? "",
        fields: derived ? derived.fields : s.fields ?? {},
        answers: answers as Record<string, unknown> | undefined,
        photos: photoEdits[sKey] ?? s.photos ?? [],
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
  }

  async function saveDraft(): Promise<boolean> {
    if (!isDraft) return true;
    // Snapshot what's being sent so success only clears edits that made it
    // to the server -- a keystroke/photo change that lands while this
    // request is in flight stays queued for the next autosave instead of
    // being silently discarded.
    const answerSnapshot = answerEdits;
    const photoSnapshot = photoEdits;
    setBusy(true);
    setSaveError(null);
    try {
      await saveInspectionDraft(inspection!.id, { sections: buildSectionsPayload() });
      setAnswerEdits(prev => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(answerSnapshot)) if (next[k] === v) delete next[k];
        return next;
      });
      setPhotoEdits(prev => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(photoSnapshot)) if (next[k] === v) delete next[k];
        return next;
      });
      return true;
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDraftClick() {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    const ok = await saveDraft();
    if (ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  // Flush any pending edit immediately before leaving the page, rather than
  // relying on the debounce timer (which may not have fired yet).
  async function handleBack() {
    if (isDraft && hasPendingEdits) {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      await saveDraft();
    }
    navigate("/inspector/dashboard");
  }

  async function handleSaveNote() {
    // `patchInspection` (PATCH /web/inspections/:id) is the reviewer/admin
    // endpoint and 403s for an inspector. The inspector's own draft-editing
    // endpoint (PATCH /inspections/:id, same one Save Draft uses) also
    // accepts `notes`, and is the one an inspector is actually allowed to
    // call on their own draft.
    if (!note.trim() || !inspection || !isDraft) return;
    setNoteBusy(true);
    setSaveError(null);
    try {
      const combined = inspection.notes ? `${inspection.notes}\n${note.trim()}` : note.trim();
      await saveInspectionDraft(inspection.id, { notes: combined });
      setNote("");
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setNoteBusy(false);
    }
  }

  async function handleSubmit() {
    if (!isDraft) return;

    // Same block mobile applies before letting the inspector leave a section
    // incomplete -- here, before Submit instead. Missing template (legacy/
    // custom sections) never blocks; only sections with an actual template
    // to validate against.
    const incomplete = inspection!.sections.filter((s) => !isSectionComplete(s));
    if (incomplete.length > 0) {
      setShowMissing(true);
      setSelectedSectionKey(sectionKeyOf(incomplete[0]));
      setSaveError(
        `${incomplete.length} section${incomplete.length > 1 ? "s" : ""} still ${incomplete.length > 1 ? "have" : "has"} required fields missing: ${incomplete.map((s) => s.name).join(", ")}. Fill these in before submitting.`,
      );
      return;
    }

    if (!window.confirm("Send this inspection for review? You will not be able to edit it afterwards.")) return;
    const ok = await saveDraft();
    if (!ok) return;
    setBusy(true);
    setSaveError(null);
    try {
      await finalizeInspection(inspection!.id);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: "Inter, -apple-system, sans-serif", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column", background: "#f5f6fa" }}>
      {/* Header */}
      <div style={{ background: "white", borderBottom: "1px solid #e5e7eb", padding: "14px 24px", display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 }}>
        <button
          onClick={handleBack}
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "white", cursor: "pointer", fontSize: "13px", color: "#374151", fontWeight: 500 }}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>
              {inspection.address}, {inspection.suburb}
            </h2>
            <StatusBadge label={sc.label} color={sc.color} bg={sc.bg} />
          </div>
          <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0" }}>
            Job No. {inspection.jobNo} · {inspection.type} · {inspection.date}
            {isDraft && (
              <span style={{ marginLeft: "10px", color: busy ? "#2563eb" : hasPendingEdits ? "#b45309" : "#16a34a", fontWeight: 600 }}>
                {busy ? "· Saving…" : hasPendingEdits ? "· Unsaved changes" : "· All changes saved"}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleSaveDraftClick}
            disabled={!isDraft || busy}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "8px", border: "1px solid #e5e7eb", background: "white", cursor: !isDraft || busy ? "default" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", opacity: !isDraft ? 0.5 : 1 }}
          >
            {saved ? <><CheckCircle size={14} color="#16a34a" /> Saved!</> : <><Save size={14} /> {busy ? "Saving…" : "Save Draft"}</>}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isDraft || busy}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #0f1d35, #1a2a4a)", cursor: !isDraft || busy ? "default" : "pointer", fontSize: "13px", fontWeight: 600, color: "white", opacity: !isDraft ? 0.5 : 1 }}
          >
            <Send size={14} /> Submit
          </button>
        </div>
      </div>

      {saveError && (
        <div style={{ background: "#fef2f2", borderBottom: "1px solid #fecaca", color: "#dc2626", padding: "10px 24px", fontSize: "13px", fontWeight: 600, flexShrink: 0 }}>
          {saveError}
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: "24px", maxWidth: "1200px" }}>

          {/* Left: Section list — clickable to show detail on right */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>Inspection Sections</h3>
              {selectedSection && (
                <button onClick={() => setSelectedSectionKey(null)} style={{ fontSize: "12px", color: "#64748b", background: "none", border: "none", cursor: "pointer" }}>
                  ✕ Close
                </button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {inspection.sections.length === 0 ? (
                <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", padding: "40px", textAlign: "center" }}>
                  <p style={{ fontSize: "14px", color: "#94a3b8", margin: 0 }}>No sections recorded yet.</p>
                  <p style={{ fontSize: "12px", color: "#94a3b8", margin: "6px 0 0" }}>Use the mobile app to fill in inspection sections.</p>
                </div>
              ) : (
                inspection.sections.map((section, idx) => {
                  const sKey = sectionKeyOf(section);
                  const isActive = selectedSectionKey === sKey;
                  // Red outline once the inspector has tried to Submit and
                  // this section is one of the ones still blocking it --
                  // the same "highlight what's incomplete" treatment mobile
                  // gives at its own Continue point.
                  const flagged = isDraft && showMissing && !isSectionComplete(section);
                  return (
                    <button
                      key={sKey}
                      onClick={() => setSelectedSectionKey(isActive ? null : sKey)}
                      style={{
                        width: "100%", background: "white", borderRadius: "12px",
                        border: `1.5px solid ${flagged ? "#dc2626" : isActive ? "#2563eb" : "#e5e7eb"}`,
                        boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                        padding: "14px 18px", display: "flex", alignItems: "center", gap: "14px",
                        cursor: "pointer", textAlign: "left",
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc"; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "white"; }}
                    >
                      <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: isActive ? "#eff6ff" : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>
                        {section.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: isActive ? "#2563eb" : "#1a2a4a", margin: 0 }}>
                          {idx + 1}. {section.name}
                        </p>
                        <p style={{ fontSize: "11px", color: "#94a3b8", margin: "2px 0 0" }}>
                          {section.damages.length > 0 ? `${section.damages.length} damage record${section.damages.length > 1 ? "s" : ""}` : "No damage recorded"}
                          {section.photos.length > 0 ? ` · ${section.photos.length} photos` : ""}
                        </p>
                      </div>
                      {/* Once the inspection itself has been submitted, every
                          section reads as Complete regardless of its own
                          stored status -- "Pending" only means anything while
                          the inspector is still actively drafting. */}
                      <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "10px", background: (!isDraft || section.status === "complete") ? "#dcfce7" : "#f1f5f9", color: (!isDraft || section.status === "complete") ? "#15803d" : "#64748b" }}>
                        {(!isDraft || section.status === "complete") ? "Complete" : "Pending"}
                      </span>
                      <span style={{ fontSize: "16px", color: isActive ? "#2563eb" : "#d1d5db", transform: isActive ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right panel: section detail OR add note/photo (for draft only) */}
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {selectedSection ? (
              /* Section detail view — every field the inspector filled in on
                 mobile, in the same order/grouping, driven by the section's
                 actual template (not a hand-picked summary). */
              (() => {
                const selectedKey = sectionKeyOf(selectedSection);
                const template = templates[selectedKey];
                return (
                  <>
                    <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                      <div style={{ padding: "14px 18px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: "10px", background: "#f8fafc" }}>
                        <span style={{ fontSize: "20px" }}>{selectedSection.icon}</span>
                        <div style={{ flex: 1 }}>
                          <h4 style={{ fontSize: "13px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>{selectedSection.name}</h4>
                          <p style={{ fontSize: "11px", color: "#94a3b8", margin: "2px 0 0" }}>Inspector's recorded data</p>
                        </div>
                        <span style={{ fontSize: "10px", fontWeight: 700, padding: "3px 8px", borderRadius: "10px", background: (!isDraft || selectedSection.status === "complete") ? "#dcfce7" : "#f1f5f9", color: (!isDraft || selectedSection.status === "complete") ? "#15803d" : "#64748b" }}>
                          {(!isDraft || selectedSection.status === "complete") ? "Complete" : "Pending"}
                        </span>
                      </div>
                      {template ? (
                        <div style={{ padding: "16px 18px" }}>
                          <PhotoUploadContext.Provider value={{ inspectionId: inspection.id, sectionKey: selectedKey }}>
                            <SectionFieldEditor
                              fields={template.fields}
                              scope={answerEdits[selectedKey] ?? (selectedSection.answers as AnswerTree | null | undefined) ?? {}}
                              onChange={(key, value) => setAnswer(selectedKey, key, value)}
                              readOnly={!isDraft}
                              showMissing={isDraft && showMissing}
                            />
                          </PhotoUploadContext.Provider>
                        </div>
                      ) : (
                        // No template for this section key (legacy/custom data) —
                        // fall back to the flat report fields, still better than nothing.
                        Object.entries(selectedSection.fields).map(([key, val], i, arr) => (
                          <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", padding: "10px 18px", borderBottom: i < arr.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                            <span style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", minWidth: "120px" }}>
                              {key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
                            </span>
                            <span style={{ fontSize: "12px", color: "#1a2a4a", textAlign: "right" }}>
                              {Array.isArray(val) ? val.join(", ") : typeof val === "boolean" ? (val ? "Yes" : "No") : String(val)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                    {/* Damage records — shown as its own card only when there's no
                        template (a template-backed section already shows every
                        damage-list instance, in full, inside the card above). */}
                    {!template && selectedSection.damages.length > 0 && (
                      <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f1f5f9", background: "#fff5f5" }}>
                          <p style={{ fontSize: "11px", fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
                            Damage Records ({selectedSection.damages.length})
                          </p>
                        </div>
                        {selectedSection.damages.map((d, i) => (
                          <div key={d.id} style={{ padding: "12px 18px", borderBottom: i < selectedSection.damages.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                            <p style={{ fontSize: "12px", fontWeight: 700, color: "#1a2a4a", margin: "0 0 4px" }}>{d.type} — {d.direction}</p>
                            <p style={{ fontSize: "11px", color: "#64748b", margin: "0 0 4px" }}>{d.location}</p>
                            <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>{d.widthMm}mm × {d.lengthMm}mm</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <AdditionalPhotosCard
                      photos={photoEdits[selectedKey] ?? selectedSection.photos}
                      savedPhotos={selectedSection.photos}
                      sectionId={selectedSection.id}
                      inspectionId={inspection.id}
                      sectionKey={selectedKey}
                      readOnly={!isDraft}
                      onChange={(photos) => setSectionPhotos(selectedKey, photos)}
                    />
                  </>
                );
              })()
            ) : (
              /* Default right panel */
              <>
                {/* Add note + photo — only for non-completed inspections */}
                {!isCompleted && (
                  <>
                    <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", padding: "20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                        <MessageSquare size={16} color="#2563eb" />
                        <h4 style={{ fontSize: "13px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>Add Inspector Note</h4>
                      </div>
                      <textarea
                        value={note}
                        onChange={e => setNote(e.target.value)}
                        placeholder="Add additional notes or observations..."
                        rows={4}
                        style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1.5px solid #e5e7eb", fontSize: "13px", color: "#1a2a4a", resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                      />
                      <button
                        onClick={handleSaveNote}
                        disabled={noteBusy || !note.trim() || !isDraft}
                        style={{ marginTop: "10px", width: "100%", padding: "9px", borderRadius: "8px", background: "#2563eb", color: "white", border: "none", fontSize: "13px", fontWeight: 600, cursor: noteBusy || !note.trim() || !isDraft ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", opacity: !note.trim() || !isDraft ? 0.6 : 1 }}
                      >
                        {noteSaved ? <><CheckCircle size={14} /> Saved!</> : <><Plus size={14} /> {noteBusy ? "Saving…" : "Save Note"}</>}
                      </button>
                    </div>
                    <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", padding: "20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                        <Camera size={16} color="#2563eb" />
                        <h4 style={{ fontSize: "13px", fontWeight: 700, color: "#1a2a4a", margin: 0 }}>Add Photos</h4>
                      </div>
                      <div
                        onMouseEnter={() => setPhotoHover(true)}
                        onMouseLeave={() => setPhotoHover(false)}
                        style={{ background: "white", border: `2px dashed ${photoHover ? "#2563eb" : "#e5e7eb"}`, borderRadius: "10px", padding: "28px 20px", textAlign: "center", cursor: "pointer", transition: "border-color 0.15s" }}
                      >
                        <Camera size={26} color="#94a3b8" style={{ margin: "0 auto 8px" }} />
                        <p style={{ fontSize: "13px", color: "#64748b", margin: 0, fontWeight: 500 }}>Upload photos</p>
                        <p style={{ fontSize: "11px", color: "#94a3b8", margin: "4px 0 0" }}>PNG, JPG up to 10MB each</p>
                      </div>
                    </div>
                  </>
                )}

                {/* Job details — always shown */}
                <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", padding: "20px" }}>
                  <h4 style={{ fontSize: "13px", fontWeight: 700, color: "#1a2a4a", margin: "0 0 12px" }}>Job Details</h4>
                  {[
                    ["Client", inspection.client],
                    ["Address", `${inspection.address}, ${inspection.suburb}`],
                    ["Date", inspection.date],
                    ["Type", inspection.type],
                    ["Progress", `${inspection.overallProgress}%`],
                    ["Status", inspection.status.replace("-", " ").replace(/\b\w/g, c => c.toUpperCase())],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f1f5f9" }}>
                      <span style={{ fontSize: "12px", color: "#94a3b8" }}>{label}</span>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#1a2a4a" }}>{value}</span>
                    </div>
                  ))}
                </div>

                {inspection.sections.length > 0 && (
                  <p style={{ fontSize: "12px", color: "#94a3b8", textAlign: "center", margin: 0 }}>
                    ← Click any section to view its details
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Photos an inspector attaches to a section without tying them to any
 * specific template field -- e.g. extra shots from an external camera that
 * don't map cleanly onto a single "Photos" field. Rendered below the
 * template-driven fields for every section, not just ones that already
 * have some, so there's always a place to add the first one.
 *
 * The "download all" link points at the *saved* copy (the zip endpoint
 * reads straight from the database), so a hint appears when there are
 * unsaved local additions it wouldn't yet include.
 */
function AdditionalPhotosCard({
  photos,
  savedPhotos,
  sectionId,
  inspectionId,
  sectionKey,
  readOnly,
  onChange,
}: {
  photos: string[];
  savedPhotos: string[];
  sectionId: string;
  inspectionId: string;
  sectionKey: string;
  readOnly: boolean;
  onChange: (photos: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (readOnly && photos.length === 0) return null;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await Promise.all(
        Array.from(files).map((f) => api.uploadInspectionPhoto(f, inspectionId, sectionKey)),
      );
      onChange([...photos, ...uploaded.map((u) => u.url)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const hasUnsaved = photos.length !== savedPhotos.length;

  return (
    <div style={{ background: "white", borderRadius: "12px", border: "1px solid #e5e7eb", padding: "16px 18px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
        <p style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em", margin: 0 }}>
          Additional Photos {photos.length > 0 ? `(${photos.length})` : ""}
        </p>
        {savedPhotos.length > 0 && (
          <a
            href={api.sectionPhotosZipUrl(sectionId)}
            style={{ fontSize: "11px", fontWeight: 600, color: "#2563eb", textDecoration: "none" }}
          >
            Download all
          </a>
        )}
      </div>
      {photos.length === 0 ? (
        <p style={{ fontSize: "12px", color: "#c1c9d4", margin: "0 0 10px" }}>No additional photos</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px", marginBottom: "10px" }}>
          {photos.map((url, i) => (
            <div key={i} style={{ position: "relative" }}>
              <img src={resolveMediaUrl(url)} alt="" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: "8px", border: "1px solid #e5e7eb", display: "block" }} />
              {!readOnly && (
                <button
                  onClick={() => onChange(photos.filter((_, idx) => idx !== i))}
                  title="Remove photo"
                  style={{
                    position: "absolute", top: "3px", right: "3px", width: "18px", height: "18px", borderRadius: "50%",
                    background: "rgba(15,23,42,0.7)", color: "white", border: "none", cursor: "pointer",
                    fontSize: "11px", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!readOnly && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            style={{
              fontSize: "11px", fontWeight: 600, color: "#2563eb", background: "#eff6ff", border: "1px dashed #93c5fd",
              borderRadius: "7px", padding: "7px 12px", cursor: uploading ? "wait" : "pointer",
            }}
          >
            {uploading ? "Uploading…" : "+ Add photos from device"}
          </button>
          {hasUnsaved && <p style={{ fontSize: "11px", color: "#b45309", margin: "6px 0 0" }}>Save draft to include new photos in the download link.</p>}
          {error && <p style={{ fontSize: "11px", color: "#dc2626", margin: "6px 0 0" }}>{error}</p>}
        </>
      )}
    </div>
  );
}
