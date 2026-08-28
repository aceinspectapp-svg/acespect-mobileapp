import { CONDITIONS, CONDITIONS_TITLE, type ConditionClause } from "../reportConditions";
import { reportTextStyle, reportTokens } from "./reportKit";

function Clause({ c }: { c: ConditionClause }) {
  return (
    <div style={{ display: "flex", gap: "10px", margin: "0 0 11px" }}>
      <span style={{ width: "30px", flexShrink: 0, color: reportTokens.inkMuted }}>{c.n}.</span>
      <div style={{ flex: 1 }}>
        {c.text && <p style={{ margin: 0, textAlign: "justify", lineHeight: 1.6 }}>{c.text}</p>}
        {c.items?.map((it) => (
          <div key={it.label} style={{ display: "flex", gap: "8px", margin: "6px 0 0", paddingLeft: "18px" }}>
            <span style={{ width: "26px", flexShrink: 0, color: reportTokens.inkMuted }}>{it.label}</span>
            <p style={{ margin: 0, flex: 1, textAlign: "justify", lineHeight: 1.6 }}>{it.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Standard "Conditions for the Provision of the Report" appendix. */
export function ReportConditions({ compact = false }: { compact?: boolean }) {
  return (
    <div style={reportTextStyle(compact, { normal: "14px", compact: "11.5px" })}>
      <h2
        style={{
          textAlign: "center",
          fontWeight: 800,
          color: reportTokens.accent,
          fontSize: compact ? "14px" : "18px",
          letterSpacing: "0.02em",
          margin: "8px 0 20px",
          paddingBottom: "10px",
          borderBottom: `2px solid ${reportTokens.accent}`,
        }}
      >
        {CONDITIONS_TITLE}
      </h2>
      {CONDITIONS.map((c) => (
        <Clause key={c.n} c={c} />
      ))}
    </div>
  );
}
