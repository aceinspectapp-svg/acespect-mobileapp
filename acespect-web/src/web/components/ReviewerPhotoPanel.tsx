import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api, resolveMediaUrl, type PhotoInfo, type PhotoPrintSize } from "../api";
import { useAppData } from "../data";
import type { FormSection, Inspection } from "../mockData";
import type { ActiveTemplate, AnswerTree } from "../templateFields";
import { flattenSectionToDraft } from "../templateFields";
import { reportProfileOf } from "../wording/profile";
import { photoKey } from "../reportParts";
import { applyEdits, hasEdits } from "../textEdits";
import {
  flatOrder, moved, photosAt, rotateEdit, SECTION_GROUP_ID, toolGroups, withPhotoAdded, withPhotoMoved, withPhotoRemoved, withPhotosMovedTo, type ToolGroup,
} from "../photoToolGroups";
import { PhotoEditorModal } from "./PhotoEditorModal";
import { PhotoLightbox, type LightboxItem } from "./PhotoLightbox";

type Info = PhotoInfo & { originalUrl?: string | null };
const mediaId = (url: string): string => /\/media\/([0-9a-f-]{36})/i.exec(url)?.[1]?.toLowerCase() ?? "";
const itemId = (g: ToolGroup, url: string) => `${g.id}|${photoKey(url)}`;
const NO_INFO: Info = { editedFromId: null, edit: null, addedByReviewer: false };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Filter = "all" | "out" | "edited" | "large" | "added";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "out", label: "Left out" },
  { key: "edited", label: "Edited" },
  { key: "large", label: "Large" },
  { key: "added", label: "Added by reviewer" },
];

/** What the section looked like before a change, so "Undo" can put it back. */
type Snapshot = { answers: AnswerTree; photos: string[]; excluded: string[]; meta: Record<string, unknown> };
type Undo = { id: number; label: string; undo: () => Promise<void> };
type Ask = { message: string; ok: string; danger?: boolean; resolve: (yes: boolean) => void };
type MoveAsk = { urls: { url: string; from: ToolGroup }[]; resolve: (to: ToolGroup | null) => void };

const THUMB_KEY = "acespect.reviewer.photoThumbSize";
const readThumb = (): number => {
  try { const v = Number(window.localStorage.getItem(THUMB_KEY)); return v >= 80 && v <= 260 ? v : 120; } catch { return 120; }
};

/**
 * "Select Photos For Report", with the photo tools: the section's photos grouped by where they print. Click a photo to see it large (and
 * rotate, resize, leave out or crop it from there, by button or key); hover a photo for its quick tools; drag it to reorder or move it to
 * another group; tick several to change them together. Every change can be undone from the bar that appears after it. Files dropped on a
 * group are uploaded into it. Everything is locked once the section is approved.
 *
 * A change to which group a photo sits in (or its order) is a change to the section's answers, so the report text is composed again
 * from them -- exactly as a Field Data save does -- and the printed report follows.
 */
