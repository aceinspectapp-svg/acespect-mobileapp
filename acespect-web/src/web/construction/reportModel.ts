/**
 * The Construction Report: lays a submitted Construction Stage inspection out the way Houspect's office templates do
 * ("ACESPECT <stage>_Office Template"): cover details, General Description, Photographs, Site & Facilities, the stage's own
 * checks (a heading and one sentence each), Identified Defects Requiring Attention (numbered, with photos), Notes, Client
 * queries, items from the previous inspection, and the References and Guide to Standards and Tolerances.
 *
 * It does not write any sentences itself. Every section's text comes from the section's report text -- the same text the
 * reviewer portal shows (written by the Construction Stage wording, src/web/wording/construction_stage.ts, or typed over by
 * the reviewer) -- and the defects from the section's defect records. This file only arranges them.
 *
 * Pure functions (no React), so the web page, the PDF and the tests share one model.
 */
import type { AnswerTree, TemplateField } from "../templateFields";
import { asString } from "../templateFields";
import { headingMap, photosIn } from "./words";
import { GENERAL, PURPOSE, SECTION_ORDER, STAGES, bannerOf, kindOfKey, stageOfSectionKeys, type StageId } from "./stages";
import { TAGS } from "./compose";
import library from "./codeLibrary.json";

export { stageOfSectionKeys, stageMeta } from "./stages";
export type { StageId } from "./stages";

// ───────────────────────── Model ─────────────────────────

export interface ReportItem { heading: string; text: string; photos: string[] }
export interface ReportGroup { heading?: string; items: ReportItem[] }
export interface ReportBlock { banner: string; groups: ReportGroup[] }

export interface DefectEntry {
  no: number;
  area: "EXTERNAL" | "INTERNAL";
  sub: string;
  /** The defect's sentence: the checklist row, where it is, the inspector's comments, severity, category and construction code. */
  text: string;
  code: string;
  photos: string[];
}

export interface ReferenceSection { section: string; codes: { code: string; title: string; text: string[] }[] }

export interface ConstructionReportModel {
  stage: StageId;
  stageLabel: string;
  purpose: string;
  general: string;
  description: string[];
  streetPhotos: string[];
  otherPhotos: string[];
  site: ReportGroup[];
  blocks: ReportBlock[];
  defects: DefectEntry[];
  groupedDefects: boolean;
  notes: string[];
  clientQueries: { text: string; photos: string[] } | null;
  previous: { text: string; photos: string[] } | null;
  blocksRef: { title: string; text: string[] }[];
  references: ReferenceSection[];
  /** Sections that were submitted but not yet approved, so they are not printed. */
  waitingSections: string[];
}

export interface SectionInput {
  key: string;
  name: string;
  approved: boolean;
  /** The section's report text (what the reviewer portal shows). */
  reportText: string;
  /** The section's defect records, in the order its DEFECT lines number them. */
  damages: { type: string; location: string; direction: string; photos: string[] }[];
  /** Used only for photos: the photograph fields sit beside the text. */
  answers: AnswerTree | null;
  fields: TemplateField[];
  excludedPhotos?: string[];
}

// ───────────────────────── Reading a section's text ─────────────────────────

type Line =
  | { kind: "room"; text: string }
  | { kind: "item"; heading: string; text: string }
  | { kind: "note"; text: string }
  | { kind: "defect"; index: number; text: string }
  | { kind: "para"; text: string };

export function parseLines(reportText: string): Line[] {
  return reportText.split(/\n{2,}|\n/).map((l) => l.trim()).filter(Boolean).map((l): Line => {
    if (l.startsWith(TAGS.room)) return { kind: "room", text: l.slice(TAGS.room.length) };
    if (l.startsWith(TAGS.item)) {
      const rest = l.slice(TAGS.item.length);
      const at = rest.indexOf("::");
      return at === -1 ? { kind: "para", text: rest } : { kind: "item", heading: rest.slice(0, at), text: rest.slice(at + 2) };
    }
    if (l.startsWith(TAGS.note)) return { kind: "note", text: l.slice(TAGS.note.length) };
    const d = /^DEFECT::(\d+)::([\s\S]*)$/.exec(l);
    if (d) return { kind: "defect", index: Number(d[1]), text: d[2]!.trim() };
    return { kind: "para", text: l };
  });
}

const paragraphs = (lines: Line[]) => lines.filter((l): l is Extract<Line, { kind: "para" }> => l.kind === "para").map((l) => l.text);

