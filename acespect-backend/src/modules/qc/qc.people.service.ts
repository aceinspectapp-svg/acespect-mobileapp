/**
 * Users and roles from the requirements spec: platform identity (E04), the
 * membership that gives a user a role in a client (E05), Private Inspector
 * credentials (E06) and the project team (E10). New accounts are activated
 * through a one-time invitation link (REQ-AUT-001): the person sets their own
 * password and accepts the privacy notice and terms. Who may create which role
 * follows the permission matrix (REQ-USR-001..004).
 */
import { randomBytes } from 'crypto';
import { Prisma, QcMemberRole, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { hashPassword } from '../../utils/password';
import { authService, revokeAllSessions } from '../auth/auth.service';
import { recordAudit } from '../../lib/audit';
import { notify } from './qc.notify';
import { QcContext, assertClientAccess } from './qc.context';
import { Capability, can } from './qc.permissions';
import { requireExists } from './qc.shared';
import { validateAgainstSpec, validateOrThrow } from './spec/qcSpec';
import { TERMINAL_STATUSES } from './qc.lifecycle';
import { assertWithinPlan } from './qc.master.service';

type Input = Record<string, unknown>;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const MEMBER_ROLES: QcMemberRole[] = [
  'CLIENT_ADMIN', 'CLIENT_USER', 'MC_MANAGER', 'MC_SITE_SUPERVISOR', 'MC_PROJECT_MANAGER', 'TRADE_USER', 'PRIVATE_INSPECTOR',
];

/** Spec role names (E05 select) <-> codes. */
export const ROLE_LABEL: Record<QcMemberRole, string> = {
  CLIENT_ADMIN: 'Client Admin',
  CLIENT_USER: 'Client User',
  MC_MANAGER: 'Master Contractor Manager',
  MC_SITE_SUPERVISOR: 'Master Contractor Site Supervisor',
  MC_PROJECT_MANAGER: 'Master Contractor Project Manager',
  TRADE_USER: 'Trade User',
  PRIVATE_INSPECTOR: 'Private Inspector',
};

/** Which platform login role each QC role signs in as (so the mobile app and auth middleware keep working). */
const LOGIN_ROLE: Record<QcMemberRole, Role> = {
  CLIENT_ADMIN: 'CLIENT',
  CLIENT_USER: 'CLIENT',
  MC_MANAGER: 'FIELD_USER',
  MC_SITE_SUPERVISOR: 'FIELD_USER',
  MC_PROJECT_MANAGER: 'FIELD_USER',
  TRADE_USER: 'FIELD_USER',
  PRIVATE_INSPECTOR: 'INSPECTOR',
};

/** The capability a creator needs to add someone in each role. */
export const CREATE_CAPABILITY: Record<QcMemberRole, Capability> = {
  CLIENT_ADMIN: 'users.clientUsers',
  CLIENT_USER: 'users.clientUsers',
  MC_MANAGER: 'users.mcOrg',
  MC_SITE_SUPERVISOR: 'users.mcStaff',
  MC_PROJECT_MANAGER: 'users.mcStaff',
  TRADE_USER: 'users.trade',
  PRIVATE_INSPECTOR: 'users.credentialInspector',
};

/** May this caller manage a person in this role / master contractor? */
export function assertMayManage(ctx: QcContext, role: QcMemberRole, masterContractorId?: string | null): void {
  if (!can(ctx, CREATE_CAPABILITY[role])) throw ApiError.forbidden('You cannot manage people in this role');
  // A Master Contractor manager only manages people inside their own contractor organisation.
  if ((ctx.role === 'MC_MANAGER' || ctx.role === 'MC_PROJECT_MANAGER') && role !== 'TRADE_USER') {
    if (!masterContractorId || masterContractorId !== ctx.membership?.masterContractorId) throw ApiError.forbidden('You can only manage people in your own organisation');
  }
  // Client Admins create Client Admins; a Client User never reaches here (no capability).
}

const MOBILE_REQUIRED: QcMemberRole[] = ['PRIVATE_INSPECTOR', 'TRADE_USER', 'MC_SITE_SUPERVISOR'];
const WHITE_CARD_REQUIRED: QcMemberRole[] = ['PRIVATE_INSPECTOR', 'TRADE_USER', 'MC_SITE_SUPERVISOR', 'MC_PROJECT_MANAGER'];

const personInclude = {
  memberships: {
    include: {
      client: { select: { id: true, name: true } },
      masterContractor: { select: { id: true, name: true } },
      tradeCompany: { select: { id: true, name: true } },
      tradeCategories: { select: { id: true, name: true } },
      projects: { select: { id: true, name: true } },
    },
  },
  qcInspectorCredential: { include: { approvedClients: { select: { id: true, name: true } } } },
} as const;

function tempPassword(): string {
  return randomBytes(9).toString('base64url');
}

export async function listPeople(filters: { clientId?: string; role?: string; q?: string; masterContractorId?: string }) {
  const q = filters.q?.trim();
  const users = await prisma.user.findMany({
    where: {
      role: { in: ['INSPECTOR', 'FIELD_USER', 'CLIENT'] },
      qcMemberships: filters.clientId || filters.role || filters.masterContractorId
        ? { some: { clientId: filters.clientId, role: filters.role as QcMemberRole | undefined, masterContractorId: filters.masterContractorId } }
        : undefined,
      OR: q ? [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] : undefined,
    } as Prisma.UserWhereInput,
    select: {
      id: true, name: true, email: true, phone: true, role: true, isActive: true, position: true, whiteCardNumber: true, whiteCardState: true,
      createdAt: true, lastSignInAt: true, mfaEnabled: true,
      qcMemberships: { include: personInclude.memberships.include, where: filters.clientId ? { clientId: filters.clientId } : undefined },
      qcInspectorCredential: personInclude.qcInspectorCredential,
      _count: { select: { assignedQcDefects: true } },
    },
    orderBy: { name: 'asc' },
  });
  return users;
}

/** E04 field requirements that depend on the role being assigned. */
function e04Required(role: QcMemberRole): string[] {
  const extra: string[] = [];
  if (MOBILE_REQUIRED.includes(role)) extra.push('mobile');
  if (WHITE_CARD_REQUIRED.includes(role)) extra.push('white_card_number', 'white_card_issuing_state_or_territory');
  return extra;
}

interface MembershipPlan {
  clientId: string;
  role: QcMemberRole;
  masterContractorId?: string;
  tradeCompanyId?: string;
  tradeCategoryIds: string[];
  projectIds: string[];
  optionalPermissions: string[];
}

async function planMembership(role: QcMemberRole, input: Input, clientId: string): Promise<MembershipPlan> {
  await requireExists('qcClient', clientId, 'Client');
  const plan: MembershipPlan = {
    clientId,
    role,
    tradeCategoryIds: strArr(input.tradeCategoryIds),
    projectIds: strArr(input.projectIds),
    optionalPermissions: strArr(input.optionalPermissions),
  };
  if (role.startsWith('MC_')) {
    const mcId = str(input.masterContractorId);
    if (!mcId) throw ApiError.badRequest('Master Contractor staff need a Master Contractor organisation');
    const mc = await requireExists('qcMasterContractor', mcId, 'Master contractor');
    if (mc.clientId !== clientId) throw ApiError.badRequest('That master contractor belongs to a different client');
    plan.masterContractorId = mcId;
  }
  if (role === 'TRADE_USER') {
    const tcId = str(input.tradeCompanyId);
    if (!tcId) throw ApiError.badRequest('A Trade User needs a trade company');
    await requireExists('qcTradeCompany', tcId, 'Trade company');
    plan.tradeCompanyId = tcId;
    if (plan.tradeCategoryIds.length === 0) throw ApiError.badRequest('A Trade User needs at least one trade category');
  }
  if (plan.optionalPermissions.length && role !== 'CLIENT_USER') {
    throw ApiError.badRequest('Optional permissions apply to Client Users only');
  }
  for (const id of plan.tradeCategoryIds) await requireExists('qcTradeCategory', id, 'Trade category');
  for (const id of plan.projectIds) {
    const p = await requireExists('qcProject', id, 'Project');
    if (p.clientId !== clientId) throw ApiError.badRequest('A selected project belongs to a different client');
  }
  return plan;
}

function membershipData(plan: MembershipPlan) {
  return {
    role: plan.role,
    optionalPermissions: plan.optionalPermissions,
    masterContractorId: plan.masterContractorId ?? null,
    tradeCompanyId: plan.tradeCompanyId ?? null,
    tradeCategories: { set: plan.tradeCategoryIds.map((id) => ({ id })) },
    projects: { set: plan.projectIds.map((id) => ({ id })) },
  };
}

export async function createPerson(input: Input, ctx?: QcContext, opts: { platformOnboarding?: boolean } = {}) {
  const role = str(input.role) as QcMemberRole;
  if (!MEMBER_ROLES.includes(role)) throw ApiError.badRequest('Choose a role');
  const e04 = validateOrThrow('E04', { sign_in_method: 'Password with MFA', ...input }, { extraRequired: e04Required(role), skipRequired: ['sign_in_method'] });
  if (ctx) {
    // A non-SA caller always creates inside their own client.
    if (!ctx.isSA) input = { ...input, clientId: ctx.clientId };
    // Creating a client creates its first admin as part of platform onboarding; every other SA action needs a support session.
    if (role !== 'PRIVATE_INSPECTOR' && ctx.isSA && !opts.platformOnboarding) await assertClientAccess(ctx, str(input.clientId));
    assertMayManage(ctx, role, role.startsWith('MC_') ? str(input.masterContractorId) : null);
    if (role === 'MC_MANAGER' || role === 'MC_SITE_SUPERVISOR' || role === 'MC_PROJECT_MANAGER') {
      if ((ctx.role === 'MC_MANAGER') && str(input.masterContractorId) !== ctx.membership?.masterContractorId) throw ApiError.forbidden('You can only add people to your own organisation');
    }
    // Optional permissions are Client Admin / Super Admin business (REQ-USR-005).
    if (strArr(input.optionalPermissions).length && !can(ctx, 'users.grantPermissions')) throw ApiError.forbidden('You cannot grant permissions');
  }

  const email = str(e04.email_address);
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) return linkExistingPerson(existingUser.id, role, input, ctx);

  // Private Inspectors are credentialed by the Super Admin and approved for specific clients (E06).
  let credential: Input | undefined;
  let plans: MembershipPlan[];
  if (role === 'PRIVATE_INSPECTOR') {
    const credInput = (input.credentials ?? {}) as Input;
    credential = validateOrThrow('E06', credInput, { skipRequired: ['user', 'signature_image'] });
    const approved = strArr(credential.approved_for_clients);
    for (const id of approved) await requireExists('qcClient', id, 'Client');
    plans = await Promise.all(approved.map((cid) => planMembership(role, input, cid)));
  } else {
    plans = [await planMembership(role, input, str(input.clientId))];
  }

  // The person chooses their own password through the invitation link; until then the account cannot sign in.
  // Each new membership counts against the client's user limit.
  for (const plan of plans) await assertWithinPlan(plan.clientId, 'users');
  const password = tempPassword();

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email,
        name: [e04.first_name, e04.last_name].filter(Boolean).join(' '),
        phone: (e04.mobile as string | undefined) ?? null,
        position: (e04.position_or_job_title as string | undefined) ?? null,
        whiteCardNumber: (e04.white_card_number as string | undefined) ?? null,
        whiteCardState: (e04.white_card_issuing_state_or_territory as string | undefined) ?? null,
        licenseNumber: credential ? str(credential.registration_number) : null,
        passwordHash: await hashPassword(password),
        role: LOGIN_ROLE[role],
      },
    });
    for (const plan of plans) {
      await tx.qcMembership.create({
        data: {
          userId: u.id,
          clientId: plan.clientId,
          role: plan.role,
          optionalPermissions: plan.optionalPermissions,
          masterContractorId: plan.masterContractorId,
          tradeCompanyId: plan.tradeCompanyId,
          tradeCategories: { connect: plan.tradeCategoryIds.map((id) => ({ id })) },
          projects: { connect: plan.projectIds.map((id) => ({ id })) },
        },
      });
    }
    if (credential) {
      await tx.qcInspectorCredential.create({
        data: {
          userId: u.id,
          status: 'PENDING',
          data: json(credential),
          approvedClients: { connect: strArr(credential.approved_for_clients).map((id) => ({ id })) },
        },
      });
    }
    return u;
  });

  const person = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { id: true, name: true, email: true, role: true, qcMemberships: { include: personInclude.memberships.include }, qcInspectorCredential: personInclude.qcInspectorCredential },
  });
  const invitation = await sendInvitation(user.id, ctx?.userId ?? null);
  await recordAudit({
    clientId: plans[0]?.clientId ?? null, entityType: 'User', entityId: user.id, action: 'user.create',
    actor: ctx ? { id: ctx.userId, role: ctx.role } : { id: null, role: 'SYSTEM' }, after: { email, role },
  });
  return { person, invitation };
}

