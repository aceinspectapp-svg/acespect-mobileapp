import { useEffect, useState } from "react";
import type { Inspection } from "../mockData";
import { formatLongDate, type ReportHeader } from "../report";
import { fetchActiveTemplate, type AnswerTree, type TemplateField } from "../templateFields";
import { Heading, MetaRow, Para, PhotoGrid, PhotoNumberProvider, SectionBand, reportTokens, usePhotoNumbering } from "../components/reportKit";
import { buildConstructionReport, stageMeta, stageOfSectionKeys, type ConstructionReportModel, type DefectEntry, type ReportGroup, type SectionInput } from "./reportModel";

const PHOTOS_NOTE_1 =
  "Selected photographs are included in the body of this report. We recommend that you download the digital photographs immediately and save in a secure folder on your device, as the link will remain active for only a few months from the date of this report.";
const PHOTOS_NOTE_2 =
  "You may view/save individual photographs by clicking on a file in the list. To save a copy of all photographs, click the Download All button above the list of files and follow the prompts. The security settings on your computer may display a bar at the top of the window, indicating that you need to allow your browser to download from the site. If this message appears, please allow downloads temporarily from this site. If a window does not then appear asking where you would like the download saved, simply click on the Download All button again to commence the download.";
const REFERENCES_NOTE =
  "The following extracts regarding Building standards and tolerances are for reference in relation to defects items noted at this property. Some extracts may be provided as an advisory for items of work yet to be completed.";

const isConstruction = (inspection?: Inspection) => !!inspection && /construction/i.test(inspection.type);

/**
 * Loads each submitted section's template (its labels and options) and builds the report model from the answers.
 * Returns undefined while loading, null for an inspection that is not a Construction Stage one.
 */
