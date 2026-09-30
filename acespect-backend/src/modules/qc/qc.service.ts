import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { hashPassword } from '../../utils/password';
import {
  CreateClientInput,
  CreateDefectInput,
  CreateFieldUserInput,
  CreatePropertyInput,
  CreatePropertyTypeInput,
  CreateProjectInput,
  CreateSeverityInput,
  CreateStatusInput,
  PostTaskUpdateInput,
  SEVERITY_KEY_TO_PRIORITY,
  UpdateDefectInput,
} from './qc.schemas';

/** The QcStatus.key a defect moves to when its task is marked Completed — see the shared Defect Lifecycle Workflow doc. */
const PENDING_REINSPECTION_KEY = 'pending_re_inspection';

// ─── Config: Clients / Projects / Properties / Property Types ──────────────

async function listClients() {
  return prisma.qcClient.findMany({ orderBy: { name: 'asc' } });
}
async function createClient(input: CreateClientInput) {
  return prisma.qcClient.create({ data: input });
}
async function updateClient(id: string, input: Partial<CreateClientInput>) {
  await requireExists('qcClient', id, 'Client');
  return prisma.qcClient.update({ where: { id }, data: input });
}
async function deleteClient(id: string) {
  await requireExists('qcClient', id, 'Client');
  await prisma.qcClient.delete({ where: { id } });
}

async function listProjects(clientId?: string) {
  return prisma.qcProject.findMany({ where: clientId ? { clientId } : undefined, orderBy: { name: 'asc' } });
}
async function createProject(input: CreateProjectInput) {
  await requireExists('qcClient', input.clientId, 'Client');
  return prisma.qcProject.create({ data: input });
}
async function updateProject(id: string, input: { name?: string }) {
  await requireExists('qcProject', id, 'Project');
  return prisma.qcProject.update({ where: { id }, data: input });
}
async function deleteProject(id: string) {
  await requireExists('qcProject', id, 'Project');
  await prisma.qcProject.delete({ where: { id } });
}

async function listProperties(projectId?: string) {
  return prisma.qcProperty.findMany({
    where: projectId ? { projectId } : undefined,
    include: { propertyType: true },
    orderBy: { name: 'asc' },
  });
}
async function createProperty(input: CreatePropertyInput) {
  await requireExists('qcProject', input.projectId, 'Project');
  await requireExists('qcPropertyType', input.propertyTypeId, 'Property type');
  return prisma.qcProperty.create({ data: input });
}
async function updateProperty(id: string, input: { name?: string; propertyTypeId?: string }) {
  await requireExists('qcProperty', id, 'Property');
  if (input.propertyTypeId) await requireExists('qcPropertyType', input.propertyTypeId, 'Property type');
  return prisma.qcProperty.update({ where: { id }, data: input });
}
async function deleteProperty(id: string) {
  await requireExists('qcProperty', id, 'Property');
  await prisma.qcProperty.delete({ where: { id } });
}

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

// ─── Config: Severities / Statuses ──────────────────────────────────────────

async function listSeverities() {
  return prisma.qcSeverity.findMany({ orderBy: { order: 'asc' } });
}
async function createSeverity(input: CreateSeverityInput) {
  await ensureKeyFree('qcSeverity', input.key);
  return prisma.qcSeverity.create({ data: input });
}
async function updateSeverity(id: string, input: Partial<CreateSeverityInput>) {
  await requireExists('qcSeverity', id, 'Severity');
  if (input.key) await ensureKeyFree('qcSeverity', input.key, id);
  return prisma.qcSeverity.update({ where: { id }, data: input });
}
async function deleteSeverity(id: string) {
  await requireExists('qcSeverity', id, 'Severity');
  await prisma.qcSeverity.delete({ where: { id } });
}

async function listStatuses() {
  return prisma.qcStatus.findMany({ orderBy: { order: 'asc' } });
}
async function createStatus(input: CreateStatusInput) {
  await ensureKeyFree('qcStatus', input.key);
  return prisma.qcStatus.create({ data: input });
}
async function updateStatus(id: string, input: Partial<CreateStatusInput>) {
  await requireExists('qcStatus', id, 'Status');
  if (input.key) await ensureKeyFree('qcStatus', input.key, id);
  return prisma.qcStatus.update({ where: { id }, data: input });
}
async function deleteStatus(id: string) {
  await requireExists('qcStatus', id, 'Status');
  await prisma.qcStatus.delete({ where: { id } });
}

// ─── Assignee roster ─────────────────────────────────────────────────────────

/** Every account that can be assigned QC work — existing INSPECTOR accounts plus dedicated FIELD_USER ones. */
async function listAssignableUsers() {
  return prisma.user.findMany({
    where: { role: { in: ['INSPECTOR', 'FIELD_USER'] }, isActive: true },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });
}

async function createFieldUser(input: CreateFieldUserInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  const user = await prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password),
      role: 'FIELD_USER',
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  return user;
}

// ─── Defects ────────────────────────────────────────────────────────────────