/** A checklist section's lines -> groups of items, with the row photos from the form's photo fields attached to their rows. */
function groupsOf(s: SectionInput): ReportGroup[] {
  const groups: ReportGroup[] = [];
  const excluded = s.excludedPhotos ?? [];
  let current: ReportGroup | null = null;
  let inDefects = false;
  for (const l of parseLines(s.reportText)) {
    if (l.kind === "room") { inDefects = l.text === "Defects"; if (!inDefects) { current = { heading: l.text, items: [] }; groups.push(current); } continue; }
    if (inDefects || l.kind !== "item") continue;
    if (!current) { current = { items: [] }; groups.push(current); }
    current.items.push({ heading: l.heading, text: l.text, photos: [] });
  }
  // Photographs the inspector took against a row ("Photos with measurements", "Photo showing the digital level").
  const a = s.answers;
  if (a) {
    const headings = headingMap(s.fields);
    for (const f of s.fields) {
      if (f.type !== "photos") continue;
      const photos = photosIn(a[f.key], excluded);
      if (!photos.length) continue;
      const base = f.key.replace(/Photos$/, "");
      const rowHeading = headings.get(base);
      const item = rowHeading ? groups.flatMap((g) => g.items).find((it) => it.heading === rowHeading) : undefined;
      if (item) item.photos.push(...photos);
      else {
        if (!current) { current = { items: [] }; groups.push(current); }
        current.items.push({ heading: f.label.replace(/^Photos? (of|showing) /i, ""), text: "", photos });
      }
    }
  }
  return groups.filter((g) => g.items.length > 0);
}

// ───────────────────────── References ─────────────────────────

type Library = { codes: Record<string, { section: string; title: string; text: string[] }>; blocks: Record<string, { title: string; text: string[] }> };
const LIB = library as unknown as Library;

/** "2.04, 3.01 and 12.2" -> the numbered references the library knows about. */
export function referencedCodes(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\b/g)) {
    const code = `${m[1]}.${m[2]!.padStart(2, "0")}`;
    if (LIB.codes[code]) found.add(code);
  }
  return [...found];
}

