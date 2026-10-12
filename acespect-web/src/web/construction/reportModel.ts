/**
 * The Construction Report, laid out the way the Houspect Lock-up Report design sample does: cover details, General
 * Description, Photographs, the Inspection Checklist (a summary of six status colours, then one table per section), Identified
 * Defects Requiring Attention (numbered, grouped by topic, with photos), Notes, Previous Defects, Client Concerns, then
 * Scope and Conditions.
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
import { GENERAL, PURPOSE, SECTION_ORDER, STAGES, coverTitleOf, kindOfKey, stageOfSectionKeys, type StageId } from "./stages";
import { ITEM_STATUSES, TAGS, type ItemStatus } from "./compose";
import library from "./codeLibrary.json";

export { stageOfSectionKeys, stageMeta } from "./stages";
export type { StageId } from "./stages";
export type { ItemStatus } from "./compose";
export { ITEM_STATUSES } from "./compose";

// ───────────────────────── Model ─────────────────────────

export interface ChecklistItem {
  /** Anchor id, so a defect or note can be jumped to from the summary. */
  id: string;
  heading: string;
  status: ItemStatus;
  text: string;
  /** The defect number this row refers to, when it is a defect. */
  defectNo?: number;
}
export interface ChecklistGroup { heading?: string; items: ChecklistItem[] }
export interface ChecklistTable {
  /** The section this table was built from (the reviewer portal shows one section at a time). */
  sectionKey: string;
  title: string;
  groups: ChecklistGroup[];
  counts: Record<ItemStatus, number>;
  /** Photographs the inspector took against rows of this section (measurements, levels), with the row they belong to. */
  photos: { heading: string; photos: string[] }[];
}

export interface DefectEntry {
  no: number;
  /** The sentence: the checklist row, where it is and the inspector's comments. */
  text: string;
  severity: string;
  category: string;
  /** What the inspector typed as the construction code ("2.04") and the library's name for it. */
  code: string;
  codeTitle: string;
  photos: string[];
  /** Where it came from: the checklist row's anchor, so the defect can link back. */
  fromId?: string;
  /** The section that recorded it. */
  sectionKey: string;
}
export interface DefectGroup { heading: string; defects: DefectEntry[] }

export interface AttachedList { attached: boolean; text: string; photos: string[] }

export interface ConstructionReportModel {
  stage: StageId;
  /** "Lock-up" -- the Stage row on the cover. */
  stageLabel: string;
  /** "Lock-up Stage" -- the cover title. */
  coverTitle: string;
  purpose: string;
  general: string;
  description: string[];
  streetPhotos: string[];
  otherPhotos: string[];
  tables: ChecklistTable[];
  totals: Record<ItemStatus, number>;
  defectGroups: DefectGroup[];
  defectCount: number;
  notes: string[];
  /** The same notes by the section that wrote them (Summary, Site & Facilities), for the reviewer portal's one-section view. */
  notesBySection: Record<string, string[]>;
  previous: AttachedList;
  clientConcerns: AttachedList;
  /** Sections that were submitted but not yet approved, so they are not printed. */
  waitingSections: string[];
  /** The section keys of the Previous Defects / Client Concerns lists, when present. */
  attachedKeys: { previous?: string; client?: string };
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
  | { kind: "item"; heading: string; status: ItemStatus; text: string }
  | { kind: "note"; text: string }
  | { kind: "defect"; index: number; text: string }
  | { kind: "para"; text: string };

const ITEM = /^ITEM::(.+?)::(?:(ok|progress|defect|note|notcomplete|na)::)?([\s\S]*)$/;

export function parseLines(reportText: string): Line[] {
  return reportText.split(/\n{2,}|\n/).map((l) => l.trim()).filter(Boolean).map((l): Line => {
    if (l.startsWith(TAGS.room)) return { kind: "room", text: l.slice(TAGS.room.length) };
    const item = ITEM.exec(l);
    if (item) return { kind: "item", heading: item[1]!, status: (item[2] as ItemStatus | undefined) ?? "ok", text: item[3]!.trim() };
    if (l.startsWith(TAGS.note)) return { kind: "note", text: l.slice(TAGS.note.length) };
    const d = /^DEFECT::(\d+)::([\s\S]*)$/.exec(l);
    if (d) return { kind: "defect", index: Number(d[1]), text: d[2]!.trim() };
    return { kind: "para", text: l };
  });
}

const paragraphs = (lines: Line[]) => lines.filter((l): l is Extract<Line, { kind: "para" }> => l.kind === "para").map((l) => l.text);
const emptyCounts = (): Record<ItemStatus, number> => ({ ok: 0, progress: 0, defect: 0, note: 0, notcomplete: 0, na: 0 });

// ───────────────────────── Defects ─────────────────────────

type CodeLibrary = { codes: Record<string, { section: string; title: string; text: string[] }> };
const LIB = library as unknown as CodeLibrary;

/** "2.04, 3.01 and 12.2" -> the numbered references the library knows about. */
export function referencedCodes(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\b/g)) {
    const code = `${m[1]}.${m[2]!.padStart(2, "0")}`;
    if (LIB.codes[code]) found.add(code);
  }
  return [...found];
}

