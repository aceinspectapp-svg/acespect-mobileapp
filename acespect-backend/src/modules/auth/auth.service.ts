import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { hashPassword, verifyPassword } from '../../utils/password';
import { signAccessToken, signMfaToken, verifyMfaToken } from '../../utils/jwt';
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry } from '../../utils/refreshToken';
import { verifyGoogleIdToken } from '../../utils/google';
import { generateSecret, otpauthUri, verifyTotp } from '../../utils/totp';
import { logSecurityEvent } from '../../lib/securityLog';
import { recordAudit } from '../../lib/audit';
import { sendMail } from '../../lib/mailer';
import { clearAuthCache } from '../../middleware/auth';
import { LoginInput, RegisterInput } from './auth.schemas';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const FAIL_WINDOW_MINUTES = 15;
const INVITATION_DAYS = 7;
const RESET_MINUTES = 60;
export const MIN_PASSWORD_LENGTH = 12;

/** Public user shape — never leaks the password hash or MFA secret. */
export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: Date;
  mfaEnabled?: boolean;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export type LoginResult =
  | AuthResult
  | { mfaRequired: true; mfaToken: string }
  | { mfaEnrollRequired: true; mfaToken: string };

export interface RequestInfo {
  ip?: string | null;
  /** 'web' sessions are subject to the client's idle timeout (REQ-AUT-005). */
  appClient?: string | null;
}

function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, role: user.role, createdAt: user.createdAt, mfaEnabled: user.mfaEnabled };
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

export function assertStrongPassword(pw: string): void {
  if (pw.length < MIN_PASSWORD_LENGTH) throw ApiError.badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (pw.length > 128) throw ApiError.badRequest('Password is too long');
}

/** Shortest idle timeout across the user's clients (5-120 min, default 30). */
async function idleMinutes(userId: string): Promise<number> {
  const rows = await prisma.qcMembership.findMany({ where: { userId, status: 'ACTIVE' }, select: { client: { select: { data: true } } } });
  const vals = rows
    .map((r) => Number((r.client.data as Record<string, unknown>).idle_session_timeout))
    .filter((n) => Number.isFinite(n) && n >= 5 && n <= 120);
  return vals.length ? Math.min(...vals) : 30;
}

/** Mint an access token + a persisted (hashed) refresh token for a user. */
async function issueTokens(user: User): Promise<AuthResult> {
  const idle = await idleMinutes(user.id);
  const accessToken = signAccessToken({ sub: user.id, role: user.role, tv: user.tokenVersion }, idle);
  const refreshToken = generateRefreshToken();
  await prisma.refreshToken.create({ data: { tokenHash: hashRefreshToken(refreshToken), userId: user.id, expiresAt: refreshTokenExpiry() } });
  await prisma.user.update({ where: { id: user.id }, data: { lastSignInAt: new Date() } });
  return { user: toPublicUser(user), accessToken, refreshToken };
}

/** End every session of a user now: bump the token version and revoke refresh tokens (REQ-AUT-005). */
export async function revokeAllSessions(userId: string, reason: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  clearAuthCache(userId);
  await logSecurityEvent({ type: 'SESSION_REVOKED', userId, detail: { reason } });
}

/** Is MFA mandatory for this user (spec roles via MFA_REQUIRED_ROLES, or a client that requires it for everyone)? */
async function mfaRequired(user: User): Promise<boolean> {
  const required = env.MFA_REQUIRED_ROLES.split(',').map((s) => s.trim()).filter(Boolean);
  if (user.role === 'ADMIN' && required.includes('SA')) return true;
  const memberships = await prisma.qcMembership.findMany({ where: { userId: user.id, status: 'ACTIVE' }, select: { role: true, client: { select: { data: true } } } });
  return memberships.some((m) => required.includes(m.role) || (m.client.data as Record<string, unknown>).mfa_required_for_all_roles === true);
}

