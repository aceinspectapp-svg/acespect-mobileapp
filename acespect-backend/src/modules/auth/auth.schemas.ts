import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
  name: z.string().trim().min(1).max(120).optional(),
  phone: z
    .string()
    .trim()
    .min(6, 'Enter a valid phone number')
    .max(20)
    .optional(),
});

export const googleSchema = z.object({
  idToken: z.string().min(1, 'idToken is required'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

export const logoutSchema = refreshSchema;

const strongPassword = z.string().min(12, 'Password must be at least 12 characters').max(128, 'Password is too long');

export const mfaVerifySchema = z.object({ mfaToken: z.string().min(1), code: z.string().min(6).max(20) });
export const mfaCodeSchema = z.object({ code: z.string().min(6).max(20) });
export const mfaDisableSchema = z.object({ password: z.string().min(1) });
export const acceptInvitationSchema = z.object({ password: strongPassword, acceptTerms: z.boolean() });
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(10), password: strongPassword });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: strongPassword });
export const ssoSchema = z.object({ idToken: z.string().min(1) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type GoogleInput = z.infer<typeof googleSchema>;
