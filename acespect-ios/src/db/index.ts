import { Platform } from 'react-native';
import type { Database } from '@nozbe/watermelondb';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { schema } from './schema';
import { Inspection } from './models/Inspection';
import { Photo } from './models/Photo';
import { Driveway } from './models/Driveway';

/**
 * WatermelonDB's SQLite adapter relies on a native module (JSI) that is **not**
 * bundled in Expo Go. So we only construct the database in a dev-client /
 * standalone build; in Expo Go `database` is `null` and the app still runs
 * (camera works, persistence is simply inert until you build a dev client).
 *
 * The adapter + Database are `require()`d lazily inside the guard so the
 * native-backed module is never even loaded under Expo Go.
 */
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function createDatabase(): Database | null {
  // No native SQLite adapter in Expo Go or on web — run without a DB there.
  if (isExpoGo || Platform.OS === 'web') return null;

  // The WatermelonDB native module isn't linked in the current standalone
  // builds — online submit via the in-memory draft is the shipped path, so the
  // watermelondb config plugin is intentionally omitted from app.json. Guard
  // the whole init: if the native adapter isn't present, run without a local
  // DB rather than crashing at launch.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SQLiteAdapter = require('@nozbe/watermelondb/adapters/sqlite').default;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Database: DatabaseClass } = require('@nozbe/watermelondb');

    const adapter = new SQLiteAdapter({
      schema,
      jsi: true,
      onSetUpError: (error: unknown) => {
        console.error('[watermelondb] setup error', error);
      },
    });

    return new DatabaseClass({
      adapter,
      modelClasses: [Inspection, Photo, Driveway],
    });
  } catch (err) {
    console.warn('[watermelondb] native module unavailable — running without a local DB.', err);
    return null;
  }
}

export const database = createDatabase();

/** True when a real local database is available (i.e. running a dev build). */
export const isDatabaseReady = database !== null;
