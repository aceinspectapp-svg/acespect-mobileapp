import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
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
import { flatOrder, moved, photosAt, SECTION_GROUP_ID, toolGroups, withPhotoAdded, withPhotoMoved, withPhotoRemoved, type ToolGroup } from "../photoToolGroups";
import { PhotoEditorModal } from "./PhotoEditorModal";

type Info = PhotoInfo & { originalUrl?: string | null };
const mediaId = (url: string): string => /\/media\/([0-9a-f-]{36})/i.exec(url)?.[1]?.toLowerCase() ?? "";
const itemId = (g: ToolGroup, url: string) => `${g.id}|${photoKey(url)}`;
const NO_INFO: Info = { editedFromId: null, edit: null, addedByReviewer: false };

/**
 * "Select Photos For Report", with the photo tools: the section's photos grouped by where they print, each one clickable to edit
 * (rotate / crop), draggable to reorder or move to another group, and with its own include, print size, replace and delete controls.
 * Files dropped on a group are uploaded into it. Everything is locked once the section is approved.
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
  const meta = section.photoMeta ?? {};

  const [info, setInfo] = useState<Record<string, Info>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [optimizeNote, setOptimizeNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ url: string; group: string } | null>(null);

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

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Whether the section's text was edited by hand: composing it again (a move) would lose that, so ask first.
  const handEdited = useMemo(() => {
    try {
      const composed = flattenSectionToDraft(template.fields, (section.answers ?? {}) as AnswerTree, sectionKey, reportProfileOf(inspection.type, inspection.propertyType)).reportText;
      return composed.replace(/\s+/g, " ").trim() !== section.reportText.replace(/\s+/g, " ").trim();
    } catch { return false; }
  }, [template.fields, section.answers, section.reportText, sectionKey, inspection.type, inspection.propertyType]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "That did not work."); } finally { setBusy(false); }
  }
  /** Saves changed answers (and the flat photo list), after a warning when it would replace text the reviewer wrote. */
  /** The section's flat photo list in the order `next` arranges them (reports that print a part's photos from it then follow). */
  const arranged = (next: AnswerTree, flat: string[] = section.photos) => flatOrder(toolGroups(template.fields, next, flat), flat);
  const saveAnswers = (next: AnswerTree, photos?: string[]) =>
    run(async () => {
      if (handEdited && !window.confirm("This section's report text was edited by hand. Changing where photos sit writes the text again from the answers, which replaces those edits. Continue?")) return;
      await onSaveAnswers(next, { photos: photos ?? arranged(next) });
    });

  const isOut = (url: string) => excluded.some((u) => photoKey(u) === photoKey(url));
  const toggleExcluded = (url: string) =>
    run(() => patchSection(inspection.id, section.id, { excludedPhotoUrls: isOut(url) ? excluded.filter((u) => photoKey(u) !== photoKey(url)) : [...excluded, url] }));

  const setSize = (url: string, size: PhotoPrintSize) =>
    run(() => {
      const next = { ...meta } as Record<string, { size: PhotoPrintSize }>;
      if (size === "standard") delete next[mediaId(url)]; else next[mediaId(url)] = { size };
      return patchSection(inspection.id, section.id, { photoMeta: next });
    });

  /** Reorders or moves the photo `url` from group `from` to group `to`, at `index`. */
  function move(from: ToolGroup, to: ToolGroup, url: string, index: number) {
    if (locked) return;
    if (from.id === to.id) {
      if (from.path) return void saveAnswers(withPhotoMoved(answers, from.path, from.path, url, index));
      // the section's own list: the group's photos swap places inside the flat list, every other photo keeps its slot
      const own = from.photos;
      const at = own.findIndex((u) => photoKey(u) === photoKey(url));
      const reordered = moved(own, at, index);
      const slots = section.photos.map((u, i) => (own.some((o) => photoKey(o) === photoKey(u)) ? i : -1)).filter((i) => i >= 0);
      const flat = [...section.photos];
      slots.forEach((slot, k) => { flat[slot] = reordered[k]!; });
      // no answer changes, so the report text is left exactly as it is -- only the photo order is saved
      return void run(() => patchSection(inspection.id, section.id, { photos: flat }));
    }
    let next = answers;
    if (from.path && to.path) next = withPhotoMoved(answers, from.path, to.path, url, index);
    // out of an item and into the section's own list: it is still in the flat list, so it then shows in the section's group
    else if (from.path) next = withPhotoRemoved(answers, from.path, url);
    // out of the section's own list and into an item
    else if (to.path) next = withPhotoAdded(answers, to.path, url, index);
    void saveAnswers(next);
  }

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

  /** Uploads files into a group (at `index`, or the end). */
  function addFiles(group: ToolGroup, files: File[], index?: number) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (locked || !images.length) return;
    void run(async () => {
      setUploading((u) => ({ ...u, [group.id]: images.map((f) => f.name) }));
      try {
        const urls: string[] = [];
        for (const f of images) urls.push((await api.uploadInspectionPhoto(f, inspection.id, sectionKey)).url);
        let next = answers;
        urls.forEach((u, k) => { if (group.path) next = withPhotoAdded(next, group.path, u, index === undefined ? undefined : index + k); });
        const flat = [...section.photos, ...urls.filter((u) => !section.photos.some((p) => photoKey(p) === photoKey(u)))];
        if (group.path) await onSaveAnswers(next, { photos: arranged(next, flat) });
        else await patchSection(inspection.id, section.id, { photos: flat });
      } finally {
        setUploading((u) => { const n = { ...u }; delete n[group.id]; return n; });
      }
    });
  }

  /**
   * A file dropped on a photo (or picked for it) takes its place -- everywhere the old photo is used, in the same spot, with the report
   * text left as it is. The server keeps the old photo, so "Revert" in the editor puts it back.
   */
  function replace(url: string, file: File) {
    if (locked || !file.type.startsWith("image/")) return;
    void run(async () => {
      const { url: fresh } = await api.uploadInspectionPhoto(file, inspection.id, sectionKey);
      await replaceSectionPhoto(inspection.id, section.id, url, fresh);
    });
  }

  const remove = (url: string) => {
    if (!window.confirm("Delete this photo? It was added by a reviewer, so it is removed from the section completely.")) return;
    void run(() => deleteSectionPhoto(inspection.id, section.id, url));
  };

  /** Every photo of this section to 1024 x 768 and under 200 KB, as copies (the originals are kept). */
  const optimizeAll = () =>
    run(async () => {
      setOptimizeNote(null);
      const r = await api.optimizePhotos(inspection.id, section.id);
      await patchInspection(inspection.id, {});
      const mb = (n: number) => (n / 1048576).toFixed(1);
      setOptimizeNote(
        r.optimized
          ? `${r.optimized} photo${r.optimized === 1 ? "" : "s"} resized to fit 1024 × 768 and under 200 KB (${mb(r.bytesBefore)} MB → ${mb(r.bytesAfter)} MB); ${r.alreadyFine} already fine${r.failed ? `; ${r.failed} could not be read` : ""}.`
          : `All ${r.alreadyFine} photos are already within 1024 × 768 and 200 KB.`,
      );
    });

  const editingInfo = editing ? info[mediaId(editing)] ?? NO_INFO : NO_INFO;

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

  return (
    <div data-photo-panel="" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {locked && (
        <div data-photo-locked="" style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", fontSize: "12px", color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "8px", padding: "8px 10px" }}>
          <span style={{ flex: "1 1 220px" }}>This section is approved, so its photos are locked. Reopen it to rotate, crop, resize, move or delete photos.</span>
          {onReopen && (
            <button type="button" data-action="reopen-section" onClick={() => void run(onReopen)} disabled={busy} style={{ fontSize: "11.5px", fontWeight: 700, color: "#92400e", background: "white", border: "1px solid #f59e0b", borderRadius: "8px", padding: "5px 10px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Reopening…" : "Reopen to edit photos"}
            </button>
          )}
        </div>
      )}
      {!locked && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" data-action="optimize-photos" onClick={optimizeAll} disabled={busy} title="New copies at the highest quality that fits; the originals are kept" style={{ fontSize: "11.5px", fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: "8px", padding: "5px 10px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Working…" : "Resize all to 1024 × 768 · under 200 KB"}
          </button>
          {optimizeNote && <span data-optimize-note="" style={{ fontSize: "11.5px", color: "#475569" }}>{optimizeNote}</span>}
        </div>
      )}
      {error && <p role="alert" style={{ margin: 0, fontSize: "12px", color: "#b91c1c" }}>{error}</p>}
      <DndContext accessibility={{ announcements, screenReaderInstructions: { draggable: "To move a photo, press Space or Enter, use the arrow keys, then press Space or Enter again to drop it. Escape cancels." } }} sensors={locked ? [] : sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        {groups.map((g) => (
          <Group
            key={g.id}
            group={g}
            locked={locked}
            busy={busy}
            uploading={uploading[g.id] ?? []}
            canDropHere={!!dragging && dragging.group !== g.id}
            onFiles={(files, index) => addFiles(g, files, index)}
          >
            {g.photos.map((url, i) => {
              const id = mediaId(url);
              const inf = info[id] ?? NO_INFO;
              return (
                <Tile
                  key={itemId(g, url)}
                  id={itemId(g, url)}
                  url={url}
                  groupId={g.id}
                  number={i + 1}
                  out={isOut(url)}
                  size={(meta[id]?.size as PhotoPrintSize | undefined) ?? "standard"}
                  info={inf}
                  locked={locked}
                  busy={busy}
                  first={i === 0}
                  last={i === g.photos.length - 1}
                  onEdit={() => setEditing(url)}
                  onToggle={() => toggleExcluded(url)}
                  onSize={(s) => setSize(url, s)}
                  onReplace={(f) => replace(url, f)}
                  onDelete={() => remove(url)}
                  onShift={(by) => move(g, g, url, i + by)}
                />
              );
            })}
          </Group>
        ))}
        <DragOverlay>{dragging ? <img src={resolveMediaUrl(dragging.url)} alt="" style={{ ...thumb, boxShadow: "0 8px 24px rgba(0,0,0,0.35)", width: "110px" }} /> : null}</DragOverlay>
      </DndContext>

      {editing && (
        <PhotoEditorModal
          url={editing}
          info={editingInfo}
          onClose={() => setEditing(null)}
          onSave={async (edit) => { await editSectionPhoto(inspection.id, section.id, editing, edit); }}
          onRevert={async () => { await revertSectionPhoto(inspection.id, section.id, editing); }}
        />
      )}
    </div>
  );
}

