"use client";

import { Fragment, type CSSProperties } from "react";
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
} from "./templateFields";

/**
 * Web equivalent of acespect-mobile's FieldListRenderer + leafRenderers --
 * renders (and, unless `readOnly`, edits) a template's fields against one
 * scope of the answer tree. This is what makes the dashboard's per-section
 * "3rd column" show the exact same fields, in the same order, gated the
 * same way, as the inspector fills in on the mobile app.
 */
export function SectionFieldEditor({
  fields,
  scope,
  onChange,
  path,
  readOnly,
}: {
  fields: TemplateField[];
  scope: AnswerTree;
  onChange: (key: string, value: AnswerValue) => void;
  path: string[];
  readOnly: boolean;
}) {
  const visible = [...fields].filter((f) => isGateSatisfied(f, scope)).sort((a, b) => a.order - b.order);
  let lastLetter: string | undefined;
  return (
    <>
      {visible.map((field) => {
        const showLetterHeader = field.sectionLetter && field.sectionLetter !== lastLetter;
        lastLetter = field.sectionLetter;
        return (
          <Fragment key={field.key}>
            {showLetterHeader && <div className="field-letter-band">{field.sectionLetter}</div>}
            <FieldRenderer
              field={field}
              value={scope[field.key]}
              onChange={(v) => onChange(field.key, v)}
              path={[...path, field.key]}
              scope={scope}
              readOnly={readOnly}
            />
          </Fragment>
        );
      })}
    </>
  );
}

