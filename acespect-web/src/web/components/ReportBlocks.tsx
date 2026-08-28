import type { ExtBlock } from "../reportExternal";
import { Blank, Chip, Heading, Para, Placeholder, reportTextStyle, SectionBand } from "./reportKit";

/** Render template text, turning each "{}" token into a Blank. */
function Templated({ text }: { text: string }) {
  const parts = text.split("{}");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <Blank />}
        </span>
      ))}
    </>
  );
}

function Block({ block, compact }: { block: ExtBlock; compact: boolean }) {
  switch (block.kind) {
    case "banner":
      return (
        <SectionBand compact={compact} tone="accent">
          {block.title}
        </SectionBand>
      );
    case "floor":
      return (
        <SectionBand compact={compact} tone="neutral">
          {block.title}
        </SectionBand>
      );
    case "heading":
      return (
        <Heading level={3}>
          {block.title}
          {block.admin && <Chip>{block.admin}</Chip>}
        </Heading>
      );
    case "subheading":
      return (
        <p style={{ fontWeight: 700, margin: "12px 0 6px" }}>{block.title}</p>
      );
    case "para":
      return (
        <Para>
          <Templated text={block.text} />
        </Para>
      );
    case "fill":
      return <Placeholder>{block.text}</Placeholder>;
    case "italic":
      return (
        <p style={{ fontStyle: "italic", color: "#444", margin: "0 0 10px", textAlign: "justify", lineHeight: 1.6 }}>
          {block.text}
        </p>
      );
  }
}

/** Renders a list of template blocks (shared by EXTERNAL and INTERNAL). */
export function ReportBlocks({ blocks, compact = false }: { blocks: ExtBlock[]; compact?: boolean }) {
  return (
    <div style={reportTextStyle(compact, { normal: "14px", compact: "11.5px" })}>
      {blocks.map((b, i) => (
        <Block key={i} block={b} compact={compact} />
      ))}
    </div>
  );
}