/** The defect's sentence, and the Severity / Category / Construction code the wording appended to it. */
export function splitDefect(text: string): { sentence: string; severity: string; category: string; code: string } {
  let rest = text;
  const grab = (label: string): string => {
    const i = rest.lastIndexOf(` ${label}: `);
    if (i === -1) return "";
    const value = rest.slice(i + label.length + 3).trim().replace(/\.$/, "");
    rest = rest.slice(0, i);
    return value;
  };
  const code = grab("Construction code");
  const category = grab("Category");
  const severity = grab("Severity");
  return { sentence: rest.trim(), severity, category, code };
}

function codeTitle(code: string): string {
  const known = referencedCodes(code);
  return known.length ? known.map((c) => `${c} ${LIB.codes[c]!.title}`).join("; ") : code;
}

// ───────────────────────── Stage / Status on Job Information (PCI) ─────────────────────────

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

const tableTitle = (name: string) => (name.split(":").pop() ?? name).trim().toUpperCase();

/** A sub-heading as the report prints it: without the form's instructions to the inspector ("— use a digital level …", "— check with the office …?"). */
function cleanGroup(heading: string): string {
  const at = heading.indexOf(" — ");
  return at !== -1 && /\?|use a digital level|check/i.test(heading.slice(at)) ? heading.slice(0, at) : heading;
}
const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();

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
  const tables: ChecklistTable[] = [];
  let summaryLines: string[] = [];
  const siteNotes: string[] = [];
  const notesBySection: Record<string, string[]> = {};
  const attachedKeys: ConstructionReportModel["attachedKeys"] = {};
  const noList = (): AttachedList => ({ attached: false, text: "", photos: [] });
  let previous = noList();
  let clientConcerns = noList();

  interface Raised { key: string; sub: string; text: string; photos: string[]; fromId?: string }
  const raised: Raised[] = [];
  /** Checklist rows that say "refer defects", per section, to be tied to their defects once those are numbered. */
  const pending: { item: ChecklistItem; raisedIndex: number }[] = [];
  let itemSeq = 0;

  for (const s of approved) {
    const lines = parseLines(s.reportText);
    const kind = kindOfKey(s.key);
    const excluded = s.excludedPhotos ?? [];
    const a = s.answers;

    // The defects this section records, each paired with its own photos.
    const firstRaised = raised.length;
    for (const l of lines) {
      if (l.kind !== "defect") continue;
      const dmg = s.damages[l.index];
      raised.push({ key: s.key, sub: dmg?.type || "General", text: l.text, photos: (dmg?.photos ?? []).filter((u) => !excluded.includes(u)) });
    }

    if (kind === "description") {
      description = paragraphs(lines);
      if (stage === "pci" && status) description = description.map((p) => (p === meta.progress ? `Progress of the works to date is ${status.split(" — ")[0]!.toLowerCase()}.` : p));
      streetPhotos = a ? photosIn(a.streetPhotos, excluded) : [];
      otherPhotos = a ? [...photosIn(a.elevationPhotos, excluded), ...photosIn(a.neighbourPhotos, excluded)] : [];
    } else if (kind === "site" || kind === "stage") {
      const groups: ChecklistGroup[] = [];
      let current: ChecklistGroup | null = null;
      let inDefects = false;
      let defectRowsSeen = 0;
      for (const l of lines) {
        if (l.kind === "room") {
          inDefects = l.text === "Defects";
          if (!inDefects) { current = { heading: l.text, items: [] }; groups.push(current); }
          continue;
        }
        if (l.kind === "note") { siteNotes.push(l.text); (notesBySection[s.key] ??= []).push(l.text); continue; }
        if (inDefects || l.kind !== "item") continue;
        if (!current) { current = { items: [] }; groups.push(current); }
        const item: ChecklistItem = { id: `item-${++itemSeq}`, heading: l.heading, status: l.status, text: l.text };
        current.items.push(item);
        if (l.status === "defect") pending.push({ item, raisedIndex: firstRaised + defectRowsSeen++ });
      }
      const title = tableTitle(s.name);
      const kept = groups.filter((g) => g.items.length > 0).map((g) => {
        const heading = g.heading ? cleanGroup(g.heading) : undefined;
        // A sub-heading that only repeats the table's own title says nothing.
        return { ...g, heading: heading && norm(heading) !== norm(title) ? heading : undefined };
      });
      // Photographs the inspector took against a row ("Photos with measurements", "Photo showing the digital level").
      const photos: ChecklistTable["photos"] = [];
      if (a) {
        const headings = headingMap(s.fields);
        for (const f of s.fields) {
          if (f.type !== "photos") continue;
          const got = photosIn(a[f.key], excluded);
          if (!got.length) continue;
          const rowHeading = headings.get(f.key.replace(/Photos$/, ""));
          photos.push({ heading: rowHeading ?? f.label.replace(/^Photos? (of|showing) /i, ""), photos: got });
        }
      }
      if (kept.length || photos.length) {
        const counts = emptyCounts();
        for (const g of kept) for (const it of g.items) counts[it.status] += 1;
        tables.push({ sectionKey: s.key, title, groups: kept, counts, photos });
      }
    } else if (kind === "summary") {
      summaryLines = paragraphs(lines);
      notesBySection[s.key] = [...summaryLines];
    } else if (kind === "client" || kind === "previous") {
      const text = paragraphs(lines);
      const entry: AttachedList = text.length
        ? { attached: true, text: text.slice(1).join(" "), photos: a ? photosIn(a[`${kind === "client" ? "clientList" : "previousDefects"}Photos`], excluded) : [] }
        : noList();
      if (kind === "client") { clientConcerns = entry; attachedKeys.client = s.key; } else { previous = entry; attachedKeys.previous = s.key; }
    }
  }

  // Defects: numbered in the order of the checklist, grouped under the topic they came from.
  const topicOrder: string[] = [];
  for (const d of raised) { d.sub = cleanGroup(d.sub); if (!topicOrder.includes(d.sub)) topicOrder.push(d.sub); }
  const defectGroups: DefectGroup[] = [];
  const numberOf = new Map<number, number>();
  let n = 0;
  for (const topic of topicOrder) {
    const group: DefectGroup = { heading: topic, defects: [] };
    raised.forEach((d, i) => {
      if (d.sub !== topic) return;
      n += 1;
      numberOf.set(i, n);
      const parts = splitDefect(d.text);
      group.defects.push({ no: n, text: parts.sentence, severity: parts.severity, category: parts.category, code: parts.code, codeTitle: parts.code ? codeTitle(parts.code) : "", photos: d.photos, sectionKey: d.key });
    });
    defectGroups.push(group);
  }
  for (const p of pending) p.item.defectNo = numberOf.get(p.raisedIndex);

  const totals = emptyCounts();
  for (const t of tables) for (const k of ITEM_STATUSES) totals[k] += t.counts[k];

  // Notes: the section's own notes, the PCI appliances note for the chosen Stage / Status, then what Site & Facilities added.
  const notes = [...summaryLines];
  const appliances = stage === "pci" ? pciAppliances(status) : "";
  if (appliances) notes.splice(Math.min(1, notes.length), 0, appliances);
  notes.push(...siteNotes);

  return {
    stage, stageLabel, coverTitle: coverTitleOf(stage), purpose: PURPOSE, general: GENERAL, description, streetPhotos, otherPhotos, tables, totals,
    defectGroups, defectCount: n, notes, notesBySection, previous, clientConcerns, waitingSections, attachedKeys,
  };
}
