import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { webService } from './web.service';
import { audit, firstWithin } from '../../lib/auditTrail';

export const webController = {
  listInspections: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const q = req.query as Record<string, unknown>;
    const since = typeof q.since === 'string' ? new Date(q.since) : undefined;
    if (since && Number.isNaN(since.getTime())) throw ApiError.badRequest('since must be a date');
    const result = await webService.listInspections(req.user, {
      view: typeof q.view === 'string' ? q.view : undefined,
      limit: typeof q.limit === 'string' ? Number(q.limit) || undefined : undefined,
      cursor: typeof q.cursor === 'string' && /^[0-9a-f-]{36}$/i.test(q.cursor) ? q.cursor : undefined,
      since,
    });
    // The list is refreshed whenever a tab regains focus: one entry per person per ten minutes, not one per refresh.
    if (!since && firstWithin(`list:${req.user.id}`, 10 * 60_000)) {
      await audit({ category: 'web', action: 'inspections.list', message: 'Inspection list opened', metadata: { view: typeof q.view === 'string' ? q.view : 'full', count: result.inspections.length } });
    }
    res.status(200).json(result);
  }),

  getInspection: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await webService.getInspection(id, req.user);
    if (firstWithin(`view:${req.user.id}:${id}`, 10 * 60_000)) {
      await audit({ category: 'web', action: 'inspection.view', inspectionId: id, jobNo: inspection.jobNo, target: { type: 'Inspection', id, label: inspection.jobNo } });
    }
    res.status(200).json({ inspection });
  }),

  listUsers: asyncHandler(async (_req: Request, res: Response) => {
    const users = await webService.listUsers();
    res.status(200).json({ users });
  }),

  updateUser: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('User id is required');
    const user = await webService.updateUser(id, req.body);
    res.status(200).json({ user });
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Section id is required');
    const section = await webService.updateSection(id, req.body);
    res.status(200).json({ section });
  }),

  updateInspection: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await webService.updateInspection(id, req.body);
    res.status(200).json({ inspection });
  }),

  submissionHealth: asyncHandler(async (_req: Request, res: Response) => {
    res.status(200).json(await webService.getSubmissionHealth());
  }),

  approveAll: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    res.status(200).json({ inspection: await webService.approveAllSections(id) });
  }),

  mailStatus: asyncHandler(async (_req: Request, res: Response) => {
    const { mailStatus } = await import('../../lib/mailer');
    const { env } = await import('../../config/env');
    const recipients = env.ALERT_EMAILS.split(',').map((e) => e.trim()).filter(Boolean);
    res.status(200).json({ ...mailStatus(), recipients: recipients.length ? recipients : (await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { email: true } })).map((u) => u.email), customRecipients: recipients.length > 0 });
  }),

  /** Sends a test email to the signed-in admin so the setup can be checked from the portal. */
  mailTest: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { sendMail, verifyMail, lastMailError } = await import('../../lib/mailer');
    const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { email: true } });
    const problem = await verifyMail();
    if (problem) return void res.status(200).json({ result: 'FAILED', error: problem });
    const result = await sendMail(me!.email, '[ACE SPECT] Test email', 'This is a test email from the ACE SPECT server. If you can read it, email alerts are working.');
    await audit({ category: 'admin', action: 'admin.mail_test', outcome: result === 'FAILED' ? 'failure' : 'success', message: `Test email ${String(result).toLowerCase()}`, target: { type: 'Settings', id: 'mail' } });
    res.status(200).json({ result, to: me!.email, ...(result === 'FAILED' ? { error: lastMailError } : {}) });
  }),

  resolveEgnyte: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Inspection id is required');
    const inspection = await webService.resolveEgnyte(id);
    res.status(200).json({ inspection });
  }),

  updateDamage: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) throw ApiError.badRequest('Damage id is required');
    const damage = await webService.updateDamage(id, req.body);
    res.status(200).json({ damage });
  }),

  listSubmissionLogs: asyncHandler(async (req: Request, res: Response) => {
    if (req.user && firstWithin(`troubleshoot:${req.user.id}`, 10 * 60_000)) await audit({ category: 'admin', action: 'admin.troubleshoot.view', message: 'Troubleshoot page opened' });
    const q = req.query as Record<string, string | undefined>;
    const logs = await webService.listSubmissionLogs({
      event: q.event || undefined,
      inspectorId: q.inspectorId || undefined,
      jobNo: q.jobNo || undefined,
      since: q.since ? new Date(q.since) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    res.status(200).json({ logs });
  }),
};
