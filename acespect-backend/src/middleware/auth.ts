import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { ApiError } from '../utils/ApiError';
import { prisma } from '../lib/prisma';

/**
 * Per-user revocation check cache. A deactivated user or a changed password
 * must stop working within a minute (REQ-AUT-005), so the cache lives 20
 * seconds and is also cleared immediately in this process when access is revoked.
 */
const CACHE_MS = 20_000;
const cache = new Map<string, { isActive: boolean; tokenVersion: number; role: string; at: number }>();

export function clearAuthCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

async function currentState(userId: string) {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true, tokenVersion: true, role: true } });
  const state = { isActive: !!u?.isActive, tokenVersion: u?.tokenVersion ?? 0, role: u?.role ?? '', at: Date.now() };
  cache.set(userId, state);
  return state;
}

/** Requires a valid `Authorization: Bearer <accessToken>`; sets req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('Missing or malformed Authorization header', 'NO_TOKEN');
  }
  const payload = verifyAccessToken(header.slice('Bearer '.length).trim());
  currentState(payload.sub).then(
    (state) => {
      if (!state.isActive) return next(ApiError.unauthorized('This account is not active', 'ACCOUNT_INACTIVE'));
      if ((payload.tv ?? 0) !== state.tokenVersion) return next(ApiError.unauthorized('Your session was ended; sign in again', 'SESSION_REVOKED'));
      req.user = { id: payload.sub, role: state.role || payload.role };
      next();
    },
    next,
  );
}

/**
 * Restricts a route to the given platform roles. Must run after `requireAuth`.
 */
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw ApiError.unauthorized();
    if (!roles.includes(req.user.role)) {
      throw ApiError.forbidden('You do not have access to this resource');
    }
    next();
  };
}
