import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * The long-lived signed link that downloads every original photo of the inspection as one zip, for the report's existing
 * "For a full download please Click here to access." sentence. `url` is null while it loads, when the inspection has no photos,
 * or when the link cannot be made -- "Click here" then stays as the report printed it before. `pending` is true while it loads.
 */
export function useOriginalPhotosLink(inspectionId: string): { url: string | null; pending: boolean } {
  const [link, setLink] = useState<{ url: string; count: number } | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    setLink(undefined);
    api
      .getOriginalPhotosLink(inspectionId)
      .then((l) => { if (!cancelled) setLink(l); })
      .catch(() => { if (!cancelled) setLink(null); });
    return () => { cancelled = true; };
  }, [inspectionId]);
  return { url: link && link.count > 0 ? link.url : null, pending: link === undefined };
}

/** While the link loads, holds the server's PDF/Word export back (the same marker the photo grids use), so "Click here" is printed linked. */
export function OriginalPhotosPending({ pending }: { pending: boolean }) {
  return pending ? <span data-photo-grid-pending="" style={{ display: "none" }} /> : null;
}
