import { SCOPE_BLOCKS, SCOPE_TITLE, type ScopeBlock } from "../reportScope";
import { reportTextStyle, reportTokens } from "./reportKit";

const NUM_W = 40; // left gutter for clause numbers
const LIST_LABEL_W = 26;

function Block({ block }: { block: ScopeBlock }) {
  switch (block.kind) {
    case "section":
      return (
        <div style={{ display: "flex", gap: "10px", fontWeight: 700, color: reportTokens.accent, margin: "22px 0 9px" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0 }}>{block.n}.</span>
          <span style={{ letterSpacing: "0.02em" }}>{block.title}</span>
        </div>
      );
    case "subheading":
      return (
        <div style={{ display: "flex", gap: "10px", margin: "12px 0 6px" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0, fontWeight: 700, color: reportTokens.inkMuted }}>{block.n}</span>
          <span style={{ fontWeight: 700 }}>{block.title}</span>
        </div>
      );
    case "clause":
      return (
        <div style={{ display: "flex", gap: "10px", margin: "0 0 10px" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0, color: reportTokens.inkMuted }}>{block.n}</span>
          <p style={{ margin: 0, flex: 1, textAlign: "justify", lineHeight: 1.6 }}>{block.text}</p>
        </div>
      );
    case "para":
      return (
        <p style={{ margin: "0 0 10px", paddingLeft: `${NUM_W + 10}px`, textAlign: "justify", lineHeight: 1.6 }}>
          {block.text}
        </p>
      );
    case "list":
      return (
        <div style={{ paddingLeft: `${NUM_W + 10}px`, margin: "0 0 10px" }}>
          {block.intro && <p style={{ margin: "0 0 6px", textAlign: "justify", lineHeight: 1.6 }}>{block.intro}</p>}
          {block.items.map((it) => (
            <div key={it.label} style={{ display: "flex", gap: "8px", margin: "0 0 6px" }}>
              <span style={{ width: `${LIST_LABEL_W}px`, flexShrink: 0, color: reportTokens.inkMuted }}>{it.label}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, textAlign: "justify", lineHeight: 1.6 }}>{it.text}</p>
                {it.note && (
                  <p style={{ margin: "3px 0 0", paddingLeft: "16px", lineHeight: 1.5, color: reportTokens.inkMuted }}>
                    {it.note}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      );
  }
}

/** The standard SCOPE / limitations appendix. `compact` shrinks it for the panel. */
export function ReportScope({ compact = false }: { compact?: boolean }) {
  return (
    <div style={reportTextStyle(compact, { normal: "14px", compact: "11.5px" })}>
      <h2
        style={{
          textAlign: "center",
          fontWeight: 800,
          color: reportTokens.accent,
          fontSize: compact ? "16px" : "22px",
          letterSpacing: "0.02em",
          margin: "8px 0 20px",
          paddingBottom: "10px",
          borderBottom: `2px solid ${reportTokens.accent}`,
        }}
      >
        {SCOPE_TITLE}
      </h2>
      {SCOPE_BLOCKS.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </div>
  );
}
