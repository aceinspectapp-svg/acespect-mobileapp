/**
 * Every photograph of one Construction Stage section, grouped by where it prints in the report: under a defect (a checklist row
 * answered "Defect", or one entry of the Defects list), or with a row's own photos ("Photos with measurements"), or as the section's
 * own photos (the client issues list, the street photos). The reviewer portal's "Photos For Report" panel shows these groups, so a
 * photo is chosen -- or added -- in the exact spot it prints, instead of in one undifferentiated list.
 *
 * Each group carries the answer path its photos live at, so a photo added to a group is written straight into that spot of the
 * section's answers (`withPhotoAdded`). Pure (no React), unit-tested in tests/construction-photo-groups.test.mjs.
 */
import type { AnswerTree, AnswerValue, TemplateField } from "../templateFields";
import { asAnswerTree, asString, asStringArray, isGateSatisfied } from "../templateFields";
import { defectKey, defectScope, isDefectAnswer } from "./defectDetail";
import { headingMap, headingOf } from "./words";

export type AnswerPath = (string | number)[];

export interface PhotoGroup {
  /** Stable id (the answer path, joined). */
  id: string;
  /** "Defect — Slab formwork dimensions", "Garage slab formed", "Client issues list" ... */
  title: string;
  /** A second line: the defect's location, or the field's own label ("Photos with measurements"). */
  detail?: string;
  /** True for a defect's photographs (they print under that defect). */
  defect: boolean;
  photos: string[];
  /** Where these photos are stored in the section's answers. */
  path: AnswerPath;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function constructionPhotoGroups(fields: TemplateField[], answers: AnswerTree | null | undefined): PhotoGroup[] {
  const a = answers ?? {};
  const groups: PhotoGroup[] = [];
  const headings = headingMap(fields);
  const visible = [...fields].filter((f) => isGateSatisfied(f, a)).sort((x, y) => x.order - y.order);
  const push = (g: Omit<PhotoGroup, "id">) => groups.push({ ...g, id: g.path.join(".") });

  for (const f of visible) {
    const heading = headings.get(f.key) ?? headingOf(f.label);
    if (isDefectAnswer(f, a[f.key])) {
      const d = defectScope(f, a);
      push({ title: `Defect — ${heading}`, detail: asString(d.location).trim() || undefined, defect: true, photos: asStringArray(d.photos), path: [defectKey(f.key), "photos"] });
      continue;
    }
    if (f.type === "photos") {
      // "slabDimensionsPhotos" belongs to the "slabDimensions" row: named after that row, the field's own label as its detail.
      const row = headings.get(f.key.replace(/Photos$/, ""));
      push({ title: row ?? cap(f.label.replace(/^Photos? (of|showing) /i, "")), detail: row ? f.label : undefined, defect: false, photos: asStringArray(a[f.key]), path: [f.key] });
      continue;
    }
    if ((f.type === "repeating-group" || f.type === "damage-list") && (f.repeat?.presentation ?? "strip") === "strip") {
      const photoFields = (f.itemFields ?? []).filter((x) => x.type === "photos");
      if (!photoFields.length) continue;
      const list = Array.isArray(a[f.key]) ? (a[f.key] as AnswerTree[]) : [];
      const noun = cap(f.repeat?.itemNoun ?? "item");
      const titleKey = f.repeat?.titleFieldKey;
      list.forEach((item, i) => {
        const scope = asAnswerTree(item as AnswerValue);
        const named = titleKey ? asString(scope[titleKey]).trim() : "";
        for (const pf of photoFields) {
          push({ title: `${noun} ${i + 1}`, detail: named || undefined, defect: /defect/i.test(noun), photos: asStringArray(scope[pf.key]), path: [f.key, i, pf.key] });
        }
      });
    }
  }
  return groups;
}

/** The answers with `url` added to the photo list at `path` (the parents are created if the spot is still empty). */
export function withPhotoAdded(answers: AnswerTree | null | undefined, path: AnswerPath, url: string): AnswerTree {
  return setAt(answers ?? {}, path, (current) => {
    const list = asStringArray(current);
    return list.includes(url) ? list : [...list, url];
  }) as AnswerTree;
}

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