/** A client suspension blocks sign-in for everyone who only belongs to suspended clients (REQ-TEN-006). */
async function assertClientNotSuspended(user: User): Promise<void> {
  if (user.role === 'ADMIN') return;
  const rows = await prisma.qcMembership.findMany({ where: { userId: user.id, status: 'ACTIVE' }, select: { client: { select: { status: true } } } });
  if (rows.length && rows.every((r) => r.client.status === 'SUSPENDED')) {
    throw new ApiError(403, "Your organisation's access to ACE SPECT is suspended. Contact your administrator.", 'CLIENT_SUSPENDED');
  }
}

async function afterPasswordOk(user: User, info: RequestInfo): Promise<LoginResult> {
  await assertClientNotSuspended(user);
  if (user.mfaEnabled && user.mfaSecret) return { mfaRequired: true, mfaToken: signMfaToken(user.id, 'verify') };
  if (await mfaRequired(user)) return { mfaEnrollRequired: true, mfaToken: signMfaToken(user.id, 'enroll') };
  await logSecurityEvent({ type: 'LOGIN_OK', userId: user.id, ip: info.ip });
  return issueTokens(user);
}

async function registerFailure(user: User, info: RequestInfo, type: 'LOGIN_FAILED' | 'MFA_FAILED'): Promise<void> {
  const now = new Date();
  const stale = !user.lastFailedAt || now.getTime() - user.lastFailedAt.getTime() > FAIL_WINDOW_MINUTES * 60_000;
  const count = (stale ? 0 : user.failedLoginCount) + 1;
  const lock = count >= MAX_FAILED_LOGINS;
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: lock ? 0 : count, lastFailedAt: now, lockedUntil: lock ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : undefined },
  });
  await logSecurityEvent({ type, userId: user.id, detail: { attempt: count }, ip: info.ip });
  if (lock) {
    await logSecurityEvent({ type: 'LOCKOUT', userId: user.id, detail: { minutes: LOCK_MINUTES }, ip: info.ip });
    // Email is advisory; the lock itself already applies.
    void sendMail(user.email, 'Your ACE SPECT account was temporarily locked', `There were ${MAX_FAILED_LOGINS} failed sign-in attempts. The account is locked for ${LOCK_MINUTES} minutes. If this was not you, reset your password.\n`);
  }
}

