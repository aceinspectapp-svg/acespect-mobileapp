import { useEffect, type CSSProperties } from "react";
import { resolveMediaUrl, type PhotoPrintSize } from "../api";

export interface LightboxItem {
  url: string;
  /** Where it prints: "Kitchen › Room photos". */
  where: string;
  /** Its number inside that group (1-based) and how many the group has. */
  number: number;
  count: number;
  out: boolean;
  size: PhotoPrintSize;
  edited: boolean;
  swapped: boolean;
  added: boolean;
}

/**
 * A photo at full size, with the section's other photos a key press away (← →) and the common tools on keys of their own:
 * R / Shift+R rotate right / left, L large or standard, X leave out or put back, E edit (crop), Esc closes. Read-only when `locked`.
 */
export function PhotoLightbox({
  items, index, locked, busy, onIndex, onClose, onRotate, onToggleOut, onToggleSize, onEdit,
}: {
  items: LightboxItem[];
  index: number;
  locked: boolean;
  busy: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  onRotate: (url: string, dir: 1 | -1) => void;
  onToggleOut: (url: string) => void;
  onToggleSize: (url: string) => void;
  onEdit: (url: string) => void;
}) {
  const at = Math.min(Math.max(index, 0), Math.max(items.length - 1, 0));
  const item = items[at];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); onIndex(Math.min(items.length - 1, at + 1)); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); onIndex(Math.max(0, at - 1)); return; }
      if (!item || locked || busy || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "r") { e.preventDefault(); onRotate(item.url, e.shiftKey ? -1 : 1); }
      else if (k === "l") { e.preventDefault(); onToggleSize(item.url); }
      else if (k === "x") { e.preventDefault(); onToggleOut(item.url); }
      else if (k === "e") { e.preventDefault(); onEdit(item.url); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, at, item, locked, busy, onIndex, onClose, onRotate, onToggleOut, onToggleSize, onEdit]);

  if (!item) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Photo preview" data-photo-lightbox="" style={backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", color: "white", padding: "0 4px 10px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.where}</div>
          <div style={{ fontSize: "12px", opacity: 0.75 }}>
            Photo {item.number} of {item.count} · {at + 1} / {items.length} in this section
            {item.out && " · left out of the report"}{item.size === "large" && " · prints large"}{item.edited && " · edited"}{item.swapped && " · swapped"}{item.added && " · added by a reviewer"}
          </div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close preview" style={{ ...btn, fontSize: "16px", padding: "4px 10px" }}>✕</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", gap: "10px" }}>
        <button type="button" aria-label="Previous photo" disabled={at === 0} onClick={() => onIndex(at - 1)} style={{ ...nav, opacity: at === 0 ? 0.3 : 1 }}>‹</button>
        <div style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <img
            key={item.url}
            src={resolveMediaUrl(item.url)}
            alt={`${item.where}, photo ${item.number}`}
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "6px", opacity: item.out ? 0.45 : 1, boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}
          />
          {busy && <span style={{ position: "absolute", top: "10px", right: "10px", ...pill }}>Saving…</span>}
        </div>
        <button type="button" aria-label="Next photo" disabled={at === items.length - 1} onClick={() => onIndex(at + 1)} style={{ ...nav, opacity: at === items.length - 1 ? 0.3 : 1 }}>›</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "8px", paddingTop: "12px" }}>
        {locked ? (
          <span style={{ color: "white", fontSize: "12px", opacity: 0.8 }}>This section is approved, so its photos are locked. ← → to browse, Esc to close.</span>
        ) : (
          <>
            <button type="button" data-action="lightbox-rotate-left" disabled={busy} onClick={() => onRotate(item.url, -1)} style={btn} title="Rotate left (Shift+R)">⟲ Rotate left</button>
            <button type="button" data-action="lightbox-rotate-right" disabled={busy} onClick={() => onRotate(item.url, 1)} style={btn} title="Rotate right (R)">⟳ Rotate right</button>
            <button type="button" data-action="lightbox-edit" disabled={busy} onClick={() => onEdit(item.url)} style={btn} title="Crop or rotate (E)">✂ Crop…</button>
            <button type="button" data-action="lightbox-size" disabled={busy} onClick={() => onToggleSize(item.url)} style={btn} title="Print large on its own row, or at the standard size (L)">{item.size === "large" ? "▭ Print standard" : "⤢ Print large"}</button>
            <button type="button" data-action="lightbox-toggle-out" disabled={busy} onClick={() => onToggleOut(item.url)} style={{ ...btn, ...(item.out ? { background: "#16a34a", borderColor: "#16a34a" } : {}) }} title="Leave out of the report, or put it back (X)">{item.out ? "✓ Put back in report" : "✕ Leave out of report"}</button>
            <span style={{ color: "white", fontSize: "11px", opacity: 0.6, width: "100%", textAlign: "center" }}>Keys: ← → browse · R rotate · Shift+R rotate left · L large · X leave out · E crop · Esc close</span>
          </>
        )}
      </div>
    </div>
  );
}

const backdrop: CSSProperties = { position: "fixed", inset: 0, zIndex: 1100, background: "rgba(15,23,42,0.92)", display: "flex", flexDirection: "column", padding: "16px" };
const btn: CSSProperties = { fontSize: "12.5px", fontWeight: 600, color: "white", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: "8px", padding: "7px 12px", cursor: "pointer" };
const nav: CSSProperties = { ...btn, fontSize: "28px", lineHeight: 1, padding: "10px 14px", flexShrink: 0 };
const pill: CSSProperties = { fontSize: "11px", fontWeight: 700, color: "white", background: "rgba(37,99,235,0.9)", borderRadius: "999px", padding: "3px 10px" };
