/**
 * Houspect user management (Admin -> Users): add an inspector, reviewer or admin, change their role, switch an account off or back on, and
 * help with invitations and forgotten passwords.
 *
 * People are never given a password by an administrator. A new account has an unusable random password and a one-time invitation link
 * (the same link system the QC platform uses); the person chooses their own password. When the server can send email the link goes only to
 * the person; when it cannot (email is not set up) the administrator gets the link once to pass on.
 *
 * Every action is written to the audit log. People who also hold a QC role (client, contractor, trade, private inspector) are managed on
 * the QC -> People page and are refused here, so the two pages can never disagree about the same account.
 */
import crypto from 'crypto';
import { Prisma, Role, User } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { hashPassword } from '../../utils/password';
import { audit } from '../../lib/auditTrail';
import { authService, revokeAllSessions } from '../auth/auth.service';
import { clearAuthCache } from '../../middleware/auth';
import { serializeUser } from './web.serializers';
import type { CreateUserInput, DeactivateUserInput } from './web.schemas';

export const HOUSPECT_ROLES: Role[] = ['INSPECTOR', 'REVIEWER', 'ADMIN'];
const ROLE_FROM_WEB: Record<'inspector' | 'reviewer' | 'admin', Role> = { inspector: 'INSPECTOR', reviewer: 'REVIEWER', admin: 'ADMIN' };
const OPEN_REVIEW: Array<'SUBMITTED' | 'IN_REVIEW'> = ['SUBMITTED', 'IN_REVIEW'];

export interface Actor { id: string; role: string }

type UserRow = User & {
  qcMemberships?: Array<{ id: string }>;
  qcInvitations?: Array<{ expiresAt: Date }>;
};

const withState = {
  qcMemberships: { where: { status: 'ACTIVE' as const }, select: { id: true } },
  qcInvitations: { where: { usedAt: null }, orderBy: { sentAt: 'desc' as const }, take: 1, select: { expiresAt: true } },
} satisfies Prisma.UserInclude;

/** Has the person ever set a password through an invitation, or signed in? Accounts that have not are still "invited". */
const activated = (u: Pick<User, 'lastSignInAt' | 'passwordChangedAt'>) => !!u.lastSignInAt || !!u.passwordChangedAt;

function statusOf(u: UserRow): 'invited' | 'active' | 'deactivated' {
  if (!u.isActive) return 'deactivated';
  return activated(u) ? 'active' : 'invited';
}

/** What the Users page shows. Everything beyond the basic profile is for administrators only. */
function view(u: UserRow, admin: boolean) {
  const base = { ...serializeUser(u), status: statusOf(u) };
  if (!admin) return base;
  const invite = u.qcInvitations?.[0];
  return {
    ...base,
    lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
    twoStep: u.mfaEnabled,
    qcManaged: (u.qcMemberships?.length ?? 0) > 0,
    invitationExpired: statusOf(u) === 'invited' ? !invite || invite.expiresAt < new Date() : undefined,
    deactivatedAt: u.deactivatedAt?.toISOString() ?? null,
    deactivationReason: u.deactivationReason ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

async function load(id: string): Promise<UserRow> {
  const u = await prisma.user.findUnique({ where: { id }, include: withState });
  if (!u || !HOUSPECT_ROLES.includes(u.role)) throw ApiError.notFound('User not found');
  return u;
}

/** Houspect accounts only, and never someone who also holds a QC role: those are managed on QC -> People. */
async function loadManageable(id: string): Promise<UserRow> {
  const u = await load(id);
  if ((u.qcMemberships?.length ?? 0) > 0) {
    throw new ApiError(409, `${u.name ?? u.email} also holds a role in a QC client, so they are managed on the QC People page.`, 'QC_MANAGED');
  }
  return u;
}

async function assertNotLastAdmin(target: User, why: string): Promise<void> {
  if (target.role !== 'ADMIN' || !target.isActive) return;
  const others = await prisma.user.count({ where: { role: 'ADMIN', isActive: true, id: { not: target.id } } });
  if (others === 0) throw new ApiError(409, `${why} the last active administrator would leave nobody able to manage users. Add another administrator first.`, 'LAST_ADMIN');
}

const roleLabel = (r: Role) => r.charAt(0) + r.slice(1).toLowerCase();

// ───────────────────────── list ─────────────────────────

async function listUsers(viewerRole: string) {
  const rows = await prisma.user.findMany({ where: { role: { in: HOUSPECT_ROLES } }, orderBy: { createdAt: 'asc' }, include: withState });
  const admin = viewerRole === 'ADMIN';
  return rows.map((u) => view(u, admin));
}

// ───────────────────────── add, invite ─────────────────────────

/** The link is only handed to the administrator when email could not carry it. */
function inviteForAdmin(inv: { url: string; expiresAt: Date; email: string; mail: string }) {
  return { email: inv.email, expiresAt: inv.expiresAt.toISOString(), mail: inv.mail, ...(inv.mail === 'SENT' ? {} : { url: inv.url }) };
}

async function sendInvite(user: User, byId: string) {
  const inv = await authService.createInvitation(user.id, byId);
  const note = user.role === 'INSPECTOR' ? 'You will do your inspections in the ACE SPECT phone app. Once your account is active, sign in there (or choose "I have an invitation" in the app and paste this link).' : '';
  const mail = await authService.sendInvitationEmail(user, inv.url, note);
  return { url: inv.url, expiresAt: inv.expiresAt, email: user.email, mail };
}

async function createUser(input: CreateUserInput, actor: Actor) {
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new ApiError(409, 'Someone already has an account with this email address.', 'EMAIL_TAKEN');
  }
  const role = ROLE_FROM_WEB[input.role];
  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        email, name: input.name.trim(), role,
        phone: input.phone?.trim() || null, region: input.region?.trim() || null, licenseNumber: input.licenseNumber?.trim() || null,
        // Nobody knows this password; the person chooses their own through the invitation link.
        passwordHash: await hashPassword(crypto.randomBytes(24).toString('base64url')),
        createdById: actor.id,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ApiError(409, 'Someone already has an account with this email address.', 'EMAIL_TAKEN');
    throw e;
  }
  const inv = await sendInvite(user, actor.id);
  await audit({
    category: 'admin', action: 'user.create', target: { type: 'User', id: user.id, label: email }, after: { email, name: user.name, role },
    message: `Added ${roleLabel(role)} ${user.name ?? email}; invitation ${inv.mail === 'SENT' ? 'emailed' : 'link given to the administrator'}`,
  });
  return { user: view(await load(user.id), true), invitation: inviteForAdmin(inv) };
}

