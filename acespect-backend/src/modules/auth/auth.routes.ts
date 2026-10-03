import { Router } from 'express';
import { authController } from './auth.controller';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { authLimiter } from '../../middleware/rateLimit';
import {
  acceptInvitationSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  mfaCodeSchema,
  mfaDisableSchema,
  mfaVerifySchema,
  resetPasswordSchema,
  ssoSchema,
  googleSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
} from './auth.schemas';

const router = Router();

// Credential endpoints are rate-limited.
router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);
router.post('/google', authLimiter, validate(googleSchema), authController.google);
router.post('/refresh', authLimiter, validate(refreshSchema), authController.refresh);
router.post('/logout', validate(logoutSchema), authController.logout);

// MFA (REQ-AUT-002)
router.post('/mfa/verify', authLimiter, validate(mfaVerifySchema), authController.mfaVerify);
router.post('/mfa/enroll/start', authLimiter, authController.mfaEnrollStartLogin);
router.post('/mfa/enroll/complete', authLimiter, validate(mfaVerifySchema), authController.mfaEnrollCompleteLogin);

// Invitations (REQ-AUT-001)
router.get('/invitations/:token', authLimiter, authController.invitationInfo);
router.post('/invitations/:token/accept', authLimiter, validate(acceptInvitationSchema), authController.invitationAccept);

// Password reset
router.post('/password/forgot', authLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/password/reset', authLimiter, validate(resetPasswordSchema), authController.resetPassword);

// SSO (REQ-AUT-006): existing accounts only
router.get('/sso/config', authController.ssoConfig);
router.post('/sso/google', authLimiter, validate(ssoSchema), authController.ssoGoogle);
router.post('/sso/microsoft', authLimiter, validate(ssoSchema), authController.ssoMicrosoft);

// Protected.
router.post('/password/change', requireAuth, validate(changePasswordSchema), authController.changePassword);
router.post('/mfa/setup', requireAuth, authController.mfaEnrollStart);
router.post('/mfa/confirm', requireAuth, validate(mfaCodeSchema), authController.mfaEnrollConfirm);
router.post('/mfa/disable', requireAuth, validate(mfaDisableSchema), authController.mfaDisable);
router.get('/me', requireAuth, authController.me);

export const authRouter = router;
