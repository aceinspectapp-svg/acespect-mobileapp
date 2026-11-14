import type { CSSProperties } from "react";
import { resolveMediaUrl } from "../api";
import type { PhotoGroup } from "../construction/photoGroups";

/**
 * "Photos For Report" for a Construction Stage section: the section's photos grouped where they print -- each defect, each row with
 * its own photos ("Photos with measurements"), the client issues list -- each group with its own "+ Add" so a new photo lands in that
 * exact spot. Every photo has a small remove button (it is left out of the report, not deleted; "Add back" undoes it). The inspector's
 * "Additional photos" are not printed on their own; each can be placed into one of the groups with "Use in report".
 */
export function ConstructionPhotoPicker({
  groups,
  additional,
  excluded,
  busyId,
  onToggle,
  onAdd,
  onUse,
}: {
  groups: PhotoGroup[];
  additional: string[];
  excluded: string[];
  /** The group (or "additional") an upload or save is running for. */
  busyId: string | null;
  onToggle: (url: string) => void;
  onAdd: (group: PhotoGroup, file: File) => void;
  onUse: (group: PhotoGroup, url: string) => void;
}) {
  const placed = new Set(groups.flatMap((g) => g.photos));
  const unplaced = additional.filter((u) => !placed.has(u));
  return (
    <div data-photo-picker="" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {groups.length === 0 && (
        <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>
          Nothing in this section prints photographs yet. A row answered “Defect” gets its own photos here.
        </p>
      )}
      {groups.map((g) => (
        <div key={g.id} data-photo-group={g.title} style={{ borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color: g.defect ? "#b91c1c" : "#334155", margin: 0 }}>{g.title}</p>
              {g.detail && <p style={{ fontSize: "11px", color: "#64748b", margin: "1px 0 0" }}>{g.detail}</p>}
            </div>
            <AddButton busy={busyId === g.id} onPick={(file) => onAdd(g, file)} />
          </div>
          {g.photos.length > 0
            ? <Thumbs photos={g.photos} excluded={excluded} onToggle={onToggle} />
            : <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>No photos yet.</p>}
        </div>
      ))}
      {unplaced.length > 0 && (
        <div data-photo-group="Additional photos" style={{ borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
          <p style={{ fontSize: "12px", fontWeight: 700, color: "#334155", margin: 0 }}>Additional photos</p>
          <p style={{ fontSize: "11px", color: "#64748b", margin: "1px 0 8px" }}>Not in the report until placed under a defect or row.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: "8px" }}>
            {unplaced.map((url) => (
              <div key={url}>
                <img src={resolveMediaUrl(url)} alt="" style={thumb} />
                {groups.length > 0 && (
                  <select
                    aria-label="Use in report"
                    disabled={busyId === "additional"}
                    value=""
                    onChange={(e) => {
                      const g = groups.find((x) => x.id === e.target.value);
                      if (g) onUse(g, url);
                    }}
                    style={{ width: "100%", marginTop: "4px", fontSize: "10.5px", padding: "3px 2px", borderRadius: "6px", border: "1px solid #cbd5e1", color: "#1d4ed8", background: "white" }}
                  >
                    <option value="">Use in report…</option>
                    {groups.map((g) => <option key={g.id} value={g.id}>{g.detail ? `${g.title} (${g.detail})` : g.title}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const thumb: CSSProperties = { width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block", borderRadius: "8px", border: "1px solid #e5e7eb" };

/** Thumbnails, three or so to a row, each with a small remove button; a removed photo is dimmed with "Add back". */
function Thumbs({ photos, excluded, onToggle }: { photos: string[]; excluded: string[]; onToggle: (url: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: "8px" }}>
      {photos.map((url) => {
        const out = excluded.includes(url);
        return (
          <div key={url} data-photo-thumb={out ? "removed" : "included"} style={{ position: "relative" }}>
            <img src={resolveMediaUrl(url)} alt="" style={{ ...thumb, opacity: out ? 0.35 : 1, border: `1px solid ${out ? "#fca5a5" : "#e5e7eb"}` }} />
            {out ? (
              <button type="button" onClick={() => onToggle(url)} title="Put this photo back in the report" style={{ position: "absolute", inset: "auto 4px 4px 4px", fontSize: "10.5px", fontWeight: 700, color: "#1d4ed8", background: "rgba(255,255,255,0.92)", border: "1px solid #93c5fd", borderRadius: "6px", padding: "2px 0", cursor: "pointer" }}>
                Add back
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onToggle(url)}
                title="Remove from the report"
                aria-label="Remove from the report"
                style={{ position: "absolute", top: "3px", right: "3px", width: "18px", height: "18px", borderRadius: "50%", background: "rgba(15,23,42,0.7)", color: "white", border: "none", cursor: "pointer", fontSize: "11px", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AddButton({ busy, onPick }: { busy: boolean; onPick: (file: File) => void }) {
  return (
    <label style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", fontSize: "11px", fontWeight: 700, color: busy ? "#94a3b8" : "#2563eb", cursor: busy ? "default" : "pointer", padding: "3px 9px", border: `1px dashed ${busy ? "#cbd5e1" : "#93c5fd"}`, borderRadius: "999px", background: "#f8fafc" }}>
      {busy ? "Saving…" : "+ Add"}
      <input
        type="file"
        accept="image/*"
        disabled={busy}
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick(file);
        }}
      />
    </label>
  );
}