async function resendInvitation(id: string, actor: Actor) {
  const u = await loadManageable(id);
  if (!u.isActive) throw new ApiError(409, 'This account is switched off. Reactivate it first.', 'DEACTIVATED');
  if (activated(u)) throw new ApiError(409, `${u.name ?? u.email} has already activated their account. Use "Send reset link" if they cannot sign in.`, 'ALREADY_ACTIVATED');
  const inv = await sendInvite(u, actor.id);
  await audit({ category: 'admin', action: 'user.invitation_resent', target: { type: 'User', id, label: u.email }, message: `New invitation for ${u.name ?? u.email}; the earlier link no longer works` });
  return { invitation: inviteForAdmin(inv) };
}

async function sendPasswordReset(id: string, actor: Actor) {
  const u = await loadManageable(id);
  if (!u.isActive) throw new ApiError(409, 'This account is switched off. Reactivate it first.', 'DEACTIVATED');
  if (!activated(u)) throw new ApiError(409, `${u.name ?? u.email} has not activated their account yet. Send a new invitation instead.`, 'NOT_ACTIVATED');
  const r = await authService.issuePasswordReset(id);
  await audit({ category: 'admin', action: 'user.password_reset_sent', target: { type: 'User', id, label: u.email }, message: `Password reset link ${r.mail === 'SENT' ? 'emailed to' : 'created for'} ${u.name ?? u.email}` });
  return { reset: { email: r.email, mail: r.mail, expiresInMinutes: 60, ...(r.mail === 'SENT' ? {} : { url: r.url }) } };
}

/** An invitation nobody used: remove the account. Anyone who has signed in, or has inspections on record, is switched off instead. */
async function cancelInvitation(id: string) {
  const u = await loadManageable(id);
  if (activated(u)) throw new ApiError(409, `${u.name ?? u.email} has already used their account, so it cannot be deleted. Switch it off instead.`, 'ALREADY_ACTIVATED');
  const history = (await prisma.inspection.count({ where: { OR: [{ inspectorId: id }, { reviewerId: id }] } })) > 0;
  if (history) throw new ApiError(409, 'This account has inspections on record, so it cannot be deleted. Switch it off instead.', 'HAS_HISTORY');
  try {
    await prisma.user.delete({ where: { id } });
  } catch {
    throw new ApiError(409, 'This account is referred to by other records, so it cannot be deleted. Switch it off instead.', 'HAS_HISTORY');
  }
  clearAuthCache(id);
  await audit({ category: 'admin', action: 'user.delete', target: { type: 'User', id, label: u.email }, before: { email: u.email, role: u.role }, message: `Cancelled the invitation and removed the unused account of ${u.name ?? u.email}` });
}

// ───────────────────────── role, switch off, switch on ─────────────────────────

