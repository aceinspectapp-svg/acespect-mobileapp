import { createContext, useContext, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { htmlToMarkup, markupToHtml } from "../textEdits";
import { InlineText } from "./InlineText";

/**
 * Click-to-edit for the reviewer's report preview. A preview wrapped in this context lets each sentence be clicked and typed into where
 * it is; anywhere else (the report page, the PDF / Word files) there is no context and the text is plain. `saveLine` saves one paragraph of
 * the section's report text (by its position in it); `saveBlock` one of the Description page's own sentences.
 */
export interface ReportEditApi {
  /** False when the section is approved: the text shows why instead of opening. */
  editable: boolean;
  saveLine?: (index: number, text: string) => Promise<void>;
  saveBlock?: (key: string, text: string, standard: string) => Promise<void>;
}
export const ReportEditContext = createContext<ReportEditApi | null>(null);

/**
 * One sentence of the preview. Click it to type into it in place (the cursor lands where you clicked); a small bar offers bold / italic /
 * underline, Save and Cancel. Enter or clicking away saves, Esc cancels; emptying it removes the paragraph. `text` carries formatting marks.
 */
export function EditableText({ text, onSave, link, emptyHint }: { text: string; onSave?: (text: string) => Promise<void>; link?: ReactNode; emptyHint?: string }) {
  const ctx = useContext(ReportEditContext);
  const [editing, setEditing] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    done.current = false;
    el.innerHTML = markupToHtml(text);
    el.focus();
    // the cursor where the reviewer clicked (or at the end)
    const sel = window.getSelection();
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
    let r = doc.caretRangeFromPoint?.(editing.x, editing.y) ?? null;
    if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
    sel?.removeAllRanges();
    sel?.addRange(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  if (!ctx || !onSave) return <InlineText text={text} link={link} />;
  ensureStyles();

  if (!ctx.editable) {
    return <span title="This section is approved. Reopen it to edit its text." data-editable-text="locked"><InlineText text={text} link={link} /></span>;
  }

  async function finish(save: boolean) {
    if (done.current || !ref.current) return;
    done.current = true;
    const next = htmlToMarkup(ref.current);
    if (!save || next === text.trim()) { setEditing(null); return; }
    setBusy(true);
    setError(null);
    try {
      await onSave!(next);
      setEditing(null);
    } catch (e) {
      done.current = false;
      setError(e instanceof Error ? e.message : "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <span
        data-editable-text=""
        className="rpe-text"
        title="Click to edit"
        onClick={(e: ReactMouseEvent) => { if ((e.target as HTMLElement).closest("a")) return; setEditing({ x: e.clientX, y: e.clientY }); }}
      >
        {text ? <InlineText text={text} link={link} /> : <span style={{ color: "#94a3b8", fontStyle: "italic" }}>{emptyHint ?? "Click to write"}</span>}
      </span>
    );
  }

  const fmt = (cmd: "bold" | "italic" | "underline") => document.execCommand(cmd);
  return (
    <span data-editing-text="" style={{ display: "block", position: "relative" }}>
      <span className="rpe-bar" data-edit-bar="" onMouseDown={(e) => e.preventDefault()}>
        <button type="button" data-action="inline-bold" title="Bold (Ctrl+B)" onClick={() => fmt("bold")}><b>B</b></button>
        <button type="button" data-action="inline-italic" title="Italic (Ctrl+I)" onClick={() => fmt("italic")}><i>I</i></button>
        <button type="button" data-action="inline-underline" title="Underline (Ctrl+U)" onClick={() => fmt("underline")}><u>U</u></button>
        <span className="rpe-sep" />
        <button type="button" data-action="inline-save" className="rpe-save" disabled={busy} onClick={() => void finish(true)}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" data-action="inline-cancel" disabled={busy} onClick={() => void finish(false)}>Cancel</button>
      </span>
      <span
        ref={ref}
        className="rpe-input"
        data-inline-editor=""
        contentEditable={!busy}
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        onBlur={() => void finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void finish(true); }
          else if (e.key === "Escape") { e.preventDefault(); void finish(false); }
        }}
        onPaste={(e) => { e.preventDefault(); document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ")); }}
      />
      <span className="rpe-hint" style={{ display: "block" }}>Enter saves · Esc cancels · leave it empty to remove the paragraph</span>
      {error && <span role="alert" style={{ display: "block", fontSize: "11px", color: "#b91c1c" }}>{error}</span>}
    </span>
  );
}

const CSS = `
.rpe-text { cursor: text; border-radius: 3px; transition: background 0.1s, box-shadow 0.1s; }
.rpe-text:hover { background: #eff6ff; box-shadow: 0 0 0 2px #bfdbfe; }
.rpe-input { display: block; outline: none; background: #eff6ff; box-shadow: 0 0 0 2px #60a5fa; border-radius: 3px; padding: 1px 3px; margin: 0 -3px; min-height: 1.4em; white-space: pre-wrap; }
.rpe-input [data-link-slot] { color: #2563eb; text-decoration: underline; }
.rpe-bar { position: absolute; bottom: 100%; right: 0; margin-bottom: 4px; z-index: 6; display: inline-flex; align-items: center; gap: 3px; padding: 3px; background: white;
  border: 1px solid #cbd5e1; border-radius: 7px; box-shadow: 0 4px 14px rgba(15,23,42,0.18); font-family: Inter, sans-serif; white-space: nowrap; }
.rpe-bar button { font-size: 11px; font-weight: 600; min-width: 24px; padding: 2px 7px; border: 1px solid #e2e8f0; border-radius: 5px; background: white; color: #1e293b; cursor: pointer; }
.rpe-bar button:hover { background: #f1f5f9; }
.rpe-bar .rpe-save { background: #2563eb; border-color: #2563eb; color: white; }
.rpe-bar .rpe-sep { width: 1px; height: 16px; background: #e2e8f0; margin: 0 2px; }
.rpe-hint { font-size: 10px; color: #94a3b8; font-family: Inter, sans-serif; margin-top: 2px; }
`;

/** The click-to-edit styles, added to the page once (not once per sentence). */
function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById("rpe-styles")) return;
  const el = document.createElement("style");
  el.id = "rpe-styles";
  el.textContent = CSS;
  document.head.appendChild(el);
}
