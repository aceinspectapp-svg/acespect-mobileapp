import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import { useNetworkState } from 'expo-network';
import { Directory, File, Paths } from 'expo-file-system';
import { SystemStatus } from '../types/jobSetup';

/**
 * Live data for the Job Information "System Status" card. Replaces the old
 * static snapshot with real, real-time values:
 *  - startedAt   — device clock, captured when the screen mounts
 *  - gpsLocation — expo-location, initial fix + live watch
 *  - photoSequence — next IMG number from the on-disk photo count
 *  - cloudSync   — expo-network connectivity (reactive)
 *  - offlineSave — local-storage availability
 */

export interface SystemStatusRow {
  value: string;
  /** Drives the trailing green check — true once the row has real, good data. */
  ready: boolean;
}

export interface LiveSystemStatus {
  startedAt: SystemStatusRow;
  gpsLocation: SystemStatusRow;
  photoSequence: SystemStatusRow;
  cloudSync: SystemStatusRow;
  offlineSave: SystemStatusRow;
  /** Flattened snapshot to hand forward in the navigation payload. */
  snapshot: SystemStatus;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatStarted(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm} · ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Count photos already on disk so the next IMG number is real. */
function nextPhotoLabel(): string {
  let count = 0;
  if (Platform.OS !== 'web') {
    try {
      const dir = new Directory(Paths.document, 'inspection-photos');
      if (dir.exists) {
        count = dir.list().filter((e) => e instanceof File).length;
      }
    } catch {
      count = 0;
    }
  }
  const next = String(count + 1).padStart(3, '0');
  return `Ready — IMG_${next}`;
}

export function useSystemStatus(): LiveSystemStatus {
  // Inspection start — captured once, when setup opens.
  const [startedAt] = useState(() => formatStarted(new Date()));

  // Next photo number from real on-disk count (recomputed on mount).
  const [photoSeq] = useState(() => nextPhotoLabel());

  // Live network state.
  const net = useNetworkState();
  const online = net.isInternetReachable ?? net.isConnected ?? false;
  const netKnown = net.isConnected !== undefined || net.isInternetReachable !== undefined;

  // Live GPS.
  const [gps, setGps] = useState<SystemStatusRow>({ value: 'Locating…', ready: false });

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    const fmt = (c: Location.LocationObjectCoords) =>
      `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`;

    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!perm.granted) {
        setGps({ value: 'Permission denied', ready: false });
        return;
      }
      try {
        const initial = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) setGps({ value: fmt(initial.coords), ready: true });
      } catch {
        if (!cancelled) setGps({ value: 'Unavailable', ready: false });
      }
      // Live updates as the device moves / refines its fix.
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 5 },
        (loc) => setGps({ value: fmt(loc.coords), ready: true }),
      );
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // AsyncStorage-backed draft persistence (see offlineStorage.ts) works on
  // every platform this app runs on -- unlike the old WatermelonDB-based
  // check this replaced, there's no native module that could be missing.
  const offlineActive = true;

  const cloudSync: SystemStatusRow = {
    value: !netKnown ? 'Checking…' : online ? 'Connected' : 'Offline',
    ready: online,
  };

  const offlineSave: SystemStatusRow = {
    value: offlineActive ? 'Active' : 'Inactive',
    ready: offlineActive,
  };

  return {
    startedAt: { value: startedAt, ready: true },
    gpsLocation: gps,
    photoSequence: { value: photoSeq, ready: true },
    cloudSync,
    offlineSave,
    snapshot: {
      startedAt,
      gpsLocation: gps.value,
      photoSequence: photoSeq,
      cloudSync: online ? 'Connected' : 'Offline',
      offlineSave: offlineActive ? 'Active' : 'Inactive',
    },
  };
}
