/**
 * Master data from the requirements spec, section 6: clients (E01), master
 * contractors (E02), trade companies (E03), trade categories (E19),
 * projects (E07), sites (E08) and lots (E09). Spec fields are validated by
 * spec/qcSpec.ts and stored in each row's `data` JSON; the handful of
 * identifying/queried fields (name, ABN, status, parent links) are real
 * columns.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { requireExists } from './qc.shared';
import { validateAgainstSpec, validateOrThrow } from './spec/qcSpec';

type Input = Record<string, unknown>;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Strips keys that live in columns, so `data` doesn't duplicate them. */
function without(data: Input, keys: string[]): Input {
  const out = { ...data };
  for (const k of keys) delete out[k];
  return out;
}

// ───────────────────────── Plan limits (E01 plan_and_limits) ─────────────────────────

/** Plan name, maximum users, maximum active projects, storage (GB). A blank or zero limit means unlimited. */
export function planLimits(clientData: Input): { plan: string | null; maxUsers: number | null; maxProjects: number | null; storageGb: number | null } {
  const raw = clientData.plan_and_limits;
  const parts = Array.isArray(raw) ? raw : [];
  const num = (v: unknown) => (Number(v) > 0 ? Number(v) : null);
  return { plan: str(parts[0]) || null, maxUsers: num(parts[1]), maxProjects: num(parts[2]), storageGb: num(parts[3]) };
}

/** Refuse to add a user or project beyond the client's plan, with a message that says what to do. */
export async function assertWithinPlan(clientId: string, kind: 'users' | 'projects'): Promise<void> {
  const client = await prisma.qcClient.findUnique({ where: { id: clientId }, select: { data: true, name: true } });
  if (!client) return;
  const limits = planLimits(client.data as Input);
  if (kind === 'users' && limits.maxUsers) {
    const n = await prisma.qcMembership.count({ where: { clientId, status: 'ACTIVE' } });
    if (n >= limits.maxUsers) throw ApiError.conflict(`${client.name}'s plan allows ${limits.maxUsers} users and all are in use. Deactivate someone or ask the platform administrator to raise the limit.`, 'PLAN_LIMIT');
  }
  if (kind === 'projects' && limits.maxProjects) {
    const n = await prisma.qcProject.count({ where: { clientId, status: { notIn: ['ARCHIVED', 'DLP_COMPLETE'] } } });
    if (n >= limits.maxProjects) throw ApiError.conflict(`${client.name}'s plan allows ${limits.maxProjects} active projects and all are in use. Archive a finished project or ask the platform administrator to raise the limit.`, 'PLAN_LIMIT');
  }
}

// ───────────────────────── Clients (E01) ─────────────────────────

const CLIENT_STATUS = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED'] as const;

async function ensureAbnFree(abn: string, exceptClientId?: string) {
  const clash = await prisma.qcClient.findFirst({
    where: { data: { path: ['abn'], equals: abn }, id: exceptClientId ? { not: exceptClientId } : undefined },
    select: { id: true, name: true },
  });
  if (clash) throw ApiError.conflict(`ABN ${abn} is already used by ${clash.name}`, 'ABN_TAKEN');
}

async function nextClientCode(): Promise<string> {
  const rows = await prisma.qcClient.findMany({ select: { clientCode: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.clientCode?.replace(/\D/g, '') || 0)), 0);
  return `CLI-${String(max + 1).padStart(4, '0')}`;
}

/** The spec field is free text; accept [name, email], "Name <email>", "Name, email" or just an email. */
export function parseFirstAdmin(v: unknown): { name: string; email: string } {
  const parts: string[] = Array.isArray(v) ? v.map((x) => String(x ?? '').trim()) : [String(v ?? '').trim()];
  const joined = parts.join(' ').trim();
  const emailMatch = /[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/.exec(joined);
  const email = (emailMatch?.[0] ?? '').toLowerCase();
  const name = joined.replace(emailMatch?.[0] ?? '', '').replace(/[<>,;]/g, ' ').replace(/\s+/g, ' ').trim() || email.split('@')[0] || '';
  return { name, email };
}

export async function listClients() {
  return prisma.qcClient.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { projects: true, masterContractors: true, memberships: true } } },
  });
}

