/** The template's numbered SCOPE / DEFECTS / Condition Definitions text (scopeText.ts), set as the template sets it: clause numbers in one gutter, lettered items under their clause. */
import type { ScopeBlock } from "./scopeText";

const NUM_W = 40;
const ITEM_INDENT = NUM_W + 10;
const ITEM_W = 30;
const para = { margin: 0, textAlign: "justify" as const, lineHeight: 1.45 };

function Block({ b }: { b: ScopeBlock }) {
  switch (b.kind) {
    case "section":
      return (
        <div data-scope="section" style={{ display: "flex", gap: "10px", fontWeight: 700, margin: "16px 0 7px", breakAfter: "avoid" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0 }}>{b.n}</span>
          <span>{b.title}</span>
        </div>
      );
    case "subheading":
      return <div data-scope="subheading" style={{ fontWeight: 700, margin: "12px 0 6px", breakAfter: "avoid" }}>{b.text}</div>;
    case "clause":
      return (
        <div data-scope="clause" style={{ display: "flex", gap: "10px", margin: "0 0 7px" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0 }}>{b.n}</span>
          <div style={{ flex: 1 }}>
            {b.term && <p style={{ ...para, fontWeight: 700 }}>{b.term}</p>}
            {b.paras.map((t, i) => <p key={i} style={{ ...para, margin: i < b.paras.length - 1 ? "0 0 6px" : 0 }}>{t}</p>)}
          </div>
        </div>
      );
    case "item":
      return (
        <div data-scope="item" style={{ display: "flex", gap: "6px", margin: "0 0 5px", paddingLeft: `${ITEM_INDENT}px` }}>
          <span style={{ width: `${ITEM_W}px`, flexShrink: 0 }}>{b.n}</span>
          <p style={{ ...para, flex: 1 }}>{b.text}</p>
        </div>
      );
    case "bullet":
      return (
        <div data-scope="bullet" style={{ display: "flex", gap: "8px", margin: "0 0 3px", paddingLeft: `${ITEM_INDENT}px` }}>
          <span aria-hidden style={{ flexShrink: 0 }}>•</span>
          <p style={{ ...para, flex: 1 }}>{b.text}</p>
        </div>
      );
    case "para":
      return <p data-scope="para" style={{ ...para, margin: "0 0 8px" }}>{b.text}</p>;
    case "term":
      return <p data-scope="term" style={{ ...para, margin: "0 0 8px" }}><strong>{b.term}</strong> - {b.text}</p>;
    case "definition":
      return <p data-scope="definition" style={{ ...para, margin: "0 0 5px", paddingLeft: `${ITEM_INDENT}px` }}><strong>{b.term}</strong> {b.text}</p>;
  }
}

/** The blocks; a heading is kept on one page with the block after it. */
export function ScopeBlocks({ blocks }: { blocks: ScopeBlock[] }) {
  const runs: ScopeBlock[][] = [];
  let pending: ScopeBlock[] = [];
  for (const b of blocks) {
    pending.push(b);
    if (b.kind === "section" || b.kind === "subheading") continue;
    runs.push(pending);
    pending = [];
  }
  if (pending.length) runs.push(pending);
  return (
    <div style={{ fontSize: "12px" }}>
      {runs.map((run, i) => (run.length === 1 ? <Block key={i} b={run[0]!} /> : <div key={i} style={{ breakInside: "avoid" }}>{run.map((b, j) => <Block key={j} b={b} />)}</div>))}
    </div>
  );
}
