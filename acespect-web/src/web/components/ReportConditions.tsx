import { CONDITIONS, CONDITIONS_TITLE, type ConditionClause } from "../reportConditions";
import { reportTextStyle, reportTokens } from "./reportKit";

// Wider hanging indent than Scope's clause numbers -- matches the reference,
// where Conditions numbers sit further from the text than Scope's do.
const NUM_W = 34;

function Clause({ c }: { c: ConditionClause }) {
  return (
    <div style={{ display: "flex", gap: "16px", margin: "0 0 10px" }}>
      <span style={{ width: `${NUM_W}px`, flexShrink: 0, color: reportTokens.ink }}>{c.n}.</span>
      <div style={{ flex: 1 }}>
        {c.text && <p style={{ margin: 0, textAlign: "justify", lineHeight: 1.5 }}>{c.text}</p>}
        {c.items?.map((it) => (
          <div key={it.label} style={{ display: "flex", gap: "8px", margin: "5px 0 0", paddingLeft: "18px" }}>
            <span style={{ width: "26px", flexShrink: 0, color: reportTokens.ink }}>{it.label}</span>
            <p style={{ margin: 0, flex: 1, textAlign: "justify", lineHeight: 1.5 }}>{it.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Standard "Conditions for the Provision of the Report" appendix. */
export function ReportConditions({ compact = false }: { compact?: boolean }) {
  return (
    <div style={reportTextStyle(compact, { normal: "12.5px", compact: "11px" })}>
      <h2
        style={{
          textAlign: "center",
          fontWeight: 700,
          color: reportTokens.ink,
          fontSize: compact ? "13px" : "16px",
          margin: "8px 0 16px",
          textDecoration: "underline",
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
