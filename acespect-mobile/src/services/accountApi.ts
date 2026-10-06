import { api } from './apiClient';
import { withCache } from './qcCache';

/** The signed-in person's own account: password, two-factor sign-in, notification preferences. */

export interface NotificationEventPref {
  type: string;
  label: string;
  mandatory: boolean;
  inApp: boolean;
  email: 'IMMEDIATE' | 'DIGEST' | 'OFF';
}

export interface AccountMe {
  user: { id: string; email: string; name: string | null; mfaEnabled?: boolean };
}

export const getAccount = () => api.get<AccountMe>('/auth/me').then((r) => r.data);

export const changePassword = (currentPassword: string, newPassword: string) => api.post('/auth/password/change', { currentPassword, newPassword }).then(() => undefined);

export const startMfa = () => api.post<{ secret: string; otpauthUri: string }>('/auth/mfa/setup').then((r) => r.data);
export const confirmMfa = (code: string) => api.post<{ backupCodes: string[] }>('/auth/mfa/confirm', { code }).then((r) => r.data);
export const disableMfa = (password: string) => api.post('/auth/mfa/disable', { password }).then(() => undefined);

export const getNotificationPrefs = () => withCache('notification-prefs', () => api.get<{ events: NotificationEventPref[] }>('/qc/notification-prefs').then((r) => r.data.events));
export const saveNotificationPrefs = (events: Array<Pick<NotificationEventPref, 'type' | 'inApp' | 'email'>>) => api.put('/qc/notification-prefs', { events }).then(() => undefined);