/**
 * The email already belongs to someone: they keep their one login and gain a role in this client too (REQ-TEN-003).
 * Credentialed inspectors are linked through the approved-clients list instead.
 */
async function linkExistingPerson(userId: string, role: QcMemberRole, input: Input, ctx?: QcContext) {
  if (role === 'PRIVATE_INSPECTOR') throw ApiError.conflict('This inspector already has an account. Add this client to their approved clients instead.', 'EMAIL_TAKEN');
  const clientId = str(input.clientId);
  const plan = await planMembership(role, input, clientId);
  const existing = await prisma.qcMembership.findUnique({ where: { userId_clientId: { userId, clientId } } });
  if (existing?.status === 'ACTIVE') throw ApiError.conflict('This person already has a role in this client.', 'ALREADY_MEMBER');
  await assertWithinPlan(clientId, 'users');
  const data = { role: plan.role, optionalPermissions: plan.optionalPermissions, masterContractorId: plan.masterContractorId ?? null, tradeCompanyId: plan.tradeCompanyId ?? null, status: 'ACTIVE', deactivationReason: null };
  const m = existing
    ? await prisma.qcMembership.update({ where: { id: existing.id }, data: { ...data, tradeCategories: { set: plan.tradeCategoryIds.map((id) => ({ id })) }, projects: { set: plan.projectIds.map((id) => ({ id })) } } })
    : await prisma.qcMembership.create({ data: { userId, clientId, ...data, tradeCategories: { connect: plan.tradeCategoryIds.map((id) => ({ id })) }, projects: { connect: plan.projectIds.map((id) => ({ id })) } } });
  await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  await recordAudit({ clientId, entityType: 'User', entityId: userId, action: 'user.link', actor: ctx ? { id: ctx.userId, role: ctx.role } : { id: null, role: 'SYSTEM' }, after: { role, membershipId: m.id } });
  const person = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, qcMemberships: { include: personInclude.memberships.include }, qcInspectorCredential: personInclude.qcInspectorCredential },
  });
  const client = await prisma.qcClient.findUniqueOrThrow({ where: { id: clientId }, select: { name: true } });
  await notify({ type: 'account.invitation', userIds: [userId], clientId, title: `You now have access to ${client.name} as ${ROLE_LABEL[role]}`, mandatory: true });
  return { person, invitation: undefined, linked: true };
}