export async function getClient(id: string) {
  return requireExists('qcClient', id, 'Client');
}

export async function createClient(input: Input) {
  // The first Client Admin is created together with the client (E01); the name/email pair is handled below.
  const data = validateOrThrow('E01', input);
  await ensureAbnFree(str(data.abn));
  const { name: adminName, email: adminEmail } = parseFirstAdmin(data.first_client_admin_name_and_email);
  if (!adminEmail) throw ApiError.badRequest('Enter the first Client Admin as a name and an email address, for example "Jane Smith, jane@example.com"');
  const client = await prisma.qcClient.create({
    data: {
      name: str(data.legal_entity_name),
      clientCode: await nextClientCode(),
      // Becomes Active when the first Client Admin accepts their invitation.
      status: 'PENDING_ACTIVATION',
      data: json(without(data, ['first_client_admin_name_and_email'])),
    },
  });
  return { client, firstAdmin: { name: adminName ?? '', email: adminEmail ?? '' } };
}

export async function updateClient(id: string, input: Input) {
  const existing = await requireExists('qcClient', id, 'Client');
  const merged = { ...(existing.data as Input), ...input };
  const data = validateOrThrow('E01', merged, { skipRequired: ['first_client_admin_name_and_email'] });
  if (data.abn && data.abn !== (existing.data as Input).abn) await ensureAbnFree(str(data.abn), id);
  return prisma.qcClient.update({
    where: { id },
    data: { name: str(data.legal_entity_name) || existing.name, data: json(data) },
  });
}

/** Suspend / reactivate / offboard (REQ-CLT-002). Suspension needs a reason. */
export async function setClientStatus(id: string, status: string, reason?: string) {
  if (!(CLIENT_STATUS as readonly string[]).includes(status)) throw ApiError.badRequest('Unknown client status');
  if (status === 'SUSPENDED' && !reason?.trim()) throw ApiError.badRequest('A suspension reason is required');
  const existing = await requireExists('qcClient', id, 'Client');
  const data = { ...(existing.data as Input) };
  if (status === 'SUSPENDED') data.suspension_reason = reason!.trim();
  else delete data.suspension_reason;
  return prisma.qcClient.update({ where: { id }, data: { status, data: json(data) } });
}

export async function deleteClient(id: string) {
  await requireExists('qcClient', id, 'Client');
  const projects = await prisma.qcProject.count({ where: { clientId: id } });
  if (projects > 0) throw ApiError.conflict('This client still has projects; offboard it instead of deleting', 'HAS_DEPENDENTS');
  await prisma.qcClient.delete({ where: { id } });
}

// ───────────────────────── Master contractors (E02) ─────────────────────────

export async function listMasterContractors(clientId?: string) {
  return prisma.qcMasterContractor.findMany({ where: { clientId }, orderBy: { name: 'asc' }, include: { client: { select: { id: true, name: true } } } });
}

/** E02's computed "Insurance status": the worst of the three policies' expiries. */
export function insuranceStatus(data: Input): 'Current' | 'Expiring within 30 days' | 'Expired' {
  const now = Date.now();
  let worst: 'Current' | 'Expiring within 30 days' | 'Expired' = 'Current';
  for (const k of ['public_liability_expiry', 'workers_compensation_expiry', 'contract_works_insurance_expiry']) {
    const v = data[k];
    if (typeof v !== 'string') continue;
    const days = (new Date(v).getTime() - now) / 86_400_000;
    if (days < 0) return 'Expired';
    if (days <= 30) worst = 'Expiring within 30 days';
  }
  return worst;
}

export async function createMasterContractor(input: Input) {
  const clientId = str(input.clientId);
  await requireExists('qcClient', clientId, 'Client');
  const data = validateOrThrow('E02', without(input, ['clientId']));
  return prisma.qcMasterContractor.create({
    data: { clientId, name: str(data.legal_entity_name), abn: str(data.abn), status: 'ACTIVE', data: json(data) },
  });
}

