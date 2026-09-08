import type { CSSProperties } from "react";
import {
  AnswerTree,
  AnswerValue,
  TemplateField,
  asAnswerTree,
  asString,
  asStringArray,
  isGateSatisfied,
  isRepeatRequirementMet,
  resolveInstances,
} from "../templateFields";

/**
 * Editable, template-driven field editor -- the web equivalent of the
 * mobile app's FieldListRenderer. Renders (and, unless `readOnly`, lets
 * the inspector edit) every field of a section's template against its
 * answer tree: the same fields, in the same order and nesting, so a
 * section started on mobile can be finished here and vice versa.
 */
export function SectionFieldEditor({
  fields,
  scope,
  onChange,
  readOnly,
}: {
  fields: TemplateField[];
  scope: AnswerTree;
  onChange: (key: string, value: AnswerValue) => void;
  readOnly: boolean;
}) {
  const visible = [...fields].filter((f) => isGateSatisfied(f, scope)).sort((a, b) => a.order - b.order);
  let lastLetter: string | undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {visible.map((field) => {
        const showLetter = field.sectionLetter && field.sectionLetter !== lastLetter;
        lastLetter = field.sectionLetter;
        return (
          <div key={field.key}>
            {showLetter && (
              <div
                style={{
                  background: "#eff6ff",
                  borderLeft: "3px solid #2563eb",
                  borderRadius: "6px",
                  padding: "6px 12px",
                  marginBottom: "12px",
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                  color: "#1d4ed8",
                }}
              >
                {field.sectionLetter}
              </div>
            )}
            <FieldRenderer field={field} value={scope[field.key]} scope={scope} onChange={(v) => onChange(field.key, v)} readOnly={readOnly} />
          </div>
        );
      })}
    </div>
  );
}

interface RendererProps {
  field: TemplateField;
  value: AnswerValue;
  scope: AnswerTree;
  onChange: (v: AnswerValue) => void;
  readOnly: boolean;
}

const labelStyle: CSSProperties = {
  fontSize: "11px",
  fontWeight: 600,
  color: "#94a3b8",
  display: "block",
  marginBottom: "6px",
};
const inputStyle: CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  borderRadius: "8px",
  border: "1.5px solid #e5e7eb",
  background: "white",
  fontSize: "13px",
  color: "#1a2a4a",
  fontFamily: "Inter, -apple-system, sans-serif",
  outline: "none",
  boxSizing: "border-box",
};

function Label({ field }: { field: TemplateField }) {
  return (
    <label style={labelStyle}>
      {field.label}
      {field.required && <span style={{ color: "#dc2626" }}> *</span>}
      {field.unit ? ` (${field.unit})` : ""}
    </label>
  );
}

function ReadValue({ text }: { text: string }) {
  return <p style={{ fontSize: "13px", color: text === "—" ? "#c1c9d4" : "#1a2a4a", margin: 0 }}>{text}</p>;
}