/** Create the activation link and email it. The link is also returned so an admin can hand it over when email is not set up. */
export async function sendInvitation(userId: string, createdById: string | null) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const inv = await authService.createInvitation(userId, createdById);
  const mail = await authService.sendInvitationEmail(user, inv.url);
  return { url: inv.url, expiresAt: inv.expiresAt, email: user.email, mail };
}

export async function updatePerson(userId: string, input: Input) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { qcMemberships: true } });
  if (!user) throw ApiError.notFound('User not found');

  const { data: e04, issues } = validateAgainstSpec('E04', input, { partial: true });
  if (issues.length) throw ApiError.badRequest(issues.map((i) => i.message).join('; '));
  if (typeof e04.email_address === 'string' && e04.email_address !== user.email) {
    if (await prisma.user.findUnique({ where: { email: e04.email_address } })) throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }
  const nameParts = [e04.first_name ?? user.name?.split(' ')[0], e04.last_name ?? user.name?.split(' ').slice(1).join(' ')].filter(Boolean);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: e04.email_address as string | undefined,
        name: e04.first_name || e04.last_name ? nameParts.join(' ') : undefined,
        phone: e04.mobile as string | undefined,
        position: e04.position_or_job_title as string | undefined,
        whiteCardNumber: e04.white_card_number as string | undefined,
        whiteCardState: e04.white_card_issuing_state_or_territory as string | undefined,
      },
    });
    // Membership edits: one membership per client, addressed by membershipId.
    if (typeof input.membershipId === 'string') {
      const m = user.qcMemberships.find((x) => x.id === input.membershipId);
      if (!m) throw ApiError.notFound('Membership not found');
      const plan = await planMembership((input.role as QcMemberRole) ?? m.role, { ...m, ...input }, m.clientId);
      await tx.qcMembership.update({ where: { id: m.id }, data: membershipData(plan) });
    }
  });
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, qcMemberships: { include: personInclude.memberships.include }, qcInspectorCredential: personInclude.qcInspectorCredential },
  });
}

