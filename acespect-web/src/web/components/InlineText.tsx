import { Fragment, type ReactNode } from "react";
import { hasInline, parseInline } from "../textEdits";

/**
 * A paragraph's words with the reviewer's formatting drawn (**bold**, *italic*, __underline__ -- see textEdits.ts). Text without any
 * marks is returned as it is. `link` fills the "[Click here]" slot a Description sentence can carry.
 */
export function InlineText({ text, link }: { text: string; link?: ReactNode }): ReactNode {
  if (!hasInline(text)) return text;
  return parseInline(text).map((r, i) => {
    if (r.link) return <Fragment key={i}>{link ?? "Click here"}</Fragment>;
    let node: ReactNode = r.text;
    if (r.underline) node = <u>{node}</u>;
    if (r.italic) node = <em>{node}</em>;
    if (r.bold) node = <strong>{node}</strong>;
    return <Fragment key={i}>{node}</Fragment>;
  });
}
