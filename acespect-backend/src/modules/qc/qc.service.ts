import { prisma } from '../../lib/prisma';
import { loadMemberships } from './qc.context';
import { ApiError } from '../../utils/ApiError';
import { requireExists, taskInclude } from './qc.shared';
import {
  CreatePropertyTypeInput,
  PostTaskUpdateInput,
  UpdateTaskStatusInput,
} from './qc.schemas';

// ─── Config: Property types ─────────────────────────────────────────────────

async function listPropertyTypes() {
  return prisma.qcPropertyType.findMany({ orderBy: { order: 'asc' } });
}
async function createPropertyType(input: CreatePropertyTypeInput) {
  await ensureKeyFree('qcPropertyType', input.key);
  return prisma.qcPropertyType.create({ data: input });
}
async function updatePropertyType(id: string, input: Partial<CreatePropertyTypeInput>) {
  await requireExists('qcPropertyType', id, 'Property type');
  if (input.key) await ensureKeyFree('qcPropertyType', input.key, id);
  return prisma.qcPropertyType.update({ where: { id }, data: input });
}
async function deletePropertyType(id: string) {
  await requireExists('qcPropertyType', id, 'Property type');
  await prisma.qcPropertyType.delete({ where: { id } });
}

// ─── Assignee roster ─────────────────────────────────────────────────────────

