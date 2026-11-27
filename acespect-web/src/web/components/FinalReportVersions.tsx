import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronUp, Download, FileText, Lock, Trash2, Upload } from "lucide-react";
import {
  asksNewVersion, canDeleteFinalVersions, canSeeFinalVersions, deleteFinalVersion, downloadFinalVersion, fileProblem, formatMelbourne, formatSize,
  latestVersionNumber, listFinalVersions, toggleLabel, uploadFinalVersion, visibleVersions, type FinalVersion,
} from "../finalReports";
import { reportTokens } from "./reportKit";

/**
 * "Final Report Versions" on the report page, beside its download buttons: the Word reports staff edited by hand and uploaded, newest first,
 * and Version 0, the live report the system makes from the inspection data. Admins and reviewers only -- for anyone else nothing renders
 * (and the server refuses them anyway). On screen only: the report page's toolbar class keeps it out of a print.
 *
 * Version 0's Download is the page's own existing Download Word (`onDownloadLive`, the report-jobs flow), so it is always made from the
 * current data -- until a version is uploaded: then the generated report is locked (for every role, on the server) and Version 0 says so.
 * The first upload is saved as Version 1; every later one asks "Save as a new version?" (Yes = the next number, No = replace the latest).
 * Collapsed by default to Version 0 and the Current final; "Show all versions (n)" opens the rest (remembered for this page only). An admin
 * can delete an uploaded version (soft delete: hidden, the file kept); deleting every one lifts the lock.
 */
export function FinalReportVersions({ inspectionId, role, onDownloadLive, liveBusy, onLockChange }: {
  inspectionId: string;
  role: string | null | undefined;
  onDownloadLive: () => void;
  liveBusy: boolean;
  /** Told whether the generated report is locked each time the list loads (after every upload and delete too). */
  onLockChange?: (locked: boolean) => void;
}) {
  if (!canSeeFinalVersions(role)) return null;
  return <FinalReportVersionsPanel inspectionId={inspectionId} canDelete={canDeleteFinalVersions(role)} onDownloadLive={onDownloadLive} liveBusy={liveBusy} onLockChange={onLockChange} />;
}

type Question = { file: File; note: string; latest: number };