/** Open reviews held by a reviewer go to another active reviewer, or back to the unassigned queue; their pending transfer requests end. */
async function handBackReviews(from: User, toId: string | null | undefined, actor: Actor): Promise<number> {
  if (toId) {
    const to = await prisma.user.findUnique({ where: { id: toId }, select: { role: true, isActive: true } });
    if (!to || to.role !== 'REVIEWER' || !to.isActive || toId === from.id) throw ApiError.badRequest('Choose another active reviewer to take over');
  }
  const open = await prisma.inspection.findMany({ where: { reviewerId: from.id, status: { in: OPEN_REVIEW } }, select: { id: true, jobNo: true } });
  await prisma.inspectionTransferRequest.updateMany({
    where: { status: 'PENDING', OR: [{ fromReviewerId: from.id }, { toReviewerId: from.id }] },
    data: { status: 'CANCELLED', decidedAt: new Date(), decidedById: actor.id },
  });
  if (open.length === 0) return 0;
  await prisma.inspection.updateMany({ where: { id: { in: open.map((i) => i.id) } }, data: { reviewerId: toId ?? null } });
  for (const i of open) {
    await audit({
      category: 'admin', action: 'inspection.assign_reviewer', inspectionId: i.id, jobNo: i.jobNo ?? undefined, target: { type: 'Inspection', id: i.id, label: i.jobNo ?? i.id },
      before: { reviewerId: from.id }, after: { reviewerId: toId ?? null },
      message: toId ? `Handed to another reviewer because ${from.name ?? from.email} was removed from the reviewer role` : `Returned to the unassigned queue because ${from.name ?? from.email} was removed from the reviewer role`,
    });
  }
  return open.length;
}

async function changeRole(id: string, webRole: 'inspector' | 'reviewer' | 'admin', reassignToId: string | null | undefined, actor: Actor) {
  const u = await loadManageable(id);
  const role = ROLE_FROM_WEB[webRole];
  if (role === u.role) return { user: view(u, true), handedBack: 0 };
  if (id === actor.id) throw new ApiError(409, 'You cannot change your own role. Ask another administrator.', 'SELF');
  if (u.role === 'ADMIN') await assertNotLastAdmin(u, 'Changing the role of');
  const handedBack = u.role === 'REVIEWER' ? await handBackReviews(u, reassignToId, actor) : 0;
  const row = await prisma.user.update({ where: { id }, data: { role } });
  clearAuthCache(id); // takes effect on their very next request; they are not signed out
  await audit({
    category: 'admin', action: 'user.role_change', severity: role === 'ADMIN' ? 'notice' : 'info', target: { type: 'User', id, label: u.email },
    before: { role: u.role }, after: { role }, message: `${u.name ?? u.email}: ${roleLabel(u.role)} to ${roleLabel(role)}${handedBack ? `; ${handedBack} open review(s) handed back` : ''}`,
  });
  return { user: view({ ...row, qcMemberships: u.qcMemberships, qcInvitations: u.qcInvitations }, true), handedBack };
}

async function deactivate(id: string, input: DeactivateUserInput, actor: Actor) {
  const u = await loadManageable(id);
  if (id === actor.id) throw new ApiError(409, 'You cannot switch off your own account. Ask another administrator.', 'SELF');
  if (!u.isActive) return { user: view(u, true), handedBack: 0 };
  await assertNotLastAdmin(u, 'Switching off');
  const handedBack = u.role === 'REVIEWER' ? await handBackReviews(u, input.reassignToId, actor) : 0;
  const reason = input.reason?.trim() || null;
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { isActive: false, deactivatedAt: new Date(), deactivatedById: actor.id, deactivationReason: reason } }),
    prisma.qcInvitation.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } }), // an unused invitation must not bring them back
    prisma.qcPushToken.deleteMany({ where: { userId: id } }),
  ]);
  await revokeAllSessions(id, 'account switched off by an administrator'); // access token and refresh token both stop working now
  await audit({
    category: 'admin', action: 'user.deactivate', severity: 'notice', target: { type: 'User', id, label: u.email }, before: { isActive: true }, after: { isActive: false }, reason,
    message: `Switched off ${u.name ?? u.email}${handedBack ? `; ${handedBack} open review(s) handed back` : ''}`,
  });
  return { user: view(await load(id), true), handedBack };
}

async function reactivate(id: string, actor: Actor) {
  const u = await loadManageable(id);
  if (u.isActive) return { user: view(u, true), needsInvitation: !activated(u) };
  await prisma.user.update({ where: { id }, data: { isActive: true, deactivatedAt: null, deactivatedById: null, deactivationReason: null, failedLoginCount: 0, lockedUntil: null } });
  clearAuthCache(id);
  await audit({ category: 'admin', action: 'user.reactivate', target: { type: 'User', id, label: u.email }, before: { isActive: false }, after: { isActive: true }, message: `Switched ${u.name ?? u.email} back on` });
  return { user: view(await load(id), true), needsInvitation: !activated(u) };
}

async function getView(id: string) {
  return view(await load(id), true);
}

export const usersService = { getView, listUsers, createUser, resendInvitation, sendPasswordReset, cancelInvitation, changeRole, deactivate, reactivate };