export const DEACTIVATION_REASONS = ['Left the company', 'Contract ended', 'Role change', 'Security concern', 'Other'];

/** F05: deactivate a user and move their open work to someone else (REQ-USR-006). */
export async function deactivatePerson(userId: string, input: { reason: string; reassignToId?: string }, ctx?: QcContext) {
  if (!DEACTIVATION_REASONS.includes(input.reason)) throw ApiError.badRequest('Choose a deactivation reason');
  await requireExists('user', userId, 'User');
  if (userId === ctx?.userId) throw ApiError.badRequest('You cannot deactivate your own account');
  {
    // A client always keeps at least one active Client Admin (REQ-USR-001).
    const adminOf = await prisma.qcMembership.findMany({ where: { userId, role: 'CLIENT_ADMIN', status: 'ACTIVE', ...(ctx && !ctx.isSA ? { clientId: ctx.clientId ?? undefined } : {}) }, select: { clientId: true } });
    for (const m of adminOf) {
      const others = await prisma.qcMembership.count({ where: { clientId: m.clientId, role: 'CLIENT_ADMIN', status: 'ACTIVE', userId: { not: userId }, user: { isActive: true } } });
      if (others === 0) throw ApiError.conflict('This is the last active Client Admin of the client. Add another Client Admin before deactivating them.', 'LAST_ADMIN');
    }
  }
  const scopeClientId = ctx && !ctx.isSA ? ctx.clientId : ctx?.clientId ?? null;
  if (ctx) {
    if (!can(ctx, 'users.deactivate')) throw ApiError.forbidden('You cannot deactivate people');
    if (ctx.role === 'MC_MANAGER') {
      const target = await prisma.qcMembership.findFirst({ where: { userId, clientId: scopeClientId ?? undefined } });
      if (!target || (target.role !== 'TRADE_USER' && target.masterContractorId !== ctx.membership?.masterContractorId)) throw ApiError.forbidden('You can only deactivate people in your own organisation');
    }
  }
  const openStatuses = await prisma.qcStatus.findMany({ where: { key: { notIn: TERMINAL_STATUSES } }, select: { id: true } });
  const openWhere = { assignedToId: userId, statusId: { in: openStatuses.map((s) => s.id) } };
  const openCount = await prisma.qcDefect.count({ where: openWhere });
  if (openCount > 0 && !input.reassignToId) {
    throw ApiError.conflict(`${openCount} open defect(s) are assigned to this user; choose someone to reassign them to`, 'OPEN_WORK');
  }
  if (input.reassignToId) {
    if (input.reassignToId === userId) throw ApiError.badRequest('Choose a different person to reassign to');
    await requireExists('user', input.reassignToId, 'Reassignee');
  }
  await prisma.$transaction(async (tx) => {
    if (input.reassignToId) {
      await tx.qcDefect.updateMany({ where: openWhere, data: { assignedToId: input.reassignToId } });
      await tx.qcTask.updateMany({ where: { assignedToId: userId, status: { not: 'COMPLETED' } }, data: { assignedToId: input.reassignToId } });
    }
    await tx.qcMembership.updateMany({ where: { userId, clientId: scopeClientId ?? undefined }, data: { status: 'DEACTIVATED', deactivationReason: input.reason } });
    // A person with roles in other clients stays active there; otherwise the account is switched off.
    const remaining = await tx.qcMembership.count({ where: { userId, status: 'ACTIVE' } });
    if (remaining === 0) await tx.user.update({ where: { id: userId }, data: { isActive: false } });
  });
  // Active sessions end within a minute, and the next refresh fails (REQ-AUT-005).
  await revokeAllSessions(userId, `deactivated: ${input.reason}`);
  await recordAudit({ clientId: scopeClientId, entityType: 'User', entityId: userId, action: 'user.deactivate', actor: ctx ? { id: ctx.userId, role: ctx.role } : { id: null, role: 'SYSTEM' }, reason: input.reason });
  return { reassigned: input.reassignToId ? openCount : 0 };
}

