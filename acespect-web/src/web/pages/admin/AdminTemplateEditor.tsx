import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, ArrowUp, ArrowDown, Plus, Trash2, Save, Send, ChevronDown, ChevronRight } from "lucide-react";
import { PageShell, StatusBadge } from "../../components/WebLayout";
import { TEMPLATE_STATUS_CONFIG, type Template, type TemplateField, type TemplateFieldType } from "../../mockData";
import { api } from "../../api";

const LEAF_FIELD_TYPES: { value: TemplateFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Textarea" },
  { value: "numeric", label: "Numeric" },
  { value: "date", label: "Date" },
  { value: "yesno", label: "Yes / No" },
  { value: "pill-select", label: "Select (pills)" },
  { value: "select-tiles", label: "Select (tiles)" },
  { value: "color-select", label: "Select (color-coded)" },
  { value: "chip-multiselect", label: "Multi-select (chips)" },
  { value: "photos", label: "Photos" },
  { value: "repeating-group", label: "Repeating group" },
  { value: "damage-list", label: "Damage / defect list" },
];

const OPTION_TYPES: TemplateFieldType[] = ["pill-select", "select-tiles", "color-select", "chip-multiselect"];
const NESTED_TYPES: TemplateFieldType[] = ["repeating-group", "damage-list"];

export const inputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: "7px",
  border: "1.5px solid #e5e7eb", background: "white",
  fontSize: "13px", color: "#1a2a4a", fontFamily: "Inter, -apple-system, sans-serif",
  outline: "none", boxSizing: "border-box",
};

function emptyField(order: number, sectionLetter?: string): TemplateField {
  return { key: "", label: "", type: "text", order, required: false, sectionLetter };
}

/** A, B, C, ... Z, AA, AB, ... -- the same "next column" sequence a spreadsheet uses. */
function nextLetter(letter: string): string {
  const chars = letter.split("");
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i] === "Z") {
      chars[i] = "A";
    } else {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join("");
    }
  }
  return "A" + chars.join("");
}

/**
 * A fresh Group letter for a brand-new cluster -- one past whatever plain
 * A/B/C-style letter is already the highest among these siblings, or "A" if
 * none of them have one yet. Used when a *repeating group* is added (it
 * starts its own container, distinct from whatever else is in the list) --
 * never for an ordinary leaf field, which should join an existing group
 * instead of starting a new one.
 */
function freshGroupLetter(siblings: TemplateField[]): string {
  const letterLike = siblings.map((f) => f.sectionLetter).filter((l): l is string => !!l && /^[A-Z]+$/.test(l));
  if (letterLike.length === 0) return "A";
  const max = letterLike.reduce((a, b) => (b.length > a.length || (b.length === a.length && b > a) ? b : a));
  return nextLetter(max);
}

/**
 * The Group letter a newly added *leaf* field should share -- every leaf
 * field in the same list is one group, never each its own. Reuses whatever
 * letter the list's other leaf siblings already carry (backfilling any that
 * don't have one yet, so they all read the same), or claims a fresh one if
 * this list has no leaf-field group yet (e.g. it's currently only repeating
 * groups, or completely empty). Repeating-group siblings are left alone --
 * each keeps its own letter from when it was created.
 */
function sharedLeafGroupLetter(siblings: TemplateField[]): { fields: TemplateField[]; letter: string } {
  const leafSiblings = siblings.filter((f) => !NESTED_TYPES.includes(f.type));
  if (leafSiblings.length === 0) return { fields: siblings, letter: freshGroupLetter(siblings) };
  const letter = leafSiblings.find((f) => f.sectionLetter)?.sectionLetter ?? "A";
  const backfilled = siblings.map((f) => (!NESTED_TYPES.includes(f.type) && !f.sectionLetter ? { ...f, sectionLetter: letter } : f));
  return { fields: backfilled, letter };
}

