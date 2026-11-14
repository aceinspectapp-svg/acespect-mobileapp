import type { FormSection } from "./mockData";
import type { ReportWording } from "./wording/types";

/**
 * A report laid out the way its office template is, not the way its form is (Dilapidation / Apartment).
 *
 * The form asks about the building in its own sections; the template prints its own headings in its own order ("Driveway",
 * "Paving / Parking areas / Basement car parks", ..., "Main structure", "Roof Covering", then the rooms). A composer marks where each
 * of the template's headings starts in a section's text, and where an item's photos go:
 *
 *   PART::<heading>          one of the template's headings (ReportWording.reportParts lists them in print order)
 *   PHOTOS::<key>,<key>...   the photos of these answers ("driveway_common_photos"), printed here -- the template's "Please refer to
 *                            Photographs ..." under each item
 *
 * The report splits every section at its PART marks, prints each part under its heading in the template's order (a part may come
 * from any section), and prints each item's photos where its PHOTOS mark is.
 */
export const PART_RE = /^PART::(.+)$/;
export const PHOTOS_RE = /^PHOTOS::(.+)$/;

/** A photo's address without its query string (a signed link's token changes; the photo does not). */
export const photoKey = (url: string): string => url.split("?")[0] ?? url;

/** Every photo address (without its query) anywhere in some answers. */
export function answerPhotoKeys(answers: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach((x) => (typeof x === "string" ? /^https?:|^\//.test(x) && out.add(photoKey(x)) : walk(x)));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(answers);
  return out;
}

/**
 * The photos a PHOTOS mark names: those answers' photos, as the section lists them (so a photo the reviewer left out of the report is
 * left out here too), without any that are a defect's own (printed under the defect).
 */
export function markedPhotos(section: Pick<FormSection, "photos" | "damages" | "answers">, keys: string[]): string[] {
  const answers = (section.answers ?? {}) as Record<string, unknown>;
  // A mark names an answer ("driveway_common_photos") or, for an item inside a list (a room, a side), the photos themselves.
  const isPhoto = (k: string) => /^(https?:|\/)/.test(k);
  const wanted = new Set(
    keys
      .flatMap((k) => (isPhoto(k) ? [k] : Array.isArray(answers[k]) ? (answers[k] as unknown[]) : []))
      .filter((x): x is string => typeof x === "string")
      .map(photoKey),
  );
  const ofDefects = new Set(section.damages.flatMap((d) => d.photos.map(photoKey)));
  return section.photos.filter((url) => wanted.has(photoKey(url)) && !ofDefects.has(photoKey(url)));
}

/** The answer keys named by every PHOTOS mark in some report text. */
export function markedKeys(text: string): string[] {
  return text
    .split(/\n{2,}|\n/)
    .map((p) => PHOTOS_RE.exec(p.trim())?.[1] ?? "")
    .flatMap((keys) => keys.split(",").map((k) => k.trim()))
    .filter(Boolean);
}

/** One piece of the report body: a whole section, or one of the template's parts cut out of a section. */
export interface ReportPiece {
  section: FormSection;
  /** The template's EXTERNAL / INTERNAL band it prints under, when the report type says. */
  band?: "EXTERNAL" | "INTERNAL";
  /** The photos printed after it, when not the section's own general photos (a part prints its photos at its PHOTOS marks instead). */
  generalPhotos?: string[];
  /** False: the section's defects that no sentence names are printed with another piece of the same section. */
  untaggedDefects?: boolean;
  /** False: the section's photo-archive link is printed with another piece of the same section. */
  archiveLink?: boolean;
  /** False: printed under the heading of the piece before it (the same heading), or a heading the template prints as its band only. */
  showHeading?: boolean;
}

/** A section's text cut at its PART marks: the heading of each part and its text. Text before the first mark has no heading of its own. */
export function splitParts(text: string): { title?: string; text: string }[] {
  const parts: { title?: string; lines: string[] }[] = [{ lines: [] }];
  for (const line of text.split(/\n{2,}/)) {
    const m = PART_RE.exec(line.trim());
    if (m) parts.push({ title: m[1]!.trim(), lines: [] });
    else parts[parts.length - 1]!.lines.push(line);
  }
  // An item-by-item section marks its heading at every item ("PART::Garage/Carport/Loading Bay" for the garage, again for the carport):
  // one part per run of the same heading.
  const merged: typeof parts = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && p.title !== undefined && last.title === p.title) last.lines.push(...p.lines);
    else merged.push(p);
  }
  return merged.map((p) => ({ title: p.title, text: p.lines.join("\n\n").trim() })).filter((p, i) => p.title !== undefined || (i === 0 && p.text));
}

