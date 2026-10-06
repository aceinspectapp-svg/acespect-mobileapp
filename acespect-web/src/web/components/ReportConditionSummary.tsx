import type { ConditionSummaryRow } from "../templateFields";
import { GRADE_LEGEND } from "../conditionGrades";
import { PageTitle, reportTextStyle, reportTokens } from "./reportKit";

/** One category's rows for the Condition Summary page -- `sectionName` is
 *  the category's own display name (e.g. "Driveway", "Elevations"), kept
 *  separate from each row's `subLabel` (see ConditionSummaryRow) so this
 *  component decides how to combine them, not the derivation in
 *  templateFields.ts. */
export interface ConditionSummaryCategory {
  sectionName: string;
  rows: ConditionSummaryRow[];
  /** The `id` of this category's section further down the report, so each topic here can link straight to it. */
  anchorId?: string;
}

/** A topic's name as a link to its section (an in-page link on screen, a clickable internal link in the exported PDF); plain text when there is nothing to link to. */
function TopicLink({ anchorId, children }: { anchorId?: string; children: React.ReactNode }) {
  if (!anchorId) return <>{children}</>;
  return (
    <a href={`#${anchorId}`} style={{ color: reportTokens.accent, textDecoration: "underline", textUnderlineOffset: "2px" }}>
      {children}
    </a>
  );
}

function ConditionPill({ color, label }: { color: string; label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: reportTokens.radius,
        background: color,
        color: "white",
        fontWeight: 700,
        fontSize: "0.82em",
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/**
 * One category's rows. A category with more than one row (e.g. each
 * Elevations side, each Internal Areas room) gets its own bold header line
 * above its indented rows; a single-row category (e.g. one Driveway) just
 * shows its name directly as that row's label -- no redundant header above
 * a single line.
 *
 * The header + its first row are kept together across a page break
 * (`breakInside: "avoid"`) the same way ReportSection.tsx keeps a category
 * heading with its opening description -- without it, a page could end
 * right on "Internal Areas" with every room starting fresh on the next
 * page. Each individual row gets the same protection so its label/pill/note
 * can't split across a line break either. Rows after the first are left
 * free to flow onto the next page independently, so one long category
 * doesn't force an oversized unbreakable block.
 */
function CategoryBlock({ category }: { category: ConditionSummaryCategory }) {
  const { sectionName, rows, anchorId } = category;
  const showHeader = rows.length > 1;
  return (
    <>
      {rows.map((row, i) => {
        const rowContent = (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              padding: "6px 0",
              borderBottom: `1px solid ${reportTokens.border}`,
            }}
          >
            <div style={{ flex: "1 1 40%", paddingLeft: showHeader ? "14px" : 0, fontWeight: showHeader ? 400 : 700 }}>
              <TopicLink anchorId={anchorId}>{row.subLabel ?? sectionName}</TopicLink>
            </div>
            <div style={{ flex: "0 0 108px" }}>
              <ConditionPill color={row.conditionColor} label={row.conditionLabel} />
            </div>
            <div style={{ flex: "1 1 45%", color: reportTokens.inkMuted, fontSize: "0.92em" }}>{row.defectNote ?? ""}</div>
          </div>
        );
        if (i === 0 && showHeader) {
          return (
            <div key={i} style={{ breakInside: "avoid" }}>
              <div style={{ fontWeight: 700, color: reportTokens.ink, margin: "10px 0 2px", fontSize: "0.95em" }}>
                <TopicLink anchorId={anchorId}>{sectionName}</TopicLink>
              </div>
              {rowContent}
            </div>
          );
        }
        return (
          <div key={i} style={{ breakInside: "avoid" }}>
            {rowContent}
          </div>
        );
      })}
    </>
  );
}

/** What each grade in the table means, in the report's own wording (also printed in the Scope appendix). Kept in one block so it never splits across a page break. */
function ConditionLegend() {
  return (
    <div style={{ breakInside: "avoid", marginTop: "22px" }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: "0.78em",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          color: reportTokens.inkMuted,
          paddingBottom: "4px",
          borderBottom: `1px solid ${reportTokens.border}`,
          marginBottom: "6px",
        }}
      >
        Condition grades
      </div>
      {GRADE_LEGEND.map((g) => (
        <div key={g.label} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "3px 0" }}>
          <div style={{ flex: "0 0 108px" }}>
            <ConditionPill color={g.color} label={g.label} />
          </div>
          <div style={{ fontSize: "0.92em", color: reportTokens.ink }}>{g.meaning}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * The report's Condition Summary page -- an at-a-glance executive summary
 * of every category's condition grade and any defect noted against it,
 * printed on its own page between the cover and Description & Overview.
 * Neither Houspect reference report has one of these; this is a deliberate
 * addition. Renders nothing at all (so ReportView.tsx's page-break wrapper
 * around it can skip too) when there's nothing yet to summarise.
 */
export function ReportConditionSummary({
  categories,
  compact = false,
}: {
  categories: ConditionSummaryCategory[];
  compact?: boolean;
}) {
  if (categories.length === 0) return null;
  return (
    <div style={reportTextStyle(compact)}>
      <PageTitle compact={compact}>Condition Summary</PageTitle>
      <p style={{ textAlign: "left", color: reportTokens.inkMuted, fontSize: "0.85em", margin: "0 0 20px" }}>
        Condition summary — grade and any defect noted, by category
      </p>
      <div
        style={{
          display: "flex",
          gap: "10px",
          padding: "0 0 6px",
          borderBottom: `2px solid ${reportTokens.ink}`,
          fontWeight: 700,
          fontSize: "0.78em",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
          color: reportTokens.inkMuted,
        }}
      >
        <div style={{ flex: "1 1 40%" }}>Item</div>
        <div style={{ flex: "0 0 108px" }}>Condition</div>
        <div style={{ flex: "1 1 45%" }}>Notes</div>
      </div>
      {categories.map((c, i) => (
        <CategoryBlock key={i} category={c} />
      ))}
      <ConditionLegend />
    </div>
  );
}