export async function reactivatePerson(userId: string, ctx?: QcContext) {
  await requireExists('user', userId, 'User');
  if (ctx && !can(ctx, 'users.deactivate')) throw ApiError.forbidden('You cannot reactivate people');
  await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  await prisma.qcMembership.updateMany({ where: { userId, clientId: ctx?.clientId ?? undefined }, data: { status: 'ACTIVE', deactivationReason: null } });
  await recordAudit({ clientId: ctx?.clientId ?? null, entityType: 'User', entityId: userId, action: 'user.reactivate', actor: ctx ? { id: ctx.userId, role: ctx.role } : { id: null, role: 'SYSTEM' } });
}

// ───────────────────────── Private Inspector credentials (E06) ─────────────────────────

const CREDENTIAL_STATUS = ['PENDING', 'APPROVED', 'SUSPENDED', 'EXPIRED'];

export async function saveCredentials(userId: string, input: Input) {
  await requireExists('user', userId, 'User');
  const data = validateOrThrow('E06', input, { skipRequired: ['user', 'signature_image'] });
  const approved = strArr(data.approved_for_clients);
  for (const id of approved) await requireExists('qcClient', id, 'Client');
  return prisma.qcInspectorCredential.upsert({
    where: { userId },
    create: { userId, data: json(data), approvedClients: { connect: approved.map((id) => ({ id })) } },
    update: { data: json(data), approvedClients: { set: approved.map((id) => ({ id })) } },
    include: { approvedClients: { select: { id: true, name: true } } },
  });
}