// ---- one group of photos ---------------------------------------------------------------------------------------------------------

function Group({
  group, locked, busy, uploading, canDropHere, onFiles, children,
}: {
  group: ToolGroup; locked: boolean; busy: boolean; uploading: string[]; canDropHere: boolean;
  onFiles: (files: File[], index?: number) => void; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `drop:${group.id}`, data: { group: group.id }, disabled: locked });
  const [fileOver, setFileOver] = useState(false);
  const hasFiles = (e: ReactDragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const highlight = isOver || fileOver;
  return (
    <div
      ref={setNodeRef}
      data-photo-group={group.title}
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
      style={{ borderTop: "1px solid #f1f5f9", paddingTop: "10px", borderRadius: "8px", background: highlight ? "#eff6ff" : "transparent", outline: highlight ? "2px dashed #60a5fa" : canDropHere ? "1px dashed #cbd5e1" : "none", outlineOffset: "2px", transition: "background 0.1s" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: "12px", fontWeight: 700, color: group.defect ? "#b91c1c" : "#334155", margin: 0 }}>{group.title}</p>
          {group.detail && <p style={{ fontSize: "11px", color: "#64748b", margin: "1px 0 0" }}>{group.detail}</p>}
        </div>
        {!locked && <AddFiles disabled={busy} onFiles={(files) => onFiles(files)} />}
      </div>
      <SortableContext items={group.photos.map((u) => `${group.id}|${photoKey(u)}`)} strategy={rectSortingStrategy}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: "8px", minHeight: group.photos.length || uploading.length ? undefined : "38px" }}>
          {children}
          {uploading.map((name, i) => (
            <div key={`up-${i}`} data-upload-tile="" style={{ ...thumb, display: "flex", alignItems: "center", justifyContent: "center", background: "#f1f5f9", color: "#64748b", fontSize: "10.5px", textAlign: "center", padding: "4px" }}>
              Uploading {name.length > 14 ? `${name.slice(0, 12)}…` : name}
            </div>
          ))}
        </div>
      </SortableContext>
      {group.photos.length === 0 && uploading.length === 0 && (
        <p style={{ fontSize: "11px", color: "#94a3b8", margin: "4px 0 0" }}>{locked ? "No photos." : "No photos yet — drop image files here, or drag a photo in."}</p>
      )}
    </div>
  );
}

