/**
 * Stage inspections (E21, E22, forms F09-F15): request, plan and assign,
 * reschedule or cancel, start, record item results, raise defects from
 * results, complete and sign, and addenda after lock.
 *
 * Lifecycle: REQUESTED -> PLANNED -> IN_PROGRESS -> COMPLETED, with CANCELLED
 * before the start. A completed inspection is locked: only an addendum may be
 * added. Item text is snapshotted into each result row at start, so a later
 * template version never alters it.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../lib/audit';
import { validateOrThrow } from './spec/qcSpec';
import { QcContext } from './qc.context';
import { can } from './qc.permissions';
import { notify } from './qc.notify';
import { createDefect, performAction } from './qc.defects.service';
import { checkTolerance, listResultCodes } from './qc.templates.service';
import { floorAllowed, getPlan, stageApplies } from './qc.projects.service';
import { listStages } from './qc.templates.service';
import { signMediaUrl } from '../../lib/mediaLinks';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const actor = (ctx: QcContext) => ({ id: ctx.userId, role: ctx.role });
const DEFECT_CODES = ['Minor Defect', 'Major Defect', 'Safety Hazard', 'Monitor / Serviceability'];
const SEVERITY_LABEL_OF: Record<string, string> = { 'Minor Defect': 'Minor Defect', 'Major Defect': 'Major Defect', 'Safety Hazard': 'Safety Hazard', 'Monitor / Serviceability': 'Monitor / Serviceability' };

export const INSPECTION_TYPES = ['Planned stage inspection', 'Ad-hoc visit', 'Re-inspection', 'DLP inspection', 'Combined stage visit'];

const include = { results: { orderBy: { itemNumber: 'asc' as const } } } satisfies Prisma.QcInspectionInclude;
type InspectionRow = Prisma.QcInspectionGetPayload<{ include: typeof include }>;

// ───────────────────────── Visibility ─────────────────────────

/** What inspections a role may list (REQ-AUT-004): inspectors their own, others their client's and projects'. */
export function inspectionScope(ctx: QcContext): Prisma.QcInspectionWhereInput {
  if (!ctx.clientId) {
    if (ctx.legacy) return { inspectorId: ctx.userId };
    throw new ApiError(409, 'Choose a client first', 'CLIENT_REQUIRED');
  }
  const where: Prisma.QcInspectionWhereInput = { clientId: ctx.clientId };
  if (ctx.projectIds !== 'all') where.projectId = { in: ctx.projectIds };
  if (ctx.role === 'PRIVATE_INSPECTOR') where.inspectorId = ctx.userId;
  // The Builder and the Client see requested and planned inspections and completed reports; work in progress stays with the inspector.
  if (ctx.role.startsWith('MC_')) where.status = { in: ['REQUESTED', 'PLANNED', 'COMPLETED', 'CANCELLED'] };
  return where;
}

async function load(ctx: QcContext, id: string): Promise<InspectionRow> {
  const row = await prisma.qcInspection.findFirst({ where: { AND: [{ id }, inspectionScope(ctx)] }, include });
  if (!row) throw ApiError.notFound('Inspection not found');
  return row;
}

async function nextRef(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ n: number | null }>>`SELECT MAX(CAST(SUBSTRING(ref FROM 5) AS INTEGER)) AS n FROM qc_inspections`;
  return `INS-${String((rows[0]?.n ?? 0) + 1).padStart(5, '0')}`;
}

// ───────────────────────── Serialisation ─────────────────────────

const countsOf = (results: Array<{ resultCode: string | null }>) => {
  const c: Record<string, number> = { OK: 0, 'Minor Defect': 0, 'Major Defect': 0, 'Safety Hazard': 0, 'Monitor / Serviceability': 0, 'N/A': 0, 'Not Inspected': 0, Unanswered: 0 };
  for (const r of results) c[r.resultCode ?? 'Unanswered'] = (c[r.resultCode ?? 'Unanswered'] ?? 0) + 1;
  return c;
};

export function serializeInspection(i: InspectionRow | (Omit<InspectionRow, 'results'> & { results?: InspectionRow['results'] })) {
  const results = i.results ?? [];
  return {
    id: i.id, ref: i.ref, clientId: i.clientId, projectId: i.projectId, siteId: i.siteId, propertyId: i.propertyId, stageKey: i.stageKey, templateId: i.templateId,
    type: i.type, status: i.status, inspectorId: i.inspectorId, plannedFrom: i.plannedFrom, plannedTo: i.plannedTo, startedAt: i.startedAt, finishedAt: i.finishedAt,
    signedAt: i.signedAt, signedById: i.signedById, locked: i.locked, holdPoint: i.holdPoint, requestedAt: i.requestedAt, requestedById: i.requestedById,
    request: i.requestData, header: i.headerData, summary: i.summaryData, data: i.data, createdAt: i.createdAt, updatedAt: i.updatedAt,
    counts: i.results ? countsOf(results) : undefined,
    results: i.results ? results.map(serializeResult) : undefined,
  };
}

export function serializeResult(r: InspectionRow['results'][number]) {
  const photos = ((r.photoUrls as string[]) ?? []).map((u) => signMediaUrl(u));
  return {
    id: r.id, itemNumber: r.itemNumber, item: r.itemSnapshot, resultCode: r.resultCode, comments: r.comments, locationDetail: r.locationDetail, measurement: r.measurement,
    photoUrls: photos, reason: r.reason, defectIds: r.defectIds, carriedFromId: r.carriedFromId, previousValues: r.previousValues, answeredById: r.answeredById, answeredAt: r.answeredAt, updatedAt: r.updatedAt,
  };
}

