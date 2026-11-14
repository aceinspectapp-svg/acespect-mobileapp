import { API_BASE, fetchWithRefresh, getToken } from "./api";
import { constructionFileName } from "./construction/ConstructionReport";

/** The name the report file is saved under (the same one the report page's Download PDF / Word buttons use). */
export function reportFileName(inspection: { id: string; jobNo?: string | null }, construction: boolean, format: "pdf" | "docx"): string {
  const job = inspection.jobNo || inspection.id;
  const pdf = construction ? constructionFileName(job) : `${job.replace(/[^a-z0-9.-]+/gi, "-")}-dilapidation-report.pdf`;
  return format === "pdf" ? pdf : pdf.replace(/\.pdf$/, ".docx");
}

/**
 * The report as a PDF or an editable Word file, made server-side from the report page, opened in a new tab.
 * The tab is opened straight away (this must be called inside the click, so the browser does not block it as a pop-up) and shows a
 * short "Preparing" note while the server builds the file; then a PDF shows in the browser's own viewer, and a Word file (which a
 * browser cannot show) is saved from that tab under its proper name. If the browser blocks new tabs, the file downloads here instead.
 * Throws (after showing the reason in the new tab) when the file could not be made.
 */
export async function openReportFile(id: string, format: "pdf" | "docx", fileName: string): Promise<void> {
  const label = format === "pdf" ? "PDF" : "Word document";
  const win = window.open("", "_blank");
  const note = (title: string, text: string) => {
    if (!win || win.closed) return;
    win.document.title = title;
    win.document.body.style.cssText = "font-family: Inter, system-ui, sans-serif; color: #1a2a4a; padding: 48px; text-align: center;";
    win.document.body.textContent = text;
  };
  note(fileName, `Preparing the ${label}… this can take a few seconds.`);
  try {
    const token = getToken();
    const res = await fetchWithRefresh(`${API_BASE}/inspections/${id}/report.${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      // The server says why (for example the report page could not be opened); show that instead of a bare status code.
      const why = (await res.json().catch(() => null))?.error?.message;
      throw new Error(`Failed to generate ${format === "pdf" ? "PDF" : "Word document"}${why ? `: ${why}` : ` (HTTP ${res.status})`}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    // Kept for a while so the new tab can finish loading (and the viewer can save) the file; freed with this page at the latest.
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
    if (win && !win.closed && format === "pdf") {
      win.location.href = url;
      return;
    }
    const doc = win && !win.closed ? win.document : document;
    const a = doc.createElement("a");
    a.href = url;
    a.download = fileName;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    note(fileName, `${fileName} has been downloaded. You can close this tab.`);
  } catch (e) {
    const message = e instanceof Error ? e.message : `Failed to download the ${label}`;
    note("Report not available", message);
    throw new Error(message);
  }
}
