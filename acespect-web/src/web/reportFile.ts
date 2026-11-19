import { API_BASE, ensureSession, getToken } from "./api";
import { constructionFileName } from "./construction/ConstructionReport";
import { makeReportFile, progressText, SignInAgainError, type ReportFormat } from "./reportJob";

/** The name the report file is saved under (the same one the report page's Download PDF / Word buttons use). */
export function reportFileName(inspection: { id: string; jobNo?: string | null }, construction: boolean, format: "pdf" | "docx"): string {
  const job = inspection.jobNo || inspection.id;
  const pdf = construction ? constructionFileName(job) : `${job.replace(/[^a-z0-9.-]+/gi, "-")}-dilapidation-report.pdf`;
  return format === "pdf" ? pdf : pdf.replace(/\.pdf$/, ".docx");
}

/** A finished report file, ready for the person to open (PDF) or save (Word) with a click. */
export interface ReadyReport {
  format: ReportFormat;
  fileName: string;
  url: string;
  /** "Open PDF" / "Download Word". */
  label: string;
  /** Opens the PDF in a new tab, or saves the Word file. Call it from a click, so the browser (Safari especially) allows it. */
  open: () => void;
}

/** Where "Sign in again" goes: the sign-in page, which then says the session ended. */
export const signInAgainHref = () => `${typeof window !== "undefined" ? window.location.origin : ""}/?reason=SESSION_REVOKED`;

/** The button's words for a finished file. */
export const readyLabel = (format: ReportFormat) => (format === "pdf" ? "Open PDF" : "Download Word");

/** Opens (PDF) or saves (Word) a finished file from a click in `doc`'s window. */
function openFile(doc: Document, format: ReportFormat, url: string, fileName: string): void {
  const a = doc.createElement("a");
  a.href = url;
  if (format === "pdf") a.target = "_blank";
  else a.download = fileName;
  a.rel = "noopener";
  doc.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The report as a PDF or an editable Word file, made server-side from the report page in the background (reportJob.ts).
 *
 * A tab is opened straight away (this must be called inside the click, so the browser does not block it as a pop-up) and shows
 * "Preparing report…" with how far the server has got. When the file is ready the tab shows an "Open PDF" / "Download Word" button: the
 * person clicks it, so the browser treats the download as theirs (Safari blocks one started by a script after a long wait). The same file
 * is returned, so the page that asked can offer the button too (when the browser blocked the new tab, or it was closed).
 *
 * The login is checked and renewed before every request (a large report takes longer than a login lasts); when it has ended the tab says
 * "Please sign in again" with a link, and SignInAgainError is thrown. `onProgress` is told the same progress text (for the page's own
 * status line). Throws (after showing the reason in the new tab) when the file could not be made.
 */
export async function openReportFile(id: string, format: ReportFormat, fileName: string, onProgress?: (text: string) => void): Promise<ReadyReport> {
  const label = format === "pdf" ? "PDF" : "Word document";
  const win = window.open("", "_blank");
  const open = () => !!win && !win.closed;
  /** The tab's whole content: a line of text and, optionally, a button or a link. */
  const show = (title: string, text: string, action?: { label: string; onClick?: () => void; href?: string }) => {
    if (!open()) return;
    const doc = win!.document;
    doc.title = title;
    doc.body.style.cssText = "font-family: Inter, system-ui, sans-serif; color: #1a2a4a; padding: 48px; text-align: center;";
    doc.body.textContent = "";
    const p = doc.createElement("p");
    p.textContent = text;
    p.setAttribute("role", "status");
    doc.body.appendChild(p);
    if (!action) return;
    const style = "display: inline-block; margin-top: 16px; padding: 12px 24px; border-radius: 8px; border: none; background: #1a2a4a; color: white; font: 700 15px Inter, system-ui, sans-serif; cursor: pointer; text-decoration: none;";
    if (action.href) {
      const a = doc.createElement("a");
      a.href = action.href;
      a.textContent = action.label;
      a.style.cssText = style;
      doc.body.appendChild(a);
    } else {
      const b = doc.createElement("button");
      b.type = "button";
      b.textContent = action.label;
      b.style.cssText = style;
      b.setAttribute("data-report-ready", format);
      b.onclick = () => action.onClick?.();
      doc.body.appendChild(b);
    }
  };
  // The current login, as it is when each request goes out (it is renewed between requests); not api.ts's fetchWithRefresh, so a login
  // that has ended is reported here ("Please sign in again") rather than taking this tab to the sign-in page.
  const request = (path: string, init: RequestInit = {}) => {
    const token = getToken();
    return fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "X-App-Client": "web", ...(init.headers as Record<string, string> | undefined), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  };
  let lastProgress = "Preparing report…";
  try {
    const blob = await makeReportFile(id, format, request, {
      session: (force) => ensureSession({ force, redirect: false }),
      onProgress: (job) => {
        const text = progressText(job, format);
        lastProgress = text;
        const working = !job || (job.state !== "done" && job.state !== "failed");
        show(fileName, working ? `${text} This can take a few minutes for a report with many photographs; you can keep working in the other tab.` : text);
        onProgress?.(text);
      },
      onRetry: ({ waitMs }) => {
        const text = `${lastProgress} The server is busy; trying again in ${Math.round(waitMs / 1000)} s.`;
        show(fileName, text);
        onProgress?.(text);
      },
    });
    const url = URL.createObjectURL(blob);
    // Kept for a while so the file can still be opened or saved from the button; freed with this page at the latest.
    setTimeout(() => URL.revokeObjectURL(url), 30 * 60_000);
    const ready: ReadyReport = {
      format,
      fileName,
      url,
      label: readyLabel(format),
      open: () => (open() ? openFile(win!.document, format, url, fileName) : openFile(document, format, url, fileName)),
    };
    show(fileName, `${fileName} is ready.`, {
      label: ready.label,
      onClick: () => {
        if (format === "pdf") win!.location.href = url; // the PDF in this tab, in the browser's own viewer
        else {
          openFile(win!.document, format, url, fileName);
          show(fileName, `${fileName} has been downloaded. You can close this tab.`, { label: "Download again", onClick: () => openFile(win!.document, format, url, fileName) });
        }
      },
    });
    return ready;
  } catch (e) {
    if (e instanceof SignInAgainError) {
      show("Please sign in again", e.message, { label: "Sign in again", href: signInAgainHref() });
      throw e;
    }
    const message = e instanceof Error ? e.message : `Failed to download the ${label}`;
    show("Report not available", message);
    throw new Error(message);
  }
}
