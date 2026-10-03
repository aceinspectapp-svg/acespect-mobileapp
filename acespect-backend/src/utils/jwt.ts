import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './ApiError';

export interface AccessTokenPayload {
  sub: string; // user id
  role: string;
  /** Token version: bumping the user's version revokes every token issued before it (REQ-AUT-005). */
  tv?: number;
}

/** Sign a short-lived stateless access token (JWT). `ttlMin` lets a client's idle timeout shorten it. */
export function signAccessToken(payload: AccessTokenPayload, ttlMin: number = env.ACCESS_TOKEN_TTL_MIN): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: Math.max(1, Math.min(ttlMin, env.ACCESS_TOKEN_TTL_MIN)) * 60, // seconds
  });
}

/** Verify an access token; throws 401 on invalid/expired. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof decoded === 'string' || !decoded.sub || (decoded as jwt.JwtPayload).purpose) {
      throw ApiError.unauthorized('Invalid token', 'INVALID_TOKEN');
    }
    const d = decoded as jwt.JwtPayload;
    return { sub: String(d.sub), role: String(d.role), tv: typeof d.tv === 'number' ? d.tv : 0 };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Access token expired', 'TOKEN_EXPIRED');
    }
    throw ApiError.unauthorized('Invalid token', 'INVALID_TOKEN');
  }
}

/**
 * Short-lived token handed out after the password step when a second factor
 * (or MFA enrolment) is still needed. It cannot be used as an access token.
 */
export function signMfaToken(userId: string, stage: 'verify' | 'enroll'): string {
  return jwt.sign({ sub: userId, purpose: `mfa-${stage}` }, `${env.JWT_ACCESS_SECRET}:mfa`, { expiresIn: 5 * 60 });
}

export function verifyMfaToken(token: string, stage: 'verify' | 'enroll'): string {
  try {
    const d = jwt.verify(token, `${env.JWT_ACCESS_SECRET}:mfa`) as jwt.JwtPayload;
    if (d.purpose !== `mfa-${stage}` || !d.sub) throw new Error('wrong purpose');
    return String(d.sub);
  } catch {
    throw ApiError.unauthorized('Your sign-in step expired; sign in again', 'MFA_TOKEN_INVALID');
  }
}