// ---- one photo -------------------------------------------------------------------------------------------------------------------

function Tile({
  id, url, groupId, number, out, size, info, locked, busy, first, last, onEdit, onToggle, onSize, onReplace, onDelete, onShift,
}: {
  id: string; url: string; groupId: string; number: number; out: boolean; size: PhotoPrintSize; info: Info; locked: boolean; busy: boolean; first: boolean; last: boolean;
  onEdit: () => void; onToggle: () => void; onSize: (s: PhotoPrintSize) => void; onReplace: (f: File) => void; onDelete: () => void; onShift: (by: -1 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, data: { group: groupId, url }, disabled: locked });
  const [fileOver, setFileOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const style: CSSProperties = { position: "relative", transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1, touchAction: "none" };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-photo-thumb={out ? "removed" : "included"}
      data-photo-size={size}
      onDragOver={(e) => { if (!locked && Array.from(e.dataTransfer?.types ?? []).includes("Files")) { e.preventDefault(); e.stopPropagation(); setFileOver(true); } }}
      onDragLeave={() => setFileOver(false)}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer?.types ?? []).includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        setFileOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onReplace(f);
      }}
      {...attributes}
      {...listeners}
    >
      <img
        src={resolveMediaUrl(url)}
        alt={`Photo ${number}`}
        draggable={false}
        onClick={() => !locked && onEdit()}
        title={locked ? "" : "Click to rotate or crop · drag to move"}
        style={{ ...thumb, cursor: locked ? "default" : "grab", opacity: out ? 0.35 : 1, border: `1px solid ${fileOver ? "#2563eb" : out ? "#fca5a5" : "#e5e7eb"}`, outline: fileOver ? "2px solid #93c5fd" : "none" }}
      />
      <span style={{ position: "absolute", top: "3px", left: "3px", fontSize: "10px", fontWeight: 700, color: "white", background: "rgba(15,23,42,0.65)", borderRadius: "4px", padding: "0 4px" }}>{number}</span>
      <button
        type="button"
        data-action="toggle-include"
        onClick={onToggle}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        disabled={locked || busy}
        title={out ? "Left out of the report — click to put it back" : "In the report — click to leave it out"}
        style={{ position: "absolute", top: "3px", right: "3px", width: "20px", height: "20px", borderRadius: "50%", border: "none", cursor: locked ? "default" : "pointer", fontSize: "11px", fontWeight: 700, color: "white", background: out ? "rgba(15,23,42,0.6)" : "#16a34a", boxShadow: "0 1px 3px rgba(0,0,0,0.3)", padding: 0 }}
      >
        {out ? "✕" : "✓"}
      </button>
      <div style={{ position: "absolute", left: "3px", bottom: "3px", display: "flex", gap: "3px" }}>
        {info.editedFromId && (info.replaced
          ? <span title="Swapped for another file; click the photo and use Revert to put the old one back" style={badge}>swapped</span>
          : <span title="Rotated or cropped; the original is kept" style={badge}>edited</span>)}
        {info.addedByReviewer && <span title="Added by a reviewer" style={badge}>added</span>}
        {size === "large" && <span title="Prints large" style={{ ...badge, background: "#1d4ed8" }}>large</span>}
      </div>
      {!locked && (
        <div data-photo-tools="" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} style={{ display: "flex", flexWrap: "wrap", gap: "2px", marginTop: "3px" }}>
          <ToolBtn label="Edit" title="Rotate or crop" onClick={onEdit} disabled={busy} />
          <ToolBtn label={size === "large" ? "Std" : "Large"} title={size === "large" ? "Print at the standard size" : "Print large, on its own row"} onClick={() => onSize(size === "large" ? "standard" : "large")} disabled={busy} />
          <ToolBtn label="◀" title="Move earlier" onClick={() => onShift(-1)} disabled={busy || first} />
          <ToolBtn label="▶" title="Move later" onClick={() => onShift(1)} disabled={busy || last} />
          <ToolBtn label="Swap" title="Replace with another file (Revert in the editor puts this one back)" onClick={() => pick.current?.click()} disabled={busy} />
          {info.addedByReviewer && <ToolBtn label="Delete" title="Delete this photo you added" onClick={onDelete} disabled={busy} danger />}
          <input ref={pick} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onReplace(f); }} />
        </div>
      )}
    </div>
  );
}