/** List with the lot, site, project and inspector names a table needs. */
export async function listInspections(ctx: QcContext, filters: { projectId?: string; propertyId?: string; status?: string; stageKey?: string; inspectorId?: string; mine?: boolean; from?: string; to?: string }) {
  const where: Prisma.QcInspectionWhereInput = {
    AND: [
      inspectionScope(ctx),
      {
        projectId: filters.projectId, propertyId: filters.propertyId, status: filters.status, stageKey: filters.stageKey,
        inspectorId: filters.mine ? ctx.userId : filters.inspectorId,
        plannedFrom: { gte: filters.from ? new Date(filters.from) : undefined, lte: filters.to ? new Date(`${filters.to}T23:59:59Z`) : undefined },
      },
    ],
  };
  const rows = await prisma.qcInspection.findMany({ where, orderBy: [{ plannedFrom: 'asc' }, { createdAt: 'desc' }], take: 500 });
  return enrich(rows);
}

async function enrich(rows: Array<Omit<InspectionRow, 'results'> & { results?: InspectionRow['results'] }>) {
  const lotIds = [...new Set(rows.map((r) => r.propertyId).filter((x): x is string => !!x))];
  const projIds = [...new Set(rows.map((r) => r.projectId))];
  const userIds = [...new Set(rows.map((r) => r.inspectorId).filter((x): x is string => !!x))];
  const [lots, projects, users, stages] = await Promise.all([
    prisma.qcProperty.findMany({ where: { id: { in: lotIds } }, select: { id: true, name: true, site: { select: { id: true, name: true } } } }),
    prisma.qcProject.findMany({ where: { id: { in: projIds } }, select: { id: true, name: true, jobNumber: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    listStages(),
  ]);
  return rows.map((r) => ({
    ...serializeInspection(r),
    lot: lots.find((l) => l.id === r.propertyId) ?? null,
    project: projects.find((p) => p.id === r.projectId) ?? null,
    inspector: users.find((u) => u.id === r.inspectorId) ?? null,
    stage: ((stages as unknown as Array<{ id: string; stage_name: string; stage_number: string }>).find((s) => s.id === r.stageKey)) ?? null,
  }));
}

export async function getInspection(ctx: QcContext, id: string) {
  const row = await load(ctx, id);
  const [one] = await enrich([row]);
  const defects = await prisma.qcDefect.findMany({
    where: { sourceInspectionId: id },
    select: { id: true, defectRef: true, title: true, isDraft: true, sourceItemNumber: true, severity: { select: { label: true, key: true } }, status: { select: { label: true, key: true } } },
  });
  const template = row.templateId ? await prisma.qcTemplate.findUnique({ where: { id: row.templateId }, select: { id: true, name: true, code: true, version: true, data: true } }) : null;
  const addenda = ((row.summaryData as Record<string, unknown>).addenda as Array<Record<string, unknown>> | undefined) ?? [];
  return { inspection: one, defects, template, addenda, resultCodes: await listResultCodes(ctx.clientId) };
}

// ───────────────────────── Hold points ─────────────────────────

/** A hold point after a stage blocks the next stage on that lot until the earlier inspection is complete and clear of Major / Safety Hazard defects. */
export async function holdPointBlock(projectId: string, propertyId: string, stageId: string): Promise<string | null> {
  const plan = (await getPlan(projectId)).filter((p) => p.enabled);
  const idx = plan.findIndex((p) => p.stageId === stageId);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const prev = plan[i]!;
    if (!prev.holdPoint) continue;
    const done = await prisma.qcInspection.findFirst({ where: { projectId, propertyId, stageKey: prev.stageId, status: 'COMPLETED' }, orderBy: { createdAt: 'desc' } });
    if (!done) return `${prev.stageName} is a hold point and has not been completed on this lot`;
    const open = await prisma.qcDefect.count({ where: { sourceInspectionId: done.id, isDraft: false, status: { terminal: false }, severity: { key: { in: ['major', 'safety_hazard'] } } } });
    if (open > 0) return `${open} Major or Safety Hazard defect(s) from ${prev.stageName} are not yet resolved (hold point)`;
  }
  return null;
}

// ───────────────────────── Request (F09) ─────────────────────────

export async function requestInspection(ctx: QcContext, input: Record<string, unknown>) {
  const projectId = str(input.projectId);
  const project = await prisma.qcProject.findFirst({ where: { id: projectId, clientId: ctx.clientId ?? undefined } });
  if (!project) throw ApiError.notFound('Project not found');
  if (ctx.projectIds !== 'all' && !ctx.projectIds.includes(projectId)) throw ApiError.notFound('Project not found');
  if (!['CONSTRUCTION', 'PRACTICAL_COMPLETION'].includes(project.status)) throw ApiError.conflict('Inspections can be requested once construction has started', 'PROJECT_NOT_ACTIVE');

  const lotIds = Array.isArray(input.lotIds) ? (input.lotIds as string[]) : [];
  if (lotIds.length === 0) throw ApiError.badRequest('Choose at least one lot');
  const stageId = str(input.stageId);
  const plan = (await getPlan(projectId)).find((p) => p.stageId === stageId && p.enabled);
  if (!plan) throw ApiError.badRequest('That stage is not part of this project\'s plan');
  const data = validateOrThrow('F09', { ...input, project_and_site: [projectId], stage: stageId, lots_ready: lotIds.join(', ') }, { skipRequired: ['project_and_site', 'stage', 'lots_ready', 'rbs_notified_for_mandatory_stage'] });
  if (data.stage_complete_confirmation !== true) throw ApiError.badRequest('Confirm that the stage work is complete on these lots');
  // A statutory stage needs notice given to the Relevant Building Surveyor.
  if (plan.mandatoryNotification && !input.rbsNotifiedOn) throw ApiError.badRequest('This is a mandatory notification stage: record when the Relevant Building Surveyor was notified');

  const stageDef = ((await listStages()) as unknown as Array<Record<string, unknown> & { id: string }>).find((s) => s.id === stageId) ?? {};
  const lots = await prisma.qcProperty.findMany({ where: { id: { in: lotIds }, projectId } });
  if (lots.length !== lotIds.length) throw ApiError.badRequest('A selected lot does not belong to this project');
  const created: string[] = [];
  for (const lot of lots) {
    if (!stageApplies(stageDef, lot.data as Record<string, unknown>)) throw ApiError.badRequest(`${plan.stageName} does not apply to lot ${lot.name}`);
    const dup = await prisma.qcInspection.findFirst({ where: { propertyId: lot.id, stageKey: stageId, status: { in: ['REQUESTED', 'PLANNED', 'IN_PROGRESS'] } } });
    if (dup) throw ApiError.conflict(`Lot ${lot.name} already has ${dup.ref} open for this stage`, 'DUPLICATE_REQUEST');
    const block = await holdPointBlock(projectId, lot.id, stageId);
    if (block) throw ApiError.conflict(`Lot ${lot.name}: ${block}`, 'HOLD_POINT');
    const row = await prisma.qcInspection.create({
      data: {
        ref: await nextRef(), clientId: project.clientId, projectId, siteId: lot.siteId, propertyId: lot.id, stageKey: stageId, templateId: plan.templateId, type: 'Planned stage inspection',
        status: 'REQUESTED', requestedById: ctx.userId, requestedAt: new Date(), holdPoint: plan.holdPoint,
        plannedFrom: input.preferredFrom ? new Date(str(input.preferredFrom)) : data.ready_from_date ? new Date(`${str(data.ready_from_date)}T00:00:00Z`) : null,
        plannedTo: input.preferredTo ? new Date(str(input.preferredTo)) : null,
        requestData: asJson({ ready_from_date: data.ready_from_date, site_contact: data.site_contact_name_and_mobile, access_notes: data.access_notes ?? null, rbsNotifiedOn: input.rbsNotifiedOn ?? null, rbsName: input.rbsName ?? null }),
      },
    });
    created.push(row.id);
    await recordAudit({ clientId: project.clientId, entityType: 'Inspection', entityId: row.id, action: 'inspection.request', actor: actor(ctx), after: { lot: lot.name, stage: plan.stageName } });
  }
  // Tell the people who plan inspections (Client Admin, and Client Users allowed to plan) plus the stage's default inspector.
  const planners = await prisma.qcMembership.findMany({
    where: { clientId: project.clientId, status: 'ACTIVE', OR: [{ role: 'CLIENT_ADMIN' }, { role: 'CLIENT_USER', optionalPermissions: { has: 'Plan and assign inspections' } }] },
    select: { userId: true },
  });
  await notify({
    clientId: project.clientId, type: 'inspection.requested', entityType: 'QcProject', entityId: projectId,
    userIds: [...planners.map((p) => p.userId), ...(plan.defaultInspectorId ? [plan.defaultInspectorId] : [])],
    title: `${plan.stageName} inspection requested on ${lots.length} lot${lots.length === 1 ? '' : 's'} (${project.name})`,
  });
  return prisma.qcInspection.findMany({ where: { id: { in: created } }, include }).then((rows) => enrich(rows));
}

// ───────────────────────── Plan and assign (F10) ─────────────────────────

async function assertAssignable(inspectorId: string, clientId: string, projectId: string) {
  const user = await prisma.user.findUnique({
    where: { id: inspectorId },
    include: { qcMemberships: { where: { clientId, status: 'ACTIVE', role: 'PRIVATE_INSPECTOR' }, include: { projects: { select: { id: true } } } }, qcInspectorCredential: { include: { approvedClients: { select: { id: true } } } } },
  });
  if (!user?.isActive || user.qcMemberships.length === 0) throw ApiError.badRequest('Choose a Private Inspector approved for this client');
  const m = user.qcMemberships[0]!;
  if (m.projects.length > 0 && !m.projects.some((p) => p.id === projectId)) throw ApiError.badRequest('That inspector is not assigned to this project');
  const cred = user.qcInspectorCredential;
  if (cred) {
    if (cred.status !== 'APPROVED') throw ApiError.badRequest(`That inspector's credentials are ${cred.status.toLowerCase()}`);
    const expiry = (cred.data as Record<string, unknown>).registration_expiry;
    if (typeof expiry === 'string' && expiry < new Date().toISOString().slice(0, 10)) throw ApiError.badRequest("That inspector's registration has expired");
    if (cred.approvedClients.length && !cred.approvedClients.some((c) => c.id === clientId)) throw ApiError.badRequest('That inspector is not approved for this client');
  }
}

/** Overlaps with the inspector's other planned work, as a warning rather than a block. */
async function conflictsFor(inspectorId: string, from: Date, to: Date, exceptIds: string[]) {
  return prisma.qcInspection.findMany({
    where: { inspectorId, id: { notIn: exceptIds }, status: { in: ['PLANNED', 'IN_PROGRESS'] }, plannedFrom: { lt: to }, plannedTo: { gt: from } },
    select: { id: true, ref: true, plannedFrom: true, plannedTo: true },
  });
}

export async function planInspections(ctx: QcContext, input: Record<string, unknown>) {
  const data = validateOrThrow('F10', { ...input, inspections_selected: 'x', inspector: input.inspectorId, planned_window: [input.plannedFrom, input.plannedTo], notify_master_contractor: input.notifyMasterContractor ?? true }, { skipRequired: ['inspections_selected', 'planned_window'] });
  const from = new Date(str(input.plannedFrom));
  const to = new Date(str(input.plannedTo));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw ApiError.badRequest('Choose a planned window that ends after it starts');
  const inspectorId = str(input.inspectorId);

  // Either existing requested inspections, or new ones created from the planning matrix cells.
  const ids = Array.isArray(input.inspectionIds) ? (input.inspectionIds as string[]) : [];
  const cells = Array.isArray(input.cells) ? (input.cells as Array<{ propertyId: string; stageId: string }>) : [];
  if (ids.length === 0 && cells.length === 0) throw ApiError.badRequest('Choose at least one inspection');
  const existing = ids.length ? await prisma.qcInspection.findMany({ where: { AND: [{ id: { in: ids } }, inspectionScope(ctx)] } }) : [];
  if (existing.length !== ids.length) throw ApiError.notFound('Inspection not found');
  const projectIds = new Set(existing.map((e) => e.projectId));

  const planned: string[] = [];
  const warnings: string[] = [];
  const ctxClient = ctx.clientId!;
  for (const e of existing) {
    if (!['REQUESTED', 'PLANNED'].includes(e.status)) throw ApiError.conflict(`${e.ref} is ${e.status.toLowerCase().replace('_', ' ')} and cannot be planned`, 'INVALID_STATE');
    await assertAssignable(inspectorId, e.clientId, e.projectId);
  }
  for (const e of existing) {
    const block = e.propertyId && e.stageKey ? await holdPointBlock(e.projectId, e.propertyId, e.stageKey) : null;
    if (block) throw ApiError.conflict(`${e.ref}: ${block}`, 'HOLD_POINT');
    await prisma.qcInspection.update({
      where: { id: e.id },
      data: { status: 'PLANNED', inspectorId, plannedFrom: from, plannedTo: to, data: asJson({ ...(e.data as object), estimatedDuration: data.estimated_duration ?? null, instructions: data.instructions_to_inspector ?? null }) },
    });
    planned.push(e.id);
  }
  for (const c of cells) {
    const lot = await prisma.qcProperty.findFirst({ where: { id: c.propertyId, project: { clientId: ctxClient } }, include: { project: true } });
    if (!lot) throw ApiError.notFound('Lot not found');
    if (ctx.projectIds !== 'all' && !ctx.projectIds.includes(lot.projectId)) throw ApiError.notFound('Lot not found');
    if (!['CONSTRUCTION', 'PRACTICAL_COMPLETION', 'DLP'].includes(lot.project.status)) throw ApiError.conflict(`${lot.project.name} is not in construction yet`, 'PROJECT_NOT_ACTIVE');
    const plan = (await getPlan(lot.projectId)).find((p) => p.stageId === c.stageId && p.enabled);
    if (!plan) throw ApiError.badRequest('That stage is not part of the project plan');
    const stageDef = ((await listStages()) as unknown as Array<Record<string, unknown> & { id: string }>).find((s) => s.id === c.stageId) ?? {};
    if (!stageApplies(stageDef, lot.data as Record<string, unknown>)) throw ApiError.badRequest(`${plan.stageName} does not apply to lot ${lot.name}`);
    const dup = await prisma.qcInspection.findFirst({ where: { propertyId: lot.id, stageKey: c.stageId, status: { in: ['REQUESTED', 'PLANNED', 'IN_PROGRESS'] } } });
    if (dup) throw ApiError.conflict(`Lot ${lot.name} already has ${dup.ref} open for this stage`, 'DUPLICATE_REQUEST');
    const block = await holdPointBlock(lot.projectId, lot.id, c.stageId);
    if (block) throw ApiError.conflict(`Lot ${lot.name}: ${block}`, 'HOLD_POINT');
    await assertAssignable(inspectorId, lot.project.clientId, lot.projectId);
    const row = await prisma.qcInspection.create({
      data: {
        ref: await nextRef(), clientId: lot.project.clientId, projectId: lot.projectId, siteId: lot.siteId, propertyId: lot.id, stageKey: c.stageId, templateId: plan.templateId,
        type: str(input.type) && INSPECTION_TYPES.includes(str(input.type)) ? str(input.type) : 'Planned stage inspection', status: 'PLANNED', inspectorId, plannedFrom: from, plannedTo: to,
        holdPoint: plan.holdPoint, data: asJson({ estimatedDuration: data.estimated_duration ?? null, instructions: data.instructions_to_inspector ?? null }),
      },
    });
    planned.push(row.id);
    projectIds.add(lot.projectId);
  }
  const conflicts = await conflictsFor(inspectorId, from, to, planned);
  if (conflicts.length) warnings.push(`The inspector already has ${conflicts.length} inspection(s) in this window (${conflicts.map((c) => c.ref).join(', ')})`);

  await notify({ clientId: ctxClient, type: 'inspection.assigned', userIds: [inspectorId], entityType: 'QcInspection', entityId: planned[0], title: `${planned.length} inspection${planned.length === 1 ? '' : 's'} assigned to you` });
  if (data.notify_master_contractor !== false) {
    const builders = await prisma.qcMembership.findMany({ where: { clientId: ctxClient, status: 'ACTIVE', role: { in: ['MC_MANAGER', 'MC_PROJECT_MANAGER', 'MC_SITE_SUPERVISOR'] }, OR: [{ role: 'MC_MANAGER' }, { projects: { some: { id: { in: [...projectIds] } } } }] }, select: { userId: true } });
    await notify({ clientId: ctxClient, type: 'inspection.assigned', userIds: builders.map((b) => b.userId), entityType: 'QcInspection', entityId: planned[0], title: `Inspection scheduled for ${from.toISOString().slice(0, 10)}` });
  }
  for (const id of planned) await recordAudit({ clientId: ctxClient, entityType: 'Inspection', entityId: id, action: 'inspection.plan', actor: actor(ctx), after: { inspectorId, from, to } });
  const rows = await prisma.qcInspection.findMany({ where: { id: { in: planned } }, include });
  return { inspections: await enrich(rows), warnings };
}

// ───────────────────────── Reassign / reschedule / cancel (F11) ─────────────────────────

export async function changeInspection(ctx: QcContext, id: string, input: Record<string, unknown>) {
  const row = await load(ctx, id);
  const data = validateOrThrow('F11', input, { skipRequired: ['new_inspector', 'new_window'] });
  if (!['REQUESTED', 'PLANNED'].includes(row.status)) throw ApiError.conflict('Only inspections that have not started can be changed', 'INVALID_STATE');
  const action = str(data.action);
  const patch: Prisma.QcInspectionUncheckedUpdateInput = {};
  const notifyIds: string[] = [];
  if (row.inspectorId) notifyIds.push(row.inspectorId);
  if (action === 'Reassign') {
    const next = str(input.newInspectorId);
    await assertAssignable(next, row.clientId, row.projectId);
    patch.inspectorId = next;
    notifyIds.push(next);
    if (row.status === 'REQUESTED') patch.status = 'PLANNED';
  } else if (action === 'Reschedule') {
    const from = new Date(str(input.newFrom));
    const to = new Date(str(input.newTo));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw ApiError.badRequest('Choose a new window that ends after it starts');
    patch.plannedFrom = from;
    patch.plannedTo = to;
  } else if (action === 'Cancel') {
    patch.status = 'CANCELLED';
    patch.data = asJson({ ...(row.data as object), cancellation_reason: str(data.reason) });
  } else throw ApiError.badRequest('Choose Reassign, Reschedule or Cancel');
  await prisma.qcInspection.update({ where: { id }, data: patch });
  await recordAudit({ clientId: row.clientId, entityType: 'Inspection', entityId: id, action: `inspection.${action.toLowerCase()}`, actor: actor(ctx), reason: str(data.reason), before: { inspectorId: row.inspectorId, plannedFrom: row.plannedFrom }, after: patch as object });
  await notify({ clientId: row.clientId, type: 'inspection.assigned', userIds: notifyIds, entityType: 'QcInspection', entityId: id, title: `${row.ref} was ${action === 'Cancel' ? 'cancelled' : action === 'Reassign' ? 'reassigned' : 'rescheduled'}` });
  return (await getInspection(ctx, id)).inspection;
}

// ───────────────────────── Ad-hoc visits ─────────────────────────

export async function createAdHoc(ctx: QcContext, input: Record<string, unknown>) {
  const projectId = str(input.projectId);
  const project = await prisma.qcProject.findFirst({ where: { id: projectId, clientId: ctx.clientId ?? undefined } });
  if (!project) throw ApiError.notFound('Project not found');
  if (ctx.projectIds !== 'all' && !ctx.projectIds.includes(projectId)) throw ApiError.notFound('Project not found');
  const inspectorId = ctx.role === 'PRIVATE_INSPECTOR' ? ctx.userId : str(input.inspectorId);
  if (!inspectorId) throw ApiError.badRequest('Choose the inspector');
  await assertAssignable(inspectorId, project.clientId, projectId);
  const lot = input.propertyId ? await prisma.qcProperty.findFirst({ where: { id: str(input.propertyId), projectId } }) : null;
  if (input.propertyId && !lot) throw ApiError.badRequest('That lot is not in this project');
  const type = INSPECTION_TYPES.includes(str(input.type)) ? str(input.type) : 'Ad-hoc visit';
  const now = new Date();
  const row = await prisma.qcInspection.create({
    data: {
      ref: await nextRef(), clientId: project.clientId, projectId, siteId: lot?.siteId ?? (input.siteId ? str(input.siteId) : null), propertyId: lot?.id ?? null,
      stageKey: input.stageId ? str(input.stageId) : null, templateId: input.templateId ? str(input.templateId) : null, type, status: 'PLANNED', inspectorId,
      plannedFrom: input.plannedFrom ? new Date(str(input.plannedFrom)) : now, plannedTo: input.plannedTo ? new Date(str(input.plannedTo)) : new Date(now.getTime() + 2 * 3_600_000),
      data: asJson({ adHoc: true, purpose: str(input.purpose) }),
    },
    include,
  });
  await recordAudit({ clientId: project.clientId, entityType: 'Inspection', entityId: row.id, action: 'inspection.adhoc', actor: actor(ctx), after: { type } });
  return (await enrich([row]))[0];
}

// ───────────────────────── Start (F12) ─────────────────────────

function assertInspector(ctx: QcContext, row: { inspectorId: string | null }) {
  if (ctx.isSA) return;
  if (row.inspectorId !== ctx.userId) throw ApiError.forbidden('This inspection is assigned to someone else');
}

export async function startInspection(ctx: QcContext, id: string, input: Record<string, unknown>) {
  const row = await load(ctx, id);
  assertInspector(ctx, row);
  if (row.status === 'IN_PROGRESS') return getInspection(ctx, id);
  if (row.status !== 'PLANNED') throw ApiError.conflict(`${row.ref} is ${row.status.toLowerCase().replace('_', ' ')} and cannot be started`, 'INVALID_STATE');
  const header = validateOrThrow('F12', { site_access: 'Full', ...input }, { skipRequired: ['job_number_client_site_address_lot', 'inspector_and_date', 'construction_type', 'persons_present', 'carried_forward_items_reviewed', 'access_limitations'] });
  if (header.site_access !== 'Full' && !str(header.access_limitations).trim()) throw ApiError.badRequest('Describe the access limitations');
  if (row.propertyId && row.stageKey) {
    const block = await holdPointBlock(row.projectId, row.propertyId, row.stageKey);
    if (block) throw ApiError.conflict(block, 'HOLD_POINT');
  }

  // Snapshot the template's active items; carry forward items still open on this lot.
  const items = row.templateId ? await prisma.qcTemplateItem.findMany({ where: { templateId: row.templateId, active: true }, orderBy: { sortOrder: 'asc' } }) : [];
  const lot = row.propertyId ? await prisma.qcProperty.findUnique({ where: { id: row.propertyId }, select: { data: true, name: true } }) : null;
  const openDefects = row.propertyId
    ? await prisma.qcDefect.findMany({ where: { propertyId: row.propertyId, isDraft: false, status: { terminal: false }, sourceItemNumber: { not: null }, NOT: { sourceInspectionId: id } }, select: { id: true, sourceItemNumber: true, defectRef: true, title: true, severity: { select: { key: true } } } })
    : [];
  const floor = str((lot?.data as Record<string, unknown> | undefined)?.floor_system).toLowerCase();
  const monitorCarried = openDefects.filter((d) => d.severity?.key === 'monitor');
  if (monitorCarried.length && header.carried_forward_items_reviewed !== true && !input.carriedForwardReviewed) {
    throw ApiError.badRequest(`Review the ${monitorCarried.length} Monitor item(s) carried forward from earlier inspections before starting`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.qcInspection.update({ where: { id }, data: { status: 'IN_PROGRESS', startedAt: new Date(), headerData: asJson({ ...header, construction_type: lot?.data ?? null, carriedForward: openDefects.map((d) => ({ defectId: d.id, ref: d.defectRef, item: d.sourceItemNumber })) }) } });
    for (const it of items) {
      const d = it.data as Record<string, unknown>;
      // Items for other floor systems default to N/A (E17).
      const notApplicable = !floorAllowed(str(d.applies_to_floor_systems), floor);
      const carried = openDefects.find((c) => c.sourceItemNumber === it.itemNumber);
      await tx.qcInspectionResult.upsert({
        where: { inspectionId_itemNumber: { inspectionId: id, itemNumber: it.itemNumber } },
        create: {
          inspectionId: id, itemNumber: it.itemNumber, itemSnapshot: asJson({ ...d, item_number: it.itemNumber, section: it.section, item_type: it.itemType, mandatory_item: it.mandatory }),
          carriedFromId: carried?.id ?? null,
          ...(notApplicable ? { resultCode: 'N/A', reason: 'Does not apply to this floor system', answeredById: ctx.userId, answeredAt: new Date() } : {}),
        },
        update: {},
      });
    }
  });
  await recordAudit({ clientId: row.clientId, entityType: 'Inspection', entityId: id, action: 'inspection.start', actor: actor(ctx) });
  return getInspection(ctx, id);
}

// ───────────────────────── Results (F13) ─────────────────────────

/** Record or change one item's result. Safe to repeat: the server keeps the later of two writes by `clientUpdatedAt` (offline sync). */
export async function saveResult(ctx: QcContext, inspectionId: string, itemNumber: string, input: Record<string, unknown>) {
  const insp = await load(ctx, inspectionId);
  assertInspector(ctx, insp);
  if (insp.locked) throw ApiError.conflict('This inspection is signed and locked. Add an addendum instead.', 'INSPECTION_LOCKED');
  if (insp.status !== 'IN_PROGRESS') throw ApiError.conflict('Start the inspection before recording results', 'INVALID_STATE');
  const row = insp.results.find((r) => r.itemNumber === itemNumber);
  if (!row) throw ApiError.notFound('That item is not part of this inspection');

  const clientAt = input.clientUpdatedAt ? new Date(str(input.clientUpdatedAt)) : null;
  if (clientAt && row.answeredAt && clientAt < row.answeredAt) return { result: serializeResult(row), stale: true };

  const codes = await listResultCodes(insp.clientId);
  const code = str(input.result);
  const def = codes.find((c) => (c as { code?: string }).code === code) as { creates_a_defect?: boolean; photo_required?: boolean; reason_required?: boolean } | undefined;
  if (!def) throw ApiError.badRequest('Choose a result');
  const item = row.itemSnapshot as Record<string, unknown>;
  const comments = str(input.comments).trim();
  const location = str(input.locationDetail).trim();
  const photos = Array.isArray(input.photoUrls) ? (input.photoUrls as string[]).map((u) => str(u).split('?')[0]!).filter(Boolean) : ((row.photoUrls as string[]) ?? []);
  const reason = str(input.reason).trim();

  const isDefect = DEFECT_CODES.includes(code);
  if (isDefect) {
    if (!comments) throw ApiError.badRequest('Describe the defect');
    if (!location) throw ApiError.badRequest('Add the location detail, for example "Bed 2 north wall"');
  }
  if (def.reason_required && !reason) throw ApiError.badRequest(`A reason is required for ${code}`);
  const photoRule = str(item.photo_rule);
  if ((isDefect && photoRule !== 'Never' && photos.length === 0) || (photoRule === 'Always' && photos.length === 0)) throw ApiError.badRequest('Add at least one photo');

  // Measurement items: a value and unit, checked against the tolerance.
  let measurement: Record<string, unknown> | null = (input.measurement as Record<string, unknown> | undefined) ?? (row.measurement as Record<string, unknown> | null);
  if (item.item_type === 'Measurement' && !['N/A', 'Not Inspected'].includes(code)) {
    const value = Number((measurement as { value?: unknown } | null)?.value);
    if (!measurement || Number.isNaN(value)) throw ApiError.badRequest('Enter the measured value');
    measurement = { value, unit: str((measurement as { unit?: unknown }).unit) || str(item.measurement_unit) };
    const tol = checkTolerance(item, value);
    if (tol && !tol.within && code === 'OK' && !comments) throw ApiError.badRequest(`The measurement is outside the tolerance (${tol.min ?? '-'} to ${tol.max ?? '-'}). Choose a defect result, or explain in the comments why it is acceptable.`);
  }

  const previous = row.resultCode ? { resultCode: row.resultCode, comments: row.comments, locationDetail: row.locationDetail, measurement: row.measurement, photoUrls: row.photoUrls, reason: row.reason, at: row.answeredAt, by: row.answeredById } : null;
  const history = [...((row.previousValues as unknown[]) ?? []), ...(previous ? [previous] : [])];

  // Changing a defect result: drafts raised from this item follow the new result (withdrawn, or re-graded).
  const draftIds: string[] = [];
  for (const defectId of row.defectIds) {
    const d = await prisma.qcDefect.findUnique({ where: { id: defectId }, select: { id: true, isDraft: true, severity: { select: { label: true } } } });
    if (d?.isDraft) draftIds.push(d.id);
  }
  const requester = { id: ctx.userId, role: ctx.platformRole, ctx };
  if (draftIds.length && !isDefect) {
    for (const dId of draftIds) await performAction({ defectId: dId, action: 'withdraw', input: { reason: `Result changed to ${code} during the inspection` }, fileUrls: [], requester });
  }

  const saved = await prisma.qcInspectionResult.update({
    where: { id: row.id },
    data: {
      resultCode: code, comments: comments || null, locationDetail: location || null, measurement: measurement ? asJson(measurement) : Prisma.JsonNull, photoUrls: asJson(photos),
      reason: reason || null, previousValues: asJson(history), answeredById: ctx.userId, answeredAt: clientAt ?? new Date(),
    },
  });

  // Record each photo as evidence with its hash the first time it is attached.
  for (const url of photos) {
    const exists = await prisma.qcEvidence.findFirst({ where: { url, linkedId: row.id } });
    if (!exists) {
      const { hashStoredFile } = await import('./qc.evidence');
      await hashStoredFile({ url, linkedType: 'InspectionResult', linkedId: row.id, clientId: insp.clientId, projectId: insp.projectId, userId: ctx.userId, phase: 'Identification', caption: comments || null });
    }
  }

  let raised: string[] = [];
  if (isDefect && input.raiseDefect !== false && row.defectIds.length === 0) {
    raised = [await raiseDefectFromResult(ctx, insp, saved.id, code)];
  } else if (isDefect && draftIds.length) {
    // The grade changed on an existing draft: keep the draft in step.
    for (const dId of draftIds) await prisma.qcDefect.update({ where: { id: dId }, data: { summary: comments, locationDetails: location, severityId: (await severityIdFor(code)) ?? undefined, photoUrls: asJson(photos) } });
  }
  const fresh = await prisma.qcInspectionResult.findUniqueOrThrow({ where: { id: row.id } });
  return { result: serializeResult(fresh), raisedDefectIds: raised, stale: false };
}

async function severityIdFor(code: string): Promise<string | null> {
  const sev = await prisma.qcSeverity.findFirst({ where: { label: SEVERITY_LABEL_OF[code] ?? '', active: true } });
  return sev?.id ?? null;
}

/** Open a draft defect pre-filled from the result (F13 "raise defect" opens F16). May be called more than once per item. */
async function raiseDefectFromResult(ctx: QcContext, insp: InspectionRow, resultId: string, code: string): Promise<string> {
  const r = await prisma.qcInspectionResult.findUniqueOrThrow({ where: { id: resultId } });
  const item = r.itemSnapshot as Record<string, unknown>;
  if (!insp.propertyId) throw ApiError.badRequest('Defects need a lot: choose the lot for this visit');
  const stage = ((await listStages()) as unknown as Array<{ id: string; stage_name: string }>).find((s) => s.id === insp.stageKey);
  const defect = await createDefect(
    { id: ctx.userId, role: ctx.platformRole, ctx },
    {
      propertyId: insp.propertyId,
      assignedToId: insp.inspectorId ?? ctx.userId,
      defect_title: str(item.check_description).slice(0, 120) || 'Defect',
      description: r.comments ?? '',
      room_or_area: r.locationDetail ?? str(item.location_or_element),
      element: str(item.location_or_element) || undefined,
      location_detail: r.locationDetail ?? undefined,
      severity: SEVERITY_LABEL_OF[code],
      trade_category: str(item.default_trade_category) || undefined,
      code_or_standard_reference: str(item.reference) || undefined,
      foundAtStage: stage?.stage_name,
      sourceInspectionId: insp.id,
      sourceItemNumber: r.itemNumber,
    } as never,
  );
  // The photos taken on the item travel with the defect.
  await prisma.qcDefect.update({ where: { id: defect.id }, data: { photoUrls: r.photoUrls as Prisma.InputJsonValue } });
  await prisma.qcInspectionResult.update({ where: { id: resultId }, data: { defectIds: { push: defect.id } } });
  return defect.id;
}

/** A second (or later) defect from the same item. */
export async function raiseAnotherDefect(ctx: QcContext, inspectionId: string, itemNumber: string) {
  const insp = await load(ctx, inspectionId);
  assertInspector(ctx, insp);
  if (insp.locked || insp.status !== 'IN_PROGRESS') throw ApiError.conflict('This inspection is not open for changes', 'INVALID_STATE');
  const row = insp.results.find((r) => r.itemNumber === itemNumber);
  if (!row?.resultCode || !DEFECT_CODES.includes(row.resultCode)) throw ApiError.badRequest('Record a defect result for this item first');
  return { defectId: await raiseDefectFromResult(ctx, insp, row.id, row.resultCode) };
}

// ───────────────────────── Complete and sign (F14), addendum (F15) ─────────────────────────

export async function completionCheck(ctx: QcContext, id: string) {
  const insp = await load(ctx, id);
  const unanswered = insp.results.filter((r) => !r.resultCode).map((r) => r.itemNumber);
  const drafts = await prisma.qcDefect.findMany({ where: { sourceInspectionId: id, isDraft: true }, select: { id: true, defectRef: true, title: true } });
  const notInspected = insp.results.filter((r) => r.resultCode === 'Not Inspected').length;
  const cred = await prisma.qcInspectorCredential.findUnique({ where: { userId: insp.inspectorId ?? ctx.userId } });
  return { unanswered, draftDefects: drafts, notInspected, hasSignature: !!(cred?.data as Record<string, unknown> | undefined)?.signature_image, canComplete: unanswered.length === 0 && drafts.length === 0 };
}

export async function completeInspection(ctx: QcContext, id: string, input: Record<string, unknown>) {
  const insp = await load(ctx, id);
  assertInspector(ctx, insp);
  if (insp.locked || insp.status === 'COMPLETED') throw ApiError.conflict('This inspection is already complete', 'INVALID_STATE');
  if (insp.status !== 'IN_PROGRESS') throw ApiError.conflict('Start the inspection first', 'INVALID_STATE');
  const check = await completionCheck(ctx, id);
  if (check.unanswered.length) throw new ApiError(409, `${check.unanswered.length} item(s) have no result: ${check.unanswered.slice(0, 8).join(', ')}${check.unanswered.length > 8 ? '…' : ''}`, 'UNANSWERED_ITEMS', { items: check.unanswered });
  if (check.draftDefects.length) throw new ApiError(409, `${check.draftDefects.length} defect(s) are still drafts. Confirm or withdraw each one before completing.`, 'DRAFT_DEFECTS', { defects: check.draftDefects });
  const data = validateOrThrow('F14', input, { skipRequired: ['unanswered_items', 'draft_defects_not_confirmed', 'signature', 'limitations_statement'] });
  if (data.declaration !== true) throw ApiError.badRequest('Accept the declaration to sign this inspection');
  if (check.notInspected > 0 && !str(input.limitations_statement).trim()) throw ApiError.badRequest('Add a limitations statement: some items were not inspected');
  if (!check.hasSignature) throw ApiError.conflict('Your signature image is not on file. Ask the platform administrator to add it to your credentials.', 'NO_SIGNATURE');

  const now = new Date();
  const counts = countsOf(insp.results);
  const done = await prisma.qcInspection.update({
    where: { id },
    data: {
      status: 'COMPLETED', locked: true, finishedAt: now, signedAt: now, signedById: ctx.userId,
      summaryData: asJson({ overall_summary_notes: data.overall_summary_notes ?? null, limitations_statement: input.limitations_statement ?? null, recommended_next_inspection: data.recommended_next_inspection ?? null, declaration_accepted: true, counts, addenda: [] }),
    },
    include,
  });
  await recordAudit({ clientId: insp.clientId, entityType: 'Inspection', entityId: id, action: 'inspection.complete', actor: actor(ctx), after: { counts } });
  const recipients = await prisma.qcMembership.findMany({
    where: { clientId: insp.clientId, status: 'ACTIVE', OR: [{ role: 'CLIENT_ADMIN' }, { role: { in: ['MC_MANAGER', 'MC_PROJECT_MANAGER'] }, projects: { some: { id: insp.projectId } } }] },
    select: { userId: true },
  });
  await notify({
    clientId: insp.clientId, type: 'inspection.completed', entityType: 'QcInspection', entityId: id,
    userIds: [...recipients.map((r) => r.userId), ...(insp.requestedById ? [insp.requestedById] : [])], title: `${insp.ref} completed: ${counts['Major Defect'] ?? 0} major, ${counts['Minor Defect'] ?? 0} minor, ${counts['Safety Hazard'] ?? 0} safety`,
  });
  return (await enrich([done]))[0];
}

export async function addAddendum(ctx: QcContext, id: string, input: Record<string, unknown>, attachments: string[]) {
  const insp = await load(ctx, id);
  assertInspector(ctx, insp);
  if (insp.status !== 'COMPLETED') throw ApiError.conflict('Addenda are added to completed inspections', 'INVALID_STATE');
  const data = validateOrThrow('F15', input, { skipRequired: ['inspection', 'author_and_date'] });
  const summary = insp.summaryData as Record<string, unknown>;
  const addenda = [...((summary.addenda as unknown[]) ?? []), { text: data.addendum_text, reason: data.reason, attachments, authorId: ctx.userId, at: new Date().toISOString() }];
  await prisma.qcInspection.update({ where: { id }, data: { summaryData: asJson({ ...summary, addenda }) } });
  await recordAudit({ clientId: insp.clientId, entityType: 'Inspection', entityId: id, action: 'inspection.addendum', actor: actor(ctx), reason: str(data.reason) });
  return addenda;
}

/** Permission note: who may record results is the assigned inspector; `can` is exposed for the routes. */
export const mayPlan = (ctx: QcContext) => can(ctx, 'inspections.plan');
