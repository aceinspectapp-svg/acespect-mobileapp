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
      // The template sets the gradings of clause 5.7(e) as a bulleted list.
      return (
        <div style={{ display: "flex", gap: "8px", margin: "0 0 3px", paddingLeft: `${ITEM_INDENT + ITEM_W + 6}px` }}>
          <span aria-hidden style={{ flexShrink: 0, color: reportTokens.ink }}>•</span>
          <p style={{ ...para, margin: 0 }}>{b.text}</p>
        </div>
      );
    case "para":
      return <p style={{ ...para, margin: "0 0 8px" }}>{b.text}</p>;
  }
}

/** The Dilapidation / Residential House Agreement: "Conditions for the Provision of the Report and Scope". `compact` shrinks it for the panel. */
export function ReportAgreement({ compact = false }: { compact?: boolean }) {
  return (
    <div style={reportTextStyle(compact, { normal: "12px", compact: "11px" })}>
      <PageTitle compact={compact}>{AGREEMENT_TITLE}</PageTitle>
      {AGREEMENT_BLOCKS.map((b, i) => (
        <Block key={i} b={b} />
      ))}
    </div>
  );
}
