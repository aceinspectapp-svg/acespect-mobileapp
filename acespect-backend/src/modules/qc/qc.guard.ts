/**
 * Tenant guards for entity ids that arrive in a URL. Each resolver answers
 * "which client owns this record?"; `guardEntity` then applies the context
 * rules (own client only, or the Super Admin's support session) so another
 * tenant's id answers "not found" (REQ-TEN-001).
 */
import { Request } from 'express';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { assertClientAccess, canSeeProject, ctxOf, QcContext, requireTenant } from './qc.context';

export type EntityKind = 'client' | 'masterContractor' | 'tradeCompany' | 'project' | 'site' | 'lot' | 'person' | 'team' | 'defect';

/** The owning client (and project, when there is one) of a record, or null when it does not exist. */
export async function ownerOf(kind: EntityKind, id: string): Promise<{ clientId: string | null; projectId?: string } | null> {
  switch (kind) {
    case 'client':
      return (await prisma.qcClient.findUnique({ where: { id }, select: { id: true } })) ? { clientId: id } : null;
    case 'masterContractor': {
      const r = await prisma.qcMasterContractor.findUnique({ where: { id }, select: { clientId: true } });
      return r ? { clientId: r.clientId } : null;
    }
    case 'tradeCompany': {
      const r = await prisma.qcTradeCompany.findUnique({ where: { id }, select: { masterContractors: { select: { clientId: true } } } });
      if (!r) return null;
      // A trade company is engaged by contractors of one or more clients; it belongs to the first until engaged elsewhere.
      return { clientId: r.masterContractors[0]?.clientId ?? null };
    }
    case 'project': {
      const r = await prisma.qcProject.findUnique({ where: { id }, select: { clientId: true } });
      return r ? { clientId: r.clientId, projectId: id } : null;
    }
    case 'site': {
      const r = await prisma.qcSite.findUnique({ where: { id }, select: { projectId: true, project: { select: { clientId: true } } } });
      return r ? { clientId: r.project.clientId, projectId: r.projectId } : null;
    }
    case 'lot': {
      const r = await prisma.qcProperty.findUnique({ where: { id }, select: { projectId: true, project: { select: { clientId: true } } } });
      return r ? { clientId: r.project.clientId, projectId: r.projectId } : null;
    }
    case 'person': {
      const m = await prisma.qcMembership.findFirst({ where: { userId: id }, select: { clientId: true } });
      return m ? { clientId: m.clientId } : (await prisma.user.findUnique({ where: { id }, select: { id: true } })) ? { clientId: null } : null;
    }
    case 'team': {
      const r = await prisma.qcProjectMember.findUnique({ where: { id }, select: { projectId: true, project: { select: { clientId: true } } } });
      return r ? { clientId: r.project.clientId, projectId: r.projectId } : null;
    }
    case 'defect': {
      const r = await prisma.qcDefect.findUnique({ where: { id }, select: { property: { select: { projectId: true, project: { select: { clientId: true } } } } } });
      return r ? { clientId: r.property.project.clientId, projectId: r.property.projectId } : null;
    }
  }
}

/**
 * Resolve the record's owner and check the caller may touch it. Returns the
 * owner. A missing record and a foreign record are indistinguishable.
 */
export async function guardEntity(req: Request, kind: EntityKind, id: string): Promise<{ clientId: string | null; projectId?: string }> {
  const ctx = ctxOf(req);
  const owner = await ownerOf(kind, id);
  if (!owner) throw ApiError.notFound('Not found');
  // Platform-level people with no membership (e.g. the Super Admin's own record) are SA business.
  if (owner.clientId === null) {
    if (ctx.isSA || (kind === 'person' && id === ctx.userId)) return owner;
    if (kind === 'tradeCompany' && ctx.clientId) return owner; // unengaged company: visible to tenants for engagement
    throw ApiError.notFound('Not found');
  }
  await assertClientAccess(ctx, owner.clientId);
  if (owner.projectId && !ctx.isSA && ctx.role !== 'CLIENT_ADMIN' && ctx.projectIds !== 'all' && !ctx.projectIds.includes(owner.projectId)) {
    throw ApiError.notFound('Not found');
  }
  return owner;
}

/** The client a list or create is scoped to (own client, or the SA's support-session client). */
export function tenantOf(req: Request): string {
  return requireTenant(ctxOf(req));
}

/** Project-level visibility check used by lists that already loaded the project. */
export function mayViewProject(ctx: QcContext, p: { id: string; clientId: string }): boolean {
  return canSeeProject(ctx, p);
}