export async function setCredentialStatus(userId: string, status: string) {
  if (!CREDENTIAL_STATUS.includes(status)) throw ApiError.badRequest('Unknown credential status');
  const existing = await prisma.qcInspectorCredential.findUnique({ where: { userId } });
  if (!existing) throw ApiError.notFound('This user has no inspector credentials on file');
  return prisma.qcInspectorCredential.update({ where: { userId }, data: { status } });
}

// ───────────────────────── Project team (E10) ─────────────────────────

const ASSIGNEE_TYPES = ['PERSON', 'TRADE_COMPANY', 'MASTER_CONTRACTOR'];

export async function listTeam(projectId: string) {
  await requireExists('qcProject', projectId, 'Project');
  const rows = await prisma.qcProjectMember.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' }, include: { tradeCompany: { select: { id: true, name: true } } } });
  const userIds = rows.map((r) => r.userId).filter((x): x is string => !!x);
  const mcIds = rows.map((r) => r.masterContractorId).filter((x): x is string => !!x);
  const [users, mcs] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    prisma.qcMasterContractor.findMany({ where: { id: { in: mcIds } }, select: { id: true, name: true } }),
  ]);
  return rows.map((r) => ({
    ...r,
    user: users.find((u) => u.id === r.userId) ?? null,
    masterContractor: mcs.find((m) => m.id === r.masterContractorId) ?? null,
  }));
}

