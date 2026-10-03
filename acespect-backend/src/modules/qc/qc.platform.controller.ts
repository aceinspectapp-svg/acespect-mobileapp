/**
 * Platform-level endpoints of the QC module: the caller's own context, support
 * mode (E32), the permission matrix screen, and the inspector roster.
 */
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../lib/prisma';
import { ctxOf, endSupportSession, loadMemberships, startSupportSession } from './qc.context';
import { capabilityList, permissionMatrix as matrix } from './qc.permissions';
import { OPTIONAL_PERMISSIONS } from './qc.permissions';

export const qcPlatformController = {
  /** The caller's role, client, capabilities and (for a Super Admin) support session. */
  me: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const all = ctx.isSA ? [] : await loadMemberships(ctx.userId);
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
      supportSession: ctx.supportSession,
    });
  }),

  startSupport: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const session = await startSupportSession(ctx, String(body.clientId ?? ''), String(body.reason ?? ''), typeof body.ticketRef === 'string' ? body.ticketRef : undefined);
    res.status(201).json({ supportSession: session });
  }),

  endSupport: asyncHandler(async (req, res) => {
    await endSupportSession(ctxOf(req));
    res.status(200).json({ success: true });
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
      if (ctx.isSA) throw new ApiError(409, 'Start support mode in a client first', 'SUPPORT_MODE_REQUIRED');
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