export function ReviewerPhotoPanel({
  inspection,
  section,
  template,
  answers,
  locked,
  onSaveAnswers,
  onReopen,
}: {
  inspection: Inspection;
  section: FormSection;
  template: ActiveTemplate;
  /** The section's answers as the reviewer currently has them (saved ones plus any Field Data edits not yet saved). */
  answers: AnswerTree;
  /** True once the section is approved: every tool is off until it is reopened. */
  locked: boolean;
  /** Saves new answers (the report text is composed again from them) together with `extra` -- the section's flat photo list. */
  onSaveAnswers: (answers: AnswerTree, extra: { photos?: string[] }) => Promise<void>;
  /** Takes the section out of "approved" (back to pending) so its photos can be changed again. */
  onReopen?: () => Promise<void>;
}) {
  const { patchSection, patchInspection, editSectionPhoto, revertSectionPhoto, replaceSectionPhoto, deleteSectionPhoto } = useAppData();
  const sectionKey = section.key ?? section.id;
  const groups = useMemo(() => toolGroups(template.fields, answers, section.photos), [template.fields, answers, section.photos]);
  const excluded = section.excludedPhotoUrls ?? [];
  const meta = (section.photoMeta ?? {}) as Record<string, { size?: PhotoPrintSize }>;

  const [info, setInfo] = useState<Record<string, Info>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string[]>([]); // photo keys being saved
  const [uploading, setUploading] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [optimizeNote, setOptimizeNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ url: string; group: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]); // item ids
  const [anchor, setAnchor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [thumbSize, setThumbSize] = useState<number>(readThumb);
  const [wide, setWide] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [toast, setToast] = useState<Undo | null>(null);
  const [asking, setAsking] = useState<Ask | null>(null);
  const [moveAsk, setMoveAsk] = useState<MoveAsk | null>(null);

  // The latest section and answers, for an undo that runs after later renders.
  const live = useRef({ section, answers });
  live.current = { section, answers };

  // Which photos are edited copies / reviewer-added: asked once per set of photos.
  const idsKey = groups.flatMap((g) => g.photos.map(mediaId)).filter(Boolean).sort().join(",");
  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (!ids.length) return;
    let cancelled = false;
    api.photoInfo(ids).then((got) => !cancelled && setInfo((prev) => ({ ...prev, ...got }))).catch(() => undefined);
    return () => { cancelled = true; };
  }, [idsKey]);

  // A file dropped anywhere else on the page (a near miss) must not make the browser open it in place of the review page -- which would
  // also sign the reviewer out. Drops on a group or a photo are handled there.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes("Files") || e.defaultPrevented) return; // a group or photo took it
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => { window.removeEventListener("dragover", guard); window.removeEventListener("drop", guard); };
  }, []);

  // A selection belongs to one section and one unlocked state; the undo bar fades after a while.
  useEffect(() => { setSelected([]); setAnchor(null); setPreview(null); }, [section.id]);
  useEffect(() => { if (locked) setSelected([]); }, [locked]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), 9000);
    return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => { try { window.localStorage.setItem(THUMB_KEY, String(thumbSize)); } catch { /* per-viewer nicety only */ } }, [thumbSize]);
  useEffect(() => {
    if (!wide) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && preview === null && !editing && !asking && !moveAsk) setWide(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wide, preview, editing, asking, moveAsk]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Whether the section's text was edited by hand: composing it again (a move) would lose that, so ask first.
  const handEdited = useMemo(() => {
    try {
      const composed = flattenSectionToDraft(template.fields, (section.answers ?? {}) as AnswerTree, sectionKey, reportProfileOf(inspection.type, inspection.propertyType)).reportText;
      // the reviewer's wording saved through the text editor is put back after a move, so only text typed some other way is at risk
      const expected = hasEdits(section.textEdits) ? applyEdits(composed, section.textEdits).text : composed;
      return expected.replace(/\s+/g, " ").trim() !== section.reportText.replace(/\s+/g, " ").trim();
    } catch { return false; }
  }, [template.fields, section.answers, section.reportText, section.textEdits, sectionKey, inspection.type, inspection.propertyType]);

  // ---- small helpers ------------------------------------------------------------------------------------------------------------

  const ask = (message: string, ok: string, danger = false) => new Promise<boolean>((resolve) => setAsking({ message, ok, danger, resolve }));
  const pickGroup = (urls: { url: string; from: ToolGroup }[]) => new Promise<ToolGroup | null>((resolve) => setMoveAsk({ urls, resolve }));

  /** Runs one change: one at a time, its photos marked as saving, an error shown in plain words, and an undo offered afterwards. */
  async function run(work: () => Promise<Undo["undo"] | void>, label?: string, keys: string[] = []): Promise<void> {
    if (busy) return;
    setBusy(true);
    setWorking(keys.map(photoKey));
    setError(null);
    try {
      const undo = await work();
      if (undo && label) setToast({ id: Date.now(), label, undo });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setBusy(false);
      setWorking([]);
    }
  }

  const snapshot = (): Snapshot => {
    const s = live.current.section;
    return { answers: live.current.answers, photos: [...s.photos], excluded: [...(s.excludedPhotoUrls ?? [])], meta: { ...(s.photoMeta ?? {}) } };
  };
  /** Puts the section back as `snap` had it (answers, photo order, left-out photos, print sizes). */
  async function restore(snap: Snapshot) {
    const cur = live.current;
    const keys = (list: string[]) => list.map(photoKey);
    if (!same(cur.answers, snap.answers)) await onSaveAnswers(snap.answers, { photos: snap.photos });
    else if (!same(keys(cur.section.photos), keys(snap.photos))) await patchSection(inspection.id, section.id, { photos: snap.photos });
    const now = live.current.section;
    if (!same(keys(now.excludedPhotoUrls ?? []).sort(), keys(snap.excluded).sort()) || !same(now.photoMeta ?? {}, snap.meta)) {
      await patchSection(inspection.id, section.id, { excludedPhotoUrls: snap.excluded, photoMeta: snap.meta as Record<string, { size: PhotoPrintSize }> });
    }
  }
  const undoTo = (snap: Snapshot) => () => restore(snap);

  /** The section's flat photo list in the order `next` arranges them (reports that print a part's photos from it then follow). */
  const arranged = (next: AnswerTree, flat: string[] = section.photos) => flatOrder(toolGroups(template.fields, next, flat), flat);
  /** Saves changed answers (and the flat photo list) -- after asking, when it would replace report text the reviewer wrote. False: cancelled. */
  async function saveAnswers(next: AnswerTree, photos?: string[]): Promise<boolean> {
    if (handEdited && !(await ask("This section's report text was edited by hand. Changing where photos sit writes the text again from the inspector's answers, which replaces those edits.", "Change it anyway"))) return false;
    await onSaveAnswers(next, { photos: photos ?? arranged(next) });
    return true;
  }

  const isOut = (url: string) => excluded.some((u) => photoKey(u) === photoKey(url));
  const sizeOf = (url: string): PhotoPrintSize => (meta[mediaId(url)]?.size as PhotoPrintSize | undefined) ?? "standard";
  const infoOf = (url: string): Info => info[mediaId(url)] ?? NO_INFO;

  // ---- one photo ----------------------------------------------------------------------------------------------------------------

  const setOut = (urls: string[], out: boolean) =>
    run(async () => {
      const snap = snapshot();
      const keys = new Set(urls.map(photoKey));
      const kept = excluded.filter((u) => !keys.has(photoKey(u)));
      await patchSection(inspection.id, section.id, { excludedPhotoUrls: out ? [...kept, ...urls] : kept });
      return undoTo(snap);
    }, `${out ? "Left out" : "Put back"} ${plural(urls.length, "photo")}`, urls);
  const toggleOut = (url: string) => setOut([url], !isOut(url));

  const setSizes = (urls: string[], size: PhotoPrintSize) =>
    run(async () => {
      const snap = snapshot();
      const next = { ...meta } as Record<string, { size: PhotoPrintSize }>;
      for (const u of urls) { if (size === "standard") delete next[mediaId(u)]; else next[mediaId(u)] = { size }; }
      await patchSection(inspection.id, section.id, { photoMeta: next });
      return undoTo(snap);
    }, `${plural(urls.length, "photo")} set to print ${size === "large" ? "large" : "at the standard size"}`, urls);
  const toggleSize = (url: string) => setSizes([url], sizeOf(url) === "large" ? "standard" : "large");

  /** Turns photos a quarter turn, keeping any crop; one server copy each (the originals are kept). */
  const rotate = (urls: string[], dir: 1 | -1) =>
    run(async () => {
      const done: { fresh: string; before: Info["edit"] }[] = [];
      for (const url of urls) {
        const inf = infoOf(url);
        const before = inf.replaced ? null : inf.edit;
        const fresh = await editSectionPhoto(inspection.id, section.id, url, rotateEdit(before, dir));
        done.push({ fresh, before });
        // know the new copy's edit straight away, so a second quick turn builds on this one
        const got = await api.photoInfo([mediaId(fresh)]).catch(() => ({}));
        setInfo((prev) => ({ ...prev, ...got }));
      }
      return async () => {
        for (const d of done.reverse()) {
          if (d.before) await editSectionPhoto(inspection.id, section.id, d.fresh, { rotate: d.before.rotate ?? 0, ...(d.before.crop ? { crop: d.before.crop } : {}) });
          else await revertSectionPhoto(inspection.id, section.id, d.fresh);
        }
      };
    }, `Rotated ${plural(urls.length, "photo")} ${dir === 1 ? "right" : "left"}`, urls);

  /** Reorders or moves the photo `url` from group `from` to group `to`, at `index`. */
  function move(from: ToolGroup, to: ToolGroup, url: string, index: number) {
    if (locked) return;
    void run(async () => {
      const snap = snapshot();
      if (from.id === to.id) {
        if (from.path) return (await saveAnswers(withPhotoMoved(answers, from.path, from.path, url, index))) ? undoTo(snap) : undefined;
        // the section's own list: the group's photos swap places inside the flat list, every other photo keeps its slot
        const own = from.photos;
        const at = own.findIndex((u) => photoKey(u) === photoKey(url));
        const reordered = moved(own, at, index);
        const slots = section.photos.map((u, i) => (own.some((o) => photoKey(o) === photoKey(u)) ? i : -1)).filter((i) => i >= 0);
        const flat = [...section.photos];
        slots.forEach((slot, k) => { flat[slot] = reordered[k]!; });
        // no answer changes, so the report text is left exactly as it is -- only the photo order is saved
        await patchSection(inspection.id, section.id, { photos: flat });
        return undoTo(snap);
      }
      let next = answers;
      if (from.path && to.path) next = withPhotoMoved(answers, from.path, to.path, url, index);
      else if (from.path) next = withPhotoRemoved(answers, from.path, url);
      else if (to.path) next = withPhotoAdded(answers, to.path, url, index);
      const flat = section.photos.some((p) => photoKey(p) === photoKey(url)) ? section.photos : [...section.photos, url];
      return (await saveAnswers(next, arranged(next, flat))) ? undoTo(snap) : undefined;
    }, from.id === to.id ? "Moved a photo" : `Moved a photo to ${to.title}`, [url]);
  }

  /** Moves several photos (or one, from its menu) to a group the reviewer picks. */
  async function moveTo(items: { url: string; from: ToolGroup }[]) {
    const to = await pickGroup(items);
    if (!to) return;
    const moving = items.filter((i) => i.from.id !== to.id);
    if (!moving.length) return;
    await run(async () => {
      const snap = snapshot();
      const next = withPhotosMovedTo(answers, moving, to);
      const flat = [...section.photos, ...moving.map((m) => m.url).filter((u) => !section.photos.some((p) => photoKey(p) === photoKey(u)))];
      if (!(await saveAnswers(next, arranged(next, flat)))) return;
      setSelected([]);
      return undoTo(snap);
    }, `Moved ${plural(moving.length, "photo")} to ${to.title}`, moving.map((m) => m.url));
  }

  /** Uploads files into a group (at `index`, or the end). */
  function addFiles(group: ToolGroup, files: File[], index?: number) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (locked) return;
    if (!images.length) { if (files.length) setError("Only image files can be added."); return; }
    void run(async () => {
      const snap = snapshot();
      setUploading((u) => ({ ...u, [group.id]: images.map((f) => f.name) }));
      try {
        const urls: string[] = [];
        for (const f of images) urls.push((await api.uploadInspectionPhoto(f, inspection.id, sectionKey)).url);
        let next = answers;
        urls.forEach((u, k) => { if (group.path) next = withPhotoAdded(next, group.path, u, index === undefined ? undefined : index + k); });
        const flat = [...section.photos, ...urls.filter((u) => !section.photos.some((p) => photoKey(p) === photoKey(u)))];
        if (group.path) await onSaveAnswers(next, { photos: arranged(next, flat) });
        else await patchSection(inspection.id, section.id, { photos: flat });
        return undoTo(snap);
      } finally {
        setUploading((u) => { const n = { ...u }; delete n[group.id]; return n; });
      }
    }, `Added ${plural(images.length, "photo")} to ${group.title}`);
  }

  /**
   * A file dropped on a photo (or picked for it) takes its place -- everywhere the old photo is used, in the same spot, with the report
   * text left as it is. The server keeps the old photo, so Undo (or "Undo swap" in the editor) puts it back.
   */
  function replace(url: string, file: File) {
    if (locked) return;
    if (!file.type.startsWith("image/")) { setError("Only an image file can replace a photo."); return; }
    void run(async () => {
      const { url: fresh } = await api.uploadInspectionPhoto(file, inspection.id, sectionKey);
      const swapped = await replaceSectionPhoto(inspection.id, section.id, url, fresh);
      return async () => { await revertSectionPhoto(inspection.id, section.id, swapped); };
    }, "Swapped a photo", [url]);
  }

  /** Deletes photos a reviewer added (the inspector's own can only be left out). */
  async function remove(urls: string[]) {
    const mine = urls.filter((u) => infoOf(u).addedByReviewer);
    if (!mine.length) return;
    const skipped = urls.length - mine.length;
    const yes = await ask(
      `Delete ${mine.length === 1 ? "this photo" : `these ${mine.length} photos`}? ${mine.length === 1 ? "It was" : "They were"} added by a reviewer, so ${mine.length === 1 ? "it is" : "they are"} removed from the section completely. You can undo this straight after.${skipped ? ` (${plural(skipped, "inspector's photo")} in the selection can only be left out, not deleted, so ${skipped === 1 ? "it is" : "they are"} kept.)` : ""}`,
      mine.length === 1 ? "Delete photo" : `Delete ${mine.length} photos`,
      true,
    );
    if (!yes) return;
    await run(async () => {
      const snap = snapshot();
      for (const u of mine) await deleteSectionPhoto(inspection.id, section.id, u);
      setSelected([]);
      return undoTo(snap);
    }, `Deleted ${plural(mine.length, "photo")}`, mine);
  }

  /** Every photo of this section to 1024 x 768 and under 200 KB, as copies (the originals are kept). */
  const optimizeAll = () =>
    run(async () => {
      setOptimizeNote(null);
      const r = await api.optimizePhotos(inspection.id, section.id);
      await patchInspection(inspection.id, {});
      const mb = (n: number) => (n / 1048576).toFixed(1);
      setOptimizeNote(
        r.optimized
          ? `${plural(r.optimized, "photo")} resized to fit 1024 × 768 and under 200 KB (${mb(r.bytesBefore)} MB → ${mb(r.bytesAfter)} MB); ${r.alreadyFine} already fine${r.failed ? `; ${r.failed} could not be read` : ""}.`
          : `All ${r.alreadyFine} photos are already within 1024 × 768 and 200 KB.`,
      );
    });

  // ---- what is shown ------------------------------------------------------------------------------------------------------------

  const matches = useCallback((url: string): boolean => {
    if (filter === "all") return true;
    const inf = info[mediaId(url)] ?? NO_INFO;
    if (filter === "out") return excluded.some((u) => photoKey(u) === photoKey(url));
    if (filter === "edited") return !!inf.editedFromId;
    if (filter === "large") return (meta[mediaId(url)]?.size ?? "standard") === "large";
    return inf.addedByReviewer;
  }, [filter, info, excluded, meta]);

  /** Every shown photo, in the order the panel shows them: for the preview's ← → and for shift-click ranges. */
  const shown = useMemo(
    () => groups.flatMap((g) => (collapsed.includes(g.id) ? [] : g.photos.map((url, i) => ({ g, url, i })).filter((x) => matches(x.url)))),
    [groups, collapsed, matches],
  );
  const total = groups.reduce((n, g) => n + g.photos.length, 0);
  const outCount = groups.reduce((n, g) => n + g.photos.filter(isOut).length, 0);

  const selectedItems = selected
    .map((id) => { const g = groups.find((x) => id.startsWith(`${x.id}|`)); const url = g?.photos.find((u) => itemId(g, u) === id); return g && url ? { url, from: g } : null; })
    .filter((x): x is { url: string; from: ToolGroup } => !!x);
  const selectedUrls = selectedItems.map((s) => s.url);

  function toggleSelect(id: string, e: ReactMouseEvent | { shiftKey: boolean }) {
    if (locked) return;
    if (e.shiftKey && anchor) {
      const order = shown.map((x) => itemId(x.g, x.url));
      const a = order.indexOf(anchor), b = order.indexOf(id);
      if (a >= 0 && b >= 0) {
        const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelected((cur) => Array.from(new Set([...cur, ...range])));
        return;
      }
    }
    setAnchor(id);
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  const lightboxItems: LightboxItem[] = shown.map(({ g, url, i }) => {
    const inf = infoOf(url);
    return { url, where: g.title, number: i + 1, count: g.photos.length, out: isOut(url), size: sizeOf(url), edited: !!inf.editedFromId && !inf.replaced, swapped: !!inf.replaced, added: inf.addedByReviewer };
  });
  const openPreview = (g: ToolGroup, url: string) => {
    const at = shown.findIndex((x) => x.g.id === g.id && photoKey(x.url) === photoKey(url));
    setPreview(at >= 0 ? at : 0);
  };

  const jumpTo = (groupId: string) => {
    setCollapsed((c) => c.filter((x) => x !== groupId));
    window.setTimeout(() => document.querySelector(`[data-photo-group-id="${CSS_ESCAPE(groupId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  // ---- drag and drop ------------------------------------------------------------------------------------------------------------

  function onDragStart(e: DragStartEvent) {
    const d = e.active.data.current as { group: string; url: string } | undefined;
    if (d) setDragging(d);
  }
  function onDragEnd(e: DragEndEvent) {
    const d = e.active.data.current as { group: string; url: string } | undefined;
    const over = e.over;
    setDragging(null);
    if (!d || !over) return;
    const from = groups.find((g) => g.id === d.group);
    const overData = over.data.current as { group?: string; url?: string } | undefined;
    const to = groups.find((g) => g.id === (overData?.group ?? String(over.id).replace(/^drop:/, "")));
    if (!from || !to) return;
    const list = to.photos;
    const index = overData?.url ? list.findIndex((u) => photoKey(u) === photoKey(overData.url!)) : list.length;
    if (from.id === to.id && index === from.photos.findIndex((u) => photoKey(u) === photoKey(d.url))) return;
    move(from, to, d.url, index < 0 ? list.length : index);
  }

  // What a screen reader says while a photo is dragged: "Photo 3 of Kitchen › Room photos", not internal ids.
  const describe = (id: string | number | undefined): string => {
    if (id === undefined) return "nowhere";
    const s = String(id);
    if (s.startsWith("drop:")) return groups.find((g) => `drop:${g.id}` === s)?.title ?? "a group";
    const g = groups.find((x) => s.startsWith(`${x.id}|`));
    const at = g ? g.photos.findIndex((u) => itemId(g, u) === s) : -1;
    return g ? `photo ${at + 1} of ${g.title}` : "a photo";
  };
  const announcements = {
    onDragStart: ({ active }: { active: { id: string | number } }) => `Picked up ${describe(active.id)}.`,
    onDragOver: ({ over }: { over: { id: string | number } | null }) => (over ? `Over ${describe(over.id)}.` : "Not over a group."),
    onDragEnd: ({ over }: { over: { id: string | number } | null }) => (over ? `Dropped on ${describe(over.id)}.` : "Dropped back where it was."),
    onDragCancel: () => "Move cancelled; the photo stays where it was.",
  };

  const editingInfo = editing ? infoOf(editing) : NO_INFO;
  const anyAddedSelected = selectedUrls.some((u) => infoOf(u).addedByReviewer);

  // ---- layout -------------------------------------------------------------------------------------------------------------------

  const body = (
    <div data-photo-panel="" className="rpp" style={{ display: "flex", flexDirection: "column", gap: "10px", ["--rpp-thumb" as string]: `${thumbSize}px` } as CSSProperties}>
      <style>{PANEL_CSS}</style>

      {locked && (
        <div data-photo-locked="" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", fontSize: "12px", color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "8px 10px" }}>
          <span style={{ flex: "1 1 220px" }}>This section is approved, so its photos are locked. Reopen it to rotate, crop, resize, move or delete photos. You can still click a photo to view it.</span>
          {onReopen && (
            <button type="button" data-action="reopen-section" onClick={() => void run(onReopen)} disabled={busy} style={{ ...chip, color: "#92400e", borderColor: "#f59e0b", fontWeight: 700 }}>
              {busy ? "Reopening…" : "Reopen to edit photos"}
            </button>
          )}
        </div>
      )}

      {/* header: what is here, how to work it, and the view controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "#334155" }}>
            {plural(total, "photo")}{outCount ? ` · ${outCount} left out` : ""}
          </span>
          {busy && <span data-saving="" style={{ fontSize: "11px", fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", borderRadius: "999px", padding: "2px 9px" }}>Saving…</span>}
          <span style={{ flex: 1 }} />
          <button type="button" data-action="toggle-wide" onClick={() => setWide((w) => !w)} style={chip} title={wide ? "Back to the side panel (Esc)" : "Open the photos in a large window"}>
            {wide ? "⤡ Close large view" : "⤢ Large view"}
          </button>
        </div>
        {!locked && (
          <p data-photo-help="" style={{ margin: 0, fontSize: "11px", color: "#64748b", lineHeight: 1.5 }}>
            Click a photo to see it large · hover it for quick tools · drag it to reorder or move it · tick the box to select several · drop image files on a group to add them.
          </p>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {groups.length > 2 && (
            <select data-action="jump-to" aria-label="Jump to a group" value="" onChange={(e) => e.target.value && jumpTo(e.target.value)} style={{ ...chip, maxWidth: "220px" }}>
              <option value="">Jump to…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.title} ({g.photos.length})</option>)}
            </select>
          )}
          <select data-action="filter" aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={chip}>
            {FILTERS.map((f) => <option key={f.key} value={f.key}>{f.key === "all" ? "Show: all photos" : `Show: ${f.label.toLowerCase()}`}</option>)}
          </select>
          <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#64748b" }} title="Photo size in this panel (does not change the report)">
            <span aria-hidden>🔍</span>
            <input data-action="thumb-size" type="range" min={80} max={260} step={10} value={thumbSize} onChange={(e) => setThumbSize(Number(e.target.value))} aria-label="Photo size in this panel" style={{ width: "90px" }} />
          </label>
          {groups.length > 2 && (
            <button type="button" data-action="collapse-all" onClick={() => setCollapsed(collapsed.length ? [] : groups.map((g) => g.id))} style={chip}>
              {collapsed.length ? "Expand all" : "Collapse all"}
            </button>
          )}
          {!locked && (
            <button type="button" data-action="optimize-photos" onClick={optimizeAll} disabled={busy} title="New copies at the highest quality that fits; the originals are kept" style={{ ...chip, color: "#1d4ed8", background: "#eff6ff", borderColor: "#93c5fd", fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
              Resize all to 1024 × 768 · under 200 KB
            </button>
          )}
        </div>
        {optimizeNote && <span data-optimize-note="" style={{ fontSize: "11.5px", color: "#475569" }}>{optimizeNote}</span>}
      </div>

      {error && (
        <div role="alert" style={{ display: "flex", gap: "8px", alignItems: "flex-start", fontSize: "12px", color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "8px 10px" }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss" style={{ ...iconBtn, color: "#b91c1c" }}>✕</button>
        </div>
      )}

      {/* the bar for a selection of several photos */}
      {selectedItems.length > 0 && !locked && (
        <div data-selection-bar="" style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", background: "#1e3a8a", color: "white", borderRadius: "10px", padding: "8px 10px", boxShadow: "0 4px 14px rgba(30,58,138,0.3)" }}>
          <strong style={{ fontSize: "12px", marginRight: "4px" }}>{selectedItems.length} selected</strong>
          <button type="button" data-action="bulk-out" disabled={busy} onClick={() => void setOut(selectedUrls, true)} style={barBtn}>✕ Leave out</button>
          <button type="button" data-action="bulk-in" disabled={busy} onClick={() => void setOut(selectedUrls, false)} style={barBtn}>✓ Put back</button>
          <button type="button" data-action="bulk-rotate-left" disabled={busy} onClick={() => void rotate(selectedUrls, -1)} style={barBtn} title="Rotate left">⟲</button>
          <button type="button" data-action="bulk-rotate-right" disabled={busy} onClick={() => void rotate(selectedUrls, 1)} style={barBtn} title="Rotate right">⟳</button>
          <button type="button" data-action="bulk-large" disabled={busy} onClick={() => void setSizes(selectedUrls, "large")} style={barBtn}>⤢ Large</button>
          <button type="button" data-action="bulk-standard" disabled={busy} onClick={() => void setSizes(selectedUrls, "standard")} style={barBtn}>▭ Standard</button>
          <button type="button" data-action="bulk-move" disabled={busy} onClick={() => void moveTo(selectedItems)} style={barBtn}>↪ Move to…</button>
          {anyAddedSelected && <button type="button" data-action="bulk-delete" disabled={busy} onClick={() => void remove(selectedUrls)} style={{ ...barBtn, background: "#b91c1c", borderColor: "#fca5a5" }}>🗑 Delete</button>}
          <span style={{ flex: 1 }} />
          <button type="button" data-action="select-none" onClick={() => setSelected([])} style={{ ...barBtn, background: "transparent" }}>Clear</button>
        </div>
      )}

      <DndContext accessibility={{ announcements, screenReaderInstructions: { draggable: "To move a photo, press Space or Enter, use the arrow keys, then press Space or Enter again to drop it. Escape cancels." } }} sensors={locked ? [] : sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        {groups.map((g) => {
          const visible = g.photos.map((url, i) => ({ url, i })).filter((x) => matches(x.url));
          if (filter !== "all" && visible.length === 0) return null;
          const isCollapsed = collapsed.includes(g.id);
          const groupIds = g.photos.map((u) => itemId(g, u));
          const allSelected = groupIds.length > 0 && groupIds.every((id) => selected.includes(id));
          return (
            <Group
              key={g.id}
              group={g}
              locked={locked}
              busy={busy}
              collapsed={isCollapsed}
              shownCount={visible.length}
              outCount={g.photos.filter(isOut).length}
              allSelected={allSelected}
              uploading={uploading[g.id] ?? []}
              canDropHere={!!dragging && dragging.group !== g.id}
              onToggleCollapsed={() => setCollapsed((c) => (c.includes(g.id) ? c.filter((x) => x !== g.id) : [...c, g.id]))}
              onSelectAll={() => setSelected((cur) => (allSelected ? cur.filter((x) => !groupIds.includes(x)) : Array.from(new Set([...cur, ...groupIds]))))}
              onFiles={(files, index) => addFiles(g, files, index)}
            >
              {visible.map(({ url, i }) => {
                const inf = infoOf(url);
                const id = itemId(g, url);
                return (
                  <Tile
                    key={id}
                    id={id}
                    url={url}
                    groupId={g.id}
                    number={i + 1}
                    out={isOut(url)}
                    size={sizeOf(url)}
                    info={inf}
                    locked={locked}
                    busy={busy}
                    saving={working.includes(photoKey(url))}
                    selected={selected.includes(id)}
                    selecting={selected.length > 0}
                    first={i === 0}
                    last={i === g.photos.length - 1}
                    onOpen={() => openPreview(g, url)}
                    onSelect={(e) => toggleSelect(id, e)}
                    onEdit={() => setEditing(url)}
                    onRotate={(dir) => void rotate([url], dir)}
                    onToggle={() => void toggleOut(url)}
                    onSize={() => void toggleSize(url)}
                    onReplace={(f) => replace(url, f)}
                    onDelete={() => void remove([url])}
                    onMove={() => void moveTo([{ url, from: g }])}
                    onShift={(by) => move(g, g, url, i + by)}
                  />
                );
              })}
            </Group>
          );
        })}
        <DragOverlay>{dragging ? <img src={resolveMediaUrl(dragging.url)} alt="" style={{ ...thumb, boxShadow: "0 8px 24px rgba(0,0,0,0.35)", width: `${thumbSize}px` }} /> : null}</DragOverlay>
      </DndContext>
      {filter !== "all" && shown.length === 0 && <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>No photos match “{FILTERS.find((f) => f.key === filter)?.label}”.</p>}
    </div>
  );

  return (
    <>
      {wide ? (
        <div data-photo-wide="" style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(15,23,42,0.5)", padding: "20px" }} onMouseDown={(e) => e.target === e.currentTarget && setWide(false)}>
          <div style={{ background: "white", borderRadius: "14px", height: "100%", overflow: "auto", padding: "16px 20px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
            <h3 style={{ margin: "0 0 10px", fontSize: "15px", color: "#0f172a" }}>{section.name} — photos for the report</h3>
            {body}
          </div>
        </div>
      ) : body}

      {preview !== null && lightboxItems.length > 0 && (
        <PhotoLightbox
          items={lightboxItems}
          index={preview}
          locked={locked}
          busy={busy}
          onIndex={setPreview}
          onClose={() => setPreview(null)}
          onRotate={(url, dir) => void rotate([url], dir)}
          onToggleOut={(url) => void toggleOut(url)}
          onToggleSize={(url) => void toggleSize(url)}
          onEdit={(url) => setEditing(url)}
        />
      )}

      {editing && (
        <PhotoEditorModal
          url={editing}
          info={editingInfo}
          onClose={() => setEditing(null)}
          onSave={async (edit) => {
            const from = editing;
            const before = editingInfo.replaced ? null : editingInfo.edit;
            const fresh = await editSectionPhoto(inspection.id, section.id, from, edit);
            setToast({
              id: Date.now(), label: "Edited a photo",
              undo: async () => {
                if (before) await editSectionPhoto(inspection.id, section.id, fresh, { rotate: before.rotate ?? 0, ...(before.crop ? { crop: before.crop } : {}) });
                else await revertSectionPhoto(inspection.id, section.id, fresh);
              },
            });
          }}
          onRevert={async () => { await revertSectionPhoto(inspection.id, section.id, editing); }}
        />
      )}

      {toast && (
        <div data-undo-toast="" role="status" style={{ position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)", zIndex: 1200, display: "flex", alignItems: "center", gap: "12px", background: "#0f172a", color: "white", borderRadius: "10px", padding: "10px 14px", boxShadow: "0 10px 30px rgba(0,0,0,0.35)", fontSize: "13px", maxWidth: "calc(100vw - 32px)" }}>
          <span>{toast.label}</span>
          <button
            type="button"
            data-action="undo"
            disabled={busy}
            onClick={() => { const t = toast; setToast(null); void run(async () => { await t.undo(); }, undefined); }}
            style={{ fontSize: "13px", fontWeight: 700, color: "#93c5fd", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Undo
          </button>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" style={{ ...iconBtn, color: "#94a3b8" }}>✕</button>
        </div>
      )}

      {asking && (
        <Dialog title="Please confirm" onClose={() => { asking.resolve(false); setAsking(null); }}>
          <p data-confirm-message="" style={{ margin: "0 0 16px", fontSize: "13px", lineHeight: 1.6, color: "#334155" }}>{asking.message}</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
            <button type="button" data-action="confirm-cancel" onClick={() => { asking.resolve(false); setAsking(null); }} style={chip}>Cancel</button>
            <button type="button" data-action="confirm-ok" autoFocus onClick={() => { asking.resolve(true); setAsking(null); }} style={{ ...chip, color: "white", fontWeight: 700, background: asking.danger ? "#dc2626" : "#2563eb", borderColor: asking.danger ? "#dc2626" : "#2563eb" }}>{asking.ok}</button>
          </div>
        </Dialog>
      )}

      {moveAsk && (
        <Dialog title={`Move ${plural(moveAsk.urls.length, "photo")} to…`} onClose={() => { moveAsk.resolve(null); setMoveAsk(null); }}>
          <div data-move-picker="" style={{ display: "flex", flexDirection: "column", gap: "4px", maxHeight: "55vh", overflow: "auto" }}>
            {groups.map((g) => {
              const here = moveAsk.urls.every((u) => u.from.id === g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  disabled={here}
                  onClick={() => { moveAsk.resolve(g); setMoveAsk(null); }}
                  style={{ textAlign: "left", fontSize: "12.5px", padding: "8px 10px", borderRadius: "8px", border: "1px solid #e2e8f0", background: here ? "#f8fafc" : "white", color: here ? "#94a3b8" : g.defect ? "#b91c1c" : "#1e293b", cursor: here ? "default" : "pointer" }}
                >
                  {g.title}{g.detail ? ` — ${g.detail}` : ""} <span style={{ color: "#94a3b8" }}>({g.photos.length}){here ? " · already here" : ""}</span>
                </button>
              );
            })}
          </div>
        </Dialog>
      )}
    </>
  );
}

const CSS_ESCAPE = (s: string) => (globalThis.CSS?.escape ? globalThis.CSS.escape(s) : s.replace(/"/g, "\\\""));

// ---- one group of photos ---------------------------------------------------------------------------------------------------------

function Group({
  group, locked, busy, collapsed, shownCount, outCount, allSelected, uploading, canDropHere, onToggleCollapsed, onSelectAll, onFiles, children,
}: {
  group: ToolGroup; locked: boolean; busy: boolean; collapsed: boolean; shownCount: number; outCount: number; allSelected: boolean; uploading: string[]; canDropHere: boolean;
  onToggleCollapsed: () => void; onSelectAll: () => void; onFiles: (files: File[], index?: number) => void; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${group.id}`, data: { group: group.id }, disabled: locked });
  const [fileOver, setFileOver] = useState(false);
  const hasFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const highlight = isOver || fileOver;
  return (
    <div
      ref={setNodeRef}
      data-photo-group={group.title}
      data-photo-group-id={group.id}
      data-drop-target={highlight ? "" : undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        // always taken here, so a file dropped on a locked panel is refused instead of the browser opening it in place of this page
        e.preventDefault();
        if (locked) { e.dataTransfer.dropEffect = "none"; return; }
        setFileOver(true);
      }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setFileOver(false);
        if (!locked) onFiles(Array.from(e.dataTransfer.files));
      }}
      style={{ borderTop: "1px solid #f1f5f9", paddingTop: "8px", borderRadius: "8px", background: highlight ? "#eff6ff" : "transparent", outline: highlight ? "2px dashed #60a5fa" : canDropHere ? "1px dashed #cbd5e1" : "none", outlineOffset: "2px", transition: "background 0.1s", scrollMarginTop: "60px" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: collapsed ? 0 : "6px" }}>
        <button type="button" data-action="toggle-group" onClick={onToggleCollapsed} aria-expanded={!collapsed} style={{ display: "flex", alignItems: "flex-start", gap: "6px", minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
          <span aria-hidden style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px", transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 0.1s" }}>▼</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: "12px", fontWeight: 700, color: group.defect ? "#b91c1c" : "#334155" }}>
              {group.title} <span style={{ fontWeight: 500, color: "#94a3b8" }}>({group.photos.length}{outCount ? `, ${outCount} left out` : ""}{shownCount !== group.photos.length ? `, ${shownCount} shown` : ""})</span>
            </span>
            {group.detail && <span style={{ display: "block", fontSize: "11px", color: "#64748b", marginTop: "1px" }}>{group.detail}</span>}
          </span>
        </button>
        {!locked && (
          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
            {group.photos.length > 1 && !collapsed && (
              <button type="button" data-action="select-group" onClick={onSelectAll} style={{ ...chip, padding: "3px 8px", fontSize: "11px" }}>{allSelected ? "Unselect" : "Select all"}</button>
            )}
            <AddFiles disabled={busy} onFiles={(files) => onFiles(files)} />
          </div>
        )}
      </div>
      {!collapsed && (
        <>
          <SortableContext items={group.photos.map((u) => `${group.id}|${photoKey(u)}`)} strategy={rectSortingStrategy}>
            <div className="rpp-grid" style={{ minHeight: group.photos.length || uploading.length ? undefined : "38px" }}>
              {children}
              {uploading.map((name, i) => (
                <div key={`up-${i}`} data-upload-tile="" style={{ ...thumb, display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", color: "#64748b", fontSize: "10.5px", textAlign: "center", padding: "4px" }}>
                  <span className="rpp-spin" aria-hidden /> Uploading {name.length > 14 ? `${name.slice(0, 12)}…` : name}
                </div>
              ))}
            </div>
          </SortableContext>
          {group.photos.length === 0 && uploading.length === 0 && (
            <p style={{ fontSize: "11px", color: "#94a3b8", margin: "4px 0 0" }}>{locked ? "No photos." : "No photos yet — drop image files here, or drag a photo in."}</p>
          )}
        </>
      )}
    </div>
  );
}

