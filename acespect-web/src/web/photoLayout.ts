/**
 * Row layout for a group of photos that sit under one title.
 *
 * Given each photo's real shape (width / height), `packPhotoRows` decides how
 * many photos go in each row so that every row fills the page width and all
 * the photos in a row share one height -- three portraits side by side, two
 * portraits and a landscape in one row, two landscapes per row, and so on --
 * with no cropping and no stretching, because each photo is shown at exactly
 * its own shape. The row height follows from the shapes: a row of portraits
 * is taller than a row of landscapes, which keeps every photo at a readable
 * size without a fixed box.
 *
 * Pure and unit-tested (tests/photo-layout.test.mjs); the React side lives in
 * PhotoGrid (components/reportKit.tsx). Units are centimetres throughout.
 */

export interface PackOptions {
  /** Usable width of one row. */
  width: number;
  /** Space between neighbouring photos. */
  gap: number;
  /** Most photos allowed in one row. */
  maxPerRow: number;
  /** A full row is never shorter than this (photos would get too small). */
  minHeight: number;
  /** The row height the layout aims for. */
  targetHeight: number;
  /** A row is never taller than this; if the photos can't fill the width at this height the row is left short. */
  maxHeight: number;
}

export interface PackedRow {
  /** Indices (into the input) of the photos in this row, in order. */
  indices: number[];
  /** Height every photo in the row is drawn at. */
  height: number;
  /** True when the row spans the full width; false for a short last row (e.g. a lone photo). */
  full: boolean;
}

/** A report page at A4 with the report's side margins: 21cm - 2 x 2.2cm of text width. */
export const PAGE_PACK: PackOptions = { width: 16.4, gap: 0.25, maxPerRow: 4, minHeight: 5, targetHeight: 6.5, maxHeight: 9 };
/** The narrow reviewer preview panel. */
export const COMPACT_PACK: PackOptions = { width: 9, gap: 0.2, maxPerRow: 3, minHeight: 3.5, targetHeight: 4.5, maxHeight: 6 };

export function packPhotoRows(aspects: number[], o: PackOptions): PackedRow[] {
  const n = aspects.length;
  if (n === 0) return [];

  // The cost of drawing photos [i, i+k) as one row; `short` rows (too few photos to fill the width) are only allowed as the last row.
  const rowFor = (i: number, k: number): { height: number; full: boolean; cost: number } => {
    let sum = 0;
    for (let j = i; j < i + k; j++) sum += aspects[j];
    const fillHeight = (o.width - (k - 1) * o.gap) / sum;
    if (fillHeight > o.maxHeight) {
      if (i + k < n) return { height: o.maxHeight, full: false, cost: Infinity };
      return { height: o.maxHeight, full: false, cost: (o.maxHeight - o.targetHeight) ** 2 + 0.5 };
    }
    const tooSmall = fillHeight < o.minHeight ? 25 * (o.minHeight - fillHeight) ** 2 : 0;
    return { height: fillHeight, full: true, cost: (fillHeight - o.targetHeight) ** 2 + tooSmall };
  };

  // best[i] = cheapest way to lay out photos i..n-1
  const best: number[] = new Array(n + 1).fill(Infinity);
  const take: number[] = new Array(n + 1).fill(1);
  best[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let k = 1; k <= o.maxPerRow && i + k <= n; k++) {
      const total = rowFor(i, k).cost + best[i + k];
      if (total < best[i]) {
        best[i] = total;
        take[i] = k;
      }
    }
  }

  const rows: PackedRow[] = [];
  for (let i = 0; i < n; ) {
    const k = take[i];
    const r = rowFor(i, k);
    rows.push({ indices: Array.from({ length: k }, (_, j) => i + j), height: r.height, full: r.full });
    i += k;
  }
  return rows;
}