export async function updateMasterContractor(id: string, input: Input) {
  const existing = await requireExists('qcMasterContractor', id, 'Master contractor');
  const data = validateOrThrow('E02', { ...(existing.data as Input), ...without(input, ['clientId', 'status']) });
  return prisma.qcMasterContractor.update({
    where: { id },
    data: { name: str(data.legal_entity_name), abn: str(data.abn), status: typeof input.status === 'string' ? input.status : existing.status, data: json(data) },
  });
}

export async function deleteMasterContractor(id: string) {
  await requireExists('qcMasterContractor', id, 'Master contractor');
  const used = await prisma.qcProject.count({ where: { builderId: id } });
  if (used > 0) throw ApiError.conflict('This contractor is the builder on a project; mark it inactive instead', 'HAS_DEPENDENTS');
  await prisma.qcMasterContractor.delete({ where: { id } });
}

// ───────────────────────── Trade categories (E19) ─────────────────────────

export async function listTradeCategories() {
  return prisma.qcTradeCategory.findMany({ orderBy: { name: 'asc' } });
}

export async function createTradeCategory(input: Input) {
  const data = validateOrThrow('E19', input);
  const code = str(data.code).toUpperCase();
  if (await prisma.qcTradeCategory.findUnique({ where: { code } })) throw ApiError.conflict(`Code ${code} is already used`, 'KEY_TAKEN');
  return prisma.qcTradeCategory.create({
    data: {
      name: str(data.category_name),
      code,
      licenceRequired: data.licence_required === true,
      licenceHint: str(data.licensing_authority_hint) || null,
      active: data.active !== false,
    },
  });
}

export async function updateTradeCategory(id: string, input: Input) {
  await requireExists('qcTradeCategory', id, 'Trade category');
  const { data, issues } = validateAgainstSpec('E19', input, { partial: true });
  if (issues.length) throw ApiError.badRequest(issues.map((i) => i.message).join('; '));
  return prisma.qcTradeCategory.update({
    where: { id },
    data: {
      name: data.category_name as string | undefined,
      code: typeof data.code === 'string' ? data.code.toUpperCase() : undefined,
      licenceRequired: data.licence_required as boolean | undefined,
      licenceHint: data.licensing_authority_hint as string | undefined,
      active: data.active as boolean | undefined,
    },
  });
}

/** In-use categories are retired, never deleted. */
export async function deleteTradeCategory(id: string) {
  await requireExists('qcTradeCategory', id, 'Trade category');
  const used = (await prisma.qcDefect.count({ where: { tradeCategoryId: id } })) + (await prisma.qcTradeCompany.count({ where: { categories: { some: { id } } } }));
  if (used > 0) {
    await prisma.qcTradeCategory.update({ where: { id }, data: { active: false } });
    return { retired: true };
  }
  await prisma.qcTradeCategory.delete({ where: { id } });
  return { retired: false };
}

// ───────────────────────── Trade companies (E03) ─────────────────────────

const tradeInclude = {
  categories: { select: { id: true, name: true, code: true } },
  masterContractors: { select: { id: true, name: true } },
} as const;

/** `clientId` limits the list to companies engaged by that client's contractors. */
export async function listTradeCompanies(clientId?: string) {
  return prisma.qcTradeCompany.findMany({
    where: clientId ? { masterContractors: { some: { clientId } } } : undefined,
    orderBy: { name: 'asc' },
    include: tradeInclude,
  });
}

async function tradeRelations(data: Input) {
  const categoryIds = (data.trade_categories as string[] | undefined) ?? [];
  const mcIds = (data.engaged_by as string[] | undefined) ?? [];
  for (const id of categoryIds) await requireExists('qcTradeCategory', id, 'Trade category');
  for (const id of mcIds) await requireExists('qcMasterContractor', id, 'Master contractor');
  return { categoryIds, mcIds };
}

export async function createTradeCompany(input: Input) {
  const data = validateOrThrow('E03', input);
  const { categoryIds, mcIds } = await tradeRelations(data);
  return prisma.qcTradeCompany.create({
    data: {
      name: str(data.legal_entity_name),
      abn: str(data.abn),
      status: 'ACTIVE',
      data: json(without(data, ['trade_categories', 'engaged_by'])),
      categories: { connect: categoryIds.map((id) => ({ id })) },
      masterContractors: { connect: mcIds.map((id) => ({ id })) },
    },
    include: tradeInclude,
  });
}