interface RendererProps {
  field: TemplateField;
  value: AnswerValue;
  onChange: (v: AnswerValue) => void;
  path: string[];
  scope: AnswerTree;
  readOnly: boolean;
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

function FieldLabel({ field }: { field: TemplateField }) {
  return (
    <label>
      {field.label}
      {field.required && <span style={{ color: "var(--red)" }}> *</span>}
      {field.unit ? ` (${field.unit})` : ""}
    </label>
  );
}

function TextField({ field, value, onChange, readOnly }: RendererProps) {
  const raw = asString(value);
  const suffix = field.prefix && raw.startsWith(field.prefix) ? raw.slice(field.prefix.length) : raw;
  return (
    <div className="field-block">
      <FieldLabel field={field} />
      {readOnly || field.readOnly ? (
        <p className="field-readvalue">{raw || <span className="muted">—</span>}</p>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          {field.prefix && <span className="muted">{field.prefix}</span>}
          <input
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
    <div className="field-block">
      <FieldLabel field={field} />
      {readOnly || field.readOnly ? (
        <p className="field-readvalue">{raw || <span className="muted">—</span>}</p>
      ) : (
        <textarea rows={3} value={raw} placeholder={field.placeholder} maxLength={field.maxLength} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function NumericField({ field, value, onChange, readOnly }: RendererProps) {
  const raw = asString(value);
  return (
    <div className="field-block">
      <FieldLabel field={field} />
      {readOnly || field.readOnly ? (
        <p className="field-readvalue">{raw || <span className="muted">—</span>}</p>
      ) : (
        <input type="number" value={raw} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function DateFieldR({ field, value, onChange, readOnly }: RendererProps) {
  const raw = asString(value);
  return (
    <div className="field-block">
      <FieldLabel field={field} />
      {readOnly || field.readOnly ? (
        <p className="field-readvalue">{raw || <span className="muted">—</span>}</p>
      ) : (
        <input type="date" value={raw} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

function ToggleField({
  field,
  value,
  onChange,
  readOnly,
  defaultOptions,
}: RendererProps & { defaultOptions?: { value: string; label: string }[] }) {
  const options = field.options?.length ? field.options : defaultOptions ?? [];
  const current = asString(value);
  return (
    <div className="field-block">
      <FieldLabel field={field} />
      <div className="toggle-row">
        {options.map((o) => {
          const active = o.value === current;
          const swatch: string | undefined = "color" in o ? (o.color as string | undefined) : undefined;
          const style: CSSProperties | undefined =
            field.type === "color-select" && swatch
              ? { borderColor: swatch, ...(active ? { background: swatch, color: "#fff" } : {}) }
              : undefined;
          return (
            <button
              key={o.value}
              type="button"
              className={`toggle-btn${active ? " active" : ""}`}
              disabled={readOnly || field.readOnly}
              onClick={() => onChange(o.value)}
              style={style}
            >
              {o.label}
            </button>
          );
        })}
        {options.length === 0 && <span className="muted">—</span>}
      </div>
    </div>
  );
}

function ChipField({ field, value, onChange, readOnly }: RendererProps) {
  const selected = asStringArray(value);
  const otherKey = "__other__";
  const otherEntry = selected.find((s) => s.startsWith(`${otherKey}:`));
  const otherValue = otherEntry ? otherEntry.slice(otherKey.length + 1) : "";
  const baseSelected = selected.filter((s) => s !== "other" && !s.startsWith(`${otherKey}:`)).concat(
    selected.includes("other") ? ["other"] : [],
  );

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
    <div className="field-block">
      <FieldLabel field={field} />
      <div className="toggle-row">
        {(field.options ?? []).map((o) => {
          const active = baseSelected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className={`toggle-btn chip${active ? " active" : ""}`}
              disabled={readOnly || field.readOnly}
              onClick={() => toggle(o.value)}
            >
              {o.label}
            </button>
          );
        })}
        {field.allowOther && (
          <button
            type="button"
            className={`toggle-btn chip${baseSelected.includes("other") ? " active" : ""}`}
            disabled={readOnly || field.readOnly}
            onClick={() => toggle("other")}
          >
            Other
          </button>
        )}
      </div>
      {field.allowOther && baseSelected.includes("other") && (
        readOnly || field.readOnly ? (
          <p className="field-readvalue">{otherValue || <span className="muted">—</span>}</p>
        ) : (
          <input
            style={{ marginTop: 8 }}
            placeholder="Specify…"
            value={otherValue}
            onChange={(e) => setOther(e.target.value)}
          />
        )
      )}
    </div>
  );
}

function PhotosField({ field, value }: RendererProps) {
  const uris = asStringArray(value);
  return (
    <div className="field-block">
      <FieldLabel field={field} />
      {uris.length === 0 ? (
        <p className="muted">No photos</p>
      ) : (
        <div className="photo-grid">
          {uris.map((uri) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={uri} src={uri} alt={field.label} className="photo-thumb" />
          ))}
        </div>
      )}
    </div>
  );
}

function isAnswered(v: AnswerValue): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== "";
}

function humanizeList(values: string[]): string {
  const titled = values.map((v) => v.charAt(0).toUpperCase() + v.slice(1));
  if (titled.length <= 1) return titled[0] ?? "";
  return `${titled.slice(0, -1).join(", ")} or ${titled[titled.length - 1]}`;
}

/** repeating-group / damage-list: checklist rows inline, everything else as a list of instance cards. */
function RepeatingField({ field, value, onChange, path, scope, readOnly }: RendererProps) {
  const presentation = field.repeat?.presentation ?? "strip";
  const itemFields = field.itemFields ?? [];

  if (presentation === "checklist") {
    const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
    return (
      <div className="field-block">
        <label>{field.label}</label>
        {(field.repeat?.fixedInstances ?? []).map((inst) => {
          const instScope = record[inst.key] ?? {};
          return (
            <div key={inst.key} className="checklist-row">
              <SectionFieldEditor
                fields={itemFields.map((f) => (f.key === "value" ? { ...f, label: inst.label } : f))}
                scope={instScope}
                onChange={(k, v) => onChange({ ...record, [inst.key]: { ...instScope, [k]: v } })}
                path={[...path, inst.key]}
                readOnly={readOnly}
              />
            </div>
          );
        })}
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
    <div className="field-block">
      <label>{field.label}</label>
      {!requirementMet && requireWhen && (
        <div className="require-warning">
          Add at least one defect — required because {requireWhen.fieldKey} is {humanizeList(requireWhen.equals)}.
        </div>
      )}
      {instances.length === 0 && <p className="muted">None recorded</p>}
      {instances.map((inst, idx) => {
        const key = isArrayBacked ? String(idx) : Object.keys(asAnswerTree(value) as unknown as Record<string, AnswerTree>).find(
          (k) => (asAnswerTree(value) as unknown as Record<string, AnswerTree>)[k] === inst.scope,
        );
        const removable = isArrayBacked
          ? instances.length > 1 || field.type === "damage-list"
          : key !== undefined && !fixedKeys.has(key);
        return (
          <div key={isArrayBacked ? idx : key ?? idx} className="instance-card">
            <div className="instance-card-header">
              <span className="instance-card-title">{inst.label}</span>
              {!readOnly && removable && (
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    isArrayBacked ? removeArrayInstance(idx) : key !== undefined ? removeRecordInstance(key) : undefined
                  }
                >
                  Remove
                </button>
              )}
            </div>
            <SectionFieldEditor
              fields={itemFields}
              scope={inst.scope}
              onChange={(k, v) =>
                isArrayBacked ? updateArrayInstance(idx, k, v) : key !== undefined ? updateRecordInstance(key, k, v) : undefined
              }
              path={[...path, String(idx)]}
              readOnly={readOnly}
            />
          </div>
        );
      })}
      {!readOnly && (field.repeat?.addable ?? true) && (
        <button
          type="button"
          className={!requirementMet && requireWhen ? "add-instance-btn required" : "add-instance-btn"}
          onClick={isArrayBacked ? addArrayInstance : addRecordInstance}
        >
          + {field.repeat?.addButtonLabel ?? `Add ${field.label}`}
        </button>
      )}
    </div>
  );
}

export { isAnswered };
