import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { audit } from '../../lib/auditTrail';
import { sendMail } from '../../lib/mailer';
import { env } from '../../config/env';
import { Actor, assignDenial, canRespondToTransfer, isAdmin, transferRequestDenial } from './assignment.rules';

const INSPECTION_BRIEF = { id: true, jobNo: true, address: true, suburb: true, status: true, reviewerId: true } as const;

/** Where the people in the emails click to sign in; the web app's address if the server knows it. */
function portalUrl(): string {
  return env.WEB_APP_URL;
}

async function activeReviewer(id: string) {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, role: true, isActive: true } });
  if (!u || u.role !== 'REVIEWER' || !u.isActive) throw ApiError.badRequest('The inspection can only be assigned to an active reviewer');
  return u;
}

const label = (i: { jobNo: string | null; address: string | null }) => [i.jobNo, i.address].filter(Boolean).join(' – ') || 'an inspection';

/** Tells the new assignee. Never fails the assignment: a mail problem is logged by the mailer and the in-app list is the source of truth. */
async function notifyAssigned(to: { name: string | null; email: string }, insp: { jobNo: string | null; address: string | null }, byName: string | null, kind: 'assigned' | 'reassigned') {
  const url = portalUrl();
  const subject = `[ACE SPECT] Inspection ${insp.jobNo ?? ''} ${kind === 'assigned' ? 'assigned to you' : 'reassigned to you'}`.replace(/\s+/g, ' ');
  const text = [
    `Hi ${to.name ?? ''}`.trim() + ',',
    '',
    `${label(insp)} has been ${kind} to you${byName ? ` by ${byName}` : ''}. It is now in your review queue.`,
    ...(url ? ['', `Sign in to review it: ${url}`] : []),
  ].join('\n');
  await sendMail(to.email, subject, text).catch(() => undefined);
}

/**
 * Sets (or changes) the reviewer of one inspection. `actor` must be allowed to by the rules (assignDenial). The write is conditional on the
 * assignee the caller saw, so two reviewers racing for the same unassigned inspection cannot both win: the loser gets a 409.
 */
async function assign(inspectionId: string, targetId: string, actor: Actor) {
  const insp = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: INSPECTION_BRIEF });
  if (!insp) throw ApiError.notFound('Inspection not found');
  const target = await activeReviewer(targetId);

  const denial = assignDenial(actor, insp, targetId);
  if (denial === 'SAME_ASSIGNEE') return { inspectionId, reviewerId: targetId, changed: false };
  if (denial === 'NOT_SUBMITTED') throw ApiError.conflict('This inspection has not been finalized yet', 'NOT_SUBMITTED');
  if (denial === 'ASSIGNED_TO_OTHER') throw new ApiError(403, 'This inspection is assigned to another reviewer. Ask them to agree to hand it over (request a transfer).', 'ASSIGNED_TO_OTHER');
  if (denial) throw ApiError.forbidden('Only reviewers and admins can assign inspections');

  const moved = await prisma.$transaction(async (tx) => {
    const res = await tx.inspection.updateMany({ where: { id: inspectionId, reviewerId: insp.reviewerId, status: { not: 'DRAFT' } }, data: { reviewerId: targetId } });
    if (res.count !== 1) return false;
    // Whatever was being asked of the previous holder is now moot.
    await tx.inspectionTransferRequest.updateMany({ where: { inspectionId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date(), decidedById: actor.id } });
    return true;
  });
  if (!moved) throw ApiError.conflict('Someone else just changed the assignment of this inspection. Refresh and try again.', 'ASSIGNMENT_CHANGED');

  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
  await audit({
    category: 'web', action: 'inspection.assign_reviewer', inspectionId, jobNo: insp.jobNo ?? undefined,
    target: { type: 'Inspection', id: inspectionId, label: insp.jobNo ?? inspectionId },
    before: { reviewerId: insp.reviewerId }, after: { reviewerId: targetId },
    message: actor.id === targetId ? `${me?.name ?? 'Reviewer'} took the inspection` : `Assigned to ${target.name ?? target.email}${me ? ` by ${me.name ?? me.email}` : ''}`,
  });
  // Nobody needs an email about something they just did themselves.
  if (actor.id !== targetId) await notifyAssigned(target, insp, me?.name ?? me?.email ?? null, insp.reviewerId ? 'reassigned' : 'assigned');
  return { inspectionId, reviewerId: targetId, changed: true };
}