export async function updateTradeCompany(id: string, input: Input) {
  const existing = await prisma.qcTradeCompany.findUnique({ where: { id }, include: tradeInclude });
  if (!existing) throw ApiError.notFound('Trade company not found');
  const base: Input = {
    ...(existing.data as Input),
    trade_categories: existing.categories.map((c) => c.id),
    engaged_by: existing.masterContractors.map((m) => m.id),
  };
  const data = validateOrThrow('E03', { ...base, ...without(input, ['status']) });
  const { categoryIds, mcIds } = await tradeRelations(data);
  return prisma.qcTradeCompany.update({
    where: { id },
    data: {
      name: str(data.legal_entity_name),
      abn: str(data.abn),
      status: typeof input.status === 'string' ? input.status : existing.status,
      data: json(without(data, ['trade_categories', 'engaged_by'])),
      categories: { set: categoryIds.map((cid) => ({ id: cid })) },
      masterContractors: { set: mcIds.map((mid) => ({ id: mid })) },
    },
    include: tradeInclude,
  });
}

export async function deleteTradeCompany(id: string) {
  await requireExists('qcTradeCompany', id, 'Trade company');
  const used = await prisma.qcDefect.count({ where: { allocatedTradeCompanyId: id } });
  if (used > 0) throw ApiError.conflict('Defects are allocated to this company; mark it inactive instead', 'HAS_DEPENDENTS');
  await prisma.qcTradeCompany.delete({ where: { id } });
}

// ───────────────────────── Projects (E07) ─────────────────────────

const CLOSURE_POLICIES = ['DEVELOPER_SIGNOFF', 'AUTO_CLOSE', 'INSPECTOR_CLOSE'];
/** The E07 status select, stored as these codes. */
const PROJECT_STATUS = ['SETUP', 'CONSTRUCTION', 'PRACTICAL_COMPLETION', 'DLP', 'DLP_COMPLETE', 'ARCHIVED'];

const projectInclude = {
  client: { select: { id: true, name: true } },
  builder: { select: { id: true, name: true } },
  _count: { select: { sites: true, properties: true } },
} as const;

/** `where` carries the caller's tenant and project scope (see projectScope in qc.context). */
export async function listProjects(where: Prisma.QcProjectWhereInput = {}) {
  return prisma.qcProject.findMany({ where, orderBy: { name: 'asc' }, include: projectInclude });
}

export async function getProject(id: string) {
  const project = await prisma.qcProject.findUnique({
    where: { id },
    include: { ...projectInclude, sites: { orderBy: { name: 'asc' } }, team: { orderBy: { createdAt: 'asc' } } },
  });
  if (!project) throw ApiError.notFound('Project not found');
  return project;
}

/** Policy switches the lifecycle engine reads; they are not spec fields but project-level settings (REQ-PRJ-005). */
type PolicyColumns = { closurePolicy?: string; deskReviewAllowed?: boolean; safetyAutoRelease?: boolean; status?: string };

function policyColumns(input: Input): PolicyColumns {
  const cols: PolicyColumns = {};
  if (input.closurePolicy !== undefined) {
    if (!CLOSURE_POLICIES.includes(str(input.closurePolicy))) throw ApiError.badRequest('Unknown closure policy');
    cols.closurePolicy = str(input.closurePolicy);
  }
  if (typeof input.deskReviewAllowed === 'boolean') cols.deskReviewAllowed = input.deskReviewAllowed;
  if (typeof input.safetyAutoRelease === 'boolean') cols.safetyAutoRelease = input.safetyAutoRelease;
  if (typeof input.status === 'string') {
    if (!PROJECT_STATUS.includes(input.status)) throw ApiError.badRequest('Unknown project status');
    cols.status = input.status;
  }
  return cols;
}

async function projectRefs(data: Input) {
  const clientId = str(data.developer);
  await requireExists('qcClient', clientId, 'Developer (client)');
  const builderId = str(data.builder);
  const builder = await requireExists('qcMasterContractor', builderId, 'Builder');
  if (builder.clientId !== clientId) throw ApiError.badRequest("The builder must belong to the developer's client");
  return { clientId, builderId };
}

