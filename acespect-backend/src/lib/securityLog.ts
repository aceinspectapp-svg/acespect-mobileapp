import { prisma } from './prisma';
import { audit } from './auditTrail';

export type SecurityEventType =
  | 'LOGIN_OK' | 'LOGIN_FAILED' | 'LOCKOUT' | 'MFA_FAILED' | 'PASSWORD_RESET' | 'PASSWORD_CHANGED'
  | 'INVITATION_ACCEPTED' | 'FORBIDDEN' | 'CROSS_TENANT' | 'SUPPORT_START' | 'SUPPORT_END' | 'CONTEXT_SWITCH'
  | 'MEDIA_DENIED' | 'FILE_ACCESS' | 'REPORT_DOWNLOAD' | 'EXPORT' | 'TAMPER_DETECTED' | 'SESSION_REVOKED';

/**
 * E31 / REQ-AUD-003: record a security-relevant event. Logging must never
 * break the request that triggered it, so failures are swallowed.
 */
export async function logSecurityEvent(e: {
  type: SecurityEventType;
  clientId?: string | null;
  userId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await prisma.qcSecurityEvent.create({
      data: { type: e.type, clientId: e.clientId ?? null, userId: e.userId ?? null, detail: (e.detail ?? {}) as object, ip: e.ip ?? null },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[securityLog] could not record event', e.type, err instanceof Error ? err.message : err);
  }
  // The same event, on the shared audit trail (so sign-ins, refusals and downloads sit beside everything else that happened).
  const bad = ['LOGIN_FAILED', 'LOCKOUT', 'MFA_FAILED', 'FORBIDDEN', 'CROSS_TENANT', 'MEDIA_DENIED', 'TAMPER_DETECTED'].includes(e.type);
  await audit({
    category: 'security',
    action: `security.${e.type.toLowerCase()}`,
    outcome: bad ? 'denied' : 'success',
    severity: e.type === 'TAMPER_DETECTED' || e.type === 'LOCKOUT' ? 'error' : bad ? 'warning' : 'info',
    actor: e.userId ? { id: e.userId } : { id: null, type: 'user', name: 'Not signed in' },
    ip: e.ip ?? undefined,
    message: e.type.replace(/_/g, ' ').toLowerCase(),
    metadata: e.detail,
  });
}
