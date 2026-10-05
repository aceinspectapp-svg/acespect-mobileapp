/**
 * Platform-level endpoints of the QC module: the caller's own context, the permission matrix screen, and the inspector roster.
 */
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../lib/prisma';
import { ctxOf, loadMemberships } from './qc.context';
import { logSecurityEvent } from '../../lib/securityLog';
import { capabilityList, permissionMatrix as matrix } from './qc.permissions';
import { OPTIONAL_PERMISSIONS } from './qc.permissions';

export const qcPlatformController = {
  /** The caller's role, client, capabilities and . */
  me: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    // The Super Admin can work in every client; everyone else only in the ones they belong to.
    const all = ctx.isSA
      ? (await prisma.qcClient.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })).map((c) => ({ clientId: c.id, clientName: c.name, role: 'SA' }))
      : await loadMemberships(ctx.userId);
    res.status(200).json({
      userId: ctx.userId,
      role: ctx.role,
      isSA: ctx.isSA,
      legacy: ctx.legacy,
      clientId: ctx.clientId,
      clients: all.map((m) => ({ id: m.clientId, name: m.clientName, role: m.role })),
      projectIds: ctx.projectIds,
      permissions: ctx.permissions,
      capabilities: capabilityList(ctx),
    });
  }),

  /** The person says which client they are about to work in; the switch is checked against their memberships and logged (REQ-TEN-003). */
  switchContext: asyncHandler(async (req, res) => {
    // Runs before a client is chosen, so it reads the memberships directly instead of building a client context.
    if (!req.user) throw ApiError.unauthorized();
    const clientId = String((req.body ?? {}).clientId ?? '');
    let target: { role: string; clientName: string } | undefined;
    if (req.user.role === 'ADMIN') {
      const c = await prisma.qcClient.findUnique({ where: { id: clientId }, select: { name: true } });
      if (c) target = { role: 'SA', clientName: c.name };
    } else {
      target = (await loadMemberships(req.user.id)).find((m) => m.clientId === clientId);
    }
    if (!target) throw ApiError.notFound('Client not found');
    await logSecurityEvent({ type: 'CONTEXT_SWITCH', clientId, userId: req.user.id, detail: { to: clientId, role: target.role }, ip: req.ip ?? null });
    res.status(200).json({ clientId, role: target.role, name: target.clientName });
  }),

  /** REQ-USR-007: the role x capability matrix, read-only. */
  permissionMatrix: asyncHandler(async (_req, res) => {
    res.status(200).json({ matrix: matrix(), optionalPermissions: OPTIONAL_PERMISSIONS });
  }),

  /**
   * People a defect can be assigned to inside the caller's client: Private
   * Inspectors who are approved for this client, in date and not suspended
   * (REQ-DEF-001). Legacy mobile accounts without a QC role still appear so
   * existing assignments keep working.
   */
  assignableInspectors: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const clientId = ctx.clientId;
    if (!clientId) {
      if (ctx.isSA) throw new ApiError(409, 'Choose a client first', 'CLIENT_REQUIRED');
      throw ApiError.forbidden('No client context');
    }
    const today = new Date().toISOString().slice(0, 10);
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { qcMemberships: { some: { role: 'PRIVATE_INSPECTOR', status: 'ACTIVE', clientId } } },
          { role: { in: ['INSPECTOR', 'FIELD_USER'] }, qcMemberships: { none: {} } },
        ],
      },
      select: {
        id: true, name: true, email: true, role: true,
        qcInspectorCredential: { select: { status: true, data: true, approvedClients: { select: { id: true } } } },
        qcMemberships: { where: { status: 'ACTIVE' }, select: { role: true, client: { select: { id: true, name: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    const usable = users.filter((u) => {
      const c = u.qcInspectorCredential;
      if (!c) return true;
      if (c.status === 'SUSPENDED' || c.status === 'EXPIRED') return false;
      const expiry = (c.data as Record<string, unknown>).registration_expiry;
      if (typeof expiry === 'string' && expiry < today) return false;
      return c.approvedClients.length === 0 || c.approvedClients.some((a) => a.id === clientId);
    });
    res.status(200).json({
      users: usable.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, qcMemberships: u.qcMemberships })),
    });
  }),
};
