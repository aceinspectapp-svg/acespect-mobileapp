import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FormSection } from "../mockData";
import { anatomy, diffEdits, htmlToMarkup, joinLines, markupToHtml, splitLines, type LineAnatomy, type LineEdit, type TextEdits } from "../textEdits";
import type { DescriptionBlock } from "./ReportDescription";
import { reportTextStyle } from "./reportKit";

type Para = { id: string; anat: LineAnatomy; html: string; line: string };
let seq = 0;
const nextId = () => `p${++seq}`;
const toParas = (text: string): Para[] => splitLines(text).map((line) => { const anat = anatomy(line); return { id: nextId(), anat, line, html: anat.editable ? markupToHtml(anat.text) : "" }; });

/**
 * The section's report text, editable in place like a document: each paragraph is typed into where it sits, in the report's own type;
 * headings, condition tags and photo spots stay fixed. A toolbar gives bold / italic / underline, a list item, a new or removed paragraph
 * and "reset to the generated wording". Saving keeps the reviewer's wording apart from the generated text (textEdits.ts), so it survives
 * the text being written again from the answers. The Description page's own sentences (works, scope, ...) are edited here too.
 */
export function ReportTextEditor({
  section,
  generated,
  locked,
  descriptionBlocks,
  onSave,
  onClose,
  onReopen,
}: {
  section: FormSection;
  /** The text the answers write for this section (no reviewer edits); null when it cannot be worked out here. */
  generated: string | null;
  locked: boolean;
  /** For the Description section: the page's own sentences. */
  descriptionBlocks?: DescriptionBlock[];
  onSave: (reportText: string, textEdits: TextEdits | undefined) => Promise<void>;
  onClose: () => void;
  onReopen?: () => Promise<void>;
}) {
  const [version, setVersion] = useState(0); // bumped by Discard to start again from what is saved
  const initial = useMemo(() => toParas(section.reportText), [section.reportText, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [paras, setParas] = useState<Para[]>(initial);
  const [stale, setStale] = useState<LineEdit[]>(section.textEdits?.stale ?? []);
  const [blocks, setBlocks] = useState<Record<string, { text: string; removed: boolean }>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(true);
  const [tick, setTick] = useState(0); // re-render after typing, for the change marks
  const [blockResets, setBlockResets] = useState<Record<string, number>>({}); // redraws one sentence box after "standard wording"
  // The wording an untouched sentence box last showed: it is redrawn when that wording changes (the photo link arriving late), and not
  // once the reviewer starts typing in it (that would lose the cursor).
  const seen = useRef<Record<string, string>>({});
  const seenWording = (b: DescriptionBlock) => {
    if (!blocks[b.key]) seen.current[b.key] = b.override ?? b.standard;
    return seen.current[b.key] ?? "";
  };
  const els = useRef(new Map<string, HTMLDivElement>());
  const focusNext = useRef<{ id: string; atEnd?: boolean } | null>(null);

  // start again from what is saved (on open, after a save, or Discard)
  useEffect(() => {
    setParas(initial);
    setStale(section.textEdits?.stale ?? []);
    setBlocks({});
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useLayoutEffect(() => {
    const f = focusNext.current;
    if (!f) return;
    focusNext.current = null;
    const el = els.current.get(f.id);
    if (!el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!f.atEnd);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  });

  /** A paragraph's line as it stands in the editor. */
  const lineOf = useCallback((p: Para): string => {
    if (!p.anat.editable) return p.line;
    const el = els.current.get(p.id);
    const text = el ? htmlToMarkup(el) : p.anat.text;
    return text ? `${p.anat.prefix}${text}` : "";
  }, []);
  const currentText = () => joinLines(paras.map(lineOf));

  // which paragraphs differ from the generated wording (for the change marks and "reset")
  const generatedLines = useMemo(() => new Set(generated ? splitLines(generated) : []), [generated]);
  const counterpart = (p: Para): string | null => {
    if (!generated) return null;
    const edits = diffEdits(generated, currentText());
    const line = lineOf(p);
    const hit = edits.lines?.find((l) => l.to === line);
    return hit ? hit.from : null;
  };
  void tick;

  const changed = (p: Para) => !!generated && p.anat.editable && !generatedLines.has(lineOf(p));
  const touch = () => { setDirty(true); setTick((t) => t + 1); };

  // ---- toolbar actions ----------------------------------------------------------------------------------------------------------

  const format = (cmd: "bold" | "italic" | "underline") => { document.execCommand(cmd); touch(); };
  const focusedPara = () => paras.find((p) => p.id === focused && p.anat.editable);

  function addParagraph(afterId?: string | null, html = "") {
    const p: Para = { id: nextId(), anat: { kind: "para", prefix: "", text: "", editable: true }, line: "", html };
    setParas((list) => {
      const at = afterId ? list.findIndex((x) => x.id === afterId) : list.length - 1;
      const next = [...list];
      next.splice(at + 1, 0, p);
      return next;
    });
    focusNext.current = { id: p.id };
    touch();
  }
  function removeParagraph(id: string) {
    const at = paras.findIndex((p) => p.id === id);
    const prev = [...paras.slice(0, at)].reverse().find((p) => p.anat.editable);
    setParas((list) => list.filter((p) => p.id !== id));
    els.current.delete(id);
    if (prev) focusNext.current = { id: prev.id, atEnd: true };
    touch();
  }
  function toggleList(id: string) {
    const el = els.current.get(id);
    if (!el) return;
    const md = htmlToMarkup(el);
    el.innerHTML = markupToHtml(md.startsWith("• ") ? md.slice(2) : `• ${md}`);
    touch();
  }
  function resetParagraph(p: Para) {
    const from = counterpart(p);
    const el = els.current.get(p.id);
    if (from === null) { removeParagraph(p.id); return; } // a paragraph of the reviewer's own: "reset" takes it out
    if (el) el.innerHTML = markupToHtml(anatomy(from).text);
    touch();
  }

  /** Enter splits the paragraph at the cursor; Backspace in an empty one removes it; Ctrl+S saves. */
  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>, p: Para) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); return; }
    if ((e.ctrlKey || e.metaKey) && ["b", "i", "u"].includes(e.key.toLowerCase())) { setTimeout(touch, 0); return; }
    const el = e.currentTarget;
    if (e.key === "Enter") {
      e.preventDefault();
      const sel = window.getSelection();
      let tailHtml = "";
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        const tail = document.createRange();
        tail.selectNodeContents(el);
        tail.setStart(r.endContainer, r.endOffset);
        const box = document.createElement("div");
        box.appendChild(tail.extractContents());
        tailHtml = markupToHtml(htmlToMarkup(box));
      }
      addParagraph(p.id, tailHtml);
      return;
    }
    if (e.key === "Backspace" && !el.textContent?.trim() && p.anat.kind === "para") { e.preventDefault(); removeParagraph(p.id); }
  }

  // ---- saving -------------------------------------------------------------------------------------------------------------------

  async function save() {
    if (busy || locked) return;
    setBusy(true);
    setError(null);
    try {
      const text = currentText();
      const blockOverrides: Record<string, string> = {};
      for (const b of descriptionBlocks ?? []) {
        const cur = blocks[b.key];
        // untouched: keep the wording it already had (the reviewer's, or the standard one, which follows the answers)
        if (!cur) { if (b.override !== undefined) blockOverrides[b.key] = b.override; continue; }
        if (cur.removed) blockOverrides[b.key] = "";
        else if (cur.text.trim() && cur.text.trim() !== b.standard.trim()) blockOverrides[b.key] = cur.text.trim();
      }
      const previous: TextEdits = { ...(Object.keys(blockOverrides).length ? { blocks: blockOverrides } : {}), ...(stale.length ? { stale } : {}) };
      const edits = generated !== null ? diffEdits(generated, text, previous) : descriptionBlocks ? previous : undefined;
      await onSave(text, edits);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The text could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function discard() {
    els.current.clear();
    setVersion((v) => v + 1);
  }
  const close = () => {
    if (dirty && !window.confirm("You have unsaved changes to this text. Close without saving them?")) return;
    onClose();
  };

  // warn before leaving the page with unsaved text
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const fp = focusedPara();
  const changedCount = paras.filter(changed).length;

  return (
    <div data-text-editor="" style={{ border: "2px solid #2563eb", borderRadius: "10px", background: "white" }}>
      <style>{EDITOR_CSS}</style>

      {/* toolbar */}
      <div data-text-toolbar="" style={{ position: "sticky", top: 0, zIndex: 4, display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", padding: "8px 10px", background: "#eff6ff", borderBottom: "1px solid #bfdbfe", borderRadius: "8px 8px 0 0" }}>
        {locked ? (
          <>
            <span style={{ fontSize: "12px", color: "#92400e", flex: "1 1 200px" }}>This section is approved, so its text is locked. Reopen it to edit the text.</span>
            {onReopen && <button type="button" data-action="text-reopen" onClick={() => void onReopen()} style={{ ...tb, color: "#92400e", borderColor: "#f59e0b", fontWeight: 700 }}>Reopen to edit</button>}
          </>
        ) : (
          <>
            <ToolButton action="text-bold" title="Bold (Ctrl+B)" onClick={() => format("bold")} disabled={!fp}><b>B</b></ToolButton>
            <ToolButton action="text-italic" title="Italic (Ctrl+I)" onClick={() => format("italic")} disabled={!fp}><i>I</i></ToolButton>
            <ToolButton action="text-underline" title="Underline (Ctrl+U)" onClick={() => format("underline")} disabled={!fp}><u>U</u></ToolButton>
            <ToolButton action="text-list" title="Make this paragraph a list item (•)" onClick={() => fp && toggleList(fp.id)} disabled={!fp}>• List</ToolButton>
            <span style={{ width: "1px", height: "20px", background: "#bfdbfe" }} />
            <ToolButton action="text-add" title="Add a paragraph below this one (or press Enter)" onClick={() => addParagraph(focused)}>＋ Paragraph</ToolButton>
            <ToolButton action="text-remove" title="Remove this paragraph from the report" onClick={() => fp && removeParagraph(fp.id)} disabled={!fp}>🗑 Remove</ToolButton>
            {generated !== null && <ToolButton action="text-reset" title="Put back the wording written from the inspector's answers" onClick={() => fp && resetParagraph(fp)} disabled={!fp || !changed(fp)}>↺ Reset</ToolButton>}
            <span style={{ flex: 1 }} />
            {generated !== null && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: "#1e40af", cursor: "pointer" }}>
                <input type="checkbox" data-action="text-show-changes" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} />
                Show changes{changedCount ? ` (${changedCount})` : ""}
              </label>
            )}
          </>
        )}
      </div>

      {/* save bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "6px 10px", borderBottom: "1px solid #e2e8f0", fontSize: "12px" }}>
        <span data-text-status="" style={{ color: dirty ? "#b45309" : "#16a34a", fontWeight: 600 }}>{busy ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span>
        <span style={{ color: "#64748b" }}>· Ctrl+S saves · Enter starts a new paragraph</span>
        <span style={{ flex: 1 }} />
        {!locked && <button type="button" data-action="text-discard" onClick={discard} disabled={!dirty || busy} style={{ ...tb, opacity: dirty ? 1 : 0.45 }}>Discard</button>}
        {!locked && <button type="button" data-action="text-save" onClick={() => void save()} disabled={!dirty || busy} style={{ ...tb, color: "white", background: dirty ? "#2563eb" : "#93c5fd", borderColor: dirty ? "#2563eb" : "#93c5fd", fontWeight: 700 }}>{busy ? "Saving…" : "Save"}</button>}
        <button type="button" data-action="text-close" onClick={close} style={tb}>Close editor</button>
      </div>

      {error && <p role="alert" style={{ margin: "8px 10px 0", fontSize: "12px", color: "#b91c1c" }}>{error}</p>}

      {/* edits whose sentence has since changed */}
      {stale.length > 0 && (
        <div data-text-stale="" style={{ margin: "10px", padding: "8px 10px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", fontSize: "12px", color: "#92400e" }}>
          <strong>{stale.length === 1 ? "One of your edits needs checking" : `${stale.length} of your edits need checking`}</strong> — the inspector's answer behind {stale.length === 1 ? "that sentence" : "those sentences"} changed, so the new wording is printed instead.
          {stale.map((s, i) => (
            <div key={i} style={{ marginTop: "6px", padding: "6px 8px", background: "white", borderRadius: "6px", border: "1px solid #fde68a", color: "#334155" }}>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>Your wording:</div>
              <div>{anatomy(s.to).text || s.to}</div>
              {!locked && (
                <div style={{ display: "flex", gap: "6px", marginTop: "4px" }}>
                  <button type="button" data-action="stale-add" style={tb} onClick={() => { addParagraph(null, markupToHtml(anatomy(s.to).text || s.to)); setStale((list) => list.filter((_, k) => k !== i)); }}>Add it as a paragraph at the end</button>
                  <button type="button" data-action="stale-dismiss" style={tb} onClick={() => { setStale((list) => list.filter((_, k) => k !== i)); touch(); }}>Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* the document */}
      <div className={`rte-doc${showChanges ? " show-changes" : ""}`} style={{ ...reportTextStyle(false), padding: "14px 18px" }} key={version}>
        {paras.length === 0 && !locked && (
          <button type="button" onClick={() => addParagraph(null)} style={{ ...tb, marginBottom: "8px" }}>＋ Start writing</button>
        )}
        {paras.map((p) => {
          if (!p.anat.editable) return <FixedLine key={p.id} anat={p.anat} />;
          return (
            <div key={p.id} className={`rte-row${changed(p) ? " is-changed" : ""}`}>
              {p.anat.kind === "defect" && <div style={{ fontSize: "10px", fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.05em" }}>Defect</div>}
              {p.anat.kind === "item" && <div style={{ fontWeight: 700 }}>{p.anat.label}</div>}
              <EditablePara
                html={p.html}
                locked={locked}
                register={(el) => { if (el) els.current.set(p.id, el); }}
                onFocus={() => setFocused(p.id)}
                onInput={touch}
                onKeyDown={(e) => onKeyDown(e, p)}
              />
            </div>
          );
        })}

        {descriptionBlocks && descriptionBlocks.length > 0 && (
          <div data-text-blocks="" style={{ marginTop: "16px", borderTop: "1px dashed #cbd5e1", paddingTop: "12px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>The page's other sentences (this inspection only)</div>
            {descriptionBlocks.map((b) => {
              const cur = blocks[b.key] ?? { text: b.override ?? b.standard, removed: b.override === "" };
              const custom = cur.removed || cur.text.trim() !== b.standard.trim();
              return (
                <div key={`${b.key}-${version}`} data-text-block={b.key} className={`rte-row${custom ? " is-changed" : ""}`} style={{ marginBottom: "10px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "11px", color: "#64748b", marginBottom: "2px" }}>
                    <span style={{ fontWeight: 700 }}>{b.label}</span><span>· under “{b.band}”</span>
                    <span style={{ flex: 1 }} />
                    {!locked && custom && <button type="button" data-action="block-reset" style={{ ...tb, padding: "1px 7px", fontSize: "10.5px" }} onClick={() => { setBlocks((s) => ({ ...s, [b.key]: { text: b.standard, removed: false } })); setBlockResets((r) => ({ ...r, [b.key]: (r[b.key] ?? 0) + 1 })); touch(); }}>↺ Standard wording</button>}
                    {!locked && <button type="button" data-action="block-toggle" style={{ ...tb, padding: "1px 7px", fontSize: "10.5px" }} onClick={() => { setBlocks((s) => ({ ...s, [b.key]: { ...cur, removed: !cur.removed } })); touch(); }}>{cur.removed ? "Put back in report" : "Leave out"}</button>}
                  </div>
                  {cur.removed ? (
                    <div style={{ color: "#94a3b8", fontStyle: "italic" }}>Left out of the report.</div>
                  ) : (
                    <EditablePara
                      key={`${version}-${blockResets[b.key] ?? 0}-${seenWording(b)}`}
                      html={markupToHtml(cur.text)}
                      locked={locked}
                      placeholder={b.placeholder}
                      register={() => undefined}
                      onFocus={() => setFocused(null)}
                      onInput={(el) => { const text = htmlToMarkup(el); setBlocks((s) => ({ ...s, [b.key]: { text, removed: false } })); setDirty(true); }}
                      onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } else if (e.key === "Enter") e.preventDefault(); }}
                    />
                  )}
                </div>
              );
            })}
            <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>“Click here” is the photo download link; it stays a link wherever you keep it.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** One paragraph you can type into. Its words are set once; after that the browser owns them until saved (React does not redraw them). */
function EditablePara({
  html, locked, placeholder, register, onFocus, onInput, onKeyDown,
}: {
  html: string; locked: boolean; placeholder?: string;
  register: (el: HTMLDivElement | null) => void; onFocus: () => void; onInput: (el: HTMLDivElement) => void; onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.innerHTML = html;
    // set once: later changes come from typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={(el) => { ref.current = el; register(el); }}
      className="rte-para"
      data-text-para=""
      data-placeholder={placeholder ?? "Type here…"}
      contentEditable={!locked}
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="false"
      onFocus={onFocus}
      onInput={(e) => onInput(e.currentTarget)}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        // plain words only (no fonts or colours from Word / web pages), on one paragraph
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ");
        document.execCommand("insertText", false, text);
      }}
    />
  );
}

function FixedLine({ anat }: { anat: LineAnatomy }) {
  const base: CSSProperties = { userSelect: "none", opacity: 0.75, margin: "6px 0" };
  if (anat.kind === "photos") return <div data-text-fixed="photos" style={{ ...base, fontSize: "11px", color: "#475569", background: "#f1f5f9", border: "1px dashed #cbd5e1", borderRadius: "6px", padding: "4px 8px" }}>📷 {anat.label}</div>;
  if (anat.kind === "cond") return <div data-text-fixed="cond" style={{ ...base, display: "inline-block", fontSize: "11px", fontWeight: 700, color: "#166534", background: "#f0fdf4", borderLeft: "4px solid #16a34a", padding: "2px 8px" }}>{anat.label}</div>;
  if (anat.kind === "floor") return <div data-text-fixed="floor" style={{ ...base, fontSize: "11px", fontWeight: 700, background: "#e7e2cf", padding: "3px 8px", letterSpacing: "0.05em" }}>{anat.label}</div>;
  return <div data-text-fixed={anat.kind} style={{ ...base, fontWeight: 700, fontSize: anat.kind === "heading" ? "1.05em" : "1em" }}>{anat.label}</div>;
}

function ToolButton({ action, title, onClick, disabled, children }: { action: string; title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-action={action}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep the cursor / selection in the paragraph
      onClick={onClick}
      style={{ ...tb, minWidth: "30px", opacity: disabled ? 0.45 : 1 }}
    >
      {children}
    </button>
  );
}

const tb: CSSProperties = { fontSize: "12px", fontWeight: 600, color: "#1e293b", background: "white", border: "1px solid #cbd5e1", borderRadius: "6px", padding: "4px 9px", cursor: "pointer" };

const EDITOR_CSS = `
.rte-doc .rte-row { position: relative; margin: 0 0 8px; padding-left: 8px; border-left: 3px solid transparent; }
.rte-doc.show-changes .rte-row.is-changed { border-left-color: #3b82f6; background: #f8fbff; }
.rte-doc .rte-para { outline: none; border-radius: 4px; padding: 2px 4px; margin: 0 -4px; line-height: inherit; min-height: 1.4em; cursor: text; white-space: pre-wrap; }
.rte-doc .rte-para:hover { background: #f1f5f9; }
.rte-doc .rte-para:focus { background: #eff6ff; box-shadow: 0 0 0 2px #93c5fd; }
.rte-doc .rte-para[contenteditable="false"] { cursor: default; }
.rte-doc .rte-para[contenteditable="false"]:hover { background: none; }
.rte-doc .rte-para:empty::before { content: attr(data-placeholder); color: #94a3b8; font-style: italic; }
.rte-doc [data-link-slot] { color: #2563eb; text-decoration: underline; background: #eff6ff; border-radius: 3px; padding: 0 2px; cursor: default; }
`;
