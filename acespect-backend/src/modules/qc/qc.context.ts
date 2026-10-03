/**
 * Who is calling, acting as which QC role, inside which client (REQ-TEN-001,
 * REQ-TEN-003, REQ-TEN-008, REQ-AUT-003/004).
 *
 * - A Super Admin works inside a client only through an active support session
 *   (reason, optional ticket, time limited). Without one, tenant data is off
 *   limits (the platform-level client list is the exception).
 * - Everyone else acts through a membership in one client. With several
 *   memberships the caller names the client with the X-Client-Id header; the
 *   server never trusts it without checking the membership.
 * - Another tenant's records answer "not found" and the attempt is logged.
 */
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';
import { logSecurityEvent } from '../../lib/securityLog';
import { recordAudit } from '../../lib/audit';
import { ActorRole } from './qc.lifecycle';
import { Capability, PermissionSubject, can } from './qc.permissions';

export interface QcMembershipSummary {
  id: string;
  clientId: string;
  clientName: string;
  role: ActorRole;
  permissions: string[];
  projectIds: string[];
  masterContractorId: string | null;
  tradeCompanyId: string | null;
}

export interface QcContext extends PermissionSubject {
  userId: string;
  platformRole: string;
  isSA: boolean;
  /** True for older mobile accounts that predate memberships; they act as inspectors on defects assigned to them. */
  legacy: boolean;
  clientId: string | null;
  membership: QcMembershipSummary | null;
  /** 'all' for the Super Admin (in a session) and Client Admins; otherwise the projects they are assigned to. */
  projectIds: string[] | 'all';
  supportSession: { id: string; clientId: string; reason: string; ticketRef: string | null; expiresAt: Date } | null;
  ip: string | null;
  /** Set when the route guard already logged a refusal for this request. */
  forbiddenLogged?: boolean;
}

const MEMBER_ROLE: Record<string, ActorRole> = {
  CLIENT_ADMIN: 'CLIENT_ADMIN',
  CLIENT_USER: 'CLIENT_USER',
  MC_MANAGER: 'MC_MANAGER',
  MC_SITE_SUPERVISOR: 'MC_SITE_SUPERVISOR',
  MC_PROJECT_MANAGER: 'MC_PROJECT_MANAGER',
  TRADE_USER: 'TRADE_USER',
  PRIVATE_INSPECTOR: 'PRIVATE_INSPECTOR',
};

