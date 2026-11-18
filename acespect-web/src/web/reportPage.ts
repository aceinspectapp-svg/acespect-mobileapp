/**
 * The report page (/report/:id): the generated report on screen, with Download PDF and Download Word. The review page's Report
 * button opens it in a new tab, so the review stays open behind it.
 */
export const reportPagePath = (id: string): string => `/report/${encodeURIComponent(id)}`;

type Opener = (url: string, target: string) => unknown;

/**
 * Opens the report page in a new tab. Call it inside the click, so the browser does not block it as a pop-up. Returns false when the
 * browser blocked the new tab anyway; the caller then shows the report page in this tab instead.
 */
export function openReportPage(id: string, open: Opener = (url, target) => window.open(url, target)): boolean {
  return !!open(reportPagePath(id), "_blank");
}

/**
 * What the report page's Back button does. In a tab of its own (opened by the Report button) there is nothing to go back to, so it
 * closes the tab; if the browser does not allow that, it shows the inspection's review page. Otherwise it goes back as before.
 */
export function reportBackAction(historyLength: number): "back" | "close" {
  return historyLength > 1 ? "back" : "close";
}

/** The review page an inspection's report page belongs to, for the Back button when its tab cannot be closed. */
export function reviewPagePath(role: string | undefined, id: string): string {
  if (role === "admin") return `/admin/inspections/${encodeURIComponent(id)}`;
  if (role === "reviewer") return `/reviewer/review/${encodeURIComponent(id)}`;
  return role ? `/${role}/dashboard` : "/";
}
