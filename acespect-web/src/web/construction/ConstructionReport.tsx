import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Inspection } from "../mockData";
import { resolveMediaUrl } from "../api";
import { formatLongDate, type ReportHeader } from "../report";
import { fetchActiveTemplate, type AnswerTree, type TemplateField } from "../templateFields";
import { reportProfileOf } from "../wording/profile";
import { PhotoNumberProvider, usePhotoNumbering } from "../components/reportKit";
import { constructionSectionText } from "./sectionText";
import { CONDITIONS, SCOPE } from "./scopeText";
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
  const key = inspection ? `${all ? "all" : "approved"}:${inspection.id}:${inspection.sections.map((s) => `${s.key ?? s.id}:${s.reviewStatus}:${s.reportText.length}`).join(",")}` : "";

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
  navy: "#1b3a6b", red: "#d1262b", ink: "#1f2937", grey: "#6b7280", faint: "#9ca3af", rule: "#e5e7eb", band: "#e8eef8",
  font: "Arial, Helvetica, sans-serif",
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
const Back = () => (
  <div style={{ textAlign: "right", margin: "-4px 0 12px" }}>
    <a href="#checklist" style={{ color: "#2563eb", fontSize: "11.5px" }}>↑ Back to summary</a>
  </div>
);
const Bullets = ({ items }: { items: string[] }) => (
  <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0 }}>
    {items.map((t, i) => (
      <li key={i} style={{ display: "flex", gap: "10px", margin: "0 0 4px" }}>
        <span style={{ color: C.red, lineHeight: 1.45 }}>•</span>
        <span style={{ flex: 1 }}>{t}</span>
      </li>
    ))}
  </ul>
);

function photoRange(start: number | undefined, count: number): string {
  if (start === undefined) return "";
  return count === 1 ? `${start}` : `${start} to ${start + count - 1}`;
}

