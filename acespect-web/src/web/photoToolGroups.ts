/**
 * Every place a section keeps photos, for the reviewer's photo panel: each photo field of the form (a part's start photos, a room's
 * photos, one defect's photos ...) is a group, found by walking the section's template alongside its answers. Reordering, moving and adding
 * photos are plain changes to those answer lists; the caller re-composes the report text from the changed answers, so the report follows.
 *
 * A group's `path` is where its photo list sits in the answers. `path: null` is the section's own flat photo list: photos the reviewer
 * added to the section as a whole (and, for older inspections, every photo). Pure (no React); tested in tests/photo-tool-groups.test.mjs.
 */
import type { AnswerTree, AnswerValue, TemplateField } from "./templateFields";
import { asAnswerTree, asString, asStringArray, isGateSatisfied, resolveInstances } from "./templateFields";
import { photoKey } from "./reportParts";

export type AnswerPath = (string | number)[];

export interface ToolGroup {
  /** Stable id: the answer path joined (or "section" for the section's own list). */
  id: string;
  /** "Part A - Gwynne Street frontage › Wide photos at start (min 4)". */
  title: string;
  /** A second line: a defect's or room's own name. */
  detail?: string;
  /** True when these photos print under a defect. */
  defect: boolean;
  photos: string[];
  /** Where the list sits in the section's answers; null for the section's own photo list. */
  path: AnswerPath | null;
}

export const SECTION_GROUP_ID = "section";

/** The option a field is gated on, when the gate is a ticked item of a multi-select ("What is present: Footpaths and Crossovers"): the category's own name. */
function gateLabel(f: TemplateField, siblings: TemplateField[]): string | undefined {
  if (!f.gate?.equals) return undefined;
  const gating = siblings.find((x) => x.key === f.gate!.fieldKey);
  if (!gating || (gating.type !== "chip-multiselect" && gating.type !== "tile-multiselect")) return undefined;
  return gating.options?.find((o) => o.value === f.gate!.equals)?.label;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (label: string) =>
  label.replace(/\s*\*$/, "").replace(/\s*\((?:start|end|min \d+)[^)]*\)/gi, "").replace(/\s*\(\d+\s*[–-]\s*\d+\s*(?:pics|photos)\)/gi, "").trim();

/** Every photo group of a section, in form order, then the section's own list. */
export function toolGroups(fields: TemplateField[], answers: AnswerTree | null | undefined, sectionPhotos: string[]): ToolGroup[] {
  const groups: ToolGroup[] = [];

  const walk = (list: TemplateField[], scope: AnswerTree, prefix: AnswerPath, crumbs: string[], detail?: string, defect = false): void => {
    const visible = [...list].filter((f) => isGateSatisfied(f, scope)).sort((a, b) => a.order - b.order);
    for (const f of visible) {
      const category = gateLabel(f, list);
      const trail = category && !crumbs.includes(category) ? [...crumbs, category] : crumbs;
      if (f.type === "photos") {
        const path = [...prefix, f.key];
        groups.push({ id: path.join("."), title: [...trail, clean(f.label)].filter(Boolean).join(" › "), detail, defect, photos: asStringArray(scope[f.key]), path });
        continue;
      }
      if (f.type !== "repeating-group" && f.type !== "damage-list") continue;
      const value = scope[f.key] as AnswerValue;
      const noun = cap(f.repeat?.itemNoun ?? (f.type === "damage-list" ? "defect" : "item"));
      const isDefectList = f.type === "damage-list" || /defect/i.test(noun);
      if (Array.isArray(value)) {
        (value as AnswerTree[]).forEach((item, i) => {
          const inst = asAnswerTree(item as AnswerValue);
          const named = (f.repeat?.titleFieldKey ? asString(inst[f.repeat.titleFieldKey]).trim() : "") || asString(inst.location).trim() || asString(inst.partName).trim();
          walk(f.itemFields ?? [], inst, [...prefix, f.key, i], [...trail, isDefectList ? `${noun} ${i + 1}` : named || `${noun} ${i + 1}`], isDefectList ? named || undefined : undefined, isDefectList);
        });
      } else if (value && typeof value === "object") {
        // In the form's own room order (the order the report prints them), not the order the database happens to keep the keys in;
        // each room's scope also carries which room it is, which some fields are gated on.
        for (const { key, label, scope: inst } of resolveInstances(f, value)) {
          if (!key || !(key in (value as Record<string, unknown>))) continue;
          walk(f.itemFields ?? [], inst, [...prefix, f.key, key], [...trail, asString(inst.roomName).trim() || label]);
        }
      }
    }
  };
  walk(fields, answers ?? {}, [], []);

  // The section's own list: whatever it holds that no group above holds.
  const placed = new Set(groups.flatMap((g) => g.photos.map(photoKey)));
  const own = sectionPhotos.filter((u) => !placed.has(photoKey(u)));
  groups.push({ id: SECTION_GROUP_ID, title: groups.length ? "Other photos of this section" : "Photos of this section", defect: false, photos: own, path: null });
  return groups;
}

