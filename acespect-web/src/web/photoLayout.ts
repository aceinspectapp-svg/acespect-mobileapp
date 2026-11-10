/**
 * Row layout for a group of photos that sit under one title.
 *
 * Photos keep their order and are placed in rows by a fixed rule:
 *   - portrait photos go three to a row;
 *   - a row that holds a landscape photo has at most two photos (two landscapes, or a landscape and a portrait).
 * Every portrait is as wide as a third of the row (less the gaps), and every landscape is as TALL as a portrait is wide. The other side
 * follows the photo's own shape, so nothing is ever cropped or stretched (a 3:4 portrait and a 4:3 landscape are the same box turned on
 * its side). Rows start at the left margin and the photos in a row share a bottom line; a lone photo stays at its normal size.
 *
 * Pure and unit-tested (tests/photo-layout.test.mjs); the React side lives in
 * PhotoGrid (components/reportKit.tsx). Units are centimetres throughout.
 */

export interface PackOptions {
  /** Usable width of one row. */
  width: number;
  /** Space between neighbouring photos. */
  gap: number;
  /** Most photos in one row of portraits. */
  maxPerRow: number;
  /** Most photos in a row that holds at least one landscape photo. */
  landscapeMaxPerRow: number;
  /** Kept for callers that size a grid; the boxes above decide the sizes. */
  minHeight: number;
  /** Kept for callers that size a grid; the boxes above decide the sizes. */
  targetHeight: number;
  /** No photo is drawn taller than this (a spot like the cover photo passes a smaller value). */
  maxHeight: number;
}

export interface PackedRow {
  /** Indices (into the input) of the photos in this row, in order. */
  indices: number[];
  /** Each photo's drawn size, in the same order as `indices`; `width / height` is always the photo's own shape. */
  sizes: { width: number; height: number }[];
  /** The tallest photo in the row. */
  height: number;
  /** True when the row holds as many photos as it can (three portraits, or two with a landscape); false for a short row. */
  full: boolean;
}

/** A report page at A4 with the report's side margins: 21cm - 2 x 2.2cm of text width. */
export const PAGE_PACK: PackOptions = { width: 16.4, gap: 0.25, maxPerRow: 3, landscapeMaxPerRow: 2, minHeight: 5, targetHeight: 6.5, maxHeight: 9 };
/** The narrow reviewer preview panel. */
export const COMPACT_PACK: PackOptions = { width: 9, gap: 0.2, maxPerRow: 3, landscapeMaxPerRow: 2, minHeight: 3.5, targetHeight: 4.5, maxHeight: 6 };

/** Wider than tall. A square photo counts as landscape (two to a row), so it is not shrunk to portrait size. */
export const isLandscape = (aspect: number): boolean => aspect >= 1;

export function packPhotoRows(aspects: number[], o: PackOptions): PackedRow[] {
  const n = aspects.length;
  if (n === 0) return [];

  // Rows in order: a row closes when it is at its capacity (three portraits, or two once a landscape is in it), or when the next photo
  // would push it past that capacity.
  const capacity = (idx: number[]) => (idx.some((j) => isLandscape(aspects[j]!)) ? o.landscapeMaxPerRow : o.maxPerRow);
  const groups: number[][] = [];
  let row: number[] = [];
  for (let i = 0; i < n; i++) {
    if (row.length > 0 && row.length + 1 > capacity([...row, i])) {
      groups.push(row);
      row = [];
    }
    row.push(i);
    if (row.length >= capacity(row)) {
      groups.push(row);
      row = [];
    }
  }
  if (row.length > 0) groups.push(row);

  // Every portrait is a third of the row wide (less the gaps); every landscape is exactly that tall. The other side follows the photo's own
  // shape, so nothing is cropped or stretched. Limits: a portrait is never taller than maxHeight, and a landscape never wider than half the
  // row (so two always fit side by side) -- only an unusually tall or wide photo reaches them, and is then scaled down whole.
  const portraitW = (o.width - (o.maxPerRow - 1) * o.gap) / o.maxPerRow;
  const landscapeMaxW = (o.width - (o.landscapeMaxPerRow - 1) * o.gap) / o.landscapeMaxPerRow;
  const fit = (a: number) => {
    let height = isLandscape(a) ? Math.min(portraitW, landscapeMaxW / a) : portraitW / a;
    height = Math.min(height, o.maxHeight);
    return { width: a * height, height };
  };

  const rows: PackedRow[] = groups.map((idx) => {
    const sizes = idx.map((j) => fit(aspects[j]!));
    return { indices: idx, sizes, height: Math.max(...sizes.map((z) => z.height)), full: idx.length >= capacity(idx) };
  });
  return rows;
}