async function nextProjectRef(): Promise<string> {
  const rows = await prisma.qcProject.findMany({ select: { projectRef: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(r.projectRef?.replace(/\D/g, '') || 0)), 0);
  return `PRJ-${String(max + 1).padStart(4, '0')}`;
}

export async function createProject(input: Input) {
  const data = validateOrThrow('E07', input);
  const { clientId, builderId } = await projectRefs(data);
  await assertWithinPlan(clientId, 'projects');
  const clash = await prisma.qcProject.findFirst({ where: { clientId, jobNumber: str(data.job_number) } });
  if (clash) throw ApiError.conflict(`Job number ${data.job_number} is already used by ${clash.name}`, 'JOB_NUMBER_TAKEN');
  return prisma.qcProject.create({
    data: {
      name: str(data.project_name),
      clientId,
      builderId,
      jobNumber: str(data.job_number),
      projectRef: await nextProjectRef(),
      state: str(data.state_or_territory),
      data: json(without(data, ['developer', 'builder'])),
      ...policyColumns(input),
    },
    include: projectInclude,
  });
}

export async function updateProject(id: string, input: Input) {
  const existing = await requireExists('qcProject', id, 'Project');
  if (existing.status === 'ARCHIVED') throw ApiError.conflict('This project is archived and read-only. Reopen it to make changes.', 'PROJECT_ARCHIVED');
  const base: Input = { ...(existing.data as Input), developer: existing.clientId, builder: existing.builderId };
  const specInput = without(input, ['closurePolicy', 'deskReviewAllowed', 'safetyAutoRelease', 'status']);
  const data = validateOrThrow('E07', { ...base, ...specInput });
  const { clientId, builderId } = await projectRefs(data);
  if (str(data.job_number) !== existing.jobNumber) {
    const clash = await prisma.qcProject.findFirst({ where: { clientId, jobNumber: str(data.job_number), id: { not: id } } });
    if (clash) throw ApiError.conflict(`Job number ${data.job_number} is already used by ${clash.name}`, 'JOB_NUMBER_TAKEN');
  }
  return prisma.qcProject.update({
    where: { id },
    data: {
      name: str(data.project_name),
      clientId,
      builderId,
      jobNumber: str(data.job_number),
      state: str(data.state_or_territory),
      data: json(without(data, ['developer', 'builder'])),
      ...policyColumns(input),
    },
    include: projectInclude,
  });
}

export async function deleteProject(id: string) {
  await requireExists('qcProject', id, 'Project');
  const defects = await prisma.qcDefect.count({ where: { property: { projectId: id } } });
  if (defects > 0) throw ApiError.conflict('This project has defects; archive it instead of deleting', 'HAS_DEPENDENTS');
  await prisma.qcProject.delete({ where: { id } });
}

// ───────────────────────── Sites (E08) ─────────────────────────

export async function listSites(projectId?: string, projectWhere?: Prisma.QcProjectWhereInput) {
  return prisma.qcSite.findMany({
    where: { projectId, project: projectWhere },
    orderBy: { name: 'asc' },
    include: { project: { select: { id: true, name: true } }, _count: { select: { lots: true } } },
  });
}

/** An archived project is a closed record: nothing under it changes until it is reopened (REQ-PRJ-006). */
export async function assertProjectOpen(projectId: string): Promise<void> {
  const p = await prisma.qcProject.findUnique({ where: { id: projectId }, select: { status: true } });
  if (p?.status === 'ARCHIVED') throw ApiError.conflict('This project is archived and read-only. Reopen it to make changes.', 'PROJECT_ARCHIVED');
}

export async function createSite(input: Input) {
  const projectId = str(input.projectId);
  await requireExists('qcProject', projectId, 'Project');
  await assertProjectOpen(projectId);
  const data = validateOrThrow('E08', without(input, ['projectId']));
  return prisma.qcSite.create({ data: { projectId, name: str(data.site_name), data: json(data) } });
}

export async function updateSite(id: string, input: Input) {
  const existing = await requireExists('qcSite', id, 'Site');
  await assertProjectOpen(existing.projectId);
  const data = validateOrThrow('E08', { ...(existing.data as Input), ...without(input, ['projectId', 'status']) });
  return prisma.qcSite.update({
    where: { id },
    data: { name: str(data.site_name), status: typeof input.status === 'string' ? input.status : existing.status, data: json(data) },
  });
}

export async function deleteSite(id: string) {
  await requireExists('qcSite', id, 'Site');
  const lots = await prisma.qcProperty.count({ where: { siteId: id } });
  if (lots > 0) throw ApiError.conflict('This site still has lots; archive it instead', 'HAS_DEPENDENTS');
  await prisma.qcSite.delete({ where: { id } });
}

// ───────────────────────── Lots (E09, stored as QcProperty) ─────────────────────────

const DWELLING_TO_PROPERTY_TYPE: Record<string, string> = {
  'Detached house': 'house',
  Townhouse: 'townhouse',
  'Duplex or dual occupancy': 'duplex',
  Apartment: 'apartment',
  Other: 'house',
};

const lotInclude = {
  propertyType: true,
  site: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, clientId: true } },
} as const;