// ---- changes to the answers ----------------------------------------------------------------------------------------------------

function setAt(node: AnswerValue | undefined, path: AnswerPath, update: (current: AnswerValue | undefined) => AnswerValue): AnswerValue {
  if (path.length === 0) return update(node);
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const list = Array.isArray(node) ? [...(node as AnswerValue[])] : [];
    list[head] = setAt(list[head], rest, update);
    return list as AnswerValue;
  }
  const tree = asAnswerTree(node ?? {});
  return { ...tree, [head!]: setAt(tree[head!], rest, update) };
}

/** The photo list at `path`. */
export function photosAt(answers: AnswerTree | null | undefined, path: AnswerPath): string[] {
  let node: unknown = answers ?? {};
  for (const p of path) node = node && typeof node === "object" ? (node as Record<string | number, unknown>)[p] : undefined;
  return asStringArray(node as AnswerValue);
}

/** The answers with the list at `path` replaced by `list`. */
export function withPhotos(answers: AnswerTree | null | undefined, path: AnswerPath, list: string[]): AnswerTree {
  return setAt(answers ?? {}, path, () => list) as AnswerTree;
}

/** `list` with its `from`-th photo moved to position `to` (both clamped). */
export function moved<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item!);
  return next;
}

/**
 * The photo `url` taken out of the list at `from` and put into the list at `to`, at position `index` (the end when not given). The same list
 * is a reorder. A photo already in the destination is not added twice. Photos are matched by their address without the signed-link query.
 */
export function withPhotoMoved(answers: AnswerTree | null | undefined, from: AnswerPath, to: AnswerPath, url: string, index?: number): AnswerTree {
  const key = photoKey(url);
  const source = photosAt(answers, from);
  const at = source.findIndex((u) => photoKey(u) === key);
  if (at < 0) return (answers ?? {}) as AnswerTree;
  if (from.join("\u0000") === to.join("\u0000")) return withPhotos(answers, from, moved(source, at, index ?? source.length - 1));
  const without = withPhotos(answers, from, source.filter((_, i) => i !== at));
  const dest = photosAt(without, to).filter((u) => photoKey(u) !== key);
  dest.splice(index === undefined ? dest.length : Math.max(0, Math.min(dest.length, index)), 0, source[at]!);
  return withPhotos(without, to, dest);
}

/** The photo `url` taken out of the list at `path` (it stays wherever else it is used). */
export function withPhotoRemoved(answers: AnswerTree | null | undefined, path: AnswerPath, url: string): AnswerTree {
  const key = photoKey(url);
  return withPhotos(answers, path, photosAt(answers, path).filter((u) => photoKey(u) !== key));
}

/** The photo added to the list at `path` (at `index`, or the end). */
export function withPhotoAdded(answers: AnswerTree | null | undefined, path: AnswerPath, url: string, index?: number): AnswerTree {
  const list = photosAt(answers, path).filter((u) => photoKey(u) !== photoKey(url));
  list.splice(index === undefined ? list.length : Math.max(0, Math.min(list.length, index)), 0, url);
  return withPhotos(answers, path, list);
}

/** `url` replaced by `next` in whichever list holds it, at the same position (a photo replaced by a new file). */
export function withPhotoReplaced(answers: AnswerTree | null | undefined, groups: ToolGroup[], url: string, next: string): AnswerTree {
  const key = photoKey(url);
  let out = (answers ?? {}) as AnswerTree;
  for (const g of groups) {
    if (!g.path) continue;
    const list = photosAt(out, g.path);
    if (list.some((u) => photoKey(u) === key)) out = withPhotos(out, g.path, list.map((u) => (photoKey(u) === key ? next : u)));
  }
  return out;
}

/**
 * The section's flat photo list put in the order the groups arrange them: every group's photos in turn (form order), then whatever the groups do not
 * hold. Some reports print a part's photos from this flat list, so this is what makes the printed order follow the reviewer's arrangement. Each photo
 * keeps the link form (signature) the section already lists it by.
 */
export function flatOrder(groups: ToolGroup[], sectionPhotos: string[]): string[] {
  const listed = new Map(sectionPhotos.map((u) => [photoKey(u), u] as const));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const u of g.photos) {
      const k = photoKey(u);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(listed.get(k) ?? u);
    }
  }
  for (const u of sectionPhotos) if (!seen.has(photoKey(u))) out.push(u);
  return out;
}