/**
 * The report body's pieces in the template's order: every section split at its PART marks, each part placed by its heading's place in
 * `wording.reportParts`. A section with no marks (one composed before the marks existed, or a type that has none) is placed by its
 * printed name; an inspector-added structure after the heading marked `structures`; anything else after every known heading, in its own
 * order. Notes always come last.
 */
export function orderedPieces(sections: FormSection[], wording: ReportWording, keyOf: (s: FormSection) => string): ReportPiece[] | undefined {
  const plan = wording.reportParts;
  if (!plan) return undefined;
  const rank = (title: string): number => plan.findIndex((p) => p.title === title);
  const bandOf = (title: string) => plan.find((p) => p.title === title)?.band;
  const structuresAt = plan.findIndex((p) => p.structures);
  const pieces: (ReportPiece & { rank: number; order: number })[] = [];
  sections.forEach((s, order) => {
    const key = keyOf(s);
    const name = wording.sectionTitle?.(key) ?? s.name;
    if (key.startsWith("notes")) {
      pieces.push({ section: s, rank: Number.MAX_SAFE_INTEGER, order });
      return;
    }
    const parts = splitParts(s.reportText);
    if (!parts.some((p) => p.title !== undefined)) {
      const r = key.startsWith("custom_") && structuresAt >= 0 ? structuresAt + 0.5 : rank(name);
      pieces.push({ section: { ...s, name }, band: bandOf(name) ?? (key.startsWith("custom_") && structuresAt >= 0 ? plan[structuresAt]!.band : undefined), rank: r >= 0 ? r : plan.length + order, order });
      return;
    }
    // Photos the reviewer added in the review (in the section's list but in no answer): printed with the section's last part.
    const inAnswers = answerPhotoKeys(s.answers);
    const ofDefects = new Set(s.damages.flatMap((d) => d.photos.map(photoKey)));
    const added = s.photos.filter((url) => !inAnswers.has(photoKey(url)) && !ofDefects.has(photoKey(url)));
    parts.forEach((p, i) => {
      const title = p.title ?? name;
      const last = i === parts.length - 1;
      const r = rank(title);
      pieces.push({
        section: { ...s, id: `${s.id}:${i}`, name: title, reportText: p.text },
        band: bandOf(title),
        generalPhotos: last ? added : [],
        untaggedDefects: last,
        archiveLink: i === 0,
        rank: r >= 0 ? r : plan.length + order,
        order,
      });
    });
  });
  const sorted = pieces
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.rank - b.p.rank || a.p.order - b.p.order || a.i - b.i)
    .map(({ p }) => p);
  // A heading is printed once: the pieces after it under the same heading (fences, then retaining walls, under "Fences and Retaining
  // Walls"; each added structure under "Any other free standing Structures") carry on under it. A heading the template prints only as
  // its band (INTERNAL) is not printed again.
  return sorted.map((p, i) => ({
    section: p.section,
    band: p.band,
    generalPhotos: p.generalPhotos,
    untaggedDefects: p.untaggedDefects,
    archiveLink: p.archiveLink,
    showHeading: plan.find((x) => x.title === p.section.name)?.heading !== false && sorted[i - 1]?.section.name !== p.section.name,
  }));
}