function buildReferences(stage: StageId, defectTexts: string[]): { blocks: { title: string; text: string[] }[]; sections: ReferenceSection[] } {
  const codes = new Set<string>(STAGES[stage].defaultCodes);
  for (const t of defectTexts) {
    const m = /Construction code:\s*([^\n]*?)(?:\.\s*$|$)/.exec(t);
    if (m) for (const c of referencedCodes(m[1]!)) codes.add(c);
  }
  const sorted = [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const bySection = new Map<string, ReferenceSection>();
  for (const code of sorted) {
    const c = LIB.codes[code]!;
    let sec = bySection.get(c.section);
    if (!sec) { sec = { section: c.section, codes: [] }; bySection.set(c.section, sec); }
    sec.codes.push({ code, title: c.title, text: c.text });
  }
  const blocks = ["normal_viewing", ...STAGES[stage].defaultBlocks].map((k) => LIB.blocks[k]).filter((b): b is { title: string; text: string[] } => !!b);
  return { blocks, sections: [...bySection.values()] };
}

// ───────────────────────── The Stage / Status on Job Information (PCI) ─────────────────────────

function pciStatus(jobInfo: AnswerTree | null): string {
  const raw = jobInfo ? asString(jobInfo.stageOptionPci) : "";
  if (/^practical_completion/.test(raw)) return "Practical Completion — appliances not yet installed";
  if (/^handover/.test(raw)) return "Handover — appliances installed or some installed";
  if (/^off_the_plan/.test(raw)) return "Off the Plan Handover — appliances are installed";
  if (/^defects_liability/.test(raw)) return "Defects Liability — after handover and now occupied";
  return raw.startsWith("__other__:") ? raw.slice(10) : raw.replace(/_/g, " ");
}

function pciAppliances(status: string): string {
  if (/^practical completion/i.test(status)) return "Appliances such as the oven, cook top, rangehood, dishwasher and hot water service are not yet installed due to concerns about theft of appliances.";
  if (/^handover/i.test(status)) return "Appliances are installed, except for oven, cook top, rangehood, dishwasher and hot water service.";
  if (/^off the plan/i.test(status)) return "Appliances are installed.";
  return "";
}

// ───────────────────────── The whole report ─────────────────────────

export function buildConstructionReport(sections: SectionInput[], jobInfo: AnswerTree | null): ConstructionReportModel | null {
  const stage = stageOfSectionKeys(sections.map((s) => s.key));
  if (!stage) return null;
  const meta = STAGES[stage];
  const rank = (k: string) => { const i = SECTION_ORDER.indexOf(k); return i === -1 ? 9999 : i; };
  const approved = sections.filter((s) => s.approved).map((s, i) => ({ s, i })).sort((x, y) => rank(x.s.key) - rank(y.s.key) || x.i - y.i).map((x) => x.s);
  const waitingSections = sections.filter((s) => !s.approved && (s.answers || s.reportText)).map((s) => s.name);

  const status = stage === "pci" ? pciStatus(jobInfo) : "";
  const stageLabel = stage === "pci" && status ? status.split(" — ")[0]! : meta.label;

  let description: string[] = [];
  let streetPhotos: string[] = [];
  let otherPhotos: string[] = [];
  let site: ReportGroup[] = [];
  const blocks: ReportBlock[] = [];
  let clientQueries: ConstructionReportModel["clientQueries"] = null;
  let previous: ConstructionReportModel["previous"] = null;
  let summaryLines: string[] = [];
  const siteNotes: string[] = [];
  const raised: { area: "EXTERNAL" | "INTERNAL"; sub: string; text: string; photos: string[] }[] = [];

  for (const s of approved) {
    const lines = parseLines(s.reportText);
    const kind = kindOfKey(s.key);
    const excluded = s.excludedPhotos ?? [];
    const a = s.answers;

    // The defects this section records, each paired with its own photos.
    for (const l of lines) {
      if (l.kind !== "defect") continue;
      const dmg = s.damages[l.index];
      raised.push({
        area: dmg?.direction === "INTERNAL" ? "INTERNAL" : "EXTERNAL",
        sub: dmg?.type || "General",
        text: l.text,
        photos: (dmg?.photos ?? []).filter((u) => !excluded.includes(u)),
      });
    }

    if (kind === "description") {
      description = paragraphs(lines);
      if (stage === "pci" && status) description = description.map((p) => (p === meta.progress ? `Progress of the works to date is ${status.split(" — ")[0]!.toLowerCase()}.` : p));
      streetPhotos = a ? photosIn(a.streetPhotos, excluded) : [];
      otherPhotos = a ? [...photosIn(a.elevationPhotos, excluded), ...photosIn(a.neighbourPhotos, excluded)] : [];
    } else if (kind === "site") {
      site = groupsOf(s);
      siteNotes.push(...lines.filter((l): l is Extract<Line, { kind: "note" }> => l.kind === "note").map((l) => l.text));
    } else if (kind === "stage") {
      const groups = groupsOf(s);
      if (groups.length === 0) continue;
      const banner = bannerOf(s.key, s.name);
      const prior = blocks[blocks.length - 1];
      if (prior && prior.banner === banner) prior.groups.push(...groups);
      else blocks.push({ banner, groups });
    } else if (kind === "summary") {
      summaryLines = paragraphs(lines);
    } else if (kind === "client" || kind === "previous") {
      const text = paragraphs(lines).join(" ");
      if (!text) continue;
      const photos = a ? photosIn(a[`${kind === "client" ? "clientList" : "previousDefects"}Photos`], excluded) : [];
      const entry = { text, photos };
      if (kind === "client") clientQueries = entry; else previous = entry;
    }
  }

  // Defects: one numbered list for the early stages; EXTERNAL then INTERNAL, by area, from Lock Up on.
  const subOrder = new Map<string, number>();
  for (const d of raised) if (!subOrder.has(`${d.area}|${d.sub}`)) subOrder.set(`${d.area}|${d.sub}`, subOrder.size);
  const ordered = meta.groupedDefects
    ? raised.map((d, i) => ({ d, i })).sort((x, y) => (x.d.area === y.d.area ? (subOrder.get(`${x.d.area}|${x.d.sub}`)! - subOrder.get(`${y.d.area}|${y.d.sub}`)!) || x.i - y.i : x.d.area === "EXTERNAL" ? -1 : 1)).map((x) => x.d)
    : raised;
  const defects: DefectEntry[] = ordered.map((d, i) => ({
    no: i + 1, area: d.area, sub: d.sub, text: d.text, photos: d.photos, code: referencedCodes((/Construction code:\s*([^\n]*)/.exec(d.text) ?? [])[1] ?? "").join(", "),
  }));

  // Notes: the section's own notes, the PCI appliances note for the chosen Stage / Status, then what Site & Facilities added.
  const notes = [...summaryLines];
  const appliances = stage === "pci" ? pciAppliances(status) : "";
  if (appliances) notes.splice(Math.min(1, notes.length), 0, appliances);
  notes.push(...siteNotes);

  const refs = buildReferences(stage, raised.map((d) => d.text));
  return {
    stage, stageLabel, purpose: PURPOSE, general: GENERAL, description, streetPhotos, otherPhotos, site, blocks, defects,
    groupedDefects: meta.groupedDefects, notes, clientQueries, previous, blocksRef: refs.blocks, references: refs.sections, waitingSections,
  };
}