/** A reviewer asks the current assignee to hand an inspection over. Nothing moves until they agree. */
async function requestTransfer(inspectionId: string, actor: Actor) {
  const insp = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: INSPECTION_BRIEF });
  if (!insp) throw ApiError.notFound('Inspection not found');
  const denial = transferRequestDenial(actor, insp);
  if (denial === 'UNASSIGNED') throw ApiError.conflict('This inspection is unassigned: take it directly', 'UNASSIGNED');
  if (denial === 'ALREADY_YOURS') throw ApiError.conflict('This inspection is already assigned to you', 'ALREADY_YOURS');
  if (denial === 'NOT_SUBMITTED') throw ApiError.conflict('This inspection has not been finalized yet', 'NOT_SUBMITTED');
  if (denial) throw ApiError.forbidden('Only reviewers can request a transfer');

  const existing = await prisma.inspectionTransferRequest.findFirst({ where: { inspectionId, toReviewerId: actor.id, status: 'PENDING' } });
  if (existing) return existing;
  const request = await prisma.inspectionTransferRequest.create({ data: { inspectionId, fromReviewerId: insp.reviewerId!, toReviewerId: actor.id } });

  const [holder, me] = await Promise.all([
    prisma.user.findUnique({ where: { id: insp.reviewerId! }, select: { name: true, email: true } }),
    prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } }),
  ]);
  await audit({ category: 'web', action: 'inspection.transfer_request', inspectionId, jobNo: insp.jobNo ?? undefined, target: { type: 'Inspection', id: inspectionId, label: insp.jobNo ?? inspectionId }, after: { from: insp.reviewerId, to: actor.id }, message: `${me?.name ?? 'A reviewer'} asked to take over the inspection` });
  if (holder) {
    const url = portalUrl();
    await sendMail(holder.email, `[ACE SPECT] ${me?.name ?? 'A reviewer'} asks to take over ${insp.jobNo ?? 'an inspection'}`, [
      `Hi ${holder.name ?? ''}`.trim() + ',', '', `${me?.name ?? me?.email ?? 'Another reviewer'} would like to take over ${label(insp)}, which is assigned to you.`,
      'Nothing changes unless you agree. You can accept or decline on your reviewer dashboard.', ...(url ? ['', url] : []),
    ].join('\n')).catch(() => undefined);
  }
  return request;
}

/** The current assignee (or an admin) agrees to or declines a request. Agreeing moves the inspection and emails the new assignee. */
async function respondToTransfer(requestId: string, accept: boolean, actor: Actor) {
  const req = await prisma.inspectionTransferRequest.findUnique({ where: { id: requestId }, include: { inspection: { select: INSPECTION_BRIEF } } });
  if (!req) throw ApiError.notFound('Transfer request not found');
  if (!canRespondToTransfer(actor, req)) throw ApiError.forbidden('Only the reviewer who holds the inspection can answer this request');
  if (req.status !== 'PENDING') throw ApiError.conflict('This request has already been answered', 'REQUEST_CLOSED');

  const now = new Date();
  const claimed = await prisma.inspectionTransferRequest.updateMany({ where: { id: requestId, status: 'PENDING' }, data: { status: accept ? 'APPROVED' : 'DECLINED', decidedAt: now, decidedById: actor.id } });
  if (claimed.count !== 1) throw ApiError.conflict('This request has already been answered', 'REQUEST_CLOSED');

  const requester = await prisma.user.findUnique({ where: { id: req.toReviewerId }, select: { id: true, name: true, email: true, role: true, isActive: true } });
  if (!accept) {
    await audit({ category: 'web', action: 'inspection.transfer_declined', inspectionId: req.inspectionId, jobNo: req.inspection.jobNo ?? undefined, target: { type: 'Inspection', id: req.inspectionId, label: req.inspection.jobNo ?? req.inspectionId }, message: 'Transfer request declined' });
    if (requester) await sendMail(requester.email, `[ACE SPECT] Request for ${req.inspection.jobNo ?? 'an inspection'} declined`, `Hi ${requester.name ?? ''},\n\nYour request to take over ${label(req.inspection)} was declined. It stays with its current reviewer.`.replace('Hi ,', 'Hi,')).catch(() => undefined);
    return { id: requestId, status: 'DECLINED' as const };
  }

  // The holder may have changed since the request was made (an admin moved it): then the agreement no longer applies.
  const moved = requester && requester.role === 'REVIEWER' && requester.isActive
    ? await prisma.$transaction(async (tx) => {
        const res = await tx.inspection.updateMany({ where: { id: req.inspectionId, reviewerId: req.fromReviewerId }, data: { reviewerId: req.toReviewerId } });
        if (res.count !== 1) return false;
        await tx.inspectionTransferRequest.updateMany({ where: { inspectionId: req.inspectionId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: now, decidedById: actor.id } });
        return true;
      })
    : false;
  if (!moved) {
    await prisma.inspectionTransferRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } });
    throw ApiError.conflict('This request is out of date: the inspection was reassigned or the reviewer is no longer available.', 'REQUEST_STALE');
  }
  const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { name: true, email: true } });
  await audit({ category: 'web', action: 'inspection.assign_reviewer', inspectionId: req.inspectionId, jobNo: req.inspection.jobNo ?? undefined, target: { type: 'Inspection', id: req.inspectionId, label: req.inspection.jobNo ?? req.inspectionId }, before: { reviewerId: req.fromReviewerId }, after: { reviewerId: req.toReviewerId }, message: `${me?.name ?? 'The assignee'} agreed to hand the inspection over${isAdmin(actor) ? ' (answered by an admin)' : ''}` });
  await notifyAssigned(requester!, req.inspection, me?.name ?? me?.email ?? null, 'reassigned');
  return { id: requestId, status: 'APPROVED' as const };
}

