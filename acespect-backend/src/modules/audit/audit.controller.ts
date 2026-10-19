import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { audit, firstWithin, verifyAudit } from '../../lib/auditTrail';
import { acceptClientEvents, facets, getEvent, inspectionTimeline, searchEvents, trailHealth, type Filters } from './audit.service';

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

export function pickFilters(q: Record<string, unknown>): Filters {
  return {
    from: str(q.from, 40), to: str(q.to, 40), category: str(q.category), action: str(q.action, 400), outcome: str(q.outcome), severity: str(q.severity),
    source: str(q.source), actorId: str(q.actorId, 64), inspectionId: str(q.inspectionId, 64), jobNo: str(q.jobNo, 60), appVersion: str(q.appVersion, 40),
    ip: str(q.ip, 64), correlationId: str(q.correlationId, 64), q: str(q.q, 80),
  };
}

const viewerOf = (req: Request) => {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
};

export const auditController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const viewer = viewerOf(req);
    const filters = pickFilters(req.query as Record<string, unknown>);
    const result = await searchEvents(viewer, filters, { cursor: str(req.query.cursor, 20), limit: Number(req.query.limit) || undefined });
    // Reading the audit log is itself recorded (once per person per ten minutes while they browse it).
    if (firstWithin(`auditview:${viewer.id}`, 10 * 60_000)) await audit({ category: 'admin', action: 'audit.view', message: 'Audit log opened', metadata: { filters } });
    res.status(200).json(result);
  }),

  one: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json({ event: await getEvent(viewerOf(req), String(req.params.id)) });
  }),

  timeline: asyncHandler(async (req: Request, res: Response) => {
    const viewer = viewerOf(req);
    const id = String(req.params.id);
    const result = await inspectionTimeline(viewer, id);
    if (firstWithin(`timeline:${viewer.id}:${id}`, 10 * 60_000)) await audit({ category: 'web', action: 'audit.timeline.view', inspectionId: id, jobNo: result.inspection?.jobNo ?? null, message: 'Inspection history opened' });
    res.status(200).json(result);
  }),

  facets: asyncHandler(async (req: Request, res: Response) => {
    res.status(200).json(await facets(viewerOf(req)));
  }),

  health: asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json(await trailHealth());
  }),

  verify: asyncHandler(async (req: Request, res: Response) => {
    const viewer = viewerOf(req);
    const inspectionId = str(req.query.inspectionId, 64);
    // A reviewer or inspector may check the history of an inspection they can see; the whole log is for admins.
    if (viewer.role !== 'ADMIN') {
      if (!inspectionId) throw ApiError.forbidden('Only an administrator can verify the whole audit log');
      await inspectionTimeline(viewer, inspectionId); // throws unless they may see it
    }
    const result = await verifyAudit({ inspectionId });
    await audit({ category: 'admin', action: 'audit.verify', outcome: result.ok ? 'success' : 'failure', severity: result.ok ? 'info' : 'error', inspectionId: inspectionId ?? null, message: result.ok ? `Integrity check passed (${result.eventsChecked} entries)` : `Integrity check FAILED (${result.problems.length} problem(s))`, metadata: { eventsChecked: result.eventsChecked, anchorsChecked: result.anchorsChecked, problems: result.problems.length } });
    res.status(200).json(result);
  }),

  clientEvents: asyncHandler(async (req: Request, res: Response) => {
    const result = await acceptClientEvents(viewerOf(req), req.body);
    res.status(200).json(result);
  }),
};
