import { Platform } from 'react-native';
import Constants from 'expo-constants';
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