const defectInclude = {
  property: { include: { project: { include: { client: true } }, propertyType: true } },
  severity: true,
  status: true,
  assignedTo: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

async function getDefaultOpenStatus() {
  const status = await prisma.qcStatus.findFirst({ orderBy: { order: 'asc' } });
  if (!status) throw ApiError.badRequest('No QC statuses configured yet — an admin must configure them first');
  return status;
}

async function createDefect(createdById: string, input: CreateDefectInput) {
  await requireExists('qcProperty', input.propertyId, 'Property');
  const severity = await requireExists('qcSeverity', input.severityId, 'Severity');
  await requireExists('user', input.assignedToId, 'Assignee');
  const openStatus = await getDefaultOpenStatus();

  const priority = SEVERITY_KEY_TO_PRIORITY[severity.key] ?? 'LOW';

  return prisma.$transaction(async (tx) => {
    const defect = await tx.qcDefect.create({
      data: {
        propertyId: input.propertyId,
        location: input.location,
        locationDetails: input.locationDetails,
        summary: input.summary,
        severityId: input.severityId,
        statusId: openStatus.id,
        assignedToId: input.assignedToId,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        createdById,
      },
      include: defectInclude,
    });
    await tx.qcTask.create({
      data: {
        defectId: defect.id,
        assignedToId: input.assignedToId,
        priority,
        dueDate: defect.dueDate,
      },
    });
    return defect;
  });
}

async function updateDefect(id: string, input: UpdateDefectInput) {
  const defect = await requireExists('qcDefect', id, 'Defect');
  if (input.severityId) await requireExists('qcSeverity', input.severityId, 'Severity');
  if (input.statusId) await requireExists('qcStatus', input.statusId, 'Status');
  if (input.assignedToId) await requireExists('user', input.assignedToId, 'Assignee');

  return prisma.$transaction(async (tx) => {
    const updated = await tx.qcDefect.update({
      where: { id },
      data: {
        location: input.location,
        locationDetails: input.locationDetails,
        summary: input.summary,
        severityId: input.severityId,
        statusId: input.statusId,
        assignedToId: input.assignedToId === undefined ? undefined : input.assignedToId,
        dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
      },
      include: defectInclude,
    });
    // Reassigning the defect reassigns its task(s) too — v1 keeps one task per defect.
    if (input.assignedToId && input.assignedToId !== defect.assignedToId) {
      await tx.qcTask.updateMany({ where: { defectId: id }, data: { assignedToId: input.assignedToId } });
    }
    return updated;
  });
}

async function listDefects(filters: { propertyId?: string; statusId?: string; assignedToId?: string }) {
  return prisma.qcDefect.findMany({
    where: {
      propertyId: filters.propertyId,
      statusId: filters.statusId,
      assignedToId: filters.assignedToId,
    },
    include: defectInclude,
    orderBy: { createdAt: 'desc' },
  });
}

async function getDefectById(id: string) {
  const defect = await prisma.qcDefect.findUnique({ where: { id }, include: defectInclude });
  if (!defect) throw ApiError.notFound('Defect not found');
  return defect;
}

// ─── Tasks (field-user facing) ───────────────────────────────────────────────

const taskInclude = {
  defect: { include: defectInclude },
  assignedTo: { select: { id: true, name: true, email: true } },
} as const;

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
 * forces COMPLETED and advances the linked defect to "Pending Re-inspection"
 * — same cascade the mobile prototype's QcDataContext.addTaskUpdate did
 * client-side, now authoritative here.
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

    if (input.markCompleted) {
      const reinspection = await tx.qcStatus.findUnique({ where: { key: PENDING_REINSPECTION_KEY } });
      if (reinspection) {
        await tx.qcDefect.update({ where: { id: task.defectId }, data: { statusId: reinspection.id } });
      }
    }
    return update;
  });
}

// ─── Config bundle (one round-trip for mobile/dashboard on load) ────────────

async function getConfig() {
  const [propertyTypes, severities, statuses, clients] = await Promise.all([
    listPropertyTypes(),
    listSeverities(),
    listStatuses(),
    prisma.qcClient.findMany({
      orderBy: { name: 'asc' },
      include: {
        projects: {
          orderBy: { name: 'asc' },
          include: { properties: { orderBy: { name: 'asc' }, include: { propertyType: true } } },
        },
      },
    }),
  ]);
  return { propertyTypes, severities, statuses, clients };
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

/** Fetches a row by id or throws 404 with a friendly label — used to validate every FK before writing. */
async function requireExists<T extends 'qcClient' | 'qcProject' | 'qcProperty' | 'qcPropertyType' | 'qcSeverity' | 'qcStatus' | 'qcDefect' | 'user'>(
  model: T,
  id: string,
  label: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma[model] as any).findUnique({ where: { id } });
  if (!row) throw ApiError.notFound(`${label} not found`);
  return row;
}

async function ensureKeyFree(model: 'qcPropertyType' | 'qcSeverity' | 'qcStatus', key: string, excludeId?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (prisma[model] as any).findUnique({ where: { key } });
  if (existing && existing.id !== excludeId) throw ApiError.conflict(`"${key}" is already in use`, 'KEY_TAKEN');
}

export const qcService = {
  listClients,
  createClient,
  updateClient,
  deleteClient,
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  listProperties,
  createProperty,
  updateProperty,
  deleteProperty,
  listPropertyTypes,
  createPropertyType,
  updatePropertyType,
  deletePropertyType,
  listSeverities,
  createSeverity,
  updateSeverity,
  deleteSeverity,
  listStatuses,
  createStatus,
  updateStatus,
  deleteStatus,
  listAssignableUsers,
  createFieldUser,
  createDefect,
  updateDefect,
  listDefects,
  getDefectById,
  listMyTasks,
  getTaskById,
  postTaskUpdate,
  getConfig,
};