/**
 * Fixes up an entire field tree's Group letters once, top-down: each
 * repeating group keeps its own letter (assigning a fresh one if it's
 * missing one), every plain leaf alongside it shares that same letter (or,
 * at a section's own top level where there's no enclosing group, whatever
 * shared leaf letter the section's other top-level leaves use), and the
 * same two rules apply again inside each repeating group's own itemFields --
 * so a damage-list nested inside a Part gets a letter distinct from that
 * Part's own leaf fields, exactly as a top-level repeating group would.
 * Run once when a template loads (see AdminTemplateEditor below), so data
 * saved before this feature existed reads correctly immediately instead of
 * needing an edit to trigger a fix.
 */
function normalizeGroupLetters(fields: TemplateField[], containerLetter?: string): TemplateField[] {
  let next = fields;
  fields.forEach((f, i) => {
    if (NESTED_TYPES.includes(f.type) && !next[i].sectionLetter) {
      const letter = freshGroupLetter(next);
      next = next.map((g, j) => (j === i ? { ...g, sectionLetter: letter } : g));
    }
  });
  next = containerLetter
    ? next.map((f) => (NESTED_TYPES.includes(f.type) ? f : { ...f, sectionLetter: containerLetter }))
    : sharedLeafGroupLetter(next).fields;
  return next.map((f) =>
    NESTED_TYPES.includes(f.type) ? { ...f, itemFields: normalizeGroupLetters(f.itemFields ?? [], f.sectionLetter) } : f,
  );
}

/**
 * Recursive field-row-list editor. Leaf fields (text/date/select/etc) edit
 * inline exactly as before; repeating-group/damage-list fields grow an
 * expandable disclosure containing their repeat config + a nested instance
 * of this SAME component editing `itemFields` -- this is what gives
 * unlimited nesting depth (needed for InternalAreas' two levels: room
 * types containing addable instances containing a damage-list) without a
 * modal, so the admin never loses sight of the parent field.
 */