export function useConstructionReport(inspection?: Inspection): ConstructionReportModel | null | undefined {
  const [model, setModel] = useState<ConstructionReportModel | null | undefined>(isConstruction(inspection) ? undefined : null);
  const key = inspection ? `${inspection.id}:${inspection.sections.map((s) => `${s.key ?? s.id}:${s.reviewStatus}`).join(",")}` : "";

  useEffect(() => {
    if (!inspection || !isConstruction(inspection)) { setModel(null); return; }
    let cancelled = false;
    const sections = inspection.sections.filter((s) => !(s.key ?? s.id).startsWith("job-info"));
    Promise.all(
      sections.map(async (s) => {
        const sectionKey = s.key ?? s.id;
        const t = await fetchActiveTemplate(inspection.type, inspection.propertyType, sectionKey);
        const input: SectionInput = {
          key: sectionKey,
          name: s.name,
          answers: (s.answers as AnswerTree | null | undefined) ?? null,
          fields: (t?.fields ?? []) as TemplateField[],
          approved: s.reviewStatus === "approved",
          excludedPhotos: s.excludedPhotoUrls ?? [],
        };
        return input;
      }),
    ).then((inputs) => {
      if (cancelled) return;
      const jobInfo = inspection.sections.find((s) => (s.key ?? s.id).startsWith("job-info"));
      const apartment = /apartment/i.test(inspection.propertyType);
      setModel(buildConstructionReport(inputs, (jobInfo?.answers as AnswerTree | null | undefined) ?? null, apartment));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return isConstruction(inspection) ? model : null;
}

/** Report file name, e.g. "V123-construction-report.pdf". */
export const constructionFileName = (jobNo: string) => `${(jobNo || "inspection").replace(/[^a-z0-9.-]+/gi, "-")}-construction-report.pdf`;

// ───────────────────────── Pieces ─────────────────────────

function Banner({ children }: { children: string }) {
  return <SectionBand tone="accent">{children}</SectionBand>;
}

function Photos({ photos, caption }: { photos: string[]; caption?: string }) {
  const numbering = usePhotoNumbering(photos.length);
  if (photos.length === 0) return null;
  return (
    <PhotoGrid
      photos={photos}
      compact={false}
      startNumber={numbering.start}
      caption={caption ? <Para style={{ margin: "0 0 4px", fontSize: "0.92em", color: reportTokens.inkMuted }}>{caption}</Para> : undefined}
    />
  );
}

function Groups({ groups, banner }: { groups: ReportGroup[]; banner: string }) {
  const redundant = (h: string, g: ReportGroup) => banner.toLowerCase().includes(h.toLowerCase()) || /^site and facilities$/i.test(h) || g.items.every((it) => it.heading.toLowerCase().startsWith(h.toLowerCase()));
  return (
    <>
      {groups.map((g, gi) => (
        <div key={gi} style={{ marginBottom: "6px" }}>
          {g.heading && !redundant(g.heading, g) && <Heading level={3}>{g.heading}</Heading>}
          {g.items.map((it, i) => (
            <div key={i} style={{ margin: "0 0 7px", breakInside: "avoid" }}>
              <p style={{ margin: "0 0 1px", fontWeight: 700, color: reportTokens.ink, breakAfter: "avoid" }}>{it.heading}</p>
              <Para style={{ margin: "0 0 2px" }}>{it.text}</Para>
              {it.photos.length > 0 && <Photos photos={it.photos} />}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function Defect({ d }: { d: DefectEntry }) {
  const meta = [
    d.severities.length ? `Severity: ${d.severities.join(", ")}` : "",
    d.categories.length ? `Category: ${d.categories.join(", ")}` : "",
    d.code ? `Construction code: ${d.code}` : "",
  ].filter(Boolean);
  return (
    <div style={{ margin: "0 0 12px", breakInside: "avoid" }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <span style={{ fontWeight: 700, minWidth: "26px", color: reportTokens.ink }}>{d.no}.</span>
        <div style={{ flex: 1 }}>
          <Para style={{ margin: "0 0 2px" }}>{d.text}</Para>
          {meta.length > 0 && <Para style={{ margin: "0 0 4px", fontSize: "0.88em", color: reportTokens.inkMuted }}>{meta.join("  ·  ")}</Para>}
          {/* The office template sets defect photos at about 5.5 cm, two side by side. */}
          {d.photos.length > 0 && <div style={{ maxWidth: "11.6cm" }}><Photos photos={d.photos} /></div>}
        </div>
      </div>
    </div>
  );
}

function Defects({ model }: { model: ConstructionReportModel }) {
  if (model.defects.length === 0) return <Para>No defects were identified at the time of inspection.</Para>;
  if (!model.groupedDefects) return <>{model.defects.map((d) => <Defect key={d.id} d={d} />)}</>;
  const areas = ["EXTERNAL", "INTERNAL"] as const;
  return (
    <>
      {areas.map((area) => {
        const list = model.defects.filter((d) => d.area === area);
        if (list.length === 0) return null;
        const subs = [...new Set(list.map((d) => d.sub))];
        return (
          <div key={area}>
            <SectionBand tone="peach">{area}</SectionBand>
            {subs.map((sub) => (
              <div key={sub}>
                <Heading level={3}>{sub}</Heading>
                {list.filter((d) => d.sub === sub).map((d) => <Defect key={d.id} d={d} />)}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function Cover({ r, model, inspection }: { r: ReportHeader; model: ConstructionReportModel; inspection: Inspection }) {
  const labelW = 170;
  const jobInfo = inspection.sections.find((s) => (s.key ?? s.id).startsWith("job-info"));
  const email = String((jobInfo?.fields as Record<string, unknown> | undefined)?.clientEmail ?? "") || undefined;
  return (
    <div style={{ fontFamily: reportTokens.font, color: reportTokens.ink, fontSize: "15px", lineHeight: 1.5 }}>
      <div className="screen-only" style={{ display: "flex", justifyContent: "flex-end", marginBottom: "24px" }}>
        <img src="/houspect-logo.png" alt="Houspect Building Inspections" style={{ height: "56px", width: "auto", display: "block" }} />
      </div>
      <MetaRow label="Client" labelWidth={labelW}>
        <div>{r.clientName}</div>
        {(r.clientEmail || email) && <div style={{ color: reportTokens.inkMuted, fontSize: "0.92em" }}>Via email: {r.clientEmail || email}</div>}
      </MetaRow>
      <MetaRow label="Our Reference" labelWidth={labelW}>{r.ourReference}</MetaRow>
      <div style={{ borderRadius: reportTokens.radius, padding: "12px 16px", margin: "20px 0", border: `1.5px solid ${reportTokens.ink}` }}>
        <span style={{ fontSize: "34px", lineHeight: 1.1 }}>Construction Report</span>
      </div>
      <MetaRow label="Property" labelWidth={labelW}>{r.property}</MetaRow>
      <MetaRow label="Inspection Date" labelWidth={labelW}>{r.inspectionDate}</MetaRow>
      <MetaRow label="Weather Conditions" labelWidth={labelW}>{r.weather}</MetaRow>
      <MetaRow label="Inspector" labelWidth={labelW}>
        {r.inspector}
        {r.inspectorRegistration ? ` (Registration No ${r.inspectorRegistration})` : ""}
      </MetaRow>
      <MetaRow label="Stage" labelWidth={labelW}>{model.stageLabel}</MetaRow>
      <MetaRow label="Report Purpose" labelWidth={labelW}>{model.purpose}</MetaRow>
      <MetaRow label="General" labelWidth={labelW}>{model.general}</MetaRow>
    </div>
  );
}

// ───────────────────────── The page ─────────────────────────

export function ConstructionReportBody({ inspection, model, header }: { inspection: Inspection; model: ConstructionReportModel; header: ReportHeader }) {
  const r = header;
  const meta = stageMeta(model.stage);
  void meta;
  const archive = inspection.photoArchiveUrl;
  const noDefectsPhotos = model.defects.length === 0 ? [...model.streetPhotos, ...model.otherPhotos] : [];

  return (
    <>
      <Cover r={{ ...r, reportDate: formatLongDate(new Date().toISOString()) }} model={model} inspection={inspection} />
      <PhotoNumberProvider>
        <div className="report-page-break" style={{ marginTop: "40px" }}>
          <Banner>GENERAL DESCRIPTION</Banner>
          {model.description.map((line, i) => <Para key={i} style={{ margin: "0 0 4px" }}>{line}</Para>)}
          {model.streetPhotos.length > 0 && <Photos photos={model.streetPhotos.slice(0, 1)} />}

          <Banner>PHOTOGRAPHS</Banner>
          <Para>
            {PHOTOS_NOTE_1}
            {archive && (<> <a href={archive} target="_blank" rel="noopener noreferrer">Click here to access the full set of photographs.</a></>)}
          </Para>
          <Para>{PHOTOS_NOTE_2}</Para>
        </div>

        <div className="report-page-break">
          <Para>Following are observations made on the day of inspection.</Para>
          {model.site.length > 0 && (
            <>
              <Banner>SITE &amp; FACILITIES</Banner>
              <Groups groups={model.site} banner="SITE & FACILITIES" />
            </>
          )}
          {model.blocks.map((b, i) => (
            <div key={`${b.banner}-${i}`}>
              <Banner>{b.banner}</Banner>
              <Groups groups={b.groups} banner={b.banner} />
            </div>
          ))}
        </div>

        <div className="report-page-break">
          <Banner>IDENTIFIED DEFECTS REQUIRING ATTENTION</Banner>
          <Defects model={model} />
          {noDefectsPhotos.length > 0 && (
            <>
              <Heading>General photographs of the site</Heading>
              <Photos photos={noDefectsPhotos.slice(0, 6)} />
            </>
          )}
        </div>

        {model.notes.length > 0 && (
          <div className="report-page-break">
            <Banner>NOTES</Banner>
            <ul style={{ margin: "0 0 10px", paddingLeft: "20px" }}>
              {model.notes.map((n, i) => <li key={i} style={{ margin: "0 0 7px", lineHeight: 1.45 }}>{n}</li>)}
            </ul>
          </div>
        )}

        {model.clientQueries && (
          <div style={{ breakInside: "avoid" }}>
            <Heading>Client queries</Heading>
            {model.clientQueries.text && <Para>{model.clientQueries.text}</Para>}
            <Photos photos={model.clientQueries.photos} caption="The client's list of issues, with the inspector's comments:" />
          </div>
        )}

        {model.previous && (
          <div style={{ breakInside: "avoid" }}>
            <Heading>Items identified at previous inspection</Heading>
            {model.previous.text && <Para>{model.previous.text}</Para>}
            <Photos photos={model.previous.photos} caption="The previous report's defects, with updates:" />
          </div>
        )}

        <div className="report-page-break">
          <Banner>REFERENCES AND GUIDE TO STANDARDS AND TOLERANCES</Banner>
          <Para>{REFERENCES_NOTE}</Para>
          {model.blocksRef.map((b) => (
            <div key={b.title} style={{ margin: "0 0 10px" }}>
              <Heading>{b.title}</Heading>
              {b.text.map((t, i) => <Para key={i} justify>{t}</Para>)}
            </div>
          ))}
          {model.references.map((sec) => (
            <div key={sec.section} style={{ margin: "0 0 12px" }}>
              <Heading>{sec.section}</Heading>
              {sec.codes.map((c) => (
                <div key={c.code} style={{ margin: "0 0 8px", breakInside: "avoid" }}>
                  <Para justify style={{ margin: "0 0 3px" }}><strong>{c.code}</strong> {c.text[0]}</Para>
                  {c.text.slice(1).map((t, i) => <Para key={i} justify style={{ margin: "0 0 3px" }}>{t}</Para>)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </PhotoNumberProvider>

      {model.waitingSections.length > 0 && (
        <p className="screen-only" style={{ marginTop: "28px", fontStyle: "italic", color: reportTokens.inkFaint, fontSize: "13px" }}>
          Not printed yet — awaiting reviewer approval: {model.waitingSections.join(", ")}.
        </p>
      )}
    </>
  );
}

export { stageOfSectionKeys };
