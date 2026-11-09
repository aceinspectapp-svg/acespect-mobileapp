import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { InspectionDraftProvider } from './src/context/InspectionDraftContext';
import { QcDataProvider } from './src/context/QcDataContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { database } from './src/db';
import { initSyncManager } from './src/services/syncManager';
import { startSslPinning } from './src/services/sslPinning';
import { recordEvent } from './src/services/auditEvents';

// Before anything talks to the server (see src/services/sslPinning.ts).
void startSslPinning((host) => recordEvent('network.tls_pin_refused', { severity: 'warning', message: `A connection to ${host} was refused: its certificate did not match the pinned keys` }));

/**
 * App entry. Provider order: (database) -> safe area -> auth -> navigation.
 *
 * `@nozbe/watermelondb/react` is required lazily, only when a real database
 * exists, because merely importing it touches WatermelonDB's native JSI
 * binding — which isn't installed in this build (the config plugin that wires
 * it into MainApplication.kt was removed for Expo SDK 54/new-arch
 * compatibility). A static top-level import here crashed the app on launch.
 */
export default function App() {
  // Kicks off the offline sync queue: flushes anything saved from a previous
  // offline session, then watches for connectivity regained. See
  // src/services/syncManager.ts.
  useEffect(() => {
    void initSyncManager();
  }, []);

  const tree = (
    <SafeAreaProvider>
      <AuthProvider>
        <InspectionDraftProvider>
          <QcDataProvider>
            <RootNavigator />
          </QcDataProvider>
        </InspectionDraftProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );

  if (database) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseProvider } = require('@nozbe/watermelondb/react');
    return <DatabaseProvider database={database}>{tree}</DatabaseProvider>;
  }
  return tree;
}
