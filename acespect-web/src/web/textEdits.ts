/**
 * The reviewer's own wording of a section's report text.
 *
 * A section's report text is written from the inspector's answers (templateFields.ts + wording/). A reviewer can retype any of its
 * paragraphs, remove one or add their own. Those changes are remembered apart from the text, as "this generated line -> what the reviewer
 * made of it", so that when the text is written again from the answers (a Field Data save, a photo moved) the reviewer's wording goes
 * back in. When the answer behind a sentence changed, the sentence the edit was made to no longer exists: the edit is kept aside as
 * "stale" for the reviewer to look at, never silently dropped.
 *
 * Also here: the light formatting a paragraph can carry (**bold**, *italic*, __underline__, a "• " list item), converted to and from
 * the editor's HTML, and drawn in the printed report. Pure functions, no React (the drawing lives in components/InlineText.tsx);
 * tested in tests/text-edits.test.mjs.
 */
import { PART_RE, PHOTOS_RE } from "./reportParts";

export interface LineEdit { from: string; to: string; n?: number }
export interface AddedLine { after: string; text: string; n?: number }
export interface TextEdits {
  /** A generated line (its `n`th occurrence when the same sentence appears more than once) and the reviewer's version; "" = removed. */
  lines?: LineEdit[];
  /** A paragraph of the reviewer's own, after the `n`th occurrence of a generated line ("" = at the very start). */
  added?: AddedLine[];
  /** Description-page sentences that are not part of the section's report text (works, scope, photographs ...), keyed. */
  blocks?: Record<string, string>;
  /** Edits whose generated sentence no longer exists (the answer behind it changed). */
  stale?: LineEdit[];
}

/** A section's report text as its paragraphs, the way the report reads it. */
export function splitLines(text: string): string[] {
  return (text ?? "").split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
}
export function joinLines(lines: string[]): string {
  return lines.filter((l) => l.trim()).join("\n\n");
}

// ---- what a line is ------------------------------------------------------------------------------------------------------------

export type LineKind = "para" | "defect" | "item" | "note" | "heading" | "roomhead" | "floor" | "cond" | "photos";
export interface LineAnatomy {
  kind: LineKind;
  /** The marker part kept as it is ("DEFECT::2::"), empty for a plain paragraph. */
  prefix: string;
  /** The words a reviewer can retype ("" for a line that is not text). */
  text: string;
  editable: boolean;
  /** For a fixed line: what to show for it in the editor ("Condition: Fair", "3 photos print here", a heading). */
  label?: string;
}

