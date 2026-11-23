/**
 * The Pre-Purchase Condition Summary, laid out as the Construction report's Inspection Checklist summary: a total card per grade
 * (New / Satisfactory / Fair / Average / Poor), then each section under its own title bar with its counts ("2 defects · 1 Poor ·
 * 2 Average"), and a row per graded item with its grade as a coloured status on the right and its defect noted under its name. Each row
 * links to its section, which links back ("↑ Back to summary"). A row never splits across pages, and a section's title bar prints with
 * its first row.
 */
import type { CSSProperties } from "react";
import type { ConditionSummaryRow } from "../templateFields";
import { conditionTagColors, GRADE_LEGEND, shortConditionLabel } from "../conditionGrades";
import { COVER_COLORS } from "../components/CoverPage";
import { KeepTogether } from "../construction/ConstructionReport";

export interface SummarySection { heading: string; anchorId: string; rows: ConditionSummaryRow[] }

/** The five grades, with the template's Condition Definitions under each card. */
export const SUMMARY_GRADES: { label: string; color: string; sub: string }[] = [
  { label: "New", color: GRADE_LEGEND[0]!.color, sub: "Newly built, minimal use" },
  { label: "Satisfactory", color: GRADE_LEGEND[1]!.color, sub: "Generally good condition" },
  { label: "Fair", color: GRADE_LEGEND[2]!.color, sub: "Starting to need maintenance" },
  { label: "Average", color: GRADE_LEGEND[3]!.color, sub: "Maintenance within 6 months" },
  { label: "Poor", color: GRADE_LEGEND[4]!.color, sub: "Needs replacement" },
];

/** Which of the five grades a row has ("Satisfactory with typical wear and tear" is Satisfactory); undefined for anything else. */
export function gradeOfRow(row: Pick<ConditionSummaryRow, "conditionLabel" | "conditionColor">): string | undefined {
  const label = shortConditionLabel(row.conditionLabel).toLowerCase();
  return (
    SUMMARY_GRADES.find((g) => label.startsWith(g.label.toLowerCase()))?.label ??
    SUMMARY_GRADES.find((g) => g.color.toLowerCase() === (row.conditionColor ?? "").toLowerCase())?.label
  );
}

/** "2 defects · 1 Poor · 2 Average · 1 Fair": the section's defects, then its grades from worst to best. */
export function sectionCounts(rows: ConditionSummaryRow[]): string {
  const parts: string[] = [];
  const defects = rows.filter((r) => (r.defectNote ?? "").trim()).length;
  if (defects) parts.push(`${defects} ${defects === 1 ? "defect" : "defects"}`);
  for (const g of [...SUMMARY_GRADES].reverse()) {
    const n = rows.filter((r) => gradeOfRow(r) === g.label).length;
    if (n) parts.push(`${n} ${g.label}`);
  }
  return parts.join(" · ");
}

const C = { ...COVER_COLORS, band: "#e8eef8" };

function Totals({ sections }: { sections: SummarySection[] }) {
  const rows = sections.flatMap((s) => s.rows);
  return (
    <div data-summary="totals" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "4px", margin: "0 0 22px", breakInside: "avoid" }}>
      {SUMMARY_GRADES.map((g) => {
        const c = conditionTagColors(g.color);
        return (
          <div key={g.label} data-summary-total={g.label} style={{ borderTop: `3.5px solid ${c.bar}`, background: c.fill, padding: "9px 6px 10px", textAlign: "center" }}>
            <div style={{ fontSize: "26px", fontWeight: 800, color: c.text, lineHeight: 1.1 }}>{rows.filter((r) => gradeOfRow(r) === g.label).length}</div>
            <div style={{ fontSize: "8.5px", fontWeight: 800, letterSpacing: "0.03em", color: c.text, margin: "3px 0 4px", whiteSpace: "nowrap", textTransform: "uppercase" }}>{g.label}</div>
            <div style={{ fontSize: "9.5px", color: "#4b5563", lineHeight: 1.3 }}>{g.sub}</div>
          </div>
        );
      })}
    </div>
  );
}

function Row({ row, name, href }: { row: ConditionSummaryRow; name: string; href: string }) {
  const c = conditionTagColors(row.conditionColor);
  const label = shortConditionLabel(row.conditionLabel);
  const link: CSSProperties = { fontWeight: 700, fontSize: "13px", color: C.navy, textDecoration: "underline" };
  return (
    <div data-summary="row" style={{ display: "grid", gridTemplateColumns: "6px 1fr 146px", borderBottom: `1px solid ${C.rule}`, breakInside: "avoid" }}>
      <div style={{ background: c.bar }} />
      <div style={{ padding: "6px 10px 7px" }}>
        <div><a href={href} style={link}>{name}</a></div>
        {row.defectNote && <div data-summary="note" style={{ fontSize: "12px", lineHeight: 1.4, marginTop: "3px", color: C.ink }}>{row.defectNote}</div>}
      </div>
      <div data-summary="status" style={{ background: c.fill, color: c.text, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 800, letterSpacing: "0.1em", textAlign: "center", padding: "0 4px", textTransform: "uppercase" }}>
        <a href={href} style={{ color: c.text, textDecoration: "underline" }}>{label} ›</a>
      </div>
    </div>
  );
}

export function PrePurchaseSummary({ sections, lead }: { sections: SummarySection[]; lead?: React.ReactNode }) {
  const shown = sections.filter((s) => s.rows.length > 0);
  if (shown.length === 0) return null;
  return (
    <div data-summary="" id="summary">
      <KeepTogether>
        {lead}
        <p style={{ margin: "0 0 12px" }}>The condition of each item inspected, by section. Select an item to go to its detail.</p>
        <Totals sections={shown} />
      </KeepTogether>
      {shown.map((s) => {
        const bar = (
          <div data-summary="section" style={{ background: C.navy, color: "white", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px" }}>
            <span style={{ fontWeight: 700, letterSpacing: "0.05em", fontSize: "13px", textTransform: "uppercase" }}>{s.heading}</span>
            <span style={{ fontSize: "10.5px", fontWeight: 700, opacity: 0.95 }}>{sectionCounts(s.rows)}</span>
          </div>
        );
        const href = `#${s.anchorId}`;
        return (
          <div key={s.anchorId} style={{ margin: "0 0 20px" }}>
            {s.rows.map((row, i) => {
              const el = <Row key={i} row={row} name={row.subLabel ?? s.heading} href={href} />;
              // The title bar prints on one page with the section's first row.
              return i === 0 ? <KeepTogether key={i}>{bar}{el}</KeepTogether> : el;
            })}
          </div>
        );
      })}
    </div>
  );
}