// ---- one photo -------------------------------------------------------------------------------------------------------------------

function Tile({
  id, url, groupId, number, out, size, info, locked, busy, saving, selected, selecting, first, last,
  onOpen, onSelect, onEdit, onRotate, onToggle, onSize, onReplace, onDelete, onMove, onShift,
}: {
  id: string; url: string; groupId: string; number: number; out: boolean; size: PhotoPrintSize; info: Info; locked: boolean; busy: boolean; saving: boolean;
  selected: boolean; selecting: boolean; first: boolean; last: boolean;
  onOpen: () => void; onSelect: (e: ReactMouseEvent) => void; onEdit: () => void; onRotate: (dir: 1 | -1) => void; onToggle: () => void; onSize: () => void;
  onReplace: (f: File) => void; onDelete: () => void; onMove: () => void; onShift: (by: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { group: groupId, url }, disabled: locked });
  const [fileOver, setFileOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const style: CSSProperties = { position: "relative", transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1, touchAction: "none" };
  const stop = { onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(), onKeyDown: (e: { stopPropagation: () => void }) => e.stopPropagation() };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rpp-tile${selected ? " is-selected" : ""}${selecting ? " is-selecting" : ""}`}
      data-photo-thumb={out ? "removed" : "included"}
      data-photo-size={size}
      data-selected={selected ? "" : undefined}
      onDragOver={(e) => { if (!locked && Array.from(e.dataTransfer?.types ?? []).includes("Files")) { e.preventDefault(); e.stopPropagation(); setFileOver(true); } }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setFileOver(false);
        const f = e.dataTransfer.files[0];
        if (f && !locked) onReplace(f);
      }}
      {...attributes}
      {...listeners}
    >
      <div className="rpp-frame" style={{ position: "relative", borderRadius: "8px", overflow: "hidden", outline: selected ? "3px solid #2563eb" : fileOver ? "2px solid #93c5fd" : "none", outlineOffset: "1px" }}>
        <img
          src={resolveMediaUrl(url)}
          alt={`Photo ${number}`}
          draggable={false}
          onClick={(e) => (selecting && !locked ? onSelect(e) : onOpen())}
          title={locked ? "Click to view" : selecting ? "Click to select or unselect" : "Click to view large · drag to move"}
          style={{ ...thumb, cursor: "pointer", opacity: out ? 0.35 : 1, border: `1px solid ${fileOver ? "#2563eb" : out ? "#fca5a5" : "#e5e7eb"}`, filter: saving ? "brightness(0.7)" : "none" }}
        />
        {saving && <span className="rpp-spin rpp-spin-center" aria-label="Saving" />}

        {/* top-left: select box + number */}
        <div style={{ position: "absolute", top: "4px", left: "4px", display: "flex", gap: "4px", alignItems: "center" }}>
          {!locked && (
            <input
              type="checkbox"
              className="rpp-check"
              data-action="select-photo"
              checked={selected}
              onChange={() => undefined}
              onClick={(e) => { e.stopPropagation(); onSelect(e); }}
              {...stop}
              aria-label={`Select photo ${number}`}
              style={{ width: "16px", height: "16px", margin: 0, cursor: "pointer", accentColor: "#2563eb" }}
            />
          )}
          <span style={{ fontSize: "10px", fontWeight: 700, color: "white", background: "rgba(15,23,42,0.65)", borderRadius: "4px", padding: "0 4px" }}>{number}</span>
        </div>

        {/* top-right: in / out of the report */}
        <button
          type="button"
          data-action="toggle-include"
          onClick={onToggle}
          {...stop}
          disabled={locked || busy}
          title={out ? "Left out of the report — click to put it back" : "In the report — click to leave it out"}
          aria-label={out ? `Put photo ${number} back in the report` : `Leave photo ${number} out of the report`}
          style={{ position: "absolute", top: "4px", right: "4px", width: "22px", height: "22px", borderRadius: "50%", border: "2px solid white", cursor: locked ? "default" : "pointer", fontSize: "11px", fontWeight: 700, color: "white", background: out ? "rgba(15,23,42,0.7)" : "#16a34a", boxShadow: "0 1px 3px rgba(0,0,0,0.3)", padding: 0 }}
        >
          {out ? "✕" : "✓"}
        </button>

        {/* bottom-left: what has been done to it */}
        <div style={{ position: "absolute", left: "4px", bottom: "4px", display: "flex", gap: "3px", flexWrap: "wrap" }}>
          {out && <span style={{ ...badge, background: "#b91c1c" }}>left out</span>}
          {info.editedFromId && (info.replaced
            ? <span title="Swapped for another file; Undo swap in the editor puts the old one back" style={badge}>swapped</span>
            : <span title="Rotated or cropped; the original is kept" style={badge}>edited</span>)}
          {info.addedByReviewer && <span title="Added by a reviewer" style={badge}>added</span>}
          {size === "large" && <span title="Prints large" style={{ ...badge, background: "#1d4ed8" }}>large</span>}
        </div>

        {/* quick tools, shown on hover (always on touch screens) */}
        {!locked && !selecting && (
          <div className="rpp-actions" data-photo-tools="" {...stop}>
            <ToolIcon label="⟲" title="Rotate left" action="rotate-left" onClick={() => onRotate(-1)} disabled={busy} />
            <ToolIcon label="⟳" title="Rotate right" action="rotate-right" onClick={() => onRotate(1)} disabled={busy} />
            <ToolIcon label="✂" title="Crop or rotate…" action="edit" onClick={onEdit} disabled={busy} />
            <ToolIcon label={size === "large" ? "▭" : "⤢"} title={size === "large" ? "Print at the standard size" : "Print large, on its own row"} action="size" onClick={onSize} disabled={busy} active={size === "large"} />
            <ToolIcon label="↪" title="Move to another group…" action="move" onClick={onMove} disabled={busy} />
            <ToolIcon label="⇄" title="Replace with another file (Undo puts this one back)" action="swap" onClick={() => pick.current?.click()} disabled={busy} />
            {info.addedByReviewer && <ToolIcon label="🗑" title="Delete this photo you added" action="delete" onClick={onDelete} disabled={busy} danger />}
          </div>
        )}
      </div>

      {/* earlier / later, for anyone not dragging */}
      {!locked && (
        <div data-photo-order="" {...stop} style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
          <button type="button" className="rpp-mini" aria-label={`Move photo ${number} earlier`} title="Move earlier" onClick={() => onShift(-1)} disabled={busy || first}>◀</button>
          <button type="button" className="rpp-mini" aria-label={`Move photo ${number} later`} title="Move later" onClick={() => onShift(1)} disabled={busy || last}>▶</button>
        </div>
      )}
      <input ref={pick} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onReplace(f); }} />
    </div>
  );
}

function ToolIcon({ label, title, action, onClick, disabled, danger = false, active = false }: { label: string; title: string; action: string; onClick: () => void; disabled?: boolean; danger?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-action={action}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className={`rpp-icon${danger ? " is-danger" : ""}${active ? " is-active" : ""}`}
    >
      {label}
    </button>
  );
}

function AddFiles({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  return (
    <label style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", fontSize: "11px", fontWeight: 700, color: disabled ? "#94a3b8" : "#2563eb", cursor: disabled ? "default" : "pointer", padding: "3px 9px", border: `1px dashed ${disabled ? "#cbd5e1" : "#93c5fd"}`, borderRadius: "999px", background: "#f8fafc" }}>
      + Add
      <input type="file" accept="image/*" multiple disabled={disabled} style={{ display: "none" }} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) onFiles(files); }} />
    </label>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-photo-dialog="" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(15,23,42,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "white", borderRadius: "12px", padding: "18px 20px", width: "min(460px, 100%)", boxShadow: "0 20px 50px rgba(0,0,0,0.3)" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: "15px", color: "#0f172a" }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

const thumb: CSSProperties = { width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block", borderRadius: "8px", border: "1px solid #e5e7eb" };
const badge: CSSProperties = { fontSize: "9px", fontWeight: 700, color: "white", background: "rgba(15,23,42,0.7)", borderRadius: "4px", padding: "0 4px" };
const chip: CSSProperties = { fontSize: "11.5px", fontWeight: 600, color: "#334155", background: "white", border: "1px solid #cbd5e1", borderRadius: "8px", padding: "5px 10px", cursor: "pointer" };
const barBtn: CSSProperties = { fontSize: "11.5px", fontWeight: 600, color: "white", background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: "7px", padding: "4px 9px", cursor: "pointer" };
const iconBtn: CSSProperties = { background: "none", border: "none", cursor: "pointer", fontSize: "12px", padding: "0 2px" };

const PANEL_CSS = `
.rpp .rpp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--rpp-thumb, 120px), 1fr)); gap: 10px; }
.rpp .rpp-actions { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 3px; padding: 18px 4px 4px;
  background: linear-gradient(to top, rgba(15,23,42,0.8), rgba(15,23,42,0)); opacity: 0; transition: opacity 0.12s; }