export async function loadMemberships(userId: string): Promise<QcMembershipSummary[]> {
  const rows = await prisma.qcMembership.findMany({
    where: { userId, status: 'ACTIVE', client: { status: { notIn: ['SUSPENDED', 'OFFBOARDED'] } } },
    include: { client: { select: { id: true, name: true } }, projects: { select: { id: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((m) => ({
    id: m.id,
    clientId: m.clientId,
    clientName: m.client.name,
    role: MEMBER_ROLE[m.role]!,
    permissions: m.optionalPermissions,
    projectIds: m.projects.map((p) => p.id),
    masterContractorId: m.masterContractorId,
    tradeCompanyId: m.tradeCompanyId,
  }));
}

function headerValue(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Resolve the QC context for an authenticated request. */
export async function buildContext(req: Request, opts: { clientHint?: string } = {}): Promise<QcContext> {
  if (!req.user) throw ApiError.unauthorized();
  const ip = req.ip ?? null;
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive) throw ApiError.unauthorized('This account is not active', 'ACCOUNT_INACTIVE');

  if (user.role === 'ADMIN') {
    // The Super Admin administers every client: they choose the one they are working in (X-Client-Id) and everything they
    // do is still recorded in that client's audit trail with their role.
    const hint = opts.clientHint ?? headerValue(req, 'x-client-id');
    let chosen: string | null = null;
    if (hint) {
      const c = await prisma.qcClient.findUnique({ where: { id: hint }, select: { id: true } });
      if (!c) throw ApiError.notFound('Client not found');
      chosen = c.id;
    }
    return {
      userId: user.id,
      platformRole: user.role,
      isSA: true,
      legacy: false,
      role: 'SA',
      permissions: [],
      clientId: chosen,
      membership: null,
      projectIds: 'all',
      supportSession: null,
      ip,
    };
  }

  const memberships = await loadMemberships(user.id);
  if (memberships.length === 0) {
    // Accounts created before memberships existed (mobile INSPECTOR / FIELD_USER): inspectors on their own assignments.
    return {
      userId: user.id, platformRole: user.role, isSA: false, legacy: true, role: 'PRIVATE_INSPECTOR', permissions: [],
      clientId: null, membership: null, projectIds: [], supportSession: null, ip,
    };
  }

  const wanted = opts.clientHint ?? headerValue(req, 'x-client-id');
  let membership: QcMembershipSummary | undefined;
  if (wanted) {
    membership = memberships.find((m) => m.clientId === wanted);
    if (!membership) {
      await logSecurityEvent({ type: 'CROSS_TENANT', clientId: wanted, userId: user.id, detail: { via: 'X-Client-Id' }, ip });
      throw ApiError.notFound('Client not found');
    }
  } else if (memberships.length === 1) {
    membership = memberships[0];
  } else {
    throw new ApiError(409, 'Choose which client you are working in', 'CONTEXT_REQUIRED', {
      clients: memberships.map((m) => ({ id: m.clientId, name: m.clientName, role: m.role })),
    });
  }
  const m = membership!;
  return {
    userId: user.id,
    platformRole: user.role,
    isSA: false,
    legacy: false,
    role: m.role,
    permissions: m.permissions,
    clientId: m.clientId,
    membership: m,
    // A membership with no projects selected is not narrowed to any: the Client Admin always sees all, and so does anyone
    // not yet assigned (the people form warns about this); once projects are chosen they are the limit.
    projectIds: m.role === 'CLIENT_ADMIN' || m.projectIds.length === 0 ? 'all' : m.projectIds,
    supportSession: null,
    ip,
  };
}

/** Express middleware: resolve the context once and attach it as req.qc. */
export const withContext: RequestHandler = (req, _res, next) => {
  buildContext(req).then((ctx) => {
    req.qc = ctx;
    next();
  }, next);
};

export function ctxOf(req: Request): QcContext {
  if (!req.qc) throw ApiError.unauthorized();
  return req.qc;
}

/**
 * Route guard: the caller must hold the capability. Refusals are logged
 * (REQ-AUT-003). Deny by default: a route with no declared capability never
 * reaches a handler (see qc.routes.ts).
 */
export function requireCap(capability: Capability, hint?: (req: Request) => Promise<string | undefined>): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    // A record's own client decides the context for people with roles in several clients (e.g. inspectors).
    (async () => {
      const ctx = await buildContext(req, { clientHint: hint ? await hint(req) : undefined });
      if (!can(ctx, capability)) {
        await logSecurityEvent({
          type: 'FORBIDDEN',
          clientId: ctx.clientId,
          userId: ctx.userId,
          detail: { capability, role: ctx.role, method: req.method, path: req.originalUrl.split('?')[0] },
          ip: ctx.ip,
        });
        ctx.forbiddenLogged = true;
        req.qc = ctx;
        throw ApiError.forbidden('You do not have access to this resource');
      }
      req.qc = ctx;
      next();
    })().catch(next);
  };
}

/**
 * A Super Admin may only touch a client's data inside a support session for
 * that client (REQ-TEN-008, REQ-CLT-004). Everyone else may only touch their
 * own client; a different client's records answer "not found" and are logged
 * (REQ-TEN-001).
 */
export async function assertClientAccess(ctx: QcContext, clientId: string | null | undefined): Promise<void> {
  if (!clientId) return;
  if (ctx.isSA) return;
  if (ctx.clientId !== clientId) {
    await logSecurityEvent({ type: 'CROSS_TENANT', clientId, userId: ctx.userId, detail: { actorClient: ctx.clientId }, ip: ctx.ip });
    throw ApiError.notFound('Not found');
  }
}

/** Which client a list/create is scoped to. A Super Admin outside a session has none, which is an error for tenant data. */
export function requireTenant(ctx: QcContext): string {
  if (ctx.clientId) return ctx.clientId;
  if (ctx.isSA) throw new ApiError(409, 'Choose a client first', 'CLIENT_REQUIRED');
  throw ApiError.forbidden('No client context');
}

/** Prisma filter limiting projects to those the caller may see (REQ-AUT-004). */
export function projectScope(ctx: QcContext): Prisma.QcProjectWhereInput {
  const clientId = requireTenant(ctx);
  if (ctx.projectIds === 'all') return { clientId };
  return { clientId, id: { in: ctx.projectIds } };
}

export function canSeeProject(ctx: QcContext, project: { id: string; clientId: string }): boolean {
  if (ctx.clientId !== project.clientId) return false;
  return ctx.projectIds === 'all' || ctx.projectIds.includes(project.id);
}

export const actorOf = (ctx: QcContext) => ({ id: ctx.userId, role: ctx.role });