export async function addTeamMember(projectId: string, input: Input) {
  const project = await requireExists('qcProject', projectId, 'Project');
  const assigneeType = str(input.assigneeType);
  if (!ASSIGNEE_TYPES.includes(assigneeType)) throw ApiError.badRequest('Choose what is being assigned: a person, a trade company or a master contractor');
  const data = validateOrThrow('E10', input, { skipRequired: ['project', 'assignee', 'assignee_type'] });

  let userId: string | undefined;
  let tradeCompanyId: string | undefined;
  let masterContractorId: string | undefined;
  if (assigneeType === 'PERSON') {
    userId = str(input.assigneeId);
    const membership = await prisma.qcMembership.findFirst({ where: { userId, clientId: project.clientId, status: 'ACTIVE' } });
    if (!membership) throw ApiError.badRequest('That person has no active membership in this project\'s client');
    // Being on the team is what gives a scoped membership access to the project.
    await prisma.qcMembership.update({ where: { id: membership.id }, data: { projects: { connect: { id: projectId } } } });
  } else if (assigneeType === 'TRADE_COMPANY') {
    tradeCompanyId = str(input.assigneeId);
    await requireExists('qcTradeCompany', tradeCompanyId, 'Trade company');
  } else {
    masterContractorId = str(input.assigneeId);
    const mc = await requireExists('qcMasterContractor', masterContractorId, 'Master contractor');
    if (mc.clientId !== project.clientId) throw ApiError.badRequest("That master contractor belongs to a different client");
  }
  return prisma.qcProjectMember.create({
    data: {
      projectId,
      assigneeType,
      userId,
      tradeCompanyId,
      masterContractorId,
      projectRole: str(data.project_role),
      data: json(without(data, ['project_role'])),
    },
  });
}

function without(data: Input, keys: string[]): Input {
  const out = { ...data };
  for (const k of keys) delete out[k];
  return out;
}

export async function removeTeamMember(id: string, removalReason?: string) {
  const member = await prisma.qcProjectMember.findUnique({ where: { id } });
  if (!member) throw ApiError.notFound('Team member not found');
  if (member.userId) {
    const openForUser = await prisma.qcDefect.count({
      where: { assignedToId: member.userId, property: { projectId: member.projectId }, status: { terminal: false } },
    });
    if (openForUser > 0 && !removalReason?.trim()) {
      throw ApiError.badRequest('This person has open items on the project; a removal reason is required');
    }
    // Take the project off their membership so the scoped access goes with them.
    const project = await prisma.qcProject.findUnique({ where: { id: member.projectId } });
    const membership = project && (await prisma.qcMembership.findFirst({ where: { userId: member.userId, clientId: project.clientId } }));
    if (membership) await prisma.qcMembership.update({ where: { id: membership.id }, data: { projects: { disconnect: { id: member.projectId } } } });
  }
  await prisma.qcProjectMember.delete({ where: { id } });
}
