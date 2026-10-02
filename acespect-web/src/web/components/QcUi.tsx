import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, type ApiError } from "../api";
import { SpecForm, cleanPayload, inputStyle, labelStyle, useQcSpec, type RefOption } from "./SpecForm";
import { findForm, type FormSpec } from "../qcSpec";
import type { QcMasterContractorRow, QcPersonRow, QcProjectRow, QcSiteRow, QcTradeCategory, QcTradeCompanyRow, QcClientRow } from "../qcTypes";

export const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 8, border: "none", background: "#1a2a4a", color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
export const btnGhost: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 8, border: "1px solid #e5e7eb", background: "white", color: "#374151", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
export const btnLink: React.CSSProperties = { background: "none", border: "none", color: "#2563eb", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 };
export const btnDanger: React.CSSProperties = { ...btnLink, color: "#dc2626" };
export const cell: React.CSSProperties = { padding: "12px 16px", fontSize: 13, color: "#1a2a4a" };
export const sub: React.CSSProperties = { fontSize: 11, color: "#94a3b8" };

export function Modal({ title, onClose, width = 760, children, footer }: {
  title: string; onClose: () => void; width?: number; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "white", borderRadius: 14, width, maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 48px)", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #f1f5f9" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1a2a4a", margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: 4 }} aria-label="Close"><X size={16} /></button>
        </div>
        <div style={{ padding: "16px 20px", overflowY: "auto" }}>{children}</div>
        {footer && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px", borderTop: "1px solid #f1f5f9" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p style={{ fontSize: 12, color: "#dc2626", margin: "0 0 12px", lineHeight: 1.4 }}>{message}</p> : null;
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}{required && <span style={{ color: "#dc2626" }}> *</span>}</label>
      {children}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder = "Select…", disabled }: {
  value: string; onChange: (v: string) => void; options: RefOption[]; placeholder?: string; disabled?: boolean;
}) {
  return (
    <select style={inputStyle} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
}

export function statusPill(status: string) {
  const s = status.toUpperCase();
  const tone = s === "ACTIVE" || s === "APPROVED" || s === "CURRENT" ? ["#065f46", "#d1fae5"]
    : s === "SUSPENDED" || s === "EXPIRED" || s === "OFFBOARDED" || s === "DEACTIVATED" ? ["#991b1b", "#fee2e2"]
    : s === "INACTIVE" || s === "ARCHIVED" ? ["#475569", "#e2e8f0"]
    : ["#92400e", "#fef3c7"];
  return (
    <span style={{ padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 700, color: tone[0], background: tone[1], whiteSpace: "nowrap" }}>
      {status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
    </span>
  );
}

/** Reference lists the spec forms point at (E01 clients, E02 contractors, E03 trade companies, E19 categories, ...). */
export interface RefData {
  clients: QcClientRow[];
  masterContractors: QcMasterContractorRow[];
  tradeCompanies: QcTradeCompanyRow[];
  tradeCategories: QcTradeCategory[];
  projects: QcProjectRow[];
  sites: QcSiteRow[];
  people: QcPersonRow[];
}

export function useRefData() {
  const [data, setData] = useState<RefData | null>(null);
  const reload = useCallback(() => {
    Promise.all([
      api.qc.clients.list(),
      api.qc.masterContractors.list(),
      api.qc.tradeCompanies.list(),
      api.qc.tradeCategories.list(),
      api.qc.projects.list(),
      api.qc.sites.list(),
      api.qc.people.list(),
    ])
      .then(([clients, masterContractors, tradeCompanies, tradeCategories, projects, sites, people]) =>
        setData({ clients, masterContractors, tradeCompanies, tradeCategories, projects, sites, people }))
      .catch(() => setData(null));
  }, []);
  useEffect(reload, [reload]);

  const refOptions: Record<string, RefOption[]> = data
    ? {
        E01: data.clients.map((c) => ({ id: c.id, label: c.name })),
        E02: data.masterContractors.map((m) => ({ id: m.id, label: m.name })),
        E03: data.tradeCompanies.map((t) => ({ id: t.id, label: t.name })),
        E19: data.tradeCategories.filter((c) => c.active).map((c) => ({ id: c.id, label: c.name })),
        E07: data.projects.map((p) => ({ id: p.id, label: p.name })),
        E08: data.sites.map((s) => ({ id: s.id, label: s.name })),
        E04: data.people.map((p) => ({ id: p.id, label: p.name ?? p.email })),
      }
    : {};
  return { data, refOptions, reload };
}

/** Create/edit dialog rendered from a spec form. `extra` renders caller-owned fields above the spec fields. */
export function FormDialog({ title, formCode, initial = {}, submitLabel = "Save", width, hide, refOptions, fieldOptions, extra, onSubmit, onClose, note, withFiles }: {
  title: string;
  formCode: string;
  initial?: Record<string, unknown>;
  submitLabel?: string;
  width?: number;
  hide?: string[];
  refOptions?: Record<string, RefOption[]>;
  fieldOptions?: Record<string, RefOption[]> | ((value: Record<string, unknown>) => Record<string, RefOption[]>);
  extra?: (value: Record<string, unknown>, set: (patch: Record<string, unknown>) => void) => React.ReactNode;
  onSubmit: (payload: Record<string, unknown>, files: Record<string, File[]>) => Promise<void>;
  onClose: () => void;
  note?: React.ReactNode;
  withFiles?: boolean;
}) {
  const spec = useQcSpec();
  const [value, setValue] = useState<Record<string, unknown>>(initial);
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  if (!spec) {
    return <Modal title={title} onClose={onClose} width={width}><p style={sub}>Loading form…</p></Modal>;
  }
  const form: FormSpec = findForm(spec, formCode);

  async function submit() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await onSubmit(cleanPayload(value), files);
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (err.details) setFieldErrors(err.details);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={width}
      footer={
        <>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={submit}>{saving ? "Saving…" : submitLabel}</button>
        </>
      }
    >
      {note}
      <ErrorNote message={error} />
      {extra && <div style={{ marginBottom: 14 }}>{extra(value, (patch) => setValue((v) => ({ ...v, ...patch })))}</div>}
      <SpecForm
        form={form}
        value={value}
        onChange={setValue}
        errors={fieldErrors}
        refOptions={refOptions}
        fieldOptions={typeof fieldOptions === "function" ? fieldOptions(value) : fieldOptions}
        hide={hide}
        files={withFiles ? files : undefined}
        onFiles={withFiles ? (key, list) => setFiles((f) => ({ ...f, [key]: list })) : undefined}
      />
    </Modal>
  );
}

export function CredentialsDialog({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  return (
    <Modal title="Account created" onClose={onClose} width={440} footer={<button style={btnPrimary} onClick={onClose}>Done</button>}>
      <p style={{ fontSize: 13, color: "#374151", marginTop: 0 }}>Give these sign-in details to the new user. The password is shown only now.</p>
      <div style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 12, fontSize: 13, color: "#1a2a4a", lineHeight: 1.8 }}>
        <div><span style={sub}>Email</span><br /><b>{email}</b></div>
        <div style={{ marginTop: 6 }}><span style={sub}>Temporary password</span><br /><code style={{ fontSize: 14 }}>{password}</code></div>
      </div>
    </Modal>
  );
}

/** Display a stored spec value (address, array, boolean...) as text. */
export function showValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.join(", ") || "—";
  if (typeof v === "object") {
    const a = v as Record<string, string>;
    return [a.unit, a.streetNumber, a.streetName, a.streetType, a.suburb, a.state, a.postcode].filter(Boolean).join(" ");
  }
  return String(v);
}
