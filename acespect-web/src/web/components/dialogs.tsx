/**
 * In-page replacements for the browser's alert / confirm / prompt boxes.
 *
 * The native boxes look different in every browser, can be switched off by the browser ("prevent this page from creating more dialogs")
 * and cannot offer a proper choice, so the portal asks through these instead. They are used the same way, just awaited:
 *
 *   if (!(await dialog.confirm("Delete this lot?", { danger: true }))) return;
 *   const reason = await dialog.prompt("Why is it being suspended?", { required: true });   // null when cancelled
 *   const id = await dialog.choose("Who takes over their open work?", people);               // null when cancelled
 *
 * <DialogHost /> must be mounted once (QcLayout does it).
 */
import { useEffect, useRef, useState } from "react";
import { Modal, btnGhost, btnPrimary, ErrorNote } from "./QcUi";
import { inputStyle } from "./SpecForm";

interface Option { id: string; label: string }
type Request =
  | { kind: "alert"; title: string; message: string; resolve: () => void }
  | { kind: "confirm"; title: string; message: string; okLabel: string; danger: boolean; resolve: (ok: boolean) => void }
  | { kind: "prompt"; title: string; message: string; label?: string; placeholder?: string; defaultValue: string; required: boolean; multiline: boolean; okLabel: string; resolve: (v: string | null) => void }
  | { kind: "choose"; title: string; message: string; options: Option[]; okLabel: string; resolve: (v: string | null) => void };

let push: ((r: Request) => void) | null = null;

/** With no host on the page (should not happen) fall back to the native boxes so nothing is silently lost. */
function ask<T>(make: (resolve: (v: T) => void) => Request, fallback: () => T): Promise<T> {
  return new Promise<T>((resolve) => {
    if (!push) return resolve(fallback());
    push(make(resolve));
  });
}

export const dialog = {
  alert: (message: string, title = "Notice"): Promise<void> =>
    ask<void>((resolve) => ({ kind: "alert", title, message, resolve }), () => window.alert(message)),
  confirm: (message: string, opts: { title?: string; okLabel?: string; danger?: boolean } = {}): Promise<boolean> =>
    ask<boolean>((resolve) => ({ kind: "confirm", title: opts.title ?? "Please confirm", message, okLabel: opts.okLabel ?? "Confirm", danger: !!opts.danger, resolve }), () => window.confirm(message)),
  prompt: (message: string, opts: { title?: string; label?: string; placeholder?: string; defaultValue?: string; required?: boolean; multiline?: boolean; okLabel?: string } = {}): Promise<string | null> =>
    ask<string | null>(
      (resolve) => ({ kind: "prompt", title: opts.title ?? "Please answer", message, label: opts.label, placeholder: opts.placeholder, defaultValue: opts.defaultValue ?? "", required: !!opts.required, multiline: !!opts.multiline, okLabel: opts.okLabel ?? "OK", resolve }),
      () => window.prompt(message, opts.defaultValue),
    ),
  choose: (message: string, options: Option[], opts: { title?: string; okLabel?: string } = {}): Promise<string | null> =>
    ask<string | null>((resolve) => ({ kind: "choose", title: opts.title ?? "Choose one", message, options, okLabel: opts.okLabel ?? "OK", resolve }), () => null),
};

export function DialogHost() {
  const [queue, setQueue] = useState<Request[]>([]);
  useEffect(() => {
    push = (r) => setQueue((q) => [...q, r]);
    return () => { push = null; };
  }, []);
  const current = queue[0];
  if (!current) return null;
  const done = () => setQueue((q) => q.slice(1));
  // Keyed so each request starts with fresh inputs.
  return <DialogBody key={queue.length + current.title + current.message} request={current} onDone={done} />;
}

function DialogBody({ request, onDone }: { request: Request; onDone: () => void }) {
  const [text, setText] = useState(request.kind === "prompt" ? request.defaultValue : "");
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  useEffect(() => { first.current?.focus(); }, []);

  const cancel = () => {
    if (request.kind === "alert") request.resolve();
    else if (request.kind === "confirm") request.resolve(false);
    else request.resolve(null);
    onDone();
  };
  const accept = () => {
    if (request.kind === "alert") request.resolve();
    else if (request.kind === "confirm") request.resolve(true);
    else if (request.kind === "prompt") {
      const value = text.trim();
      if (request.required && !value) return setError("Please fill this in.");
      request.resolve(value);
    } else {
      if (!pick) return setError("Please choose one.");
      request.resolve(pick);
    }
    onDone();
  };

  const danger = request.kind === "confirm" && request.danger;
  const okLabel = request.kind === "alert" ? "OK" : request.okLabel;
  return (
    <Modal
      title={request.title}
      onClose={cancel}
      width={460}
      footer={
        <>
          {request.kind !== "alert" && <button style={btnGhost} onClick={cancel}>Cancel</button>}
          <button style={{ ...btnPrimary, ...(danger ? { background: "#dc2626" } : {}) }} onClick={accept}>{okLabel}</button>
        </>
      }
    >
      <p style={{ fontSize: 13, color: "#374151", margin: "0 0 12px", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{request.message}</p>
      {request.kind === "prompt" && (
        <div>
          {request.label && <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>{request.label}{request.required && <span style={{ color: "#dc2626" }}> *</span>}</label>}
          {request.multiline ? (
            <textarea ref={first} style={{ ...inputStyle, minHeight: 80, fontFamily: "inherit" }} value={text} placeholder={request.placeholder} onChange={(e) => { setText(e.target.value); setError(null); }} />
          ) : (
            <input ref={first} style={inputStyle} value={text} placeholder={request.placeholder} onChange={(e) => { setText(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === "Enter") accept(); }} />
          )}
        </div>
      )}
      {request.kind === "choose" && (
        <select ref={first} style={inputStyle} value={pick} onChange={(e) => { setPick(e.target.value); setError(null); }}>
          <option value="">Select…</option>
          {request.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
      <div style={{ marginTop: 8 }}><ErrorNote message={error} /></div>
    </Modal>
  );
}
