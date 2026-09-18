import {
  CONDITION_DEFINITIONS,
  DILAPIDATION_REPORT_INFORMATION,
} from "../report";
import { Heading, Para } from "./reportKit";

/**
 * The short front-of-report "Scope" page: Purpose/Scope/Defects clauses,
 * the Condition Definitions legend, and the Dilapidation Report Information
 * paragraphs -- distinct from the longer AS4349-style Scope/Conditions
 * appendix (`ReportScope`/`ReportConditions`) that's still appended at the
 * end of the report; the reference report carries both, in these two places.
 */
export function ReportFrontMatter({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <Heading level={2} compact={compact}>Scope</Heading>
      <ol style={{ paddingLeft: "1.4em", margin: "0 0 14px" }}>
        <li style={{ marginBottom: "10px" }}>
          <strong>Purpose of Inspection</strong>
          <Para style={{ margin: "4px 0 0" }}>
            The purpose of the inspection is to provide advice to the interested party regarding the condition of
            the structure of the property at the time of the inspection.
          </Para>
        </li>
        <li style={{ marginBottom: "10px" }}>
          <strong>Scope of Inspection</strong>
          <Para style={{ margin: "4px 0 0" }}>
            The inspection comprises a visual assessment of accessible areas of the property to identify defects
            and cracking to the building structure and the property as agreed with the client. The inspector has
            reviewed all areas to be inspected as per that agreement.
          </Para>
        </li>
        <li style={{ marginBottom: "10px" }}>
          <strong>Defects</strong>
          <Para style={{ margin: "4px 0 0" }}>
            The inspector has reviewed the property and prepared this report in accordance with the agreed scope.
          </Para>
        </li>
      </ol>
      <Para style={{ fontWeight: 600, margin: "0 0 4px" }}>Additional Scope Details</Para>
      <Para>There is no additional scope for this inspection report.</Para>

      <Heading level={3} compact={compact}>Condition Definitions</Heading>
      <Para style={{ margin: "0 0 8px" }}>
        The following terms are used throughout this report to categorise the condition of materials and finishes:
      </Para>
      <ul style={{ paddingLeft: "1.4em", margin: "0 0 14px" }}>
        {CONDITION_DEFINITIONS.map((c) => (
          <li key={c.term} style={{ marginBottom: "4px", lineHeight: 1.55 }}>
            <strong>{c.term}</strong> — {c.description}
          </li>
        ))}
      </ul>

      <Heading level={3} compact={compact}>Dilapidation Report Information</Heading>
      {DILAPIDATION_REPORT_INFORMATION.map((p, i) => (
        <Para key={i}>{p}</Para>
      ))}
    </div>
  );
}
