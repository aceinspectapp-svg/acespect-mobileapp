import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Inspection } from "../mockData";
import { formatLongDate, registrationLabel, type ReportHeader } from "../report";
import { fetchActiveTemplate, type AnswerTree, type TemplateField } from "../templateFields";
import { reportProfileOf } from "../wording/profile";
import { PhotoGrid, PhotoNumberProvider, usePhotoNumbering } from "../components/reportKit";
import { COVER_COLORS, CoverPage, DEFAULT_SIGNATURE } from "../components/CoverPage";
import { constructionSectionText } from "./sectionText";
import { ReportAgreement } from "../components/ReportAgreement";
import { OriginalPhotosPending, useOriginalPhotosLink } from "../components/OriginalPhotosLink";
import { CONSTRUCTION_AGREEMENT_BLOCKS, CONSTRUCTION_AGREEMENT_TITLE } from "./agreementText";
import { itemName, optionText, withItemName } from "./printCase";
import {
  ITEM_STATUSES, buildConstructionReport, type AttachedList, type ChecklistTable, type ConstructionReportModel, type DefectEntry, type ItemStatus, type SectionInput,
} from "./reportModel";

const isConstruction = (inspection?: Inspection) => !!inspection && /construction/i.test(inspection.type);

/**
 * Loads each submitted section's template and builds the report model from each section's wording (the same text the
 * reviewer portal shows). Returns undefined while loading, null for an inspection that is not a Construction Stage one.
 */
export function useConstructionReport(inspection?: Inspection, opts?: { includeUnapproved?: boolean }): ConstructionReportModel | null | undefined {
  const all = !!opts?.includeUnapproved;
  const [model, setModel] = useState<ConstructionReportModel | null | undefined>(isConstruction(inspection) ? undefined : null);
  // Rebuilt whenever a section's text, answers (a photo added to a defect) or left-out photos change, so the preview follows every edit.
  const key = inspection
    ? `${all ? "all" : "approved"}:${inspection.id}:${inspection.sections.map((s) => `${s.key ?? s.id}:${s.reviewStatus}:${s.reportText.length}:${(s.excludedPhotoUrls ?? []).join("|")}:${JSON.stringify(s.answers ?? null)}`).join(",")}`
    : "";

  useEffect(() => {
    if (!inspection || !isConstruction(inspection)) { setModel(null); return; }
    let cancelled = false;
    const profile = reportProfileOf(inspection.type, inspection.propertyType);
    const sections = inspection.sections.filter((s) => !(s.key ?? s.id).startsWith("job-info"));
    Promise.all(
      sections.map(async (s) => {
        const sectionKey = s.key ?? s.id;
        const t = await fetchActiveTemplate(inspection.type, inspection.propertyType, sectionKey);
        const fields = (t?.fields ?? []) as TemplateField[];
        const text = constructionSectionText(s, fields, profile);
        const input: SectionInput = {
          key: sectionKey,
          name: s.name,
          approved: all || s.reviewStatus === "approved",
          reportText: text.reportText,
          damages: text.damages,
          answers: (s.answers as AnswerTree | null | undefined) ?? null,
          fields,
          excludedPhotos: s.excludedPhotoUrls ?? [],
        };
        return input;
      }),
    ).then((inputs) => {
      if (cancelled) return;
      const jobInfo = inspection.sections.find((s) => (s.key ?? s.id).startsWith("job-info"));
      setModel(buildConstructionReport(inputs, (jobInfo?.answers as AnswerTree | null | undefined) ?? null));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return isConstruction(inspection) ? model : null;
}

/** Report file name, e.g. "V123-construction-report.pdf". */
export const constructionFileName = (jobNo: string) => `${(jobNo || "inspection").replace(/[^a-z0-9.-]+/gi, "-")}-construction-report.pdf`;

// ───────────────────────── Look ─────────────────────────

const C = {
  ...COVER_COLORS, faint: "#9ca3af", band: "#e8eef8", // the cover's colours are the report's colours: one list, in components/CoverPage.tsx
};

const STATUS: Record<ItemStatus, { label: string; sub: string; stripe: string; bg: string; fg: string }> = {
  ok: { label: "CHECKED & OK", sub: "Inspected and satisfactory", stripe: "#2e9e5b", bg: "#e0f4e8", fg: "#1f6b3f" },
  progress: { label: "IN PROGRESS", sub: "Work under way at inspection", stripe: "#2b5fd9", bg: "#dde8fb", fg: "#1e40af" },
  defect: { label: "REFER DEFECTS", sub: "Listed in Identified Defects", stripe: "#d1262b", bg: "#fde3e3", fg: "#9b1c1c" },
  note: { label: "REFER NOTES", sub: "See comment or Notes section", stripe: "#ee9b00", bg: "#fef0cf", fg: "#8a5300" },
  notcomplete: { label: "NOT COMPLETE", sub: "Not yet started / not sighted", stripe: "#7b8794", bg: "#e6e8ec", fg: "#374151" },
  na: { label: "NOT APPLICABLE", sub: "Does not apply to this build", stripe: "#b8c0cc", bg: "#f1f2f4", fg: "#4b5563" },
};

const page: CSSProperties = { fontFamily: C.font, color: C.ink, fontSize: "13px", lineHeight: 1.45 };

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ margin: "0 0 14px", paddingBottom: "6px", borderBottom: `2.5px solid ${C.red}`, color: C.navy, fontSize: "17px", fontWeight: 700, textTransform: "uppercase", breakAfter: "avoid" }}>
      {children}
    </h2>
  );
}
const SubHeading = ({ children }: { children: ReactNode }) => (
  <h3 style={{ margin: "18px 0 6px", color: C.navy, fontSize: "12.5px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", breakAfter: "avoid" }}>{children}</h3>
);
/**
 * Prints its children on one page: a heading and the first thing under it, so a heading is never left alone at the bottom of a page
 * (Chrome's PDF does not honour break-after: avoid reliably; break-inside: avoid on a wrapper is honoured).
 */
