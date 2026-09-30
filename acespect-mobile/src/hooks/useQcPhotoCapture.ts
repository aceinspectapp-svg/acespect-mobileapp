import { useCallback } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { QcPhoto } from '../types/qc';

/**
 * Camera + gallery capture for QC task updates, via the same OS pickers
 * `usePhotoCapture` uses for the Houspect flow (works in Expo Go).
 *
 * Deliberately simpler: QC data is session-only (see QcDataContext), so
 * there's no WatermelonDB persistence or document-directory copy here — the
 * picker's own URI is used directly, same as it is for the rest of the
 * session's QC state.
 */
function toQcPhotos(assets: ImagePicker.ImagePickerAsset[]): QcPhoto[] {
  return assets.map((asset, i) => ({ id: `${Date.now()}-${i}`, uri: asset.uri }));
}

export function useQcPhotoCapture() {
  const takePhoto = useCallback(async (): Promise<QcPhoto[] | null> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera access needed', 'Enable camera access in Settings to attach a photo.');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.length) return null;
    return toQcPhotos(result.assets);
  }, []);

  const pickFromLibrary = useCallback(async (): Promise<QcPhoto[] | null> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photo access needed', 'Enable photo-library access in Settings to attach a photo.');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: 0,
    });
    if (result.canceled || !result.assets?.length) return null;
    return toQcPhotos(result.assets);
  }, []);

  return { takePhoto, pickFromLibrary };
}
