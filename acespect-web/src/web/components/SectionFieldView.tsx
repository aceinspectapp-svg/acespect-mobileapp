import {
  AnswerTree,
  AnswerValue,
  TemplateField,
  asAnswerTree,
  asStringArray,
  displayValue,
  isGateSatisfied,
  resolveInstances,
} from "../templateFields";

/**
 * Read-only, template-driven view of a section's captured answers — the
 * same fields, in the same order and grouping, that the inspector filled
 * in on the mobile app. Replaces a flat "key: value" dump (which only ever
 * showed top-level scalar fields, so anything inside a repeating-group or
 * damage-list was invisible here even though it was captured on mobile).
 */
export function SectionFieldView({ fields, scope }: { fields: TemplateField[]; scope: AnswerTree }) {
  const visible = [...fields].filter((f) => isGateSatisfied(f, scope)).sort((a, b) => a.order - b.order);
  if (visible.length === 0) {
    return <p style={{ padding: "16px", fontSize: "13px", color: "#94a3b8", textAlign: "center" }}>No data recorded</p>;
  }
  let lastLetter: string | undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
      {visible.map((field, idx) => {
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
                  margin: idx === 0 ? "0 0 8px" : "14px 0 8px",
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
            <FieldRow field={field} value={scope[field.key]} isLast={idx === visible.length - 1} />
          </div>
        );
      })}
    </div>
  );
}

function FieldRow({
  field,
  value,
  isLast,
}: {
  field: TemplateField;
  value: AnswerValue;
  isLast: boolean;
}) {
  if (field.type === "photos") {
    const uris = asStringArray(value);
    if (uris.length === 0) return null;
    return (
      <div style={{ padding: "10px 16px", borderBottom: isLast ? "none" : "1px solid #f1f5f9" }}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", margin: "0 0 8px" }}>{field.label}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: "6px" }}>
          {uris.map((u, i) => (
            <img key={i} src={u} alt="" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: "8px", border: "1px solid #e5e7eb" }} />
          ))}
        </div>
      </div>
    );
  }

  if (field.type === "repeating-group" || field.type === "damage-list") {
    const instances = resolveInstances(field, value);
    return (
      <div style={{ padding: "12px 16px", borderBottom: isLast ? "none" : "1px solid #f1f5f9" }}>
        <p style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", margin: "0 0 8px" }}>
          {field.label} {instances.length > 0 && `(${instances.length})`}
        </p>
        {instances.length === 0 ? (
          <p style={{ fontSize: "12px", color: "#c1c9d4", margin: 0 }}>None recorded</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {instances.map((inst, i) => (
              <div key={i} style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ padding: "8px 12px", background: "white", borderBottom: "1px solid #f1f5f9" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#1a2a4a" }}>{inst.label}</span>
                </div>
                <div style={{ padding: "0 0" }}>
                  <SectionFieldView fields={field.itemFields ?? []} scope={inst.scope} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const text = displayValue(field, value);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "12px",
        padding: "10px 16px",
        borderBottom: isLast ? "none" : "1px solid #f1f5f9",
      }}
    >
      <span style={{ fontSize: "11px", fontWeight: 600, color: "#94a3b8", minWidth: "140px", flexShrink: 0, paddingTop: "1px" }}>
        {field.label}
        {field.unit ? ` (${field.unit})` : ""}
      </span>
      <span style={{ fontSize: "13px", fontWeight: 500, color: text === "—" ? "#c1c9d4" : "#1a2a4a" }}>{text}</span>
    </div>
  );
}