function FinalReportVersionsPanel({ inspectionId, canDelete, onDownloadLive, liveBusy, onLockChange }: {
  inspectionId: string;
  canDelete: boolean;
  onDownloadLive: () => void;
  liveBusy: boolean;
  onLockChange?: (locked: boolean) => void;
}) {
  const [versions, setVersions] = useState<FinalVersion[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [unassigned, setUnassigned] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [question, setQuestion] = useState<Question | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  // Collapsed by default; kept only while this page is open (no storage).
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FinalVersion | null>(null);
  const [deleting, setDeleting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lockChange = useRef(onLockChange);
  lockChange.current = onLockChange;

  const load = useCallback(async () => {
    try {
      const list = await listFinalVersions(inspectionId);
      setVersions(list.versions);
      setLocked(list.locked);
      setUnassigned(list.unassigned);
      setLoadError(null);
      lockChange.current?.(list.locked);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load the final report versions");
    }
  }, [inspectionId]);
  useEffect(() => { void load(); }, [load]);

  function choose(f: File | null) {
    setDone(null);
    setError(f ? fileProblem(f) : null);
    setFile(f && !fileProblem(f) ? f : null);
    if (f && fileProblem(f) && input.current) input.current.value = "";
  }

  async function send(f: File, text: string, latest: number, mode?: "new" | "replace") {
    setQuestion(null);
    setError(null);
    setDone(null);
    setProgress(0);
    try {
      const saved = await uploadFinalVersion(inspectionId, { file: f, note: text, mode, basedOn: latest }, setProgress);
      setDone(mode === "replace" ? `Version ${saved.versionNumber} replaced with ${saved.fileName}.` : `Saved as Version ${saved.versionNumber}.`);
      setFile(null);
      setNote("");
      if (input.current) input.current.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload failed");
      if ((e as { code?: string }).code === "VERSIONS_CHANGED") await load();
    } finally {
      setProgress(null);
    }
  }

  function startUpload() {
    if (!file || !versions) return;
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    const latest = latestVersionNumber(versions);
    // The question is asked only when a version has already been uploaded.
    if (asksNewVersion(versions)) setQuestion({ file, note, latest });
    else void send(file, note, latest);
  }

  async function download(v: FinalVersion) {
    setDownloading(v.id);
    setError(null);
    try {
      await downloadFinalVersion(inspectionId, v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download failed");
    } finally {
      setDownloading(null);
    }
  }

  async function remove(v: FinalVersion) {
    setDeleting(true);
    setError(null);
    setDone(null);
    try {
      const { remaining } = await deleteFinalVersion(inspectionId, v.id);
      setConfirmDelete(null);
      setDone(remaining === 0 ? `Version ${v.versionNumber} deleted. No uploaded versions are left, so the generated report is unlocked.` : `Version ${v.versionNumber} deleted.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const uploading = progress !== null;
  const shown = versions ? visibleVersions(versions, expanded) : [];
  const toggle = versions ? toggleLabel(versions, expanded) : null;
  return (
    <section className="report-toolbar" data-final-report-versions="" aria-labelledby="final-report-versions-title" style={panel}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <h2 id="final-report-versions-title" style={{ margin: 0, fontSize: "15px", fontWeight: 800, color: reportTokens.accent }}>Final Report Versions</h2>
        <span style={{ fontSize: "12px", color: "#64748b" }}>Word reports edited by hand and uploaded. Times are Melbourne time.</span>
      </div>
      {unassigned && <p data-final-unassigned="" style={{ margin: "6px 0 0", fontSize: "12px", color: "#92400e" }}>No job number: saved under Unassigned</p>}

      {/* Upload */}
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap", marginTop: "14px" }}>
        <label style={field}>
          <span style={label}>Word file (.docx, up to 50 MB)</span>
          <input ref={input} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={uploading} data-final-file=""
            onChange={(e) => choose(e.target.files?.[0] ?? null)} style={{ fontSize: "13px" }} />
        </label>
        <label style={{ ...field, flex: "1 1 220px" }}>
          <span style={label}>Changes made (optional)</span>
          <input type="text" value={note} maxLength={1000} disabled={uploading} placeholder="e.g. Corrected the roof wording" onChange={(e) => setNote(e.target.value)} style={textInput} />
        </label>
        <button type="button" onClick={startUpload} disabled={!file || uploading || !versions || !!question} data-final-upload="" style={{ ...primary, opacity: !file || uploading ? 0.6 : 1, cursor: !file || uploading ? "not-allowed" : "pointer" }}>
          <Upload size={15} /> Upload
        </button>
      </div>

      {question && (
        <div role="dialog" aria-label="Save as a new version?" data-final-question="" style={questionBox}>
          <strong style={{ fontSize: "14px" }}>Save as a new version?</strong>
          <p style={{ margin: "6px 0 10px", fontSize: "13px", color: "#334155" }}>
            Yes saves {question.file.name} as a new version. No replaces Version {question.latest} (the current final); the replaced file is kept on record but no longer listed.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" data-final-answer="yes" onClick={() => void send(question.file, question.note, question.latest, "new")} style={primary}>Yes, save as a new version</button>
            <button type="button" data-final-answer="no" onClick={() => void send(question.file, question.note, question.latest, "replace")} style={secondary}>No, replace Version {question.latest}</button>
            <button type="button" onClick={() => setQuestion(null)} style={ghost}>Cancel</button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div role="alertdialog" aria-label={`Delete Version ${confirmDelete.versionNumber}?`} data-final-delete-confirm="" style={{ ...questionBox, borderColor: "#fecaca", background: "#fef2f2" }}>
          <strong style={{ fontSize: "14px" }}>Delete Version {confirmDelete.versionNumber} ({confirmDelete.fileName})?</strong>
          <p style={{ margin: "6px 0 10px", fontSize: "13px", color: "#334155" }}>
            It is hidden from this list and its number is not used again. The file is kept in storage and the delete is recorded in the audit log.
            {versions && versions.length === 1 ? " It is the only uploaded version, so the generated report will be unlocked." : ""}
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" data-final-delete-yes="" disabled={deleting} onClick={() => void remove(confirmDelete)} style={{ ...primary, background: "#b91c1c" }}>
              <Trash2 size={14} /> {deleting ? "Deleting…" : `Delete Version ${confirmDelete.versionNumber}`}
            </button>
            <button type="button" disabled={deleting} onClick={() => setConfirmDelete(null)} style={ghost}>Cancel</button>
          </div>
        </div>
      )}

      {uploading && (
        <div role="status" data-final-progress="" style={{ marginTop: "12px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#475569", marginBottom: "4px" }}>Uploading… {Math.round((progress ?? 0) * 100)}%</div>
          <div style={{ height: "6px", background: "#e2e8f0", borderRadius: "3px", overflow: "hidden" }}>
            <div style={{ width: `${Math.round((progress ?? 0) * 100)}%`, height: "100%", background: reportTokens.accent, transition: "width 0.2s" }} />
          </div>
        </div>
      )}
      {error && <p role="alert" data-final-error="" style={{ margin: "10px 0 0", fontSize: "13px", fontWeight: 600, color: "#dc2626" }}>{error}</p>}
      {done && <p role="status" style={{ margin: "10px 0 0", fontSize: "13px", fontWeight: 600, color: "#15803d" }}>{done}</p>}

      {/* Versions, newest first (collapsed: only the Current final); Version 0 (the live generated report) last. */}
      <div style={{ marginTop: "16px", borderTop: "1px solid #e5e7eb" }}>
        {loadError && <p role="alert" style={{ fontSize: "13px", color: "#dc2626" }}>{loadError}</p>}
        {!versions && !loadError && <p style={{ fontSize: "13px", color: "#94a3b8" }}>Loading…</p>}
        {shown.map((v) => (
          <div key={v.id} data-final-version={v.versionNumber} style={row}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "13px" }}>Version {v.versionNumber}</strong>
                {v.current && <span data-final-current="" style={badge}>Current final</span>}
                <span style={{ fontSize: "13px", color: "#334155", overflowWrap: "anywhere" }}>{v.fileName}</span>
                <span style={{ fontSize: "12px", color: "#64748b" }}>{formatSize(v.sizeBytes)}</span>
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px", overflowWrap: "anywhere" }}>
                Uploaded by {v.uploadedBy.name || v.uploadedBy.email} ({v.uploadedBy.email}) · {formatMelbourne(v.uploadedAt)}
              </div>
              {v.note && <div style={{ fontSize: "12px", color: "#334155", marginTop: "3px" }}>Changes made: {v.note}</div>}
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button type="button" onClick={() => void download(v)} disabled={downloading === v.id} style={secondary}>
                <Download size={14} /> {downloading === v.id ? "Downloading…" : "Download"}
              </button>
              {canDelete && (
                <button type="button" data-final-delete={v.versionNumber} onClick={() => { setDone(null); setConfirmDelete(v); }} disabled={deleting || uploading} style={danger} title={`Delete Version ${v.versionNumber}`}>
                  <Trash2 size={14} /> Delete
                </button>
              )}
            </div>
          </div>
        ))}
        {toggle && (
          <button type="button" data-final-toggle="" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)} style={{ ...ghost, margin: "10px 0 2px", border: "none", padding: "4px 0" }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {toggle}
          </button>
        )}
        <div data-final-version="0" style={row}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "13px" }}>Version 0</strong>
              <span style={{ fontSize: "13px", color: "#334155" }}>System generated (live)</span>
            </div>
            {locked ? (
              <div data-final-locked="" style={{ fontSize: "12px", color: "#b45309", marginTop: "3px", display: "flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
                <Lock size={12} /> Locked: a final version has been uploaded
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "#64748b", marginTop: "3px" }}>Not stored: made from the current inspection data each time it is downloaded.</div>
            )}
          </div>
          {/* The page's existing Download Word flow (report-jobs); disabled while locked (the server refuses it too). */}
          <button type="button" data-final-live="" onClick={onDownloadLive} disabled={locked || liveBusy} style={{ ...secondary, opacity: locked ? 0.5 : 1, cursor: locked ? "not-allowed" : "pointer" }}>
            <FileText size={14} /> {liveBusy ? "Preparing report…" : "Download"}
          </button>
        </div>
      </div>
    </section>
  );
}

const panel: CSSProperties = { maxWidth: "820px", margin: "0 auto 16px", background: "white", borderRadius: "10px", border: "1px solid #e5e7eb", padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", fontFamily: "Inter, system-ui, sans-serif", color: "#1a2a4a", boxSizing: "border-box" };
const field: CSSProperties = { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 };
const label: CSSProperties = { fontSize: "11px", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.03em" };
const textInput: CSSProperties = { padding: "8px 10px", borderRadius: "8px", border: "1px solid #cbd5e1", fontSize: "13px", width: "100%", boxSizing: "border-box" };
const primary: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px", padding: "9px 16px", borderRadius: "8px", border: "none", background: reportTokens.accent, color: "white", fontSize: "13px", fontWeight: 700, cursor: "pointer" };
const secondary: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "8px", border: `1.5px solid ${reportTokens.accent}`, background: "white", color: reportTokens.accent, fontSize: "12px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const danger: CSSProperties = { ...secondary, border: "1.5px solid #fca5a5", color: "#b91c1c" };
const ghost: CSSProperties = { ...secondary, border: "1px solid #e5e7eb", color: "#374151" };
const row: CSSProperties = { display: "flex", alignItems: "center", gap: "12px", padding: "12px 0", borderBottom: "1px solid #f1f5f9", flexWrap: "wrap" };
const badge: CSSProperties = { fontSize: "11px", fontWeight: 700, color: "#15803d", background: "#dcfce7", borderRadius: "999px", padding: "2px 8px" };
const questionBox: CSSProperties = { marginTop: "12px", padding: "12px 14px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #cbd5e1" };
