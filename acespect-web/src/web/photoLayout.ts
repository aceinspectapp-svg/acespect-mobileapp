/**
 * Row layout for a group of photos that sit under one title.
 *
 * Photos keep their order and are placed in rows by a fixed rule:
 *   - portrait photos go three to a row;
 *   - a row that holds a landscape photo has at most two photos (two landscapes, or a landscape and a portrait).
 * Every photo sits in a box of its kind's one size: three portrait boxes (3:4) fill a row exactly, and so do two landscape boxes (4:3).
 * A photo of the usual phone shape fills its box; any other shape (a screenshot, a panorama) is shown whole inside it, never cropped or
 * stretched. Rows start at the left margin and the photos in a row share a bottom line; a lone photo stays at its normal size.
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
  /** Each photo's box, in the same order as `indices`: every portrait's box is the same (3:4), and every landscape's (4:3). */
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

/** The shape of every portrait photo's box (a phone photo held upright), and of every landscape one's. */
export const PORTRAIT_BOX = 3 / 4;
export const LANDSCAPE_BOX = 4 / 3;

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

  // Three portrait boxes fill the row, and so do two landscape boxes. Only a spot that limits the height (the cover photo) makes them smaller,
  // and then every box of that kind shrinks alike.
  const portraitW = (o.width - (o.maxPerRow - 1) * o.gap) / o.maxPerRow;
  const landscapeW = (o.width - (o.landscapeMaxPerRow - 1) * o.gap) / o.landscapeMaxPerRow;
  const box = (width: number, aspect: number) => {
    const height = Math.min(width / aspect, o.maxHeight);
    return { width: height * aspect, height };
  };
  const portraitBox = box(portraitW, PORTRAIT_BOX);
  const landscapeBox = box(landscapeW, LANDSCAPE_BOX);
  const fit = (a: number) => ({ ...(isLandscape(a) ? landscapeBox : portraitBox) });

  const rows: PackedRow[] = groups.map((idx) => {
    const sizes = idx.map((j) => fit(aspects[j]!));
    return { indices: idx, sizes, height: Math.max(...sizes.map((z) => z.height)), full: idx.length >= capacity(idx) };
  });
  return rows;
}
