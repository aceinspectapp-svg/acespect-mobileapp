import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { CapturedPhoto } from '../types/photo';
import { database } from '../db';
import { persistPhoto } from '../db/photoRepo';
import { useInspectionDraft } from '../context/InspectionDraftContext';

/**
 * Camera + gallery capture via the OS pickers (works in Expo Go).
 *
 * Both entry points return a normalized {@link CapturedPhoto}[] or `null` when
 * the user cancels -- `takePhoto` always resolves to a single-element array
 * (the camera only ever captures one shot at a time), `pickFromLibrary` can
 * return several (the library picker allows selecting multiple at once).
 * On a hard permission denial we surface an Alert and return null.
 * Successful captures are copied into the app document directory so the URI is
 * stable (raw camera/cache URIs are transient) — that saved path is what
 * WatermelonDB will persist in Phase 2.
 */

const PHOTO_DIR = 'inspection-photos';

/** Copy a picked asset into document storage and return the stable file URI. */
function persistToDocuments(sourceUri: string, id: string): string {
  // The document-directory File API is native-only; on web (dev runs) the
  // picked blob URI is already usable, so pass it through untouched.
  if (Platform.OS === 'web') return sourceUri;

  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });

  const ext = sourceUri.split('.').pop()?.split('?')[0] || 'jpg';
  const dest = new File(dir, `${id}.${ext}`);
  new File(sourceUri).copy(dest);
  return dest.uri;
}

function toCapturedPhoto(
  asset: ImagePicker.ImagePickerAsset,
  opts?: { caption?: string; category?: string },
): CapturedPhoto {
  const id = Crypto.randomUUID();
  return {
    id,
    uri: persistToDocuments(asset.uri, id),
    caption: opts?.caption ?? '',
    capturedAt: new Date().toISOString(),
    category: opts?.category,
  };
}

function toCapturedPhotos(
  assets: ImagePicker.ImagePickerAsset[],
  opts?: { caption?: string; category?: string },
): CapturedPhoto[] {
  return assets.map((asset) => toCapturedPhoto(asset, opts));
}

export interface CaptureOptions {
  caption?: string;
  category?: string;
  /** When set, the photo is also persisted to WatermelonDB under this section. */
  sectionKey?: string;
  /** Position within the section (best-effort ordering for persistence). */
  sortOrder?: number;
}

/**
 * Best-effort persist to the local DB. No-ops in Expo Go (database === null)
 * and swallows errors so a DB hiccup never blocks the capture UX.
 */
async function maybePersist(photo: CapturedPhoto, sortOrder: number, opts?: CaptureOptions): Promise<void> {
  if (!opts?.sectionKey || !database) return;
  try {
    await persistPhoto(database, {
      sectionKey: opts.sectionKey,
      photo,
      sortOrder,
    });
  } catch (err) {
    console.warn('[usePhotoCapture] failed to persist photo', err);
  }
}

export function usePhotoCapture() {
  const { addPhoto } = useInspectionDraft();

  // Persist locally + register each photo in the inspection draft (by
  // sectionKey) so it's uploaded and attached to the right section at
  // submit time. Sequential sortOrders starting from opts.sortOrder, so a
  // multi-select from the library still orders correctly relative to
  // what's already in the section.
  const register = useCallback(
    async (photos: CapturedPhoto[], opts?: CaptureOptions) => {
      const base = opts?.sortOrder ?? 0;
      for (let i = 0; i < photos.length; i++) {
        await maybePersist(photos[i]!, base + i, opts);
        if (opts?.sectionKey) addPhoto(opts.sectionKey, photos[i]!.uri);
      }
    },
    [addPhoto],
  );

  const takePhoto = useCallback(
    async (opts?: CaptureOptions): Promise<CapturedPhoto[] | null> => {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Camera access needed',
          'Enable camera access in Settings to capture inspection photos.',
        );
        return null;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        exif: true,
      });
      if (result.canceled || !result.assets?.length) return null;
      const photos = toCapturedPhotos(result.assets, opts);
      await register(photos, opts);
      return photos;
    },
    [register],
  );

  const pickFromLibrary = useCallback(
    async (opts?: CaptureOptions): Promise<CapturedPhoto[] | null> => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Photo access needed',
          'Enable photo-library access in Settings to attach existing photos.',
        );
        return null;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        // Select several at once instead of one round-trip per photo.
        // selectionLimit: 0 = no cap (the system's own max).
        allowsMultipleSelection: true,
        selectionLimit: 0,
      });
      if (result.canceled || !result.assets?.length) return null;
      const photos = toCapturedPhotos(result.assets, opts);
      await register(photos, opts);
      return photos;
    },
    [register],
  );

  return { takePhoto, pickFromLibrary };
}