/** Photographs, three to a line, each numbered; nothing is cropped. */
function PhotoGrid3({ photos, numbers, indent = 30 }: { photos: string[]; numbers: number | undefined; indent?: number }) {
  if (photos.length === 0) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", margin: `10px 0 4px ${indent}px` }}>
      {photos.map((u, i) => (
        <div key={u + i} style={{ breakInside: "avoid" }}>
          <a href={resolveMediaUrl(u)} target="_blank" rel="noopener noreferrer" style={{ display: "block" }}>
            <img src={resolveMediaUrl(u)} alt="" style={{ width: "100%", height: "4.6cm", objectFit: "contain", background: "#f8fafc", border: `1px solid ${C.rule}`, display: "block" }} />
          </a>
          {numbers !== undefined && <span style={{ display: "block", marginTop: "2px", fontSize: "10.5px", color: C.grey }}>Photo {numbers + i}</span>}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────── Cover ─────────────────────────

function Cover({ r, model, inspection }: { r: ReportHeader; model: ConstructionReportModel; inspection: Inspection }) {
  const jobInfo = inspection.sections.find((s) => (s.key ?? s.id).startsWith("job-info"));
  const email = r.clientEmail || String((jobInfo?.fields as Record<string, unknown> | undefined)?.clientEmail ?? "") || undefined;
  const label: CSSProperties = { fontSize: "10px", fontWeight: 700, letterSpacing: "0.14em", color: C.grey, textTransform: "uppercase" };
  const rows: [string, ReactNode][] = [
    ["Property", r.property],
    ["Inspection Date", r.inspectionDate],
    ["Weather", r.weather],
    ["Inspector", `${r.inspector}${r.inspectorRegistration ? ` (Registration No. ${r.inspectorRegistration})` : ""}`],
    ["Stage", model.stageLabel],
    ["Report Purpose", model.purpose],
    ["General", model.general],
  ];
  return (
    <div style={{ ...page, fontSize: "14px" }}>
      <div className="screen-only" style={{ display: "flex", justifyContent: "flex-end", marginBottom: "18px" }}>
        <img src="/houspect-logo.png" alt="Houspect Building Inspections" style={{ height: "56px", width: "auto", display: "block" }} />
      </div>
      <div style={{ fontWeight: 700, fontSize: "15px", margin: "0 0 14px" }}>{r.reportDate}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div>
          <div style={label}>Client</div>
          <div style={{ fontSize: "14px", marginTop: "3px" }}>{r.clientName}</div>
          {email && <div style={{ fontSize: "12px", color: C.grey }}>Via email: {email}</div>}
        </div>
        <div>
          <div style={label}>Our Reference</div>
          <div style={{ fontSize: "14px", marginTop: "3px" }}>{r.ourReference}</div>
        </div>
      </div>
      <div style={{ background: C.navy, borderRight: `9px solid ${C.red}`, color: "white", padding: "22px 26px 24px", margin: "34px 0 30px" }}>
        <div style={{ fontSize: "12.5px", fontWeight: 700, letterSpacing: "0.3em", textTransform: "uppercase", opacity: 0.92 }}>Construction Report</div>
        <div style={{ fontSize: "36px", fontWeight: 700, marginTop: "6px", lineHeight: 1.1 }}>{model.coverTitle}</div>
      </div>
      <div>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "166px 1fr", gap: "14px", padding: "9px 0", borderBottom: `1px solid ${C.rule}`, breakInside: "avoid" }}>
            <div style={{ ...label, paddingTop: "3px" }}>{k}</div>
            <div style={{ fontSize: "14px" }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "28px" }}>
        <div style={{ color: C.navy, fontSize: "17px" }}>Dinuke De Coonghe</div>
        <div style={{ color: C.navy, fontSize: "13px", fontWeight: 700 }}>Director – Houspect Victoria</div>
      </div>
    </div>
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
            <div style={{ fontSize: "9.5px", color: C.grey, lineHeight: 1.3 }}>{s.sub}</div>
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

function RowPhotos({ heading, photos }: { heading: string; photos: string[] }) {
  const numbering = usePhotoNumbering(photos.length);
  return (
    <div style={{ margin: "6px 0 4px", breakInside: "avoid" }}>
      <div style={{ fontSize: "11px", color: C.grey }}>Photographs — {heading}{numbering.start !== undefined ? ` (${photoRange(numbering.start, photos.length)})` : ""}</div>
      <PhotoGrid3 photos={photos} numbers={numbering.start} indent={0} />
    </div>
  );
}

function Table({ t, compact }: { t: ChecklistTable; compact?: boolean }) {
  return (
    <div style={{ margin: "0 0 20px" }}>
      <div style={{ background: C.navy, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", breakAfter: "avoid" }}>
        <span style={{ fontWeight: 700, letterSpacing: "0.05em", fontSize: "13px" }}>{t.title}</span>
        <span style={{ fontSize: "10.5px", fontWeight: 700, opacity: 0.95 }}>{countsLine(t)}</span>
      </div>
      {t.groups.map((g, gi) => (
        <Fragment key={gi}>
          {g.heading && (
            <div style={{ background: C.band, color: C.navy, fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 10px", breakAfter: "avoid" }}>{g.heading}</div>
          )}
          {g.items.map((it) => {
            const s = STATUS[it.status];
            const href = it.status === "defect" && it.defectNo ? `#defect-${it.defectNo}` : it.status === "note" ? "#notes" : undefined;
            const name = <span style={{ fontWeight: 700, fontSize: "13px", color: href ? C.navy : C.ink, textDecoration: href ? "underline" : "none" }}>{it.heading}</span>;
            return (
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
          })}
        </Fragment>
      ))}
      {t.photos.map((p, i) => <RowPhotos key={i} heading={p.heading} photos={p.photos} />)}
    </div>
  );
}

// ───────────────────────── Defects ─────────────────────────

function Defect({ d }: { d: DefectEntry }) {
  const numbering = usePhotoNumbering(d.photos.length);
  const small: CSSProperties = { fontSize: "11px", color: C.grey, marginTop: "2px" };
  return (
    <div id={`defect-${d.no}`} style={{ margin: "0 0 14px", breakInside: "avoid" }}>
      <div style={{ display: "grid", gridTemplateColumns: "30px 1fr", background: "#fff1f1" }}>
        <div style={{ background: C.red, color: "white", fontWeight: 700, fontSize: "12px", padding: "6px 0 0", textAlign: "center" }}>{d.no}</div>
        <div style={{ padding: "6px 10px 7px" }}>
          <div style={{ fontSize: "13.5px" }}>{d.text}</div>
          {d.photos.length > 0 && numbering.start !== undefined && <div style={small}><b style={{ color: C.ink }}>Photographs:</b> {photoRange(numbering.start, d.photos.length)}</div>}
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
      <PhotoGrid3 photos={d.photos} numbers={numbering.start} />
    </div>
  );
}

function Defects({ model, archiveUrl }: { model: ConstructionReportModel; archiveUrl?: string | null }) {
  if (model.defectCount === 0) return <p style={{ margin: "0 0 12px" }}>No defects were identified at the time of inspection.</p>;
  return (
    <>
      {model.defectGroups.map((g) => (
        <div key={g.heading}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: `1px solid ${C.rule}`, margin: "14px 0 8px", paddingBottom: "3px", breakAfter: "avoid" }}>
            <span style={{ color: C.navy, fontWeight: 700, fontSize: "14.5px" }}>{g.heading}</span>
            {archiveUrl && <a href={archiveUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", fontSize: "11px", fontWeight: 700 }}>View additional photos ›</a>}
          </div>
          {g.defects.map((d) => <Defect key={d.no} d={d} />)}
        </div>
      ))}
    </>
  );
}

// ───────────────────────── Previous defects / client concerns ─────────────────────────

function ListTable({ heads, intro, na, list, row }: { heads: string[]; intro: string; na: string; list: AttachedList; row: (list: AttachedList) => ReactNode[] }) {
  const numbering = usePhotoNumbering(list.photos.length);
  const cols = "74px 108px 1fr 112px 150px";
  const cells = list.attached ? row(list) : [];
  return (
    <div>
      <p style={{ margin: "0 0 10px" }}>{intro}</p>
      {list.attached && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: cols, background: C.navy, color: "white", fontSize: "9.5px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {heads.map((h) => <div key={h} style={{ padding: "8px" }}>{h}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: cols, borderBottom: `1px solid ${C.rule}`, fontSize: "12px" }}>
            {cells.map((c, i) => <div key={i} style={{ padding: "8px", background: i === 3 ? "#f3f4f6" : undefined }}>{c}</div>)}
          </div>
          {list.photos.length > 0 && (
            <div style={{ margin: "8px 0 0" }}>
              <div style={{ fontSize: "11px", color: C.grey }}>Photographs: {photoRange(numbering.start, list.photos.length)}</div>
              <PhotoGrid3 photos={list.photos} numbers={numbering.start} indent={0} />
            </div>
          )}
        </>
      )}
      {!list.attached && <p style={{ margin: "6px 0 0", fontStyle: "italic", fontSize: "11.5px", color: C.grey }}>{na}</p>}
    </div>
  );
}

// ───────────────────────── Scope and Conditions ─────────────────────────

function ScopePages() {
  return (
    <>
      <div className="report-page-break">
        <Heading>Scope</Heading>
        {SCOPE.map((b, i) => {
          if (b.type === "section") {
            return (
              <div key={i} style={{ margin: "14px 0 6px", fontWeight: 700, fontSize: "13px", breakAfter: "avoid" }}>
                <span style={{ color: C.red }}>{b.n}.</span>
                <span style={{ color: C.navy, marginLeft: "10px", letterSpacing: "0.02em" }}>{b.title}</span>
              </div>
            );
          }
          if (b.type === "p") return <p key={i} style={{ margin: "0 0 8px" }}>{b.text}</p>;
          if (b.type === "note") return <p key={i} style={{ margin: "0 0 8px", fontStyle: "italic", color: C.grey }}>{b.text}</p>;
          if (b.type === "clause") {
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 1fr", margin: "0 0 8px" }}>
                <span style={{ color: C.navy, fontWeight: 700 }}>{b.num}</span>
                <span>{b.lead && <b>{b.lead} </b>}{b.text}</span>
              </div>
            );
          }
          if (b.type === "bullets") return <div key={i} style={{ margin: "0 0 8px" }}><Bullets items={b.items} /></div>;
          return (
            <div key={i} style={{ margin: "0 0 8px 40px" }}>
              {b.items.map((it) => (
                <div key={it.k} style={{ display: "grid", gridTemplateColumns: "34px 1fr", margin: "0 0 5px" }}>
                  <span>{it.k}</span>
                  <span>{it.lead && <b>{it.lead} </b>}{it.text}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="report-page-break">
        <Heading>Conditions for the provision of the report</Heading>
        {CONDITIONS.map((c, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "38px 1fr", margin: "0 0 7px" }}>
            <span style={{ color: C.navy, fontWeight: 700 }}>{i + 1}.</span>
            <div>
              <div>{c.text}</div>
              {c.sub?.map((s) => (
                <div key={s.k} style={{ display: "grid", gridTemplateColumns: "34px 1fr", margin: "4px 0 0 4px" }}>
                  <span>{s.k}</span>
                  <span>{s.text}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ───────────────────────── The page ─────────────────────────

export function ConstructionReportBody({ inspection, model, header }: { inspection: Inspection; model: ConstructionReportModel; header: ReportHeader }) {
  const archive = inspection.photoArchiveUrl;
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
            <div style={{ margin: "14px 0 18px", border: `1px solid ${C.rule}`, background: "#f8fafc" }}>
              <img src={resolveMediaUrl(front)} alt="Front elevation" style={{ display: "block", width: "100%", maxHeight: "10.5cm", objectFit: "contain" }} />
            </div>
          )}
          <SubHeading>Photographs</SubHeading>
          <p style={{ margin: "0 0 8px" }}>
            Selected photographs are included in the body of this report. For a full download please{" "}
            {archive ? <a href={archive} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>Click here</a> : "Click here"} to access. We recommend that you download the digital photographs immediately and save in a secure folder on your device, as the link will remain active for only a few months from the date of this report.
          </p>
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

        <div className="report-page-break" id="defects">
          <Heading>Identified Defects Requiring Attention</Heading>
          <Back />
          <Defects model={model} archiveUrl={archive} />
          {noDefectsPhotos.length > 0 && (
            <>
              <SubHeading>General photographs of the site</SubHeading>
              <PhotoGrid3 photos={noDefectsPhotos} numbers={undefined} indent={0} />
            </>
          )}
        </div>

        {model.notes.length > 0 && (
          <div id="notes" style={{ marginTop: "26px" }}>
            <Heading>Notes</Heading>
            <Back />
            <Bullets items={model.notes} />
          </div>
        )}

        <div style={{ marginTop: "26px" }}>
          <Heading>Previous Defects</Heading>
          <ListTable
            heads={["Defect No", "Report Reference", "Defect Description", "Current Status", "Remarks / Photos"]}
            intro="Where a previous report exists, each defect from that report is updated below with its current status."
            na="Not applicable where no previous report exists."
            list={model.previous}
            row={(l) => ["1", "—", "Defects listed in the previous report (attached)", "Updated", l.text || "See the attached list."]}
          />
        </div>

        <div className="report-page-break">
          <Heading>Client Concerns</Heading>
          <ListTable
            heads={["Concern No", "Date Raised", "Client Concern", "Current Status", "Remarks / Photos"]}
            intro="Concerns listed by the client are answered below with the inspector’s findings."
            na="Not applicable where the client has not supplied a list of concerns."
            list={model.clientConcerns}
            row={(l) => ["1", "—", "Concerns as listed by the client (attached)", "Answered", l.text || "See the attached list."]}
          />
        </div>

        <ScopePages />
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
          <PhotoGrid3 photos={photos} numbers={undefined} indent={0} />
        </>
      )}
      {tables.map((t, i) => <Table key={`${t.title}-${i}`} t={t} compact />)}
      {defects.length > 0 && (
        <>
          <SubHeading>Identified defects</SubHeading>
          {defects.map((g) => (
            <div key={g.heading}>
              <div style={{ color: C.navy, fontWeight: 700, fontSize: "13.5px", borderBottom: `1px solid ${C.rule}`, margin: "10px 0 8px", paddingBottom: "3px" }}>{g.heading}</div>
              {g.defects.map((d) => <Defect key={d.no} d={d} />)}
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
        />
      )}
      {showClient && (
        <ListTable
          heads={["Concern No", "Date Raised", "Client Concern", "Current Status", "Remarks / Photos"]}
          intro="Concerns listed by the client are answered below with the inspector’s findings."
          na="Not applicable where the client has not supplied a list of concerns."
          list={model.clientConcerns}
          row={(l) => ["1", "—", "Concerns as listed by the client (attached)", "Answered", l.text || "See the attached list."]}
        />
      )}
      {empty && <p style={{ margin: 0, color: C.faint, fontStyle: "italic" }}>Nothing from this section is printed in the report.</p>}
    </div>
  );
}
