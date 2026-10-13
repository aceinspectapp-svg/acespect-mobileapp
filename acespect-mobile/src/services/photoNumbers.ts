/**
 * Photo numbers: the first photo taken in an inspection is 1, the next 2, and so on through the whole inspection (100, 200, 500 ...),
 * whichever section it belongs to. The number is given at the moment the photo is taken and becomes the photo's file name in Egnyte.
 * Numbers are never reused: if a photo is deleted its number is simply skipped.
 *
 * Kept in memory for the inspection in progress, saved with the draft (so a resumed inspection carries on from where it was) and
 * copied into a queued submission (so a retry later still uses the same names).
 */
let seq = 0;
const numbers = new Map<string, number>();

/** The number for this photo file, giving it the next one if it has none yet. */
export function numberPhoto(uri: string): number {
  const have = numbers.get(uri);
  if (have !== undefined) return have;
  seq += 1;
  numbers.set(uri, seq);
  return seq;
}

export const getPhotoNumber = (uri: string): number | undefined => numbers.get(uri);

/** A photo's file was replaced (marked up in the annotator): the new file keeps the old file's number. */
export function transferPhotoNumber(oldUri: string, newUri: string): void {
  const n = numbers.get(oldUri);
  if (n !== undefined && !numbers.has(newUri)) numbers.set(newUri, n);
}

export function snapshotPhotoNumbers(): { photoNumbers: Record<string, number>; photoSeq: number } {
  return { photoNumbers: Object.fromEntries(numbers), photoSeq: seq };
}

export function restorePhotoNumbers(photoNumbers?: Record<string, number>, photoSeq?: number): void {
  numbers.clear();
  for (const [uri, n] of Object.entries(photoNumbers ?? {})) numbers.set(uri, n);
  seq = Math.max(photoSeq ?? 0, ...numbers.values(), 0);
}

/** Add the numbers a queued submission carries, without disturbing the inspection that may be in progress now. */
export function mergePhotoNumbers(photoNumbers?: Record<string, number>): void {
  for (const [uri, n] of Object.entries(photoNumbers ?? {})) if (!numbers.has(uri)) numbers.set(uri, n);
}

export function resetPhotoNumbers(): void {
  numbers.clear();
  seq = 0;
}
