import { SCOPE_BLOCKS, SCOPE_TITLE, type ScopeBlock } from "../reportScope";
import { reportTextStyle, reportTokens } from "./reportKit";

const NUM_W = 40; // left gutter for clause numbers
const LIST_LABEL_W = 26;

function Block({ block }: { block: ScopeBlock }) {
  switch (block.kind) {
    case "section":
      return (
        <div style={{ display: "flex", gap: "10px", fontWeight: 700, color: reportTokens.ink, margin: "18px 0 7px" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0 }}>{block.n}.</span>
          <span>{block.title}</span>
        </div>
      );
    case "subheading":
      // Not bold in the reference (e.g. 7.1 / 7.3 / 7.5 / 7.6) -- only the
      // top-level numbered section headings above are.
      return (
        <div style={{ display: "flex", gap: "10px", margin: "10px 0 5px" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0, color: reportTokens.ink }}>{block.n}</span>
          <span>{block.title}</span>
        </div>
      );
    case "clause":
      return (
        <div style={{ display: "flex", gap: "10px", margin: "0 0 8px" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0, color: reportTokens.ink }}>{block.n}</span>
          <p style={{ margin: 0, flex: 1, textAlign: "left", lineHeight: 1.4 }}>{block.text}</p>
        </div>
      );
    case "para":
      // Starts at the left margin, not indented under the heading -- only
      // sub-clauses (above) and list items (below) are indented.
      return <p style={{ margin: "0 0 8px", textAlign: "left", lineHeight: 1.4 }}>{block.text}</p>;
    case "list":
      return (
        <div style={{ margin: "0 0 8px" }}>
          {block.intro && <p style={{ margin: "0 0 5px", textAlign: "left", lineHeight: 1.4 }}>{block.intro}</p>}
          {block.items.map((it, i) => (
            // Index, not `it.label` -- most lists use a unique lettered
            // label ("a)", "b)", ...), but the Houspect grading list below
            // (New/Satisfactory/Fair/...) uses the same plain "●" bullet for
            // every item, which produced duplicate keys within that one
            // list's own items array. `SCOPE_BLOCKS` is static, hardcoded
            // data that's never reordered or edited at runtime, so an index
            // key is safe here.
            <div key={i} style={{ display: "flex", gap: "8px", margin: "0 0 5px" }}>
              <span style={{ width: `${LIST_LABEL_W}px`, flexShrink: 0, color: reportTokens.ink }}>{it.label}</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, textAlign: "left", lineHeight: 1.4 }}>{it.text}</p>
                {it.note && (
                  <p style={{ margin: "3px 0 0", paddingLeft: "16px", lineHeight: 1.4, color: reportTokens.ink }}>
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
    <div style={reportTextStyle(compact, { normal: "12.5px", compact: "11px" })}>
      <h2
        style={{
          textAlign: "center",
          fontWeight: 700,
          color: reportTokens.ink,
          fontSize: compact ? "15px" : "20px",
          margin: "8px 0 16px",
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
