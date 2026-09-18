import {
  CRACK_CATEGORISATION_TABLE,
  CRACK_CATEGORISATION_TABLE_FOOTNOTE,
  CRACK_CATEGORISATION_TABLE_TITLE,
} from "../report";
import { Heading, Note, Table } from "./reportKit";

/** AS4349.1-2007 Table E1 -- categorisation of cracking in masonry, referenced by every section's damage findings. */
export function ReportCrackTable({ compact = false }: { compact?: boolean }) {
  return (
    <div>
      <Heading level={2} compact={compact}>{CRACK_CATEGORISATION_TABLE_TITLE}</Heading>
      <Table
        compact={compact}
        columns={["Description of typical damage and required repair", "Width Limit", "Damage Category"]}
        rows={CRACK_CATEGORISATION_TABLE.map((r) => [r.description, r.widthLimit, r.category])}
      />
      <Note>{CRACK_CATEGORISATION_TABLE_FOOTNOTE}</Note>
    </div>
  );
}