function FieldRenderer(props: RendererProps) {
  switch (props.field.type) {
    case "text":
      return <TextField {...props} />;
    case "textarea":
      return <TextareaField {...props} />;
    case "numeric":
      return <NumericField {...props} />;
    case "date":
      return <DateFieldR {...props} />;
    case "yesno":
      return <ToggleField {...props} defaultOptions={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />;
    case "pill-select":
    case "select-tiles":
    case "color-select":
      return <ToggleField {...props} />;
    case "chip-multiselect":
      return <ChipField {...props} />;
    case "photos":
      return <PhotosField {...props} />;
    case "repeating-group":
    case "damage-list":
      return <RepeatingField {...props} />;
    default:
      return null;
  }
}

function TextField({ field, value, onChange, readOnly }: RendererProps) {
  const raw = asString(value);
  const suffix = field.prefix && raw.startsWith(field.prefix) ? raw.slice(field.prefix.length) : raw;
  return (
    <div>
      <Label field={field} />
      {readOnly || field.readOnly ? (
        <ReadValue text={raw || "—"} />
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {field.prefix && <span style={{ fontSize: "13px", color: "#94a3b8" }}>{field.prefix}</span>}
          <input
            style={inputStyle}
            value={suffix}
            placeholder={field.placeholder}
            onChange={(e) => onChange(field.prefix ? `${field.prefix}${e.target.value}` : e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function TextareaField({ field, value, onChange, readOnly }: RendererProps) {
  const raw = asString(value);
  return (
    <div>
      <Label field={field} />
      {readOnly || field.readOnly ? (
        <ReadValue text={raw || "—"} />
      ) : (
        <textarea
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
          value={raw}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function NumericField({ field, value, onChange, readOnly }: RendererProps) {
  const raw = asString(value);
  return (
    <div>
      <Label field={field} />
      {readOnly || field.readOnly ? (
        <ReadValue text={raw || "—"} />
      ) : (
        <input type="number" style={inputStyle} value={raw} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function DateFieldR({ field, value, onChange, readOnly }: RendererProps) {
  const raw = asString(value);
  return (
    <div>
      <Label field={field} />
      {readOnly || field.readOnly ? (
        <ReadValue text={raw || "—"} />
      ) : (
        <input type="date" style={inputStyle} value={raw} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Rounded pill buttons -- yesno / pill-select / select-tiles / color-select all render this way. */
function ToggleField({ field, value, onChange, readOnly, defaultOptions }: RendererProps & { defaultOptions?: { value: string; label: string }[] }) {
  const options = field.options?.length ? field.options : defaultOptions ?? [];
  const current = asString(value);
  return (
    <div>
      <Label field={field} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {options.map((o) => {
          const active = o.value === current;
          const swatch = "color" in o ? (o.color as string | undefined) : undefined;
          return (
            <button
              key={o.value}
              type="button"
              disabled={readOnly || field.readOnly}
              onClick={() => onChange(o.value)}
              style={{
                padding: "8px 16px",
                borderRadius: "20px",
                border: `1.5px solid ${active ? swatch ?? "#2563eb" : "#e5e7eb"}`,
                background: active ? swatch ?? "#2563eb" : "white",
                color: active ? "white" : "#374151",
                fontSize: "13px",
                fontWeight: 600,
                cursor: readOnly || field.readOnly ? "default" : "pointer",
              }}
            >
              {o.label}
            </button>
          );
        })}
        {options.length === 0 && <ReadValue text="—" />}
      </div>
    </div>
  );
}

function ChipField({ field, value, onChange, readOnly }: RendererProps) {
  const selected = asStringArray(value);
  const otherKey = "__other__";
  const otherEntry = selected.find((s) => s.startsWith(`${otherKey}:`));
  const otherValue = otherEntry ? otherEntry.slice(otherKey.length + 1) : "";
  const baseSelected = selected.filter((s) => s !== "other" && !s.startsWith(`${otherKey}:`)).concat(selected.includes("other") ? ["other"] : []);

  function toggle(v: string) {
    const has = baseSelected.includes(v);
    const next = has ? baseSelected.filter((s) => s !== v) : [...baseSelected, v];
    onChange(
      next
        .filter((s) => s !== "other")
        .concat(next.includes("other") ? ["other"] : [])
        .concat(next.includes("other") && otherValue ? [`${otherKey}:${otherValue}`] : []),
    );
  }
  function setOther(text: string) {
    const next = baseSelected.filter((s) => !s.startsWith(`${otherKey}:`));
    onChange([...next, ...(text ? [`${otherKey}:${text}`] : [])]);
  }

  return (
    <div>
      <Label field={field} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {(field.options ?? []).map((o) => {
          const active = baseSelected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              disabled={readOnly || field.readOnly}
              onClick={() => toggle(o.value)}
              style={{
                padding: "7px 14px",
                borderRadius: "8px",
                border: `1.5px solid ${active ? "#2563eb" : "#e5e7eb"}`,
                background: active ? "#eff6ff" : "white",
                color: active ? "#1d4ed8" : "#374151",
                fontSize: "13px",
                fontWeight: 600,
                cursor: readOnly || field.readOnly ? "default" : "pointer",
              }}
            >
              {o.label}
            </button>
          );
        })}
        {field.allowOther && (
          <button
            type="button"
            disabled={readOnly || field.readOnly}
            onClick={() => toggle("other")}
            style={{
              padding: "7px 14px",
              borderRadius: "8px",
              border: `1.5px solid ${baseSelected.includes("other") ? "#2563eb" : "#e5e7eb"}`,
              background: baseSelected.includes("other") ? "#eff6ff" : "white",
              color: baseSelected.includes("other") ? "#1d4ed8" : "#374151",
              fontSize: "13px",
              fontWeight: 600,
              cursor: readOnly || field.readOnly ? "default" : "pointer",
            }}
          >
            Other
          </button>
        )}
      </div>
      {field.allowOther && baseSelected.includes("other") && (
        readOnly || field.readOnly ? (
          <div style={{ marginTop: "8px" }}>
            <ReadValue text={otherValue || "—"} />
          </div>
        ) : (
          <input style={{ ...inputStyle, marginTop: "8px" }} placeholder="Specify…" value={otherValue} onChange={(e) => setOther(e.target.value)} />
        )
      )}
    </div>
  );
}

function PhotosField({ field, value }: RendererProps) {
  const uris = asStringArray(value);
  return (
    <div>
      <Label field={field} />
      {uris.length === 0 ? (
        <p style={{ fontSize: "12px", color: "#c1c9d4", margin: 0 }}>No photos</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: "6px" }}>
          {uris.map((u, i) => (
            <img key={i} src={u} alt="" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: "8px", border: "1px solid #e5e7eb" }} />
          ))}
        </div>
      )}
    </div>
  );
}

function humanizeList(values: string[]): string {
  const titled = values.map((v) => v.charAt(0).toUpperCase() + v.slice(1));
  if (titled.length <= 1) return titled[0] ?? "";
  return `${titled.slice(0, -1).join(", ")} or ${titled[titled.length - 1]}`;
}

/** repeating-group / damage-list: a list of instance cards, each recursing back into SectionFieldEditor. */
function RepeatingField({ field, value, onChange, scope, readOnly }: RendererProps) {
  const presentation = field.repeat?.presentation ?? "strip";
  const itemFields = field.itemFields ?? [];

  if (presentation === "checklist") {
    const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
    return (
      <div>
        <label style={labelStyle}>{field.label}</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {(field.repeat?.fixedInstances ?? []).map((inst) => {
            const instScope = record[inst.key] ?? {};
            return (
              <div key={inst.key} style={{ borderBottom: "1px solid #f1f5f9", paddingBottom: "10px" }}>
                <SectionFieldEditor
                  fields={itemFields.map((f) => (f.key === "value" ? { ...f, label: inst.label } : f))}
                  scope={instScope}
                  onChange={(k, v) => onChange({ ...record, [inst.key]: { ...instScope, [k]: v } })}
                  readOnly={readOnly}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const requirementMet = isRepeatRequirementMet(field, value, scope);
  const requireWhen = field.repeat?.requireWhen;
  const instances = resolveInstances(field, value);
  const isArrayBacked = presentation === "strip" || field.type === "damage-list";

  function updateArrayInstance(idx: number, k: string, v: AnswerValue) {
    const list = Array.isArray(value) ? [...(value as AnswerTree[])] : [];
    list[idx] = { ...(list[idx] ?? {}), [k]: v };
    onChange(list);
  }
  function addArrayInstance() {
    const list = Array.isArray(value) ? [...(value as AnswerTree[])] : [];
    onChange([...list, {}]);
  }
  function removeArrayInstance(idx: number) {
    const list = Array.isArray(value) ? [...(value as AnswerTree[])] : [];
    onChange(list.filter((_, i) => i !== idx));
  }
  function updateRecordInstance(key: string, k: string, v: AnswerValue) {
    const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
    onChange({ ...record, [key]: { ...(record[key] ?? {}), [k]: v } });
  }
  function addRecordInstance() {
    const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
    onChange({ ...record, [`extra_${Date.now()}`]: {} });
  }
  function removeRecordInstance(key: string) {
    const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
    const next = { ...record };
    delete next[key];
    onChange(next);
  }
  const fixedKeys = new Set((field.repeat?.fixedInstances ?? []).map((f) => f.key));

  return (
    <div>
      <label style={labelStyle}>
        {field.label} {instances.length > 0 && `(${instances.length})`}
      </label>
      {!requirementMet && requireWhen && (
        <div
          style={{
            color: "#dc2626",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            padding: "8px 12px",
            marginBottom: "10px",
            fontSize: "12px",
            fontWeight: 600,
          }}
        >
          Add at least one defect — required because {requireWhen.fieldKey} is {humanizeList(requireWhen.equals)}.
        </div>
      )}
      {instances.length === 0 && <p style={{ fontSize: "12px", color: "#c1c9d4", margin: 0 }}>None recorded</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {instances.map((inst, idx) => {
          const key = isArrayBacked
            ? String(idx)
            : Object.keys(asAnswerTree(value) as unknown as Record<string, AnswerTree>).find(
                (k) => (asAnswerTree(value) as unknown as Record<string, AnswerTree>)[k] === inst.scope,
              );
          const removable = isArrayBacked ? instances.length > 1 || field.type === "damage-list" : key !== undefined && !fixedKeys.has(key);
          return (
            <div key={isArrayBacked ? idx : key ?? idx} style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
              <div style={{ padding: "10px 14px", background: "white", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "13px", fontWeight: 700, color: "#1a2a4a" }}>{inst.label}</span>
                {!readOnly && removable && (
                  <button
                    type="button"
                    onClick={() => (isArrayBacked ? removeArrayInstance(idx) : key !== undefined ? removeRecordInstance(key) : undefined)}
                    style={{ background: "none", border: "none", color: "#dc2626", fontSize: "12px", fontWeight: 600, cursor: "pointer", padding: 0 }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div style={{ padding: "14px" }}>
                <SectionFieldEditor
                  fields={itemFields}
                  scope={inst.scope}
                  onChange={(k, v) => (isArrayBacked ? updateArrayInstance(idx, k, v) : key !== undefined ? updateRecordInstance(key, k, v) : undefined)}
                  readOnly={readOnly}
                />
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && (field.repeat?.addable ?? true) && (
        <button
          type="button"
          onClick={isArrayBacked ? addArrayInstance : addRecordInstance}
          style={{
            marginTop: "10px",
            padding: "9px 16px",
            borderRadius: "8px",
            border: `1.5px dashed ${!requirementMet && requireWhen ? "#dc2626" : "#2563eb"}`,
            background: "white",
            color: !requirementMet && requireWhen ? "#dc2626" : "#2563eb",
            fontSize: "13px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + {field.repeat?.addButtonLabel ?? `Add ${field.label}`}
        </button>
      )}
    </div>
  );
}
