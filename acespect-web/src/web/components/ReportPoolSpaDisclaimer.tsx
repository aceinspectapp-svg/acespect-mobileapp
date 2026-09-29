import { POOL_SAFETY_NOTE, POOL_SPA_DISCLAIMER, POOL_SPA_DISCLAIMER_TITLE } from "../report";
import { Heading, Para } from "./reportKit";

/**
 * Standing legal boilerplate appended right after the Pool / Spa section's
 * own findings. Italic, matching the reference report's own disclaimer
 * styling (the draft's actual pages show this as four separate paragraphs
 * plus a "Pool Safety" note, verified directly against the reference PDF --
 * kept as-is rather than collapsed to one paragraph).
 */
export function ReportPoolSpaDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div style={{ marginTop: "10px", fontStyle: "italic" }}>
      <Heading level={3} compact={compact}>{POOL_SPA_DISCLAIMER_TITLE}</Heading>
      {POOL_SPA_DISCLAIMER.map((p, i) => (
        <Para key={i}>{p}</Para>
      ))}
      <Para style={{ fontWeight: 600, margin: "0 0 2px" }}>Pool Safety</Para>
      <Para>{POOL_SAFETY_NOTE}</Para>
    </div>
  );
}