.rpp .rpp-tile:hover .rpp-actions, .rpp .rpp-tile:focus-within .rpp-actions { opacity: 1; }
.rpp .rpp-check { opacity: 0; transition: opacity 0.12s; }
.rpp .rpp-tile:hover .rpp-check, .rpp .rpp-tile:focus-within .rpp-check, .rpp .rpp-tile.is-selecting .rpp-check, .rpp .rpp-tile.is-selected .rpp-check { opacity: 1; }
@media (hover: none) { .rpp .rpp-actions, .rpp .rpp-check { opacity: 1; } }
.rpp .rpp-icon { min-width: 26px; height: 26px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.5); background: rgba(255,255,255,0.92); color: #0f172a;
  font-size: 13px; line-height: 1; cursor: pointer; padding: 0 4px; }
.rpp .rpp-icon:hover:not(:disabled) { background: white; border-color: #2563eb; color: #1d4ed8; }
.rpp .rpp-icon.is-active { background: #1d4ed8; color: white; border-color: #1d4ed8; }
.rpp .rpp-icon.is-danger { color: #b91c1c; }
.rpp .rpp-icon:disabled { opacity: 0.45; cursor: default; }
.rpp .rpp-mini { font-size: 10px; line-height: 1; padding: 2px 8px; border-radius: 6px; border: 1px solid #e2e8f0; background: white; color: #475569; cursor: pointer; }
.rpp .rpp-mini:disabled { opacity: 0.3; cursor: default; }
.rpp .rpp-tile.is-selected img { opacity: 0.85; }
.rpp-spin { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.5); border-top-color: #2563eb; border-radius: 50%; animation: rpp-spin 0.8s linear infinite; vertical-align: middle; }
.rpp-spin-center { position: absolute; top: 50%; left: 50%; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-color: rgba(255,255,255,0.6); border-top-color: white; }
@keyframes rpp-spin { to { transform: rotate(360deg); } }
`;

export { SECTION_GROUP_ID, photosAt };