/** The requester withdraws their own pending request. */
async function cancelTransfer(requestId: string, actor: Actor) {
  const req = await prisma.inspectionTransferRequest.findUnique({ where: { id: requestId } });
  if (!req) throw ApiError.notFound('Transfer request not found');
  if (req.toReviewerId !== actor.id && !isAdmin(actor)) throw ApiError.forbidden('Only the reviewer who asked can withdraw this request');
  const res = await prisma.inspectionTransferRequest.updateMany({ where: { id: requestId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date(), decidedById: actor.id } });
  if (res.count !== 1) throw ApiError.conflict('This request has already been answered', 'REQUEST_CLOSED');
  return { id: requestId, status: 'CANCELLED' as const };
}

/**
 * The reviewer dashboard's numbers: inspections assigned to each reviewer, how many of those are still open, how many are unassigned,
 * and the pending hand-over requests the viewer is part of (admins: all). Counts are not sensitive, so every reviewer sees everyone's.
 */
async function overview(actor: Actor) {
  const [reviewers, grouped, unassigned, requests] = await Promise.all([
    prisma.user.findMany({ where: { role: 'REVIEWER', isActive: true }, select: { id: true, name: true, email: true }, orderBy: { createdAt: 'asc' } }),
    prisma.inspection.groupBy({ by: ['reviewerId', 'status'], where: { status: { not: 'DRAFT' }, reviewerId: { not: null } }, _count: { _all: true } }),
    prisma.inspection.count({ where: { status: { not: 'DRAFT' }, reviewerId: null } }),
    prisma.inspectionTransferRequest.findMany({
      where: { status: 'PENDING', ...(isAdmin(actor) ? {} : { OR: [{ fromReviewerId: actor.id }, { toReviewerId: actor.id }] }) },
      orderBy: { createdAt: 'asc' },
      include: { inspection: { select: { id: true, jobNo: true, address: true } } },
    }),
  ]);
  const OPEN = new Set(['SUBMITTED', 'IN_REVIEW']);
  const byId = new Map<string, { total: number; open: number }>();
  for (const g of grouped) {
    const cur = byId.get(g.reviewerId!) ?? { total: 0, open: 0 };
    cur.total += g._count._all;
    if (OPEN.has(g.status)) cur.open += g._count._all;
    byId.set(g.reviewerId!, cur);
  }
  return {
    reviewers: reviewers.map((r) => ({ id: r.id, name: r.name ?? r.email, assigned: byId.get(r.id)?.total ?? 0, open: byId.get(r.id)?.open ?? 0 })),
    unassigned,
    requests: requests.map((r) => ({ id: r.id, inspectionId: r.inspectionId, jobNo: r.inspection.jobNo ?? '', address: r.inspection.address ?? '', fromReviewerId: r.fromReviewerId, toReviewerId: r.toReviewerId, createdAt: r.createdAt.toISOString() })),
  };
}

export const assignmentService = { assign, requestTransfer, respondToTransfer, cancelTransfer, overview };