export function FieldListEditor({
  fields,
  onChange,
  disabled,
  depth = 0,
  sharedGroupLetter,
}: {
  fields: TemplateField[];
  onChange: (fields: TemplateField[]) => void;
  disabled: boolean;
  depth?: number;
  /**
   * Set when `fields` IS one repeating group's itemFields (never for a
   * section's own top-level list) -- every field added to the list from
   * here on must carry this exact Group letter, the container's own, not
   * one of its own choosing. Mismatches already sitting in loaded data
   * (from before this rule existed) are fixed once, up front, by
   * `normalizeGroupLetters` -- see AdminTemplateEditor's template fetch --
   * rather than reactively here, so a nested repeating group's *own* letter
   * (a damage-list inside a Part, say) can't get raced into matching its
   * container's instead of keeping its own.
   */
  sharedGroupLetter?: string;
}) {
  // Auto-expand every repeating-group / damage-list field so its itemFields
  // are visible by default — the user should never have to hunt for a chevron
  // to reveal the inner fields.
  const [expanded, setExpanded] = useState<Set<number>>(() =>
    new Set(fields.map((f, i) => (NESTED_TYPES.includes(f.type) ? i : -1)).filter((i) => i >= 0)),
  );

  function updateField(idx: number, patch: Partial<TemplateField>) {
    onChange(fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }
  function move(idx: number, dir: -1 | 1) {
    const swap = idx + dir;
    if (swap < 0 || swap >= fields.length) return;
    const next = [...fields];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next.map((f, i) => ({ ...f, order: i })));
  }
  function addField() {
    // Inside a repeating group's itemFields, every field -- new or old --
    // must carry the container's own letter.
    if (sharedGroupLetter) {
      onChange([...fields, emptyField(fields.length, sharedGroupLetter)]);
      return;
    }
    // A brand-new field always starts out as a plain "text" leaf -- it only
    // becomes its own group if the admin turns it into a repeating group
    // afterward (see the Type <select> below), so it joins the shared leaf
    // group here regardless of what else is in the list.
    const { fields: backfilled, letter } = sharedLeafGroupLetter(fields);
    onChange([...backfilled, emptyField(backfilled.length, letter)]);
  }
  function removeField(idx: number) {
    onChange(fields.filter((_, i) => i !== idx).map((f, i) => ({ ...f, order: i })));
  }
  function addOption(idx: number) {
    updateField(idx, { options: [...(fields[idx].options ?? []), { value: "", label: "" }] });
  }
  function updateOption(idx: number, optIdx: number, patch: Partial<{ value: string; label: string; icon: string; color: string }>) {
    const options = (fields[idx].options ?? []).map((o, i) => (i === optIdx ? { ...o, ...patch } : o));
    updateField(idx, { options });
  }
  function removeOption(idx: number, optIdx: number) {
    updateField(idx, { options: (fields[idx].options ?? []).filter((_, i) => i !== optIdx) });
  }
  function addFixedInstance(idx: number) {
    const repeat = fields[idx].repeat ?? { presentation: "strip" as const };
    updateField(idx, { repeat: { ...repeat, fixedInstances: [...(repeat.fixedInstances ?? []), { key: "", label: "" }] } });
  }
  function updateFixedInstance(idx: number, instIdx: number, patch: Partial<{ key: string; label: string }>) {
    const repeat = fields[idx].repeat;
    if (!repeat) return;
    const fixedInstances = (repeat.fixedInstances ?? []).map((f, i) => (i === instIdx ? { ...f, ...patch } : f));
    updateField(idx, { repeat: { ...repeat, fixedInstances } });
  }
  function removeFixedInstance(idx: number, instIdx: number) {
    const repeat = fields[idx].repeat;
    if (!repeat) return;
    updateField(idx, { repeat: { ...repeat, fixedInstances: (repeat.fixedInstances ?? []).filter((_, i) => i !== instIdx) } });
  }
  function toggleExpanded(idx: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  const priorKeys = (uptoIdx: number) => fields.slice(0, uptoIdx).map((f) => f.key).filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {fields.map((field, idx) => {
        const isNested = NESTED_TYPES.includes(field.type);
        const isOpen = expanded.has(idx);
        return (
          <div key={idx} style={{ background: depth > 0 ? "#f8fafc" : "white", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "14px 16px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap" }}>
              {isNested && (
                <button
                  onClick={() => toggleExpanded(idx)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "6px 2px", color: "#64748b" }}
                  title={isOpen ? "Collapse" : "Expand"}
                >
                  {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
              )}
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "3px" }}>Key</label>
                <input value={field.key} disabled={disabled} onChange={(e) => updateField(idx, { key: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ flex: "1 1 180px" }}>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "3px" }}>Label</label>
                <input value={field.label} disabled={disabled} onChange={(e) => updateField(idx, { label: e.target.value })} style={inputStyle} />
              </div>
              <div style={{ flex: "0 1 170px" }}>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "3px" }}>Type</label>
                <select
                  value={field.type}
                  disabled={disabled}
                  onChange={(e) => {
                    const type = e.target.value as TemplateFieldType;
                    const isNestedNow = NESTED_TYPES.includes(type);
                    updateField(idx, {
                      type,
                      repeat: isNestedNow ? (field.repeat ?? { presentation: "strip" }) : undefined,
                      itemFields: isNestedNow ? field.itemFields ?? [] : undefined,
                      // A repeating group is its own container -- becoming one
                      // always claims a fresh Group letter, distinct from
                      // whatever this field shared before (e.g. as a plain
                      // leaf) and from every other repeating group already
                      // in this list.
                      ...(isNestedNow ? { sectionLetter: freshGroupLetter(fields) } : {}),
                    });
                    // Auto-expand when switching to a nested type so itemFields are immediately visible.
                    if (isNestedNow) setExpanded((prev) => new Set([...prev, idx]));
                  }}
                  style={inputStyle}
                >
                  {LEAF_FIELD_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#374151", paddingBottom: "8px" }}>
                <input type="checkbox" checked={!!field.required} disabled={disabled} onChange={(e) => updateField(idx, { required: e.target.checked })} />
                Required
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#374151", paddingBottom: "8px" }}>
                <input type="checkbox" checked={!!field.readOnly} disabled={disabled} onChange={(e) => updateField(idx, { readOnly: e.target.checked })} />
                Read-only
              </label>
              {field.type === "chip-multiselect" && (
                <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#374151", paddingBottom: "8px" }}>
                  <input type="checkbox" checked={!!field.allowOther} disabled={disabled} onChange={(e) => updateField(idx, { allowOther: e.target.checked })} />
                  Allow "Other"
                </label>
              )}
              <div style={{ flex: "0 1 70px" }}>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "3px" }}>Group</label>
                <input
                  placeholder="A"
                  value={field.sectionLetter ?? ""}
                  disabled={disabled}
                  onChange={(e) => updateField(idx, { sectionLetter: e.target.value || undefined })}
                  style={inputStyle}
                />
              </div>
              {!disabled && (
                <div style={{ display: "flex", gap: "4px", paddingBottom: "4px" }}>
                  <IconBtn onClick={() => move(idx, -1)} disabled={idx === 0}><ArrowUp size={13} /></IconBtn>
                  <IconBtn onClick={() => move(idx, 1)} disabled={idx === fields.length - 1}><ArrowDown size={13} /></IconBtn>
                  <IconBtn onClick={() => removeField(idx)} danger><Trash2 size={13} /></IconBtn>
                </div>
              )}
            </div>

            {/* Gate: show this field only when an earlier sibling equals a value */}
            {priorKeys(idx).length > 0 && (
              <div style={{ marginTop: "10px", display: "flex", gap: "8px", alignItems: "center", fontSize: "12px", color: "#64748b" }}>
                <span>Show only when</span>
                <select
                  value={field.gate?.fieldKey ?? ""}
                  disabled={disabled}
                  onChange={(e) =>
                    updateField(idx, e.target.value ? { gate: { fieldKey: e.target.value, equals: field.gate?.equals ?? "yes" } } : { gate: undefined })
                  }
                  style={{ ...inputStyle, width: "auto" }}
                >
                  <option value="">(always shown)</option>
                  {priorKeys(idx).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                {field.gate && (
                  <>
                    <span>equals</span>
                    <input
                      value={field.gate.equals}
                      disabled={disabled}
                      onChange={(e) => updateField(idx, { gate: { fieldKey: field.gate!.fieldKey, equals: e.target.value } })}
                      style={{ ...inputStyle, width: "100px" }}
                    />
                  </>
                )}
              </div>
            )}

            {/* Options editor for select-type leaf fields */}
            {OPTION_TYPES.includes(field.type) && (
              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #f1f5f9" }}>
                <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "6px" }}>Options</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {(field.options ?? []).map((opt, optIdx) => (
                    <div key={optIdx} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <input placeholder="value" value={opt.value} disabled={disabled} onChange={(e) => updateOption(idx, optIdx, { value: e.target.value })} style={{ ...inputStyle, flex: "0 1 110px" }} />
                      <input placeholder="label" value={opt.label} disabled={disabled} onChange={(e) => updateOption(idx, optIdx, { label: e.target.value })} style={{ ...inputStyle, flex: "1 1 140px" }} />
                      {field.type === "select-tiles" && (
                        <input placeholder="icon" value={opt.icon ?? ""} disabled={disabled} onChange={(e) => updateOption(idx, optIdx, { icon: e.target.value })} style={{ ...inputStyle, flex: "1 1 120px" }} />
                      )}
                      {field.type === "color-select" && (
                        <input placeholder="#hex color" value={opt.color ?? ""} disabled={disabled} onChange={(e) => updateOption(idx, optIdx, { color: e.target.value })} style={{ ...inputStyle, flex: "1 1 110px" }} />
                      )}
                      {!disabled && <IconBtn onClick={() => removeOption(idx, optIdx)} danger><Trash2 size={12} /></IconBtn>}
                    </div>
                  ))}
                  {!disabled && (
                    <button onClick={() => addOption(idx)} style={{ alignSelf: "flex-start", fontSize: "11px", color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontWeight: 600 }}>
                      + Add option
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Repeat config + nested itemFields editor for repeating-group/damage-list */}
            {isNested && isOpen && (
              <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #f1f5f9" }}>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
                  <div style={{ flex: "0 1 160px" }}>
                    <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "3px" }}>Presentation</label>
                    <select
                      value={field.repeat?.presentation ?? "strip"}
                      disabled={disabled}
                      onChange={(e) => updateField(idx, { repeat: { ...(field.repeat ?? { presentation: "strip" }), presentation: e.target.value as "strip" | "fixed-tabs" | "nested" | "checklist" } })}
                      style={inputStyle}
                    >
                      <option value="strip">Strip (scrollable, addable)</option>
                      <option value="fixed-tabs">Fixed tabs (not addable)</option>
                      <option value="nested">Nested (fixed types, addable instances)</option>
                      <option value="checklist">Checklist (fixed rows)</option>
                    </select>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", color: "#374151", paddingBottom: "8px" }}>
                    <input
                      type="checkbox"
                      checked={!!field.repeat?.addable}
                      disabled={disabled}
                      onChange={(e) => updateField(idx, { repeat: { ...(field.repeat ?? { presentation: "strip" }), addable: e.target.checked } })}
                    />
                    Addable
                  </label>
                  {field.repeat?.addable && (
                    <div style={{ flex: "1 1 180px" }}>
                      <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "3px" }}>Add-button label</label>
                      <input
                        value={field.repeat?.addButtonLabel ?? ""}
                        disabled={disabled}
                        onChange={(e) => updateField(idx, { repeat: { ...(field.repeat ?? { presentation: "strip" }), addButtonLabel: e.target.value } })}
                        style={inputStyle}
                      />
                    </div>
                  )}
                </div>

                {(field.repeat?.presentation === "fixed-tabs" || field.repeat?.presentation === "nested" || field.repeat?.presentation === "checklist") && (
                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "6px" }}>
                      {field.repeat.presentation === "checklist" ? "Rows" : "Fixed instances"}
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {(field.repeat.fixedInstances ?? []).map((inst, instIdx) => (
                        <div key={instIdx} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <input placeholder="key" value={inst.key} disabled={disabled} onChange={(e) => updateFixedInstance(idx, instIdx, { key: e.target.value })} style={{ ...inputStyle, flex: "0 1 140px" }} />
                          <input placeholder="label" value={inst.label} disabled={disabled} onChange={(e) => updateFixedInstance(idx, instIdx, { label: e.target.value })} style={{ ...inputStyle, flex: "1 1 180px" }} />
                          {!disabled && <IconBtn onClick={() => removeFixedInstance(idx, instIdx)} danger><Trash2 size={12} /></IconBtn>}
                        </div>
                      ))}
                      {!disabled && (
                        <button onClick={() => addFixedInstance(idx)} style={{ alignSelf: "flex-start", fontSize: "11px", color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontWeight: 600 }}>
                          + Add {field.repeat.presentation === "checklist" ? "row" : "instance"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <label style={{ fontSize: "10px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "6px" }}>
                  Fields within each {field.type === "damage-list" ? "damage record" : "instance"}
                </label>
                <FieldListEditor
                  fields={field.itemFields ?? []}
                  onChange={(itemFields) => updateField(idx, { itemFields })}
                  disabled={disabled}
                  depth={depth + 1}
                  sharedGroupLetter={field.sectionLetter}
                />
                {!disabled && (
                  <button
                    onClick={() => {
                      // Every field inside this repeating group shares its
                      // container's own Group letter -- assign the group
                      // itself one now if it doesn't have one yet (e.g. it
                      // predates this feature), and bring any of its existing
                      // fields that fell out of sync back to match.
                      const groupLetter = field.sectionLetter ?? freshGroupLetter(fields);
                      const itemFields = (field.itemFields ?? []).map((f) => ({ ...f, sectionLetter: groupLetter }));
                      updateField(idx, {
                        sectionLetter: groupLetter,
                        itemFields: [...itemFields, emptyField(itemFields.length, groupLetter)],
                      });
                    }}
                    style={{ marginTop: "10px", fontSize: "11px", color: "#2563eb", background: "none", border: "none", cursor: "pointer", padding: "4px 0", fontWeight: 600 }}
                  >
                    + Add field to {field.type === "damage-list" ? "damage record" : "instance"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!disabled && (
        <button
          onClick={addField}
          style={{
            padding: "9px 16px", borderRadius: "8px", background: "white",
            border: "1.5px dashed #cbd5e1", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "6px",
            color: "#64748b", fontSize: "12px", fontWeight: 600, alignSelf: "flex-start",
          }}
        >
          <Plus size={14} /> Add Field
        </button>
      )}
    </div>
  );
}

export function AdminTemplateEditor() {
  const { inspectionType, propertyType, sectionKey, id } = useParams<{
    inspectionType: string; propertyType: string; sectionKey: string; id: string;
  }>();
  const navigate = useNavigate();
  const [template, setTemplate] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.getTemplate(id).then((t) => {
      setTemplate(t);
      setName(t.name);
      setFields(normalizeGroupLetters([...t.fields].sort((a, b) => a.order - b.order)));
    });
  }, [id]);

  if (!template) {
    return (
      <PageShell title="Template">
        <p style={{ color: "#94a3b8", fontSize: "13px" }}>Loading…</p>
      </PageShell>
    );
  }

  const isDraft = template.status === "draft";
  const sc = TEMPLATE_STATUS_CONFIG[template.status];
  const backTo = `/admin/templates/${inspectionType}/${propertyType}`;

  async function saveDraft() {
    if (!id) return;
    setSaving(true);
    try {
      const updated = await api.updateTemplate(id, { name, fields });
      setTemplate(updated);
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!id || !template) return;
    if (!confirm(`Publish v${template.version}? This becomes the active template new inspections use.`)) return;
    setPublishing(true);
    try {
      await saveDraft();
      await api.publishTemplate(id);
      navigate(backTo);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <PageShell
      title={name || "Template"}
      subtitle={`${sectionKey} — ${inspectionType} / ${propertyType}`}
      actions={
        <>
          <StatusBadge label={`v${template.version} · ${sc.label}`} color={sc.color} bg={sc.bg} />
          <button
            onClick={() => navigate(backTo)}
            style={{
              height: "32px", padding: "0 12px", borderRadius: "8px", background: "white",
              border: "1px solid #e5e7eb", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
              color: "#374151", fontSize: "12px", fontWeight: 600,
            }}
          >
            <ArrowLeft size={14} /> Back
          </button>
        </>
      }
    >
      {!isDraft && (
        <div style={{ background: "#fef3c7", border: "1px solid #fde68a", borderRadius: "10px", padding: "10px 14px", marginBottom: "16px", fontSize: "12px", color: "#92400e" }}>
          This version is {template.status} and read-only. Go back and click "Continue Draft" / "Edit" to make changes.
        </div>
      )}

      <div style={{ marginBottom: "16px" }}>
        <label style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: "4px" }}>
          Template Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isDraft}
          style={{ ...inputStyle, maxWidth: "360px" }}
        />
      </div>

      <div style={{ marginBottom: "20px" }}>
        <FieldListEditor fields={fields} onChange={setFields} disabled={!isDraft} />
      </div>

      {isDraft && (
        <div style={{ display: "flex", gap: "10px", paddingTop: "16px", borderTop: "1px solid #e5e7eb" }}>
          <button
            onClick={saveDraft}
            disabled={saving || publishing}
            style={{
              padding: "10px 18px", borderRadius: "8px", background: "white", border: "1px solid #e5e7eb",
              color: "#374151", fontSize: "13px", fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "7px",
            }}
          >
            <Save size={14} /> {saving ? "Saving…" : "Save Draft"}
          </button>
          <button
            onClick={publish}
            disabled={saving || publishing}
            style={{
              padding: "10px 18px", borderRadius: "8px", background: "#1a2a4a", border: "none",
              color: "white", fontSize: "13px", fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: "7px",
            }}
          >
            <Send size={14} /> {publishing ? "Publishing…" : `Publish v${template.version}`}
          </button>
        </div>
      )}
    </PageShell>
  );
}

function IconBtn({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "26px", height: "26px", borderRadius: "6px",
        background: danger ? "#fef2f2" : "#f8fafc",
        border: `1px solid ${danger ? "#fecaca" : "#e5e7eb"}`,
        color: disabled ? "#cbd5e1" : danger ? "#dc2626" : "#64748b",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}
