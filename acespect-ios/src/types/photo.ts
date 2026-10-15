/**
 * A photo captured during an inspection.
 *
 * `uri` points at a copy saved under the app's document directory
 * (`inspection-photos/`), so it survives the camera/cache being cleared and is
 * a stable path. In Phase 2 this same path is what WatermelonDB persists in the
 * `photos.file_path` column; the file itself stays on disk and is later uploaded
 * to Supabase Storage via the Express sync layer.
 */
export interface CapturedPhoto {
  /** Stable local id (uuid). Doubles as the on-disk filename stem. */
  id: string;
  /** file:// URI of the saved copy in the document directory. */
  uri: string;
  /** Inspector-facing caption / note. */
  caption: string;
  /** ISO timestamp of capture. */
  capturedAt: string;
  /** Optional overview-photo category id (see overviewPhotos.ts). */
  category?: string;
}