/** Every account a defect can be assigned to. */
async function listAssignableUsers() {
  return prisma.user.findMany({
    where: {
      role: { in: ['INSPECTOR', 'FIELD_USER'] },
      isActive: true,
      // Only people who can take defects: Private Inspectors, or legacy accounts with no QC role.
      OR: [{ qcMemberships: { none: {} } }, { qcMemberships: { some: { role: 'PRIVATE_INSPECTOR', status: 'ACTIVE' } } }],
    },
    select: {
      id: true, name: true, email: true, role: true,
      qcMemberships: { where: { status: 'ACTIVE' }, select: { role: true, client: { select: { id: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });
}

// ─── Tasks (field-user facing) ───────────────────────────────────────────────

/** Tasks assigned to this user — the mobile app's "My Tasks" list. */
async function listMyTasks(userId: string) {
  return prisma.qcTask.findMany({
    where: { assignedToId: userId },
    include: taskInclude,
    orderBy: { createdAt: 'desc' },
  });
}

async function getTaskById(id: string, requesterId: string, requesterRole: string) {
  const task = await prisma.qcTask.findUnique({
    where: { id },
    include: { ...taskInclude, updates: { include: { author: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } } },
  });
  if (!task) throw ApiError.notFound('Task not found');
  if (requesterRole !== 'ADMIN' && task.assignedToId !== requesterId) {
    throw ApiError.forbidden('This task is not assigned to you');
  }
  return task;
}

/**
 * Posts a site-visit update. A plain progress note nudges a still-PENDING
 * task to IN_PROGRESS (visiting implies work started); `markCompleted`
 * forces COMPLETED. A task is only the assignee's progress flag: it never
 * moves the defect through its lifecycle -- that happens through the
 * defect's own actions (qc.defects.service.ts), which enforce who may do
 * what.
 */
async function postTaskUpdate(
  taskId: string,
  authorId: string,
  requesterRole: string,
  input: PostTaskUpdateInput,
  photoUrls: string[],
) {
  const task = await prisma.qcTask.findUnique({ where: { id: taskId } });
  if (!task) throw ApiError.notFound('Task not found');
  if (requesterRole !== 'ADMIN' && task.assignedToId !== authorId) {
    throw ApiError.forbidden('This task is not assigned to you');
  }
  if (!input.comment.trim() && photoUrls.length === 0) {
    throw ApiError.badRequest('An update needs a comment or at least one photo');
  }

  const nextStatus = input.markCompleted ? 'COMPLETED' : task.status === 'PENDING' ? 'IN_PROGRESS' : task.status;
  const statusChanged = nextStatus !== task.status;

  return prisma.$transaction(async (tx) => {
    const update = await tx.qcTaskUpdate.create({
      data: {
        taskId,
        authorId,
        comment: input.comment.trim(),
        photoUrls,
        statusAfter: nextStatus,
        statusChanged,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    });
    await tx.qcTask.update({ where: { id: taskId }, data: { status: nextStatus } });

    return update;
  });
}

/**
 * Direct, free status change -- the mobile Tasks list's inline status pill,
 * as opposed to postTaskUpdate's automatic PENDING->IN_PROGRESS/COMPLETED
 * bump. Logs a (comment-less) activity entry so the change shows up in the
 * task's feed. Does not touch the defect's lifecycle status.
 */
async function updateTaskStatus(taskId: string, status: UpdateTaskStatusInput['status'], requesterId: string, requesterRole: string) {
  const task = await prisma.qcTask.findUnique({ where: { id: taskId } });
  if (!task) throw ApiError.notFound('Task not found');
  if (requesterRole !== 'ADMIN' && task.assignedToId !== requesterId) {
    throw ApiError.forbidden('This task is not assigned to you');
  }
  if (status === task.status) {
    return prisma.qcTask.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
  }

  return prisma.$transaction(async (tx) => {
    await tx.qcTaskUpdate.create({
      data: { taskId, authorId: requesterId, comment: '', photoUrls: [], statusAfter: status, statusChanged: true },
    });
    const updated = await tx.qcTask.update({ where: { id: taskId }, data: { status }, include: taskInclude });
    return updated;
  });
}

// ─── Config bundle (one round-trip for mobile/dashboard on load) ────────────

/**
 * Which clients, projects and lots a signed-in person may see in the config bundle (REQ-TEN-001): their own
 * memberships narrowed to the projects they are assigned to, the Super Admin's support-session client only,
 * and, for accounts that predate memberships, just the lots their own defects are on.
 */
async function visibleHierarchy(user: { id: string; role: string }) {
  type ProjectFilter = { clientId: string; projectIds: string[] | 'all' };
  const scopes: ProjectFilter[] = [];
  if (user.role === 'ADMIN') {
    for (const c of await prisma.qcClient.findMany({ select: { id: true } })) scopes.push({ clientId: c.id, projectIds: 'all' });
  } else {
    for (const m of await loadMemberships(user.id)) {
      scopes.push({ clientId: m.clientId, projectIds: m.role === 'CLIENT_ADMIN' || m.projectIds.length === 0 ? 'all' : m.projectIds });
    }
  }
  if (scopes.length > 0) {
    return prisma.qcClient.findMany({
      where: { id: { in: scopes.map((s) => s.clientId) } },
      orderBy: { name: 'asc' },
      include: { projects: { orderBy: { name: 'asc' }, include: { properties: { orderBy: { name: 'asc' }, include: { propertyType: true } } } } },
    }).then((rows) => rows.map((c) => {
      const scope = scopes.find((s) => s.clientId === c.id)!;
      return { ...c, projects: scope.projectIds === 'all' ? c.projects : c.projects.filter((p) => (scope.projectIds as string[]).includes(p.id)) };
    }));
  }
  // Legacy accounts: only the lots where they have a defect assigned.
  const mine = await prisma.qcDefect.findMany({ where: { assignedToId: user.id }, select: { propertyId: true } });
  const propertyIds = [...new Set(mine.map((d) => d.propertyId))];
  if (propertyIds.length === 0) return [];
  return prisma.qcClient.findMany({
    where: { projects: { some: { properties: { some: { id: { in: propertyIds } } } } } },
    orderBy: { name: 'asc' },
    include: { projects: { where: { properties: { some: { id: { in: propertyIds } } } }, orderBy: { name: 'asc' }, include: { properties: { where: { id: { in: propertyIds } }, orderBy: { name: 'asc' }, include: { propertyType: true } } } } },
  });
}

async function getConfig(user: { id: string; role: string }) {
  const clients = await visibleHierarchy(user);
  const clientIds = clients.map((c) => c.id);
  const [propertyTypes, severities, statuses, tradeCategories, tradeCompanies] = await Promise.all([
    listPropertyTypes(),
    prisma.qcSeverity.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
    prisma.qcStatus.findMany({ where: { active: true }, orderBy: { order: 'asc' } }),
    prisma.qcTradeCategory.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    // Names only, and only companies engaged by the contractors of the clients this person can see.
    prisma.qcTradeCompany.findMany({ where: { status: 'ACTIVE', masterContractors: { some: { clientId: { in: clientIds } } } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return { propertyTypes, severities, statuses, tradeCategories, tradeCompanies, clients };
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function ensureKeyFree(model: 'qcPropertyType', key: string, excludeId?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma[model] as any).findUnique({ where: { key } });
  if (existing && existing.id !== excludeId) throw ApiError.conflict(`"${key}" is already in use`, 'KEY_TAKEN');
}

export const qcService = {
  listPropertyTypes,
  createPropertyType,
  updatePropertyType,
  deletePropertyType,
  listAssignableUsers,
  listMyTasks,
  getTaskById,
  postTaskUpdate,
  updateTaskStatus,
  getConfig,
};
