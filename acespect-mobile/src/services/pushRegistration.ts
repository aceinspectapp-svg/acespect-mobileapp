import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { registerPushToken } from './qcPlatformApi';

/**
 * Ask for notification permission and register this phone's Expo push token
 * so alerts (especially Safety Hazards) reach the person when the app is
 * closed. expo-notifications is a native module: a build made before it was
 * added does not have it, so everything here is guarded and a missing module
 * is simply "no push on this build" (in-app notifications still work).
 */
export async function registerForPush(): Promise<void> {
  if (Platform.OS === 'web') return;
  // Expo Go removed remote push in SDK 53 and logs a loud error just for loading the module, so do not even try there.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return;
  // An Android build with no Firebase file cannot get a push token, and a build made before expo-notifications was added
  // does not contain its native code. In both cases do not even load the module.
  if (Platform.OS === 'android' && !Constants.expoConfig?.android?.googleServicesFile) return;
  if (!requireOptionalNativeModule('ExpoPushTokenManager') || !requireOptionalNativeModule('ExpoNotificationPermissionsModule')) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');
    const existing = await Notifications.getPermissionsAsync();
    const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await registerPushToken(token.data, Platform.OS);
  } catch {
    // No native module on this build, or the user declined: carry on without push.
  }
}
