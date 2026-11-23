/**
 * Which kind of report an inspection makes, as its file name and Word title say it: "construction", "pre-purchase" (Pre-Purchase /
 * Apartment, laid out as its own template -- acespect-web/src/web/prepurchase/) or "dilapidation" (every other report type, as before).
 * The inspection's type and property type are stored as titles ("Pre-Purchase", "Apartment") or slugs ("pre_purchase", "apartment").
 */
export type ReportKind = 'construction' | 'pre-purchase' | 'dilapidation';

const slug = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '_');

export function reportKind(inspectionType: string | null | undefined, propertyType: string | null | undefined): ReportKind {
  if (/construction/i.test(inspectionType ?? '')) return 'construction';
  if (slug(inspectionType) === 'pre_purchase' && slug(propertyType) === 'apartment') return 'pre-purchase';
  return 'dilapidation';
}

/** "Construction" / "Pre-Purchase" / "Dilapidation" -- the Word file's title ("Pre-Purchase Report V123"). */
export function reportKindTitle(kind: ReportKind): string {
  return kind === 'construction' ? 'Construction' : kind === 'pre-purchase' ? 'Pre-Purchase' : 'Dilapidation';
}

/** "V123-pre-purchase-report.pdf". */
export function reportFileNameFor(jobNo: string, kind: ReportKind, format: 'pdf' | 'docx'): string {
  return `${jobNo}-${kind}-report.${format}`.replace(/[^a-z0-9.-]+/gi, '-');
}