const KeepTogether = ({ children }: { children: ReactNode }) => <div style={{ breakInside: "avoid" }}>{children}</div>;
const Back = () => (
  <div style={{ textAlign: "right", margin: "-4px 0 12px" }}>
    <a href="#checklist" style={{ color: "#2563eb", fontSize: "11.5px" }}>↑ Back to summary</a>
  </div>
);
const Bullets = ({ items, lead }: { items: string[]; lead?: ReactNode }) => {
  const li = (t: string, i: number) => (
    <li key={i} style={{ display: "flex", gap: "10px", margin: "0 0 4px", breakInside: "avoid" }}>
      <span style={{ color: C.red, lineHeight: 1.45 }}>•</span>
      <span style={{ flex: 1 }}>{t}</span>
    </li>
  );
  const ul = { listStyle: "none", margin: 0, padding: 0 } as const;
  // `lead` (a heading) is printed on the same page as the first bullet.
  return (
    <div style={{ margin: "0 0 10px" }}>
      <KeepTogether>{lead}<ul style={ul}>{items.slice(0, 1).map(li)}</ul></KeepTogether>
      {items.length > 1 && <ul style={ul}>{items.slice(1).map((t, i) => li(t, i + 1))}</ul>}
    </div>
  );
};

/** "Please refer to Photographs 397 to 418." / "Please refer to Photograph 12." -- empty where the photos carry no report numbers (the reviewer's preview). */
export function photoReference(start: number | undefined, count: number): string {
  if (start === undefined || count === 0) return "";
  return count === 1 ? `Please refer to Photograph ${start}.` : `Please refer to Photographs ${start} to ${start + count - 1}.`;
}

function photoRange(start: number | undefined, count: number): string {
  if (start === undefined) return "";
  return count === 1 ? `${start}` : `${start} to ${start + count - 1}`;
}

// ───────────────────────── Cover ─────────────────────────