function ToolBtn({ label, title, onClick, disabled, danger = false }: { label: string; title: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{ fontSize: "10px", fontWeight: 600, lineHeight: 1.2, padding: "2px 5px", borderRadius: "5px", border: `1px solid ${danger ? "#fecaca" : "#cbd5e1"}`, color: danger ? "#b91c1c" : "#334155", background: "white", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1 }}
    >
      {label}
    </button>
  );
}

function AddFiles({ disabled, onFiles }: { disabled: boolean; onFiles: (files: File[]) => void }) {
  return (
    <label style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", fontSize: "11px", fontWeight: 700, color: disabled ? "#94a3b8" : "#2563eb", cursor: disabled ? "default" : "pointer", padding: "3px 9px", border: `1px dashed ${disabled ? "#cbd5e1" : "#93c5fd"}`, borderRadius: "999px", background: "#f8fafc" }}>
      {disabled ? "Saving…" : "+ Add"}
      <input type="file" accept="image/*" multiple disabled={disabled} style={{ display: "none" }} onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) onFiles(files); }} />
    </label>
  );
}

const thumb: CSSProperties = { width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block", borderRadius: "8px", border: "1px solid #e5e7eb" };
const badge: CSSProperties = { fontSize: "9px", fontWeight: 700, color: "white", background: "rgba(15,23,42,0.7)", borderRadius: "4px", padding: "0 4px" };

export { SECTION_GROUP_ID, photosAt };
