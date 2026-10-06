import { useEffect, useState } from "react";

/** What a photo is assumed to be shaped like until its real size is known (or if it fails to load). */
export const FALLBACK_ASPECT = 4 / 3;

/**
 * Each photo's real shape (width / height), read by loading the image. While
 * any are still loading, `pending` is true and the unknown ones count as
 * 4:3 -- the layout settles as soon as the real sizes arrive. The PDF
 * generator waits for `pending` to clear (the grid marks itself with
 * `data-photo-grid-pending`) before printing.
 */
export function useImageAspects(urls: string[]): { aspects: number[]; pending: boolean } {
  const [known, setKnown] = useState<Record<string, number>>({});
  const key = urls.join("\n");

  useEffect(() => {
    let cancelled = false;
    for (const url of urls) {
      if (url in known) continue;
      const img = new Image();
      const done = (aspect: number) => {
        if (!cancelled) setKnown((prev) => (url in prev ? prev : { ...prev, [url]: aspect }));
      };
      img.onload = () => done(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : FALLBACK_ASPECT);
      img.onerror = () => done(FALLBACK_ASPECT);
      img.src = url;
    }
    return () => {
      cancelled = true;
    };
    // `known` is deliberately not a dependency: it only ever grows, and re-running on every arrival would restart the loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { aspects: urls.map((u) => known[u] ?? FALLBACK_ASPECT), pending: urls.some((u) => !(u in known)) };
}