/** The Construction Report's cover: the shared cover page (components/CoverPage.tsx, also the Dilapidation cover) with this report's details. */
export function Cover({ r, model, inspection, compact = false }: { r: ReportHeader; model: ConstructionReportModel; inspection: Inspection; compact?: boolean }) {
  const jobInfo = inspection.sections.find((s) => (s.key ?? s.id).startsWith("job-info"));
  const email = r.clientEmail || String((jobInfo?.fields as Record<string, unknown> | undefined)?.clientEmail ?? "") || undefined;
  return (
    <CoverPage
      compact={compact}
      logo={<img src="/houspect-logo.png" alt="Houspect Building Inspections" style={{ height: "56px", width: "auto", display: "block" }} />}
      reportDate={r.reportDate}
      clientName={r.clientName}
      clientNotes={email ? [`Via email: ${email}`] : []}
      references={[["Our Reference", r.ourReference]]}
      kicker="Construction Report"
      title={model.coverTitle}
      rows={[
        ["Property", r.property],
        ["Inspection Date", r.inspectionDate],
        ["Weather Conditions", optionText("weather", r.weather)],
        // "Joe Briffa (Builder Registration No DBU 58070)", "Trevor Scott (Architect Registration No ARBV 13238)" -- as the template words it.
        ["Inspector", `${r.inspector}${r.inspectorRegistration ? ` ${registrationLabel(r.inspectorRegistration)}` : ""}`],
        ["Stage", model.stageLabel],
        ["Report Purpose", model.purpose],
        ["General", model.general],
      ]}
      signatureName="Dinuke De Coonghe"
      signatureTitle="Director – Houspect Victoria"
      signatureImage={r.signatureUrl || DEFAULT_SIGNATURE}
    />
  );
}

// ───────────────────────── Checklist ─────────────────────────

function SummaryTiles({ model }: { model: ConstructionReportModel }) {
  const target: Partial<Record<ItemStatus, string>> = { defect: "#defects", note: "#notes" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "4px", margin: "0 0 22px" }}>
      {ITEM_STATUSES.map((k) => {
        const s = STATUS[k];
        const inner = (
          <>
            <div style={{ fontSize: "26px", fontWeight: 800, color: s.fg, lineHeight: 1.1 }}>{model.totals[k]}</div>
            <div style={{ fontSize: "8.5px", fontWeight: 800, letterSpacing: "0.03em", color: s.fg, margin: "3px 0 4px", whiteSpace: "nowrap", textDecoration: target[k] ? "underline" : "none" }}>{s.label}</div>
            <div style={{ fontSize: "9.5px", color: "#4b5563", lineHeight: 1.3 }}>{s.sub}</div>
          </>
        );
        const box: CSSProperties = { borderTop: `3.5px solid ${s.stripe}`, background: s.bg, padding: "9px 6px 10px", textAlign: "center", display: "block", color: "inherit", textDecoration: "none" };
        return target[k] ? <a key={k} href={target[k]} style={box}>{inner}</a> : <div key={k} style={box}>{inner}</div>;
      })}
    </div>
  );
}

function countsLine(t: ChecklistTable): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (t.counts.defect) parts.push(plural(t.counts.defect, "defect", "defects"));
  if (t.counts.note) parts.push(plural(t.counts.note, "note", "notes"));
  if (t.counts.progress) parts.push(`${t.counts.progress} in progress`);
  if (t.counts.notcomplete) parts.push(`${t.counts.notcomplete} not complete`);
  if (t.counts.ok) parts.push(`${t.counts.ok} OK`);
  return parts.join(" · ");
}

function RowPhotos({ heading, photos, compact }: { heading: string; photos: string[]; compact?: boolean }) {
  const numbering = usePhotoNumbering(photos, `row:${heading}`);
  // The caption is printed with the first row of photos (kept on one page together); the rest of the photos may run on to the next page.
  const caption = <div style={{ fontSize: "11px", color: C.grey }}>Photographs — {itemName(heading)}{numbering.start !== undefined ? ` (${photoRange(numbering.start, photos.length)})` : ""}</div>;
  return (
    <div style={{ margin: "6px 0 4px" }}>
      <PhotoGrid photos={photos} compact={!!compact} startNumber={numbering.start} caption={caption} />
    </div>
  );
}

