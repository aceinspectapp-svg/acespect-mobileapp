import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { resolveMediaUrl, type PhotoEditSpec, type PhotoInfo } from "../api";

type Crop = { x: number; y: number; w: number; h: number };
type Rotate = PhotoEditSpec["rotate"];

const ASPECTS: { label: string; ratio: number | null }[] = [
  { label: "Free", ratio: null },
  { label: "4:3", ratio: 4 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "1:1", ratio: 1 },
];

const MIN_BOX = 0.05; // a crop box smaller than 5% of either side is a click, not a crop
const STAGE_W = 560;
const STAGE_H = 400;
const HANDLE = 14; // px grab area around a corner

/**
 * The reviewer's photo editor: rotate in quarter turns and crop with a draggable box, drawn on the ORIGINAL photo (an edit is always relative to
 * it, so editing twice never compounds). Saving makes a new copy on the server; the original stays and "Revert to original" puts it back.
 */
export function PhotoEditorModal({
  url,
  info,
  onClose,
  onSave,
  onRevert,
}: {
  /** The photo as the section has it now (the edited copy, or the original). */
  url: string;
  /** What the server knows about it: is it an edited copy, of which original, with which edit. */
  info: PhotoInfo & { originalUrl?: string | null };
  onClose: () => void;
  onSave: (edit: PhotoEditSpec) => Promise<void>;
  onRevert: () => Promise<void>;
}) {
  const source = info.originalUrl ?? url;
  const [rotate, setRotate] = useState<Rotate>(info.edit?.rotate ?? 0);
  const [crop, setCrop] = useState<Crop | null>(info.edit?.crop ?? null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "revert" | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: "draw" | "move" | "resize"; anchor: { x: number; y: number }; grab?: { x: number; y: number }; start?: Crop } | null>(null);

  useEffect(() => {
    const im = new Image();
    im.onload = () => setImg(im);
    im.onerror = () => setError("That photo could not be loaded.");
    im.src = resolveMediaUrl(source);
  }, [source]);

  // The rotated photo, drawn to fit the stage. Crop fractions are fractions of THIS picture, which is what the server crops.
  const quarter = rotate === 90 || rotate === 270;
  const size = (() => {
    if (!img) return { w: STAGE_W, h: STAGE_H, s: 1 };
    const rw = quarter ? img.naturalHeight : img.naturalWidth;
    const rh = quarter ? img.naturalWidth : img.naturalHeight;
    const s = Math.min(STAGE_W / rw, STAGE_H / rh, 1);
    return { w: Math.round(rw * s), h: Math.round(rh * s), s };
  })();
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext("2d")!;
    ctx.save();
    if (rotate === 90) { ctx.translate(size.w, 0); ctx.rotate(Math.PI / 2); }
    else if (rotate === 180) { ctx.translate(size.w, size.h); ctx.rotate(Math.PI); }
    else if (rotate === 270) { ctx.translate(0, size.h); ctx.rotate(-Math.PI / 2); }
    ctx.drawImage(img, 0, 0, img.naturalWidth * size.s, img.naturalHeight * size.s);
    ctx.restore();
  }, [img, rotate, size.w, size.h, size.s]);

  const turn = (dir: 1 | -1) => {
    setRotate((r) => (((r + dir * 90) % 360 + 360) % 360) as Rotate);
    setCrop(null); // a crop box belongs to one orientation
  };

  const point = (e: ReactPointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  /** The box with corners `a` and `b`, kept to the chosen shape (in pixels) and inside the photo. */
  const boxFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Crop => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let w = Math.abs(dx);
    let h = Math.abs(dy);
    if (ratio) {
      const wpx = w * size.w;
      const hpx = h * size.h;
      if (wpx / Math.max(hpx, 1e-6) > ratio) { w = (hpx * ratio) / size.w; } else { h = wpx / ratio / size.h; }
      // keep the shape when the box would run off the photo
      const maxW = dx < 0 ? a.x : 1 - a.x;
      const maxH = dy < 0 ? a.y : 1 - a.y;
      const k = Math.min(1, maxW / Math.max(w, 1e-6), maxH / Math.max(h, 1e-6));
      w *= k;
      h *= k;
    }
    return { x: dx < 0 ? a.x - w : a.x, y: dy < 0 ? a.y - h : a.y, w, h };
  };

  /**
   * Picking a shape reshapes the box straight away: the largest box of that shape inside the current box (or, with no box yet, inside
   * the whole photo), centred -- so the button never shows a shape the saved crop does not have.
   */
  const pickRatio = (next: number | null) => {
    setRatio(next);
    if (!next) return;
    const base = crop ?? { x: 0, y: 0, w: 1, h: 1 };
    const bw = base.w * size.w;
    const bh = base.h * size.h;
    const wpx = bw / bh > next ? bh * next : bw;
    const hpx = wpx / next;
    const w = wpx / size.w;
    const h = hpx / size.h;
    setCrop({ x: base.x + (base.w - w) / 2, y: base.y + (base.h - h) / 2, w, h });
  };

  const onDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = point(e);
    if (crop) {
      const px = (v: number, span: number) => v * span;
      const corners = [
        { x: crop.x, y: crop.y, opp: { x: crop.x + crop.w, y: crop.y + crop.h } },
        { x: crop.x + crop.w, y: crop.y, opp: { x: crop.x, y: crop.y + crop.h } },
        { x: crop.x, y: crop.y + crop.h, opp: { x: crop.x + crop.w, y: crop.y } },
        { x: crop.x + crop.w, y: crop.y + crop.h, opp: { x: crop.x, y: crop.y } },
      ];
      const hit = corners.find((c) => Math.abs(px(c.x - p.x, size.w)) < HANDLE && Math.abs(px(c.y - p.y, size.h)) < HANDLE);
      if (hit) { drag.current = { mode: "resize", anchor: hit.opp }; return; }
      if (p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h) {
        drag.current = { mode: "move", anchor: p, grab: { x: p.x - crop.x, y: p.y - crop.y }, start: crop };
        return;
      }
    }
    drag.current = { mode: "draw", anchor: p };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.mode === "move" && d.grab && d.start) {
      setCrop({ ...d.start, x: Math.min(1 - d.start.w, Math.max(0, p.x - d.grab.x)), y: Math.min(1 - d.start.h, Math.max(0, p.y - d.grab.y)) });
    } else {
      setCrop(boxFrom(d.anchor, p));
    }
  };
  const onUp = () => {
    drag.current = null;
    setCrop((c) => (c && (c.w < MIN_BOX || c.h < MIN_BOX) ? null : c));
  };

  const changed = rotate !== 0 || !!crop;
  const edited = !!info.editedFromId;

  async function run(kind: "save" | "revert") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "save") await onSave({ rotate, ...(crop ? { crop } : {}) });
      else await onRevert();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
      setBusy(null);
    }
  }

  const box = crop ? { left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` } : null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Edit photo" data-photo-editor="" style={backdrop} onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <h3 style={{ margin: 0, fontSize: "15px", color: "#0f172a" }}>Edit photo</h3>
          <button type="button" onClick={onClose} disabled={!!busy} aria-label="Close" style={ghost}>✕</button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "10px" }}>
          <button type="button" data-action="rotate-left" onClick={() => turn(-1)} style={tool} title="Rotate left">⟲ Rotate left</button>
          <button type="button" data-action="rotate-right" onClick={() => turn(1)} style={tool} title="Rotate right">⟳ Rotate right</button>
          <span style={{ width: "1px", height: "20px", background: "#e2e8f0" }} />
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>Crop shape</span>
          {ASPECTS.map((a) => (
            <button key={a.label} type="button" onClick={() => pickRatio(a.ratio)} style={{ ...tool, ...(ratio === a.ratio ? toolOn : {}) }}>{a.label}</button>
          ))}
          <button type="button" onClick={() => setCrop(null)} disabled={!crop} style={{ ...tool, opacity: crop ? 1 : 0.45 }}>Clear crop</button>
        </div>

        <div style={{ display: "flex", justifyContent: "center", background: "#0f172a", borderRadius: "10px", padding: "10px", minHeight: "120px" }}>
          {img ? (
            <div
              data-crop-stage=""
              style={{ position: "relative", width: size.w, height: size.h, touchAction: "none", cursor: "crosshair", userSelect: "none" }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <canvas ref={canvasRef} style={{ width: size.w, height: size.h, display: "block" }} />
              {box && (
                <>
                  <div data-crop-box="" style={{ position: "absolute", ...box, border: "2px solid #38bdf8", boxShadow: "0 0 0 9999px rgba(15,23,42,0.55)", boxSizing: "border-box", cursor: "move" }}>
                    {[[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy]) => (
                      <span key={`${cx}${cy}`} style={{ position: "absolute", left: `${cx * 100}%`, top: `${cy * 100}%`, width: "12px", height: "12px", margin: "-6px 0 0 -6px", background: "white", border: "2px solid #0ea5e9", borderRadius: "3px", cursor: "nwse-resize" }} />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <span style={{ color: "#94a3b8", fontSize: "12px", alignSelf: "center" }}>{error ?? "Loading the photo…"}</span>
          )}
        </div>
        <p style={{ fontSize: "11px", color: "#64748b", margin: "8px 0 0" }}>
          Drag on the photo to draw a crop box; drag inside it to move it, or a corner to resize it. {info.replaced ? "This photo was swapped in; the one it replaced is kept." : edited ? "You are editing from the original photo, so nothing stacks up." : "The original photo is kept."}
        </p>
        {error && img && <p role="alert" style={{ fontSize: "12px", color: "#b91c1c", margin: "8px 0 0" }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginTop: "14px" }}>
          <button type="button" onClick={() => run("revert")} disabled={!edited || !!busy} style={{ ...tool, opacity: edited ? 1 : 0.4 }} title={info.replaced ? "Undo the swap: put back the photo this one replaced" : "Put the original photo back"}>
            {busy === "revert" ? "Reverting…" : info.replaced ? "Undo swap" : "Revert to original"}
          </button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" onClick={onClose} disabled={!!busy} style={tool}>Cancel</button>
            <button type="button" data-action="save-edit" onClick={() => run("save")} disabled={!changed || !!busy || !img} style={{ ...primary, opacity: changed && img ? 1 : 0.5 }}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const backdrop: CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" };
const card: CSSProperties = { background: "white", borderRadius: "14px", padding: "16px", width: "min(620px, 100%)", maxHeight: "95vh", overflow: "auto", boxShadow: "0 20px 50px rgba(0,0,0,0.35)" };
const tool: CSSProperties = { fontSize: "12px", fontWeight: 600, color: "#334155", background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "6px 10px", cursor: "pointer" };
const toolOn: CSSProperties = { color: "#1d4ed8", background: "#eff6ff", borderColor: "#93c5fd" };
const primary: CSSProperties = { fontSize: "12px", fontWeight: 700, color: "white", background: "#2563eb", border: "none", borderRadius: "8px", padding: "7px 18px", cursor: "pointer" };
const ghost: CSSProperties = { border: "none", background: "none", cursor: "pointer", fontSize: "15px", color: "#64748b" };
