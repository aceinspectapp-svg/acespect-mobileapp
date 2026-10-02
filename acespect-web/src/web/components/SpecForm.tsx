import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { AU_STATES, STREET_TYPES, type Address, type FieldKind, type FieldSpec, type FormSpec, type QcSpecPayload } from "../qcSpec";

/** Fetches the server's spec once per page load and shares it between forms. */
let specPromise: Promise<QcSpecPayload> | null = null;
export function useQcSpec(): QcSpecPayload | null {
  const [spec, setSpec] = useState<QcSpecPayload | null>(null);
  useEffect(() => {
    specPromise ??= api.qc.spec();
    let live = true;
    specPromise.then((s) => live && setSpec(s)).catch(() => {
      specPromise = null;
    });
    return () => {
      live = false;
    };
  }, []);
  return spec;
}

export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #e5e7eb", fontSize: 13,
  color: "#1a2a4a", outline: "none", boxSizing: "border-box", fontFamily: "inherit", background: "white",
};
export const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 };
const helpStyle: React.CSSProperties = { fontSize: 10.5, color: "#94a3b8", marginTop: 3, lineHeight: 1.35 };

export interface RefOption {
  id: string;
  label: string;
}

export interface SpecFormProps {
  form: FormSpec;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  errors?: Record<string, string[]>;
  /** Options for reference fields, keyed by the spec entity they point at (E01, E03, E19...). */
  refOptions?: Record<string, RefOption[]>;
  /** Options for a specific field key; wins over refOptions. */
  fieldOptions?: Record<string, RefOption[]>;
  /** Field keys the caller supplies some other way. */
  hide?: string[];
  files?: Record<string, File[]>;
  onFiles?: (key: string, files: File[]) => void;
}

const WIDE: FieldKind[] = ["longtext", "address", "multiselect", "composite", "refs", "files"];

function isRequired(f: FieldSpec, value: Record<string, unknown>): boolean {
  if (f.req === "M") return true;
  if (f.req === "C" && f.requiredWhen) {
    const driver = value[f.requiredWhen.field];
    return typeof driver === "string" && f.requiredWhen.in.includes(driver);
  }
  return false;
}