const COND_RE = /^COND::(#[0-9a-fA-F]{6})::(.+)$/;
const ROOM_RE = /^ROOMHEAD::(.+)$/;
const DEFECT_RE = /^(DEFECT::\d+::)([\s\S]*)$/;
const ITEM_RE = /^(ITEM::(.+?)::(?:(?:ok|progress|defect|note|notcomplete|na)::)?)([\s\S]*)$/;
const NOTE_RE = /^(NOTE::)([\s\S]*)$/;
const FLOOR_HEADINGS = ["GROUND FLOOR", "FIRST FLOOR", "SECOND FLOOR", "BASEMENT"];
const FLOOR_LINE_RE = /^(?:LEVEL \d+|[A-Z]+ FLOOR|LOWER GROUND|MEZZANINE)$/;

export function anatomy(line: string): LineAnatomy {
  let m: RegExpMatchArray | null;
  if ((m = line.match(COND_RE))) return { kind: "cond", prefix: line, text: "", editable: false, label: `Condition: ${m[2]}` };
  if ((m = line.match(PART_RE))) return { kind: "heading", prefix: line, text: "", editable: false, label: m[1]!.trim() };
  if ((m = line.match(PHOTOS_RE))) {
    const n = m[1]!.split(",").filter((k) => k.trim()).length;
    return { kind: "photos", prefix: line, text: "", editable: false, label: `${n} photo${n === 1 ? "" : "s"} print here` };
  }
  if ((m = line.match(ROOM_RE))) return { kind: "roomhead", prefix: line, text: "", editable: false, label: m[1]!.trim() };
  if ((m = line.match(DEFECT_RE))) return { kind: "defect", prefix: m[1]!, text: m[2]!.trim(), editable: true };
  if ((m = line.match(ITEM_RE))) return { kind: "item", prefix: m[1]!, text: m[3]!.trim(), editable: true, label: m[2]! };
  if ((m = line.match(NOTE_RE))) return { kind: "note", prefix: m[1]!, text: m[2]!.trim(), editable: true };
  if (FLOOR_HEADINGS.includes(line) || FLOOR_LINE_RE.test(line)) return { kind: "floor", prefix: line, text: "", editable: false, label: line };
  return { kind: "para", prefix: "", text: line, editable: true };
}

// ---- remembering edits ---------------------------------------------------------------------------------------------------------

/** For each position of `lines`: which occurrence of its text it is (0 for the first). */
function occurrences(lines: string[]): number[] {
  const seen = new Map<string, number>();
  return lines.map((l) => { const k = seen.get(l) ?? 0; seen.set(l, k + 1); return k; });
}

/** Pairs of positions (in `a`, in `b`) of the longest run of identical lines the two have in common, in order. */
function commonLines(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push([i, j]); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return out;
}

/**
 * What the reviewer changed: `edited` (the text as the reviewer left it) lined up against `generated` (the text as the answers write it).
 * Lines both have are untouched; in between, generated lines are paired in order with the reviewer's (a retyped line), generated lines
 * left over were removed, and the reviewer's left over were added. `blocks` and `stale` are carried over from `previous`.
 */
export function diffEdits(generated: string, edited: string, previous?: TextEdits | null): TextEdits {
  const g = splitLines(generated), e = splitLines(edited);
  const gn = occurrences(g);
  const lines: LineEdit[] = [];
  const added: AddedLine[] = [];
  const pairs = [...commonLines(g, e), [g.length, e.length] as [number, number]];
  let gi = 0, ei = 0;
  let anchor: { text: string; n: number } = { text: "", n: 0 };
  for (const [gm, em] of pairs) {
    const gs = g.slice(gi, gm), es = e.slice(ei, em);
    const paired = Math.min(gs.length, es.length);
    for (let k = 0; k < gs.length; k++) {
      const at = gi + k;
      lines.push({ from: gs[k]!, to: k < paired ? es[k]! : "", ...(gn[at] ? { n: gn[at] } : {}) });
      anchor = { text: gs[k]!, n: gn[at]! };
    }
    for (let k = paired; k < es.length; k++) added.push({ after: anchor.text, text: es[k]!, ...(anchor.n ? { n: anchor.n } : {}) });
    if (gm < g.length) anchor = { text: g[gm]!, n: gn[gm]! };
    gi = gm + 1;
    ei = em + 1;
  }
  const out: TextEdits = {};
  if (lines.length) out.lines = lines;
  if (added.length) out.added = added;
  if (previous?.blocks && Object.keys(previous.blocks).length) out.blocks = previous.blocks;
  if (previous?.stale?.length) out.stale = previous.stale;
  return out;
}

/**
 * The text the answers write (`generated`) with the reviewer's edits put back in, and the edits as they now stand: an edit whose
 * generated sentence is gone moves to `stale`; a paragraph of the reviewer's whose place is gone goes at the end (still theirs).
 */
export function applyEdits(generated: string, edits: TextEdits | null | undefined): { text: string; edits: TextEdits; staleNow: LineEdit[] } {
  const g = splitLines(generated);
  const gn = occurrences(g);
  const lines = edits?.lines ?? [];
  const added = edits?.added ?? [];
  const usedLine = new Set<number>(), usedAdd = new Set<number>();
  const out: string[] = [];
  const addAfter = (text: string, n: number) =>
    added.forEach((a, i) => { if (!usedAdd.has(i) && a.after === text && (a.n ?? 0) === n) { usedAdd.add(i); out.push(a.text); } });
  addAfter("", 0);
  g.forEach((line, at) => {
    const i = lines.findIndex((l, k) => !usedLine.has(k) && l.from === line && (l.n ?? 0) === gn[at]);
    if (i >= 0) { usedLine.add(i); if (lines[i]!.to.trim()) out.push(lines[i]!.to); }
    else out.push(line);
    addAfter(line, gn[at]!);
  });
  added.forEach((a, i) => { if (!usedAdd.has(i)) out.push(a.text); });
  const staleNow = lines.filter((l, k) => !usedLine.has(k) && l.to.trim());
  const keptLines = lines.filter((_, k) => usedLine.has(k));
  const next: TextEdits = {};
  if (keptLines.length) next.lines = keptLines;
  if (added.length) next.added = added;
  if (edits?.blocks && Object.keys(edits.blocks).length) next.blocks = edits.blocks;
  const stale = [...(edits?.stale ?? []), ...staleNow.filter((s) => !(edits?.stale ?? []).some((x) => x.from === s.from && x.to === s.to))];
  if (stale.length) next.stale = stale;
  return { text: joinLines(out), edits: next, staleNow };
}

/** True when `edits` holds anything (a retyped, removed or added line, a Description sentence, or a stale edit). */
export function hasEdits(edits: TextEdits | null | undefined): boolean {
  return !!(edits && ((edits.lines?.length ?? 0) || (edits.added?.length ?? 0) || Object.keys(edits.blocks ?? {}).length || (edits.stale?.length ?? 0)));
}

// ---- formatting ----------------------------------------------------------------------------------------------------------------

/** One run of a paragraph's words, with its formatting. */
export interface Run { text: string; bold?: boolean; italic?: boolean; underline?: boolean; link?: boolean }

const TOKEN_RE = /\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__|\*(?=[^\s*])([^*]*?[^\s*])\*|\[Click here\]/;

/** A paragraph's words as formatted runs: **bold**, *italic*, __underline__ (nestable), and the "[Click here]" link slot. */
export function parseInline(text: string, base: Omit<Run, "text"> = {}): Run[] {
  const out: Run[] = [];
  let rest = text;
  while (rest) {
    const m = TOKEN_RE.exec(rest);
    if (!m) { out.push({ ...base, text: rest }); break; }
    if (m.index > 0) out.push({ ...base, text: rest.slice(0, m.index) });
    if (m[0] === "[Click here]") out.push({ ...base, text: "Click here", link: true });
    else if (m[1] !== undefined) out.push(...parseInline(m[1], { ...base, bold: true }));
    else if (m[2] !== undefined) out.push(...parseInline(m[2], { ...base, underline: true }));
    else out.push(...parseInline(m[3]!, { ...base, italic: true }));
    rest = rest.slice(m.index + m[0].length);
  }
  return out.filter((r) => r.text);
}

/** True when a paragraph carries any formatting marks (so it needs drawing as runs). */
export function hasInline(text: string): boolean {
  return TOKEN_RE.test(text);
}

/** The words with every formatting mark taken out (for counting and plain uses). */
export function plainText(text: string): string {
  return parseInline(text).map((r) => r.text).join("");
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A paragraph as HTML for the editor (b / i / u, the link slot as a non-editable chip). */
export function markupToHtml(text: string): string {
  return parseInline(text)
    .map((r) => {
      if (r.link) return `<span data-link-slot="" contenteditable="false">Click here</span>`;
      let h = escapeHtml(r.text);
      if (r.underline) h = `<u>${h}</u>`;
      if (r.italic) h = `<i>${h}</i>`;
      if (r.bold) h = `<b>${h}</b>`;
      return h;
    })
    .join("");
}

/** What the editor's HTML says, back as a paragraph with formatting marks. Unknown tags keep their words; line breaks become spaces. */
export function htmlToMarkup(root: { childNodes: ArrayLike<Node> }): string {
  const walk = (node: Node, f: { b: boolean; i: boolean; u: boolean }, out: Run[]) => {
    if (node.nodeType === 3) { out.push({ text: node.textContent ?? "", bold: f.b, italic: f.i, underline: f.u }); return; }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    if (el.hasAttribute?.("data-link-slot")) { out.push({ text: "Click here", link: true }); return; }
    const tag = el.tagName.toLowerCase();
    if (tag === "br") { out.push({ text: " " }); return; }
    const weight = el.style?.fontWeight;
    const next = {
      b: f.b || tag === "b" || tag === "strong" || weight === "bold" || Number(weight) >= 600,
      i: f.i || tag === "i" || tag === "em" || el.style?.fontStyle === "italic",
      u: f.u || tag === "u" || (el.style?.textDecoration ?? "").includes("underline"),
    };
    el.childNodes.forEach((c) => walk(c, next, out));
    if ((tag === "div" || tag === "p") && out.length) out.push({ text: " " });
  };
  const runs: Run[] = [];
  Array.from(root.childNodes).forEach((c) => walk(c, { b: false, i: false, u: false }, runs));
  // merge neighbours with the same formatting, then write the marks around each run (spaces kept outside the marks)
  const merged: Run[] = [];
  for (const r of runs) {
    const t = r.text.replace(/ /g, " ");
    const last = merged[merged.length - 1];
    if (last && !last.link && !r.link && !!last.bold === !!r.bold && !!last.italic === !!r.italic && !!last.underline === !!r.underline) last.text += t;
    else merged.push({ ...r, text: t });
  }
  const text = merged
    .map((r) => {
      if (r.link) return "[Click here]";
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text)!;
      let core = m[2]!;
      if (!core) return r.text;
      if (r.underline) core = `__${core}__`;
      if (r.italic) core = `*${core}*`;
      if (r.bold) core = `**${core}**`;
      return `${m[1]}${core}${m[3]}`;
    })
    .join("");
  return text.replace(/\s+/g, " ").trim();
}