function Table({ t, compact }: { t: ChecklistTable; compact?: boolean }) {
  const titleBar = (
    <div style={{ background: C.navy, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px" }}>
      <span style={{ fontWeight: 700, letterSpacing: "0.05em", fontSize: "13px" }}>{t.title}</span>
      <span style={{ fontSize: "10.5px", fontWeight: 700, opacity: 0.95 }}>{countsLine(t)}</span>
    </div>
  );
  return (
    <div style={{ margin: "0 0 20px" }}>
      {t.intro && !t.groups.length && <p style={{ margin: "0 0 8px" }}>{t.intro}</p>}
      {!t.groups.length && titleBar}
      {t.groups.map((g, gi) => (
        <Fragment key={gi}>
          {g.items.map((it, ii) => {
            const s = STATUS[it.status];
            const href = it.status === "defect" && it.defectNo ? `#defect-${it.defectNo}` : it.status === "note" ? "#notes" : undefined;
            const name = <span style={{ fontWeight: 700, fontSize: "13px", color: href ? C.navy : C.ink, textDecoration: href ? "underline" : "none" }}>{itemName(it.heading)}</span>;
            const rowEl = (
              <div key={it.id} id={it.id} style={{ display: "grid", gridTemplateColumns: compact ? "5px 1fr 88px" : "6px 1fr 146px", borderBottom: `1px solid ${C.rule}`, breakInside: "avoid" }}>
                <div style={{ background: s.stripe }} />
                <div style={{ padding: "6px 10px 7px" }}>
                  <div>{href ? <a href={href} style={{ textDecoration: "none" }}>{name}</a> : name}</div>
                  <div style={{ fontSize: "11.5px", color: C.grey, marginTop: "1px" }}>{it.text}</div>
                </div>
                <div style={{ background: s.bg, color: s.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: compact ? "8.5px" : "10px", fontWeight: 800, letterSpacing: compact ? "0.04em" : "0.1em", textAlign: "center", padding: "0 4px" }}>
                  {href ? <a href={href} style={{ color: s.fg, textDecoration: "underline" }}>{s.label} ›</a> : s.label}
                </div>
              </div>
            );
            if (ii > 0) return rowEl;
            // The first row of a group prints on one page with the group's sub-heading -- and, for the table's first group, with the
            // template's sentence above the table and the table's title bar -- so none of them is ever left alone at a page bottom.
            return (
              <KeepTogether key={it.id}>
                {gi === 0 && t.intro && <p style={{ margin: "0 0 8px" }}>{t.intro}</p>}
                {gi === 0 && titleBar}
                {g.heading && (
                  <div style={{ background: C.band, color: C.navy, fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 10px" }}>{g.heading}</div>
                )}
                {rowEl}
              </KeepTogether>
            );
          })}
        </Fragment>
      ))}
      {t.footnote && <p style={{ margin: "8px 0 4px", fontStyle: "italic", fontSize: "12px", lineHeight: 1.4, breakInside: "avoid" }}>{t.footnote}</p>}
      {t.photos.map((p, i) => <RowPhotos key={i} heading={p.heading} photos={p.photos} compact={compact} />)}
    </div>
  );
}

// ───────────────────────── Defects ─────────────────────────

function Defect({ d, lead, compact }: { d: DefectEntry; lead?: ReactNode; compact?: boolean }) {
  const numbering = usePhotoNumbering(d.photos, `defect:${d.no}`);
  const small: CSSProperties = { fontSize: "11px", color: "#4b5563", marginTop: "2px" };
  // `lead` (the headings above the first defect of a topic) and the defect's card print on one page with the first row of its photos;
  // the rest of a long run of photos carries on over the page.
  const card = (
    <>
      {lead}
      {/* The template's format: the location in bold (the checklist item when no location was recorded), then the numbered description
          ending with its own photographs: "Please refer to Photographs 397 to 418." */}
      {d.heading && <div data-defect-heading="" style={{ fontWeight: 700, fontSize: "13.5px", color: C.ink, margin: "0 0 4px" }}>{d.item && d.heading === d.item ? itemName(d.heading) : d.heading}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "30px 1fr", background: "#fff1f1" }}>
        <div style={{ background: C.red, color: "white", fontWeight: 700, fontSize: "12px", padding: "6px 0 0", textAlign: "center" }}>{d.no}</div>
        <div style={{ padding: "6px 10px 7px" }}>
          <div style={{ fontSize: "13.5px" }}>{[withItemName(d.description, d.item), photoReference(numbering.start, d.photos.length)].filter(Boolean).join(" ")}</div>
          {(d.severity || d.category) && (
            <div style={small}>
              {d.severity && <><b style={{ color: C.ink }}>Severity:</b> {d.severity}</>}
              {d.severity && d.category && "   ·   "}
              {d.category && <><b style={{ color: C.ink }}>Category:</b> {d.category}</>}
            </div>
          )}
          {d.codeTitle && <div style={small}><b style={{ color: C.ink }}>NCC / AS reference:</b> {d.codeTitle}</div>}
        </div>
      </div>
    </>
  );
  return (
    <div id={`defect-${d.no}`} style={{ margin: "0 0 14px" }}>
      {d.photos.length > 0
        ? <PhotoGrid photos={d.photos} compact={!!compact} startNumber={numbering.start} caption={<div style={{ marginBottom: "6px" }}>{card}</div>} />
        : <KeepTogether>{card}</KeepTogether>}
    </div>
  );
}

/** The numbered defects, by topic. `lead` (the section's own heading) prints on one page with the first defect. */
function Defects({ model, archiveUrl, lead }: { model: ConstructionReportModel; archiveUrl?: string | null; lead?: ReactNode }) {
  if (model.defectCount === 0) return <KeepTogether>{lead}<p style={{ margin: "0 0 12px" }}>No defects were identified at the time of inspection.</p></KeepTogether>;
  const groups = model.defectGroups.filter((g) => g.defects.length > 0);
  return (
    <>
      {groups.map((g, gi) => {
        const topic = (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.rule}`, margin: "14px 0 8px", paddingBottom: "3px" }}>
            <span style={{ color: C.navy, fontWeight: 700, fontSize: "14.5px" }}>{g.heading}</span>
            {archiveUrl && <a href={archiveUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontSize: "11px", fontWeight: 700 }}>View additional photos ›</a>}
          </div>
        );
        return (
          <div key={g.heading}>
            {g.defects.map((d, i) => <Defect key={d.no} d={d} lead={i === 0 ? <>{gi === 0 && lead}{topic}</> : undefined} />)}
          </div>
        );
      })}
    </>
  );
}

// ───────────────────────── Previous defects / client concerns ─────────────────────────

function ListTable({ heads, intro, na, list, row, lead, compact }: { heads: string[]; intro: string; na: string; list: AttachedList; row: (list: AttachedList) => ReactNode[]; lead?: ReactNode; compact?: boolean }) {
  const numbering = usePhotoNumbering(list.photos, "list:" + heads.join("|"));
  const cols = "74px 108px 1fr 112px 150px";
  const cells = list.attached ? row(list) : [];
  const caption = <div style={{ fontSize: "11px", color: C.grey }}>Photographs{numbering.start !== undefined ? `: ${photoRange(numbering.start, list.photos.length)}` : ""}</div>;
  if (compact) {
    // The reviewer's narrow panel: each column as a labelled line, then the photos at the panel's own size -- as every other section shows them.
    return (
      <div>
        <p style={{ margin: "0 0 8px" }}>{intro}</p>
        {list.attached ? (
          <>
            <div style={{ border: `1px solid ${C.rule}`, borderRadius: "6px", overflow: "hidden", fontSize: "12px" }}>
              {heads.map((h, i) => (
                <div key={h} style={{ display: "grid", gridTemplateColumns: "92px 1fr", borderTop: i ? `1px solid ${C.rule}` : undefined }}>
                  <div style={{ background: C.band, color: C.navy, fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", padding: "6px 8px" }}>{h}</div>
                  <div style={{ padding: "6px 8px" }}>{cells[i]}</div>
                </div>
              ))}
            </div>
            {list.photos.length > 0 && <div style={{ margin: "8px 0 0" }}><PhotoGrid photos={list.photos} compact caption={caption} startNumber={numbering.start} /></div>}
          </>
        ) : (
          <p style={{ margin: "6px 0 0", fontStyle: "italic", fontSize: "11.5px", color: C.grey }}>{na}</p>
        )}
      </div>
    );
  }
  return (
    <div>
      {/* The heading (`lead`), the introduction and the table print on one page. */}
      <KeepTogether>
        {lead}
        <p style={{ margin: "0 0 10px" }}>{intro}</p>
        {list.attached && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: cols, background: C.navy, color: "white", fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {heads.map((h) => <div key={h} style={{ padding: "8px" }}>{h}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: `1px solid ${C.rule}`, fontSize: "12px" }}>
              {cells.map((c, i) => <div key={i} style={{ padding: "8px", background: i === 3 ? "#f3f4f6" : undefined }}>{c}</div>)}
            </div>
          </>
        )}
        {!list.attached && <p style={{ margin: "6px 0 0", fontStyle: "italic", fontSize: "11.5px", color: C.grey }}>{na}</p>}
      </KeepTogether>
      {list.attached && list.photos.length > 0 && (
        <div style={{ margin: "8px 0 0" }}>
          <PhotoGrid photos={list.photos} compact={false} startNumber={numbering.start} caption={<div style={{ fontSize: "11px", color: C.grey }}>Photographs: {photoRange(numbering.start, list.photos.length)}</div>} />
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Terms ─────────────────────────

/** The template's "Conditions for the Provision of the Report and Scope", on a page of its own. */
function TermsPages() {
  return (
    <div className="report-page-break">
      <ReportAgreement title={CONSTRUCTION_AGREEMENT_TITLE} blocks={CONSTRUCTION_AGREEMENT_BLOCKS} />
    </div>
  );
}

// ───────────────────────── The page ─────────────────────────

export function ConstructionReportBody({ inspection, model, header }: { inspection: Inspection; model: ConstructionReportModel; header: ReportHeader }) {
  const archive = inspection.photoArchiveUrl;
  // The Photographs "Click here" downloads every original photo of the inspection as one zip (the folder link is the fallback).
  const originals = useOriginalPhotosLink(inspection.id);
  const fullDownloadUrl = originals.url || archive;
  const noDefectsPhotos = model.defectCount === 0 ? [...model.streetPhotos, ...model.otherPhotos].slice(0, 6) : [];
  const front = model.streetPhotos[0];

  return (
    <div style={page}>
      <Cover r={{ ...header, reportDate: formatLongDate(new Date().toISOString()) }} model={model} inspection={inspection} />
      <PhotoNumberProvider>
        <div className="report-page-break">
          <Heading>General Description</Heading>
          <Bullets items={model.description} />
          {front && (
            <PhotoGrid photos={[front]} compact={false} maxHeight={7.5} />
          )}
          <KeepTogether>
          <SubHeading>Photographs</SubHeading>
          <OriginalPhotosPending pending={originals.pending} />
          <p style={{ margin: "0 0 8px" }}>
            Selected photographs are included in the body of this report. For a full download please{" "}
            {fullDownloadUrl ? <a href={fullDownloadUrl} data-original-photos-link={originals.url ? "" : undefined} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>Click here</a> : "Click here"} to access. We recommend that you download the digital photographs immediately and save in a secure folder on your device, as the link will remain active for only a few months from the date of this report.
          </p>
          </KeepTogether>
          <p style={{ margin: 0, fontStyle: "italic", fontSize: "10.5px", color: C.grey, lineHeight: 1.7 }}>
            You may view/save individual photographs by clicking on a file in the list. To save a copy of all photographs, click the Download All button above the list of files and follow the prompts. The security settings on your computer may display a bar at the top of the window, indicating that you need to allow your browser to download from the site. If this message appears, please allow downloads temporarily from this site. If a window does not then appear asking where you would like the download saved, simply click on the Download All button again to commence the download.
          </p>
        </div>

        <div className="report-page-break" id="checklist">
          <Heading>Inspection Checklist</Heading>
          <p style={{ margin: "0 0 12px" }}>
            Following are observations made on the day of inspection. Each item carries one of six status colours; the key below also shows the totals for this inspection. Select a defect or note to jump to its detail.
          </p>
          <SummaryTiles model={model} />
          {model.tables.map((t, i) => <Table key={`${t.title}-${i}`} t={t} />)}
        </div>

        {/* The template does not start these on a new page: each follows on, with its heading kept with its first item. */}
        <div id="defects" style={{ marginTop: "26px" }}>
          <Defects model={model} archiveUrl={archive} lead={<><Heading>Identified Defects Requiring Attention</Heading><Back /></>} />
          {noDefectsPhotos.length > 0 && (
            <PhotoGrid photos={noDefectsPhotos} compact={false} caption={<SubHeading>General photographs of the site</SubHeading>} />
          )}
        </div>

        {model.notes.length > 0 && (
          <div id="notes" style={{ marginTop: "26px" }}>
            <Bullets items={model.notes} lead={<><Heading>Notes</Heading><Back /></>} />
          </div>
        )}

        {/* Only where a previous report with defects exists -- never in Pre-pour, the first stage. */}
        {model.stage !== "pre_pour" && model.previous.attached && (
          <div style={{ marginTop: "26px" }}>
            <ListTable
              lead={<Heading>Previous Defects</Heading>}
              heads={["Defect No", "Report Reference", "Defect Description", "Current Status", "Remarks / Photos"]}
              intro="Where a previous report exists, each defect from that report is updated below with its current status."
              na="Not applicable where no previous report exists."
              list={model.previous}
              row={(l) => ["1", "—", "Defects listed in the previous report (attached)", "Updated", l.text || "See the attached list."]}
            />
          </div>
        )}

        <div style={{ marginTop: "26px" }}>
          <ListTable
            lead={<Heading>Client Concerns</Heading>}
            heads={["Concern No", "Date Raised", "Client Concern", "Current Status", "Remarks / Photos"]}
            intro="Concerns listed by the client are answered below with the inspector’s findings."
            na="Not applicable where the client has not supplied a list of concerns."
            list={model.clientConcerns}
            row={(l) => ["1", "—", "Concerns as listed by the client (attached)", "Answered", l.text || "See the attached list."]}
          />
        </div>

        <TermsPages />
      </PhotoNumberProvider>

      {model.waitingSections.length > 0 && (
        <p className="screen-only" style={{ marginTop: "28px", fontStyle: "italic", color: C.faint, fontSize: "13px" }}>
          Not printed yet — awaiting reviewer approval: {model.waitingSections.join(", ")}.
        </p>
      )}
    </div>
  );
}


// ───────────────────────── One section, for the reviewer portal ─────────────────────────

/**
 * The reviewer portal's "Report Content" for one Construction Stage section: the same rows, defect cards, notes and tables
 * the final report prints (the report is built from every section, so defect numbers match what will print).
 */
export function ConstructionSectionPreview({ model, sectionKey }: { model: ConstructionReportModel; sectionKey: string }) {
  const tables = model.tables.filter((t) => t.sectionKey === sectionKey);
  const defects = model.defectGroups.map((g) => ({ heading: g.heading, defects: g.defects.filter((d) => d.sectionKey === sectionKey) })).filter((g) => g.defects.length > 0);
  const notes = model.notesBySection[sectionKey] ?? [];
  const isDescription = /_description$/.test(sectionKey);
  const showPrevious = model.attachedKeys.previous === sectionKey;
  const showClient = model.attachedKeys.client === sectionKey;
  const empty = !isDescription && !tables.length && !defects.length && !notes.length && !showPrevious && !showClient;
  const photos = [...model.streetPhotos, ...model.otherPhotos];
  return (
    <div style={{ ...page, fontSize: "12.5px" }}>
      {isDescription && (
        <>
          <Bullets items={model.description} />
          <PhotoGrid photos={photos} compact />
        </>
      )}
      {tables.map((t, i) => <Table key={`${t.title}-${i}`} t={t} compact />)}
      {defects.length > 0 && (
        <>
          <SubHeading>Identified defects</SubHeading>
          {defects.map((g) => (
            <div key={g.heading}>
              <div style={{ color: C.navy, fontWeight: 700, fontSize: "13.5px", borderBottom: `1px solid ${C.rule}`, margin: "10px 0 8px", paddingBottom: "3px" }}>{g.heading}</div>
              {g.defects.map((d) => <Defect key={d.no} d={d} compact />)}
            </div>
          ))}
        </>
      )}
      {notes.length > 0 && (
        <>
          <SubHeading>Notes</SubHeading>
          <Bullets items={notes} />
        </>
      )}
      {showPrevious && (
        <ListTable
          heads={["Defect No", "Report Reference", "Defect Description", "Current Status", "Remarks / Photos"]}
          intro="Where a previous report exists, each defect from that report is updated below with its current status."
          na="Not applicable where no previous report exists."
          list={model.previous}
          row={(l) => ["1", "—", "Defects listed in the previous report (attached)", "Updated", l.text || "See the attached list."]}
          compact
        />
      )}
      {showClient && (
        <ListTable
          heads={["Concern No", "Date Raised", "Client Concern", "Current Status", "Remarks / Photos"]}
          intro="Concerns listed by the client are answered below with the inspector’s findings."
          na="Not applicable where the client has not supplied a list of concerns."
          list={model.clientConcerns}
          row={(l) => ["1", "—", "Concerns as listed by the client (attached)", "Answered", l.text || "See the attached list."]}
          compact
        />
      )}
      {empty && <p style={{ margin: 0, color: C.faint, fontStyle: "italic" }}>Nothing from this section is printed in the report.</p>}
    </div>
  );
}