export function SpecForm({ form, value, onChange, errors = {}, refOptions = {}, fieldOptions = {}, hide = [], files = {}, onFiles }: SpecFormProps) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  const visible = form.fields.filter((f) => !f.system && !f.hidden && !hide.includes(f.key));

  let lastGroup = "";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 16px" }}>
      {visible.map((f) => {
        const showGroup = f.group && f.group !== lastGroup;
        lastGroup = f.group || lastGroup;
        const wide = WIDE.includes(f.kind);
        const err = errors[f.key]?.[0];
        return (
          <Fragment key={f.key}>
            {showGroup && (
              <div style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 700, color: "#1a2a4a", textTransform: "uppercase", letterSpacing: 0.6, margin: "6px 0 0", borderBottom: "1px solid #f1f5f9", paddingBottom: 6 }}>
                {f.group}
              </div>
            )}
            <div style={{ gridColumn: wide ? "1 / -1" : undefined }}>
              <label style={labelStyle}>
                {f.label}
                {isRequired(f, value) && <span style={{ color: "#dc2626" }}> *</span>}
                {f.req === "C" && !f.requiredWhen && <span style={{ color: "#94a3b8", fontWeight: 500 }}> (conditional)</span>}
              </label>
              <FieldInput
                f={f}
                v={value[f.key]}
                onChange={(v) => set(f.key, v)}
                options={fieldOptions[f.key] ?? (f.ref ? refOptions[f.ref] : undefined)}
                files={files[f.key] ?? []}
                onFiles={(list) => onFiles?.(f.key, list)}
                invalid={!!err}
              />
              {err ? <div style={{ ...helpStyle, color: "#dc2626" }}>{err}</div> : helpText(f) && <div style={helpStyle}>{helpText(f)}</div>}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function helpText(f: FieldSpec): string {
  if (f.kind === "select" || f.kind === "multiselect" || f.kind === "address") return f.notes ?? "";
  const parts = [f.rules, f.notes].filter(Boolean).join(" · ");
  return parts.length > 170 ? parts.slice(0, 167) + "…" : parts;
}

interface FieldInputProps {
  f: FieldSpec;
  v: unknown;
  onChange: (v: unknown) => void;
  options?: RefOption[];
  files: File[];
  onFiles: (list: File[]) => void;
  invalid: boolean;
}

function FieldInput({ f, v, onChange, options, files, onFiles, invalid }: FieldInputProps) {
  const style: React.CSSProperties = { ...inputStyle, borderColor: invalid ? "#fca5a5" : "#e5e7eb" };
  const str = typeof v === "string" || typeof v === "number" ? String(v) : "";

  switch (f.kind) {
    case "longtext":
      return <textarea style={{ ...style, minHeight: 72, resize: "vertical" }} value={str} onChange={(e) => onChange(e.target.value)} />;
    case "select":
      return (
        <select style={style} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "multiselect": {
      const picked = Array.isArray(v) ? (v as string[]) : [];
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
          {(f.options ?? []).map((o) => (
            <label key={o} style={{ fontSize: 12, color: "#374151", display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={picked.includes(o)} onChange={(e) => onChange(e.target.checked ? [...picked, o] : picked.filter((x) => x !== o))} />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case "bool":
      return (
        <select style={style} value={v === true ? "yes" : v === false ? "no" : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "yes")}>
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
    case "date":
      return <input type="date" style={style} value={str} onChange={(e) => onChange(e.target.value)} />;
    case "datetime":
      return <input type="datetime-local" style={style} value={str.slice(0, 16)} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : "")} />;
    case "int":
    case "decimal":
    case "currency":
      return (
        <input type="number" style={style} value={str} min={f.min} max={f.max} step={f.kind === "decimal" ? "0.1" : "1"}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))} />
      );
    case "phone":
      return <input type="tel" style={style} placeholder="04XX XXX XXX" value={str} onChange={(e) => onChange(e.target.value)} />;
    case "abn":
      return <input style={style} placeholder="12 345 678 901" value={str} onChange={(e) => onChange(e.target.value)} />;
    case "acn":
      return <input style={style} placeholder="123 456 789" value={str} onChange={(e) => onChange(e.target.value)} />;
    case "email":
      return <input type="email" style={style} value={str} onChange={(e) => onChange(e.target.value)} />;
    case "address":
      return <AddressInput v={(v as Address) ?? {}} onChange={onChange} />;
    case "ref":
      return options ? (
        <select style={style} value={str} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : (
        <input style={style} value={str} onChange={(e) => onChange(e.target.value)} placeholder="ID" />
      );
    case "refs": {
      const picked = Array.isArray(v) ? (v as string[]) : [];
      if (!options) return <div style={helpStyle}>No options available.</div>;
      return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", maxHeight: 130, overflowY: "auto", padding: "2px 0" }}>
          {options.map((o) => (
            <label key={o.id} style={{ fontSize: 12, color: "#374151", display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))} />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "composite": {
      const parts = f.parts ?? [];
      const arr = Array.isArray(v) ? (v as unknown[]) : [];
      return (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(parts.length, 4)}, 1fr)`, gap: 8 }}>
          {parts.map((p, i) => (
            <div key={i}>
              <input
                style={style}
                aria-label={p.label}
                placeholder={p.label}
                type={p.kind === "date" ? "date" : p.kind === "currency" || p.kind === "int" || p.kind === "decimal" ? "number" : p.kind === "email" ? "email" : "text"}
                value={arr[i] === undefined || arr[i] === null ? "" : String(arr[i])}
                onChange={(e) => {
                  const next = parts.map((_, j) => (arr[j] === undefined ? "" : arr[j]));
                  next[i] = e.target.value;
                  onChange(next);
                }}
              />
            </div>
          ))}
        </div>
      );
    }
    case "file":
    case "files":
      return (
        <div>
          <input type="file" accept="image/*,application/pdf" multiple={f.kind === "files"} onChange={(e) => onFiles(Array.from(e.target.files ?? []))} style={{ fontSize: 12 }} />
          {files.length > 0 && <div style={helpStyle}>{files.map((x) => x.name).join(", ")}</div>}
        </div>
      );
    default:
      return <input style={style} value={str} onChange={(e) => onChange(e.target.value)} />;
  }
}

function AddressInput({ v, onChange }: { v: Address; onChange: (a: Address) => void }) {
  const set = (k: keyof Address, val: string) => onChange({ ...v, [k]: val });
  const small = { ...inputStyle, padding: "7px 9px" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr 1.4fr", gap: 8 }}>
      <input style={small} placeholder="Unit / level" value={v.unit ?? ""} onChange={(e) => set("unit", e.target.value)} />
      <input style={small} placeholder="Street no. *" value={v.streetNumber ?? ""} onChange={(e) => set("streetNumber", e.target.value)} />
      <input style={small} placeholder="Street name *" value={v.streetName ?? ""} onChange={(e) => set("streetName", e.target.value)} />
      <select style={small} value={v.streetType ?? ""} onChange={(e) => set("streetType", e.target.value)}>
        <option value="">Type *</option>
        {STREET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input style={{ ...small, gridColumn: "1 / 3" }} placeholder="Suburb or locality *" value={v.suburb ?? ""} onChange={(e) => set("suburb", e.target.value)} />
      <select style={small} value={v.state ?? ""} onChange={(e) => set("state", e.target.value)}>
        <option value="">State *</option>
        {AU_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <input style={small} placeholder="Postcode *" inputMode="numeric" maxLength={4} value={v.postcode ?? ""} onChange={(e) => set("postcode", e.target.value.replace(/\D/g, ""))} />
    </div>
  );
}

/** Drops empty values so the server treats them as absent (and optional fields don't fail validation). */
export function cleanPayload(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (Array.isArray(v) && v.every((x) => x === "" || x === undefined)) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.values(v as object).every((x) => x === "" || x === undefined)) continue;
    out[k] = v;
  }
  return out;
}
