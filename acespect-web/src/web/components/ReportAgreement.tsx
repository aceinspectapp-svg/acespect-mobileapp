import { AGREEMENT_BLOCKS, AGREEMENT_TITLE, type AgreementBlock } from "../reportAgreement";
import { PageTitle, reportTextStyle, reportTokens } from "./reportKit";

// The template's hanging indents: clause numbers (1, 1.1) in one gutter, lettered items ((a)) indented under their clause,
// definitions and the grade list indented under the clause that introduces them.
const NUM_W = 40;
const ITEM_INDENT = NUM_W + 10;
const ITEM_W = 30;

const para = { margin: 0, flex: 1, textAlign: "justify" as const, lineHeight: 1.45 };

function Block({ b }: { b: AgreementBlock }) {
  switch (b.kind) {
    case "section":
      return (
        <div style={{ display: "flex", gap: "10px", fontWeight: 700, color: reportTokens.ink, margin: "16px 0 7px", breakAfter: "avoid" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0 }}>{b.n}.</span>
          <span>{b.title}</span>
        </div>
      );
    case "subheading":
      return <div style={{ fontWeight: 700, fontStyle: "italic", color: reportTokens.ink, margin: "12px 0 6px", paddingLeft: `${ITEM_INDENT}px`, breakAfter: "avoid" }}>{b.text}</div>;
    case "clause":
      return (
        <div style={{ display: "flex", gap: "10px", margin: "0 0 7px" }}>
          <span style={{ width: `${NUM_W}px`, flexShrink: 0, color: reportTokens.ink }}>{b.n}</span>
          <p style={para}>{b.text}</p>
        </div>
      );
    case "item":
      return (
        <div style={{ display: "flex", gap: "6px", margin: "0 0 5px", paddingLeft: `${ITEM_INDENT}px` }}>
          <span style={{ width: `${ITEM_W}px`, flexShrink: 0, color: reportTokens.ink }}>{b.n}</span>
          <p style={para}>{b.text}</p>
        </div>
      );
    case "definition":
      return <p style={{ ...para, margin: "0 0 6px", paddingLeft: `${ITEM_INDENT}px` }}>{b.text}</p>;
    case "grade":
      return <p style={{ ...para, margin: "0 0 3px", paddingLeft: `${ITEM_INDENT + ITEM_W + 6}px` }}>{b.text}</p>;
    case "para":
      return <p style={{ ...para, margin: "0 0 8px" }}>{b.text}</p>;
  }
}

/**
 * An Agreement: "Conditions for the Provision of the Report and Scope". The Dilapidation one by default; a Construction report passes its
 * own wording (construction/agreementText.ts). `compact` shrinks it for the panel.
 */
export function ReportAgreement({ compact = false, title = AGREEMENT_TITLE, blocks = AGREEMENT_BLOCKS }: { compact?: boolean; title?: string; blocks?: AgreementBlock[] }) {
  return (
    <div style={reportTextStyle(compact, { normal: "12px", compact: "11px" })}>
      <PageTitle compact={compact}>{title}</PageTitle>
      {keepWithNext(blocks).map((run, i) =>
        run.length === 1 ? <Block key={i} b={run[0]!} /> : (
          // A clause heading (or a clause 4 sub-heading) is kept on one page with what follows it, never left alone at a page bottom.
          <div key={i} style={{ breakInside: "avoid" }}>{run.map((b, j) => <Block key={j} b={b} />)}</div>
        ),
      )}
    </div>
  );
}

/** The blocks in runs that print together: a heading with the next block after it (a section heading and a sub-heading in a row stay with the clause after both). */
function keepWithNext(blocks: AgreementBlock[]): AgreementBlock[][] {
  const runs: AgreementBlock[][] = [];
  let pending: AgreementBlock[] = [];
  for (const b of blocks) {
    pending.push(b);
    if (b.kind === "section" || b.kind === "subheading") continue;
    runs.push(pending);
    pending = [];
  }
  if (pending.length) runs.push(pending);
  return runs;
}