function assertNotLocked(user: User): void {
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new ApiError(423, `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 'ACCOUNT_LOCKED');
  }
}

export const authService = {
  async register(input: RegisterInput): Promise<AuthResult> {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
    const user = await prisma.user.create({
      data: { email: input.email, passwordHash: await hashPassword(input.password), name: input.name ?? null, phone: input.phone ?? null },
    });
    return issueTokens(user);
  },

  async login(input: LoginInput, info: RequestInfo = {}): Promise<LoginResult> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (user) assertNotLocked(user);

    // Always run a bcrypt compare (even with no/Google-only user) so response
    // timing doesn't leak whether an email exists or has a password.
    const hashToCheck = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await verifyPassword(input.password, hashToCheck);

    if (!user || !user.passwordHash || !ok) {
      if (user) await registerFailure(user, info, 'LOGIN_FAILED');
      else await logSecurityEvent({ type: 'LOGIN_FAILED', detail: { unknownEmail: true }, ip: info.ip });
      throw ApiError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
    }
    if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');

    if (user.failedLoginCount) await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lastFailedAt: null } });
    return afterPasswordOk(user, info);
  },

  // ─── MFA (REQ-AUT-002) ───

  /** Second step after the password: an authenticator code or a one-time backup code. */
  async verifyMfa(mfaToken: string, code: string, info: RequestInfo = {}): Promise<AuthResult> {
    const userId = verifyMfaToken(mfaToken, 'verify');
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || !user.mfaEnabled || !user.mfaSecret) throw ApiError.unauthorized('Sign in again', 'MFA_TOKEN_INVALID');
    assertNotLocked(user);

    let ok = verifyTotp(user.mfaSecret, code);
    if (!ok) {
      const hash = sha256(code.replace(/\s+/g, '').toLowerCase());
      if (user.mfaBackupCodes.includes(hash)) {
        ok = true;
        await prisma.user.update({ where: { id: user.id }, data: { mfaBackupCodes: user.mfaBackupCodes.filter((h) => h !== hash) } });
      }
    }
    if (!ok) {
      await registerFailure(user, info, 'MFA_FAILED');
      throw ApiError.unauthorized('That code is not valid', 'MFA_INVALID');
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lastFailedAt: null } });
    await logSecurityEvent({ type: 'LOGIN_OK', userId: user.id, detail: { mfa: true }, ip: info.ip });
    return issueTokens(user);
  },

  /** Begin enrolment: returns the secret and the otpauth URI for a QR code. Not active until confirmed. */
  async startMfaEnrollment(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    if (user.mfaEnabled) throw ApiError.conflict('MFA is already enabled', 'MFA_ALREADY_ENABLED');
    const secret = generateSecret();
    await prisma.user.update({ where: { id: userId }, data: { mfaSecret: secret } });
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  },

  /** Confirm enrolment with a first code; returns backup codes (shown once). */
  async confirmMfaEnrollment(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.mfaSecret) throw ApiError.badRequest('Start MFA setup first');
    if (!verifyTotp(user.mfaSecret, code)) throw ApiError.badRequest('That code is not valid. Check your authenticator app and try again.');
    const backupCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: true, mfaBackupCodes: backupCodes.map((c) => sha256(c)) } });
    await recordAudit({ entityType: 'User', entityId: userId, action: 'mfa.enable', actor: { id: userId, role: user.role } });
    return { backupCodes };
  },

  async completeEnrollmentLogin(mfaToken: string, code: string, info: RequestInfo = {}): Promise<AuthResult & { backupCodes: string[] }> {
    const userId = verifyMfaToken(mfaToken, 'enroll');
    const { backupCodes } = await this.confirmMfaEnrollment(userId, code);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await logSecurityEvent({ type: 'LOGIN_OK', userId, detail: { mfaEnrolled: true }, ip: info.ip });
    return { ...(await issueTokens(user)), backupCodes };
  },

  enrollUserFromToken(mfaToken: string): string {
    return verifyMfaToken(mfaToken, 'enroll');
  },

  async disableMfa(userId: string, password: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) throw ApiError.unauthorized('Password is incorrect', 'INVALID_CREDENTIALS');
    if (await mfaRequired(user)) throw ApiError.badRequest('MFA is required for your role and cannot be turned off');
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [] } });
    await recordAudit({ entityType: 'User', entityId: userId, action: 'mfa.disable', actor: { id: userId, role: user.role } });
  },

  // ─── Invitations (REQ-AUT-001) ───

  /** Create (or replace) the one-time activation link for a user. Returns the raw token and the link. */
  async createInvitation(userId: string, createdById: string | null): Promise<{ token: string; url: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 3_600_000);
    // A new link invalidates earlier unused ones.
    await prisma.qcInvitation.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
    await prisma.qcInvitation.create({ data: { userId, tokenHash: sha256(token), expiresAt, createdById } });
    return { token, url: `${env.WEB_APP_URL.replace(/\/$/, '')}/accept/${token}`, expiresAt };
  },

  async sendInvitationEmail(user: { email: string; name: string | null }, url: string): Promise<string> {
    return sendMail(
      user.email,
      'Activate your ACE SPECT account',
      `${user.name ? `Hi ${user.name},\n\n` : ''}An ACE SPECT account has been created for you. Activate it here (the link works once and expires in ${INVITATION_DAYS} days):\n${url}\n`,
    );
  },

  async describeInvitation(token: string): Promise<{ email: string; name: string | null; termsVersion: string; privacyVersion: string }> {
    const inv = await prisma.qcInvitation.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!inv) throw ApiError.notFound('This activation link is not valid');
    if (inv.usedAt) throw new ApiError(410, 'This activation link has already been used', 'INVITATION_USED');
    if (inv.expiresAt < new Date()) throw new ApiError(410, 'This activation link has expired. Ask your administrator to send a new one.', 'INVITATION_EXPIRED');
    return { email: inv.user.email, name: inv.user.name, termsVersion: env.TERMS_VERSION, privacyVersion: env.PRIVACY_VERSION };
  },

  async acceptInvitation(token: string, password: string, acceptTerms: boolean, info: RequestInfo = {}): Promise<LoginResult> {
    if (!acceptTerms) throw ApiError.badRequest('You must accept the privacy collection notice and terms of use');
    assertStrongPassword(password);
    const inv = await prisma.qcInvitation.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!inv) throw ApiError.notFound('This activation link is not valid');
    if (inv.usedAt) throw new ApiError(410, 'This activation link has already been used', 'INVITATION_USED');
    if (inv.expiresAt < new Date()) throw new ApiError(410, 'This activation link has expired. Ask your administrator to send a new one.', 'INVITATION_EXPIRED');
    const now = new Date();
    const user = await prisma.$transaction(async (tx) => {
      await tx.qcInvitation.update({ where: { id: inv.id }, data: { usedAt: now } });
      return tx.user.update({
        where: { id: inv.userId },
        data: {
          passwordHash: await hashPassword(password),
          passwordChangedAt: now,
          termsVersion: env.TERMS_VERSION, termsAcceptedAt: now,
          privacyVersion: env.PRIVACY_VERSION, privacyAcceptedAt: now,
          failedLoginCount: 0, lockedUntil: null,
        },
      });
    });
    await logSecurityEvent({ type: 'INVITATION_ACCEPTED', userId: user.id, detail: { terms: env.TERMS_VERSION, privacy: env.PRIVACY_VERSION }, ip: info.ip });
    return afterPasswordOk(user, info);
  },

  // ─── Password reset (REQ-AUT-002) ───

  /** Always succeeds from the caller's view so emails cannot be enumerated. */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) return;
    const token = crypto.randomBytes(32).toString('base64url');
    await prisma.qcPasswordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await prisma.qcPasswordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_MINUTES * 60_000) } });
    await sendMail(user.email, 'Reset your ACE SPECT password', `Use this link to choose a new password (single use, expires in ${RESET_MINUTES} minutes):\n${env.WEB_APP_URL.replace(/\/$/, '')}/reset/${token}\n`);
  },

  async resetPassword(token: string, password: string): Promise<void> {
    assertStrongPassword(password);
    const row = await prisma.qcPasswordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new ApiError(410, 'This reset link is invalid or has expired', 'RESET_INVALID');
    await prisma.$transaction([
      prisma.qcPasswordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, lastFailedAt: null } }),
    ]);
    await revokeAllSessions(row.userId, 'password reset');
    await logSecurityEvent({ type: 'PASSWORD_RESET', userId: row.userId });
  },

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    assertStrongPassword(next);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await verifyPassword(current, user.passwordHash))) throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
    await revokeAllSessions(userId, 'password changed');
    await logSecurityEvent({ type: 'PASSWORD_CHANGED', userId });
  },

  // ─── Single sign-on (REQ-AUT-006): an existing account only, never auto-created ───

  async loginWithSso(provider: 'google' | 'microsoft', idToken: string, info: RequestInfo = {}): Promise<LoginResult> {
    let email: string;
    let subject: string;
    if (provider === 'google') {
      const p = await verifyGoogleIdToken(idToken);
      email = p.email;
      subject = p.googleId;
    } else {
      const claims = await verifyMicrosoftIdToken(idToken);
      email = claims.email;
      subject = claims.sub;
    }
    const field = provider === 'google' ? 'googleId' : 'microsoftId';
    const byId = await prisma.user.findFirst({ where: { [field]: subject } });
    const user = byId ?? (await prisma.user.findUnique({ where: { email } }));
    // Only people an administrator already created (and who hold a QC role) may use SSO.
    const hasRole = user ? (await prisma.qcMembership.count({ where: { userId: user.id, status: 'ACTIVE' } })) > 0 || user.role === 'ADMIN' : false;
    if (!user || !user.isActive || !hasRole) {
      await logSecurityEvent({ type: 'LOGIN_FAILED', detail: { sso: provider, unknown: true }, ip: info.ip });
      throw ApiError.forbidden('No ACE SPECT account exists for this sign-in. Ask your administrator to add you.');
    }
    await assertClientNotSuspended(user);
    if (!byId) await prisma.user.update({ where: { id: user.id }, data: { [field]: subject } });
    // The identity provider already did MFA/strong auth; the account keeps its own role.
    await logSecurityEvent({ type: 'LOGIN_OK', userId: user.id, detail: { sso: provider }, ip: info.ip });
    return issueTokens(user);
  },

  /**
   * Sign in (or sign up) with a verified Google ID token — the mobile app's
   * existing flow. Find-or-link-or-create.
   */
  async loginWithGoogle(idToken: string): Promise<AuthResult> {
    const profile = await verifyGoogleIdToken(idToken);
    let user = await prisma.user.findUnique({ where: { googleId: profile.googleId } });
    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
      user = byEmail
        ? await prisma.user.update({ where: { id: byEmail.id }, data: { googleId: profile.googleId, avatarUrl: byEmail.avatarUrl ?? profile.avatarUrl ?? null, name: byEmail.name ?? profile.name ?? null } })
        : await prisma.user.create({ data: { email: profile.email, googleId: profile.googleId, name: profile.name ?? null, avatarUrl: profile.avatarUrl ?? null } });
    }
    if (!user.isActive) throw ApiError.forbidden('This account has been deactivated');
    return issueTokens(user);
  },

  /** Rotate a refresh token: validate, revoke the old, issue a fresh pair. */
  async refresh(rawToken: string, info: RequestInfo = {}): Promise<AuthResult> {
    const tokenHash = hashRefreshToken(rawToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive) {
      throw ApiError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
    }
    // Web sessions end after the client's idle timeout; the refresh token's age is time since last activity.
    if (info.appClient === 'web' && stored.user.role !== 'ADMIN') {
      const idle = await idleMinutes(stored.userId);
      if (Date.now() - stored.createdAt.getTime() > idle * 60_000) {
        await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
        throw ApiError.unauthorized('Your session timed out because of inactivity', 'SESSION_IDLE');
      }
    }
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    return issueTokens(stored.user);
  },

  /** Idempotent logout — revoke the presented refresh token if it exists. */
  async logout(rawToken: string): Promise<void> {
    await prisma.refreshToken.updateMany({ where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
  },

  /** When a client is suspended/offboarded, end sessions of people who have no other active client (REQ-TEN-006). */
  async revokeSessionsIfOnlyClient(userId: string, clientId: string, reason: string): Promise<void> {
    const others = await prisma.qcMembership.count({ where: { userId, status: 'ACTIVE', clientId: { not: clientId }, client: { status: { not: 'SUSPENDED' } } } });
    if (others === 0) await revokeAllSessions(userId, reason);
  },

  async getById(userId: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.notFound('User not found');
    return toPublicUser(user);
  },
};

// ─── Microsoft Entra ID token verification (no SDK; JWKS via jose) ───

const msAudiences = () => env.MICROSOFT_CLIENT_IDS.split(',').map((s) => s.trim()).filter(Boolean);
export const isMicrosoftConfigured = () => msAudiences().length > 0;
const msJwks = createRemoteJWKSet(new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys'));

async function verifyMicrosoftIdToken(idToken: string): Promise<{ sub: string; email: string }> {
  if (!isMicrosoftConfigured()) throw ApiError.badRequest('Microsoft sign-in is not configured');
  try {
    const { payload } = await jwtVerify(idToken, msJwks, { audience: msAudiences() });
    // Multi-tenant tokens carry the tenant in the issuer.
    if (typeof payload.iss !== 'string' || !/^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+\/v2\.0$/i.test(payload.iss)) throw new Error('bad issuer');
    const email = String(payload.email ?? payload.preferred_username ?? '').toLowerCase();
    if (!email || !payload.sub) throw new Error('no email');
    return { sub: `${payload.tid ?? ''}:${payload.sub}`, email };
  } catch {
    throw ApiError.unauthorized('Microsoft sign-in could not be verified', 'SSO_INVALID');
  }
}