export async function listLots(filters: { projectId?: string; siteId?: string }, projectWhere?: Prisma.QcProjectWhereInput) {
  return prisma.qcProperty.findMany({ where: { ...filters, project: projectWhere }, orderBy: { name: 'asc' }, include: lotInclude });
}

async function lotColumns(data: Input) {
  const typeKey = DWELLING_TO_PROPERTY_TYPE[str(data.dwelling_type)] ?? 'house';
  const propertyType = await prisma.qcPropertyType.findUnique({ where: { key: typeKey } });
  if (!propertyType) throw ApiError.badRequest(`Property type "${typeKey}" is missing; run the QC seed`);
  return { name: str(data.lot_reference), propertyTypeId: propertyType.id, lotStatus: str(data.lot_status) || undefined };
}

/** Fields a bulk import may leave blank to be completed later (the lot is flagged until they are). */
export const LOT_IMPORT_OPTIONAL = ['street_address', 'ncc_building_class', 'storeys', 'floor_system', 'frame', 'floor_area', 'plan_type_and_number', 'wall_cladding', 'roof_cover'];

export async function createLot(input: Input, opts: { lenient?: boolean } = {}) {
  const siteId = str(input.siteId);
  const site = await requireExists('qcSite', siteId, 'Site');
  await assertProjectOpen(site.projectId);
  const data = validateOrThrow('E09', without(input, ['siteId']), opts.lenient ? { skipRequired: LOT_IMPORT_OPTIONAL } : {});
  const clash = await prisma.qcProperty.findFirst({ where: { siteId, name: str(data.lot_reference) } });
  if (clash) throw ApiError.conflict(`Lot reference ${data.lot_reference} already exists on this site`, 'LOT_TAKEN');
  return prisma.qcProperty.create({
    data: { projectId: site.projectId, siteId, ...(await lotColumns(data)), data: json(data) },
    include: lotInclude,
  });
}

export async function updateLot(id: string, input: Input, opts: { lenient?: boolean } = {}) {
  const existing = await requireExists('qcProperty', id, 'Lot');
  await assertProjectOpen(existing.projectId);
  const data = validateOrThrow('E09', { ...(existing.data as Input), ...without(input, ['siteId']) }, opts.lenient ? { skipRequired: LOT_IMPORT_OPTIONAL } : {});
  if (str(data.lot_reference) !== existing.name && existing.siteId) {
    const clash = await prisma.qcProperty.findFirst({ where: { siteId: existing.siteId, name: str(data.lot_reference), id: { not: id } } });
    if (clash) throw ApiError.conflict(`Lot reference ${data.lot_reference} already exists on this site`, 'LOT_TAKEN');
  }
  return prisma.qcProperty.update({ where: { id }, data: { ...(await lotColumns(data)), data: json(data) }, include: lotInclude });
}

export async function deleteLot(id: string) {
  await requireExists('qcProperty', id, 'Lot');
  const defects = await prisma.qcDefect.count({ where: { propertyId: id } });
  if (defects > 0) throw ApiError.conflict('This lot has defects and cannot be deleted', 'HAS_DEPENDENTS');
  await prisma.qcProperty.delete({ where: { id } });
}
