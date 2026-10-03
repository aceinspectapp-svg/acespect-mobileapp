import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { authService, isMicrosoftConfigured, RequestInfo } from './auth.service';
import { prisma } from '../../lib/prisma';
import { capabilityList } from '../qc/qc.permissions';
import { loadMemberships, getActiveSupportSession } from '../qc/qc.context';

const infoOf = (req: Request): RequestInfo => ({ ip: req.ip ?? null, appClient: String(req.headers['x-app-client'] ?? '') || null });

/** Thin HTTP layer — translates requests to service calls and shapes responses. */
export const authController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  }),

  login: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await authService.login(req.body, infoOf(req)));
  }),

  mfaVerify: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await authService.verifyMfa(req.body.mfaToken, req.body.code, infoOf(req)));
  }),

  /** Enrolment before first sign-in (token from the password step). */
  mfaEnrollStartLogin: asyncHandler(async (req: Request, res: Response) => {
    const userId = authService.enrollUserFromToken(String(req.body?.mfaToken ?? ''));
    res.status(200).json(await authService.startMfaEnrollment(userId));
  }),
  mfaEnrollCompleteLogin: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await authService.completeEnrollmentLogin(req.body.mfaToken, req.body.code, infoOf(req)));
  }),

  /** Enrolment from account settings (signed in). */
  mfaEnrollStart: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(200).json(await authService.startMfaEnrollment(req.user.id));
  }),
  mfaEnrollConfirm: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    res.status(200).json(await authService.confirmMfaEnrollment(req.user.id, req.body.code));
  }),
  mfaDisable: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    await authService.disableMfa(req.user.id, req.body.password);
    res.status(200).json({ success: true });
  }),

  invitationInfo: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await authService.describeInvitation(String(req.params.token)));
  }),
  invitationAccept: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await authService.acceptInvitation(String(req.params.token), req.body.password, req.body.acceptTerms, infoOf(req)));
  }),

  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.requestPasswordReset(req.body.email);
    res.status(200).json({ success: true });
  }),
  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    await authService.resetPassword(req.body.token, req.body.password);
    res.status(200).json({ success: true });
  }),
  changePassword: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    await authService.changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
    res.status(200).json({ success: true });
  }),

  google: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.loginWithGoogle(req.body.idToken);
    res.status(200).json(result);
  }),
  ssoGoogle: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await authService.loginWithSso('google', req.body.idToken, infoOf(req)));
  }),
  ssoMicrosoft: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await authService.loginWithSso('microsoft', req.body.idToken, infoOf(req)));
  }),
  ssoConfig: asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json({ microsoft: isMicrosoftConfigured() });
  }),

  refresh: asyncHandler(async (req: Request, res: Response) => {
    const result = await authService.refresh(req.body.refreshToken, infoOf(req));
    res.status(200).json(result);
  }),

  logout: asyncHandler(async (req: Request, res: Response) => {
    await authService.logout(req.body.refreshToken);
    res.status(200).json({ success: true });
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const user = await authService.getById(req.user.id);
    const [memberships, support, row] = await Promise.all([
      loadMemberships(req.user.id),
      getActiveSupportSession(req.user.id),
      prisma.user.findUnique({ where: { id: req.user.id }, select: { termsVersion: true, privacyVersion: true } }),
    ]);
    // Capabilities per membership so the web app can hide what a role cannot use.
    const withCaps = memberships.map((m) => ({
      ...m,
      capabilities: capabilityList({ role: m.role, permissions: m.permissions }),
    }));
    res.status(200).json({
      user,
      memberships: withCaps,
      supportSession: support,
      terms: row ? { termsVersion: row.termsVersion, privacyVersion: row.privacyVersion } : null,
      superAdminCapabilities: req.user.role === 'ADMIN' ? capabilityList({ role: 'SA', permissions: [] }) : [],
    });
  }),
};
