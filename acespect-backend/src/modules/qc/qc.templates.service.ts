/**
 * Inspection checklist templates (E15-E18, forms F07/F08).
 *
 * Base templates belong to the platform and are maintained by the Super Admin.
 * A client (or one of its projects) works from a clone that records its parent
 * and the version it was cloned from; items the Super Admin locked cannot be
 * removed or edited in a clone. A published version is frozen; changes go in a
 * new draft version. Inspections snapshot their items, so later versions never
 * alter a completed inspection.
 */
import { createHash } from 'crypto';
import ExcelJS from 'exceljs';
import { Prisma, QcTemplate, QcTemplateItem } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../lib/audit';
import { getForm, validateAgainstSpec, validateOrThrow } from './spec/qcSpec';
import { QcContext } from './qc.context';
import { notify } from './qc.notify';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const actor = (ctx: QcContext) => ({ id: ctx.userId, role: ctx.role });

// ───────────────────────── Reference data: stages (E15) and result codes (E18) ─────────────────────────

const STAGES = [
  { stage_number: '1', stage_name: 'Pre-Pour', typically_actioned_at: 'Site visit: prior to concrete pour', applies_to_floor_systems: 'Slab on ground', statutory: true, reg: 'Mandatory notification stage under the Building Regulations 2018 (Vic): footings and reinforcement before the pour' },
  { stage_number: '2', stage_name: 'Slab and Sub-Floor', typically_actioned_at: 'Site visit: after slab or sub-floor is complete', applies_to_floor_systems: 'All', statutory: false },
  { stage_number: '3', stage_name: 'Frame', typically_actioned_at: 'Site visit: frame complete, before linings', applies_to_floor_systems: 'All', statutory: true, reg: 'Mandatory notification stage under the Building Regulations 2018 (Vic): completion of frame' },
  { stage_number: '4', stage_name: 'Roof', typically_actioned_at: 'Site visit: roof complete', applies_to_floor_systems: 'All', statutory: false },
  { stage_number: '5', stage_name: 'Pre-Plaster / Lock-up', typically_actioned_at: 'Site visit: before plasterboard is fixed', applies_to_floor_systems: 'All', statutory: false },
  { stage_number: '6', stage_name: 'Fixing (Pre-Paint)', typically_actioned_at: 'Site visit: fixing complete, before painting', applies_to_floor_systems: 'All', statutory: false },
  { stage_number: '7', stage_name: 'Waterproofing', typically_actioned_at: 'Site visit: wet areas membrane complete', applies_to_floor_systems: 'All', statutory: false },
  { stage_number: '8', stage_name: 'PCI / Handover', typically_actioned_at: 'Site visit: practical completion', applies_to_floor_systems: 'All', statutory: true, reg: 'Mandatory notification stage under the Building Regulations 2018 (Vic): final inspection' },
  { stage_number: '8A', stage_name: 'Apartment Addendum', typically_actioned_at: 'Site visit: apartment common and fire/smoke elements', applies_to_floor_systems: 'All', statutory: false },
  { stage_number: '9', stage_name: 'Defect Liability', typically_actioned_at: 'Site visit: during the defects liability period', applies_to_floor_systems: 'All', statutory: false },
];

export const RESULT_CODES = [
  { code: 'OK', label: 'OK', definition: 'The item meets the requirement.', when_to_use: 'Use when the item was inspected and complies.', creates_a_defect: false, severity: null, photo_required: false, reason_required: false, colour: '#2f9e44', icon: 'check' },
  { code: 'Minor Defect', label: 'Minor Defect', definition: 'A defect that does not affect safety or function, but does not meet the standard.', when_to_use: 'Cosmetic or minor workmanship issues that can be corrected without significant work.', creates_a_defect: true, severity: 'minor', photo_required: true, reason_required: false, colour: '#e8a317', icon: 'alert' },
  { code: 'Major Defect', label: 'Major Defect', definition: 'A defect that affects function, durability or compliance and needs prompt correction.', when_to_use: 'Use when the item fails a mandatory requirement or will cause further damage if left.', creates_a_defect: true, severity: 'major', photo_required: true, reason_required: false, colour: '#e8590c', icon: 'alert-octagon' },
  { code: 'Safety Hazard', label: 'Safety Hazard', definition: 'A condition that could cause injury or serious harm.', when_to_use: 'Use for any item with an immediate risk to people. It is released to the Builder straight away when the project policy allows.', creates_a_defect: true, severity: 'safety_hazard', photo_required: true, reason_required: false, colour: '#c92a2a', icon: 'shield-alert' },
  { code: 'Monitor / Serviceability', label: 'Monitor / Serviceability', definition: 'A condition that is acceptable now but should be watched or reviewed at the next stage.', when_to_use: 'Use for items that need follow-up rather than rectification, such as minor movement or settlement.', creates_a_defect: true, severity: 'monitor', photo_required: true, reason_required: false, colour: '#1971c2', icon: 'eye' },
  { code: 'N/A', label: 'N/A', definition: 'The item does not apply to this lot or construction type.', when_to_use: 'Use when the item is not relevant. A reason is required.', creates_a_defect: false, severity: null, photo_required: false, reason_required: true, colour: '#868e96', icon: 'minus' },
  { code: 'Not Inspected', label: 'Not Inspected', definition: 'The item could not be inspected on this visit.', when_to_use: 'Use when access or conditions prevented inspection. A reason is required.', creates_a_defect: false, severity: null, photo_required: false, reason_required: true, colour: '#5f3dc4', icon: 'eye-off' },
];

/** Idempotent: create the standard stages and result codes the first time the platform starts. */
export async function ensureTemplateReferenceData(): Promise<void> {
  if ((await prisma.qcRecord.count({ where: { kind: 'stage_def' } })) === 0) {
    let seq = 1;
    for (const s of STAGES) {
      await prisma.qcRecord.create({
        data: {
          kind: 'stage_def', title: s.stage_name, status: 'ACTIVE',
          data: asJson({
            stage_number: s.stage_number, stage_name: s.stage_name, sequence: seq++, typically_actioned_at: s.typically_actioned_at,
            applies_to_floor_systems: s.applies_to_floor_systems, applies_to_building_classes: ['1a', '1b', '2', '10a', '10b'],
            statutory_mandatory_notification_stage: s.statutory, regulation_reference: s.reg ?? null, active: true,
          }),
        },
      });
    }
  }
  if ((await prisma.qcRecord.count({ where: { kind: 'result_code', clientId: null } })) === 0) {
    for (const r of RESULT_CODES) {
      await prisma.qcRecord.create({
        data: {
          kind: 'result_code', title: r.code, status: 'ACTIVE',
          data: asJson({ code: r.code, label: r.label, definition: r.definition, when_to_use: r.when_to_use, creates_a_defect: r.creates_a_defect, severity_mapping: r.severity, photo_required: r.photo_required, reason_required: r.reason_required, colour_and_icon: `${r.colour}|${r.icon}` }),
        },
      });
    }
  }
}

export async function listStages() {
  const rows = await prisma.qcRecord.findMany({ where: { kind: 'stage_def' } });
  return rows
    .map((r) => ({ id: r.id, ...(r.data as Record<string, unknown>) }))
    .sort((a, b) => Number((a as { sequence?: number }).sequence) - Number((b as { sequence?: number }).sequence));
}

export async function saveStage(ctx: QcContext, id: string | null, input: Record<string, unknown>) {
  const data = validateOrThrow('E15', input, { skipRequired: [] });
  const row = id
    ? await prisma.qcRecord.update({ where: { id }, data: { title: str(data.stage_name), data: asJson(data) } })
    : await prisma.qcRecord.create({ data: { kind: 'stage_def', title: str(data.stage_name), data: asJson(data), createdById: ctx.userId } });
  await recordAudit({ entityType: 'StageDefinition', entityId: row.id, action: id ? 'stage.update' : 'stage.create', actor: actor(ctx), after: data });
  return { id: row.id, ...(row.data as Record<string, unknown>) };
}

/** Result codes: the seven codes are fixed; clients may rename the label (REQ-TPL-006). */
export async function listResultCodes(clientId: string | null) {
  const base = await prisma.qcRecord.findMany({ where: { kind: 'result_code', clientId: null } });
  const overrides = clientId ? await prisma.qcRecord.findMany({ where: { kind: 'result_code', clientId } }) : [];
  return base.map((b) => {
    const d = b.data as Record<string, unknown>;
    const o = overrides.find((x) => (x.data as Record<string, unknown>).code === d.code);
    const merged = { ...d, ...(o ? (o.data as Record<string, unknown>) : {}) };
    const [colour, icon] = String(merged.colour_and_icon ?? '|').split('|');
    return { id: b.id, ...merged, colour, icon, renamed: !!o };
  });
}

export async function saveResultCode(ctx: QcContext, clientId: string | null, code: string, input: Record<string, unknown>) {
  const base = await prisma.qcRecord.findFirst({ where: { kind: 'result_code', clientId: null, title: code } });
  if (!base) throw ApiError.notFound('Unknown result code');
  const baseData = base.data as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ['label', 'definition', 'when_to_use'] as const) if (typeof input[k] === 'string' && input[k]) patch[k] = input[k];
  if (typeof input.colour_and_icon === 'string') {
    const [colour, icon] = input.colour_and_icon.split('|');
    if (!colour || !icon) throw ApiError.badRequest('A colour must be paired with an icon (accessibility)');
    patch.colour_and_icon = input.colour_and_icon;
  }
  // The meaning of a code (whether it creates a defect, its severity, photo and reason rules) cannot be changed.
  if (!clientId) {
    const row = await prisma.qcRecord.update({ where: { id: base.id }, data: { data: asJson({ ...baseData, ...patch }) } });
    await recordAudit({ entityType: 'ResultCode', entityId: base.id, action: 'resultcode.update', actor: actor(ctx), after: patch });
    return row;
  }
  const existing = await prisma.qcRecord.findFirst({ where: { kind: 'result_code', clientId, title: code } });
  const data = { code, ...(existing ? (existing.data as object) : {}), ...patch };
  const row = existing
    ? await prisma.qcRecord.update({ where: { id: existing.id }, data: { data: asJson(data) } })
    : await prisma.qcRecord.create({ data: { kind: 'result_code', clientId, title: code, data: asJson(data), createdById: ctx.userId } });
  await recordAudit({ clientId, entityType: 'ResultCode', entityId: row.id, action: 'resultcode.rename', actor: actor(ctx), after: patch });
  return row;
}

// ───────────────────────── Templates ─────────────────────────

const VERSION_RE = /^\d+\.\d+$/;
const cmpVersion = (a: string, b: string) => {
  const [a1, a2] = a.split('.').map(Number);
  const [b1, b2] = b.split('.').map(Number);
  return a1! - b1! || a2! - b2!;
};

const label = (t: QcTemplate) => str((t.data as Record<string, unknown>).version_label) || `1.${t.version - 1}`;
export const templateLabel = label;

export function serializeTemplate(t: QcTemplate & { items?: QcTemplateItem[]; _count?: { items: number } }) {
  const d = t.data as Record<string, unknown>;
  return {
    id: t.id, code: t.code, name: t.name, level: t.level, clientId: t.clientId, projectId: t.projectId, parentId: t.parentId, parentVersion: t.parentVersion,
    stageKey: t.stageKey, version: t.version, versionLabel: label(t), versionStatus: t.versionStatus, publishedAt: t.publishedAt, changeSummary: t.changeSummary,
    effectiveFrom: d.effective_from ?? null, details: d, createdAt: t.createdAt, updatedAt: t.updatedAt,
    itemCount: t._count?.items ?? t.items?.length ?? undefined,
    items: t.items?.map(serializeItem),
  };
}

export function serializeItem(i: QcTemplateItem) {
  return { id: i.id, templateId: i.templateId, itemNumber: i.itemNumber, section: i.section, sortOrder: i.sortOrder, active: i.active, locked: i.locked, mandatory: i.mandatory, itemType: i.itemType, ...(i.data as Record<string, unknown>) };
}

export interface TemplateScope {
  isSA: boolean;
  clientId: string | null;
  projectIds: string[] | 'all';
}

function visibleWhere(scope: TemplateScope): Prisma.QcTemplateWhereInput {
  if (scope.isSA && !scope.clientId) return {};
  const or: Prisma.QcTemplateWhereInput[] = [{ level: 'BASE', versionStatus: { in: ['PUBLISHED', 'RETIRED'] } }];
  if (scope.clientId) {
    or.push({ level: 'CLIENT', clientId: scope.clientId });
    or.push({ level: 'PROJECT', clientId: scope.clientId, ...(scope.projectIds === 'all' ? {} : { projectId: { in: scope.projectIds } }) });
  }
  if (scope.isSA) or.push({ level: 'BASE' });
  return { OR: or };
}

export async function listTemplates(scope: TemplateScope, filters: { level?: string; stageKey?: string; status?: string; code?: string } = {}) {
  const rows = await prisma.qcTemplate.findMany({
    where: { AND: [visibleWhere(scope), { level: filters.level, stageKey: filters.stageKey, versionStatus: filters.status, code: filters.code }] },
    include: { _count: { select: { items: true } } },
    orderBy: [{ code: 'asc' }, { version: 'desc' }],
  });
  return rows.map(serializeTemplate);
}

export async function getTemplate(scope: TemplateScope, id: string) {
  const t = await prisma.qcTemplate.findFirst({ where: { AND: [{ id }, visibleWhere(scope)] }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  if (!t) throw ApiError.notFound('Template not found');
  return serializeTemplate(t);
}

/** Who may change a template: the Super Admin for base templates, the owning client for clones. */
function assertMayEdit(ctx: QcContext, t: QcTemplate): void {
  if (t.level === 'BASE') {
    if (!ctx.isSA) throw ApiError.forbidden('Base templates are maintained by the platform administrator');
    return;
  }
  if (ctx.isSA) return;
  if (t.clientId !== ctx.clientId) throw ApiError.notFound('Template not found');
}

export async function createBaseTemplate(ctx: QcContext, input: Record<string, unknown>) {
  const data = validateOrThrow('E16', input, { skipRequired: ['parent_template_and_version', 'change_summary', 'stage'] });
  const stageKey = str(input.stage) || str(input.stageKey);
  if (!stageKey) throw ApiError.badRequest('Choose the stage this template is for');
  const code = str(data.template_code).toUpperCase();
  if (await prisma.qcTemplate.findFirst({ where: { code, level: 'BASE' } })) throw ApiError.conflict(`Template code ${code} is already used`, 'KEY_TAKEN');
  const t = await prisma.qcTemplate.create({
    data: { code, name: str(data.template_name), level: 'BASE', stageKey, version: 1, versionStatus: 'DRAFT', data: asJson({ ...data, version_label: '1.0' }), createdById: ctx.userId },
  });
  await recordAudit({ entityType: 'Template', entityId: t.id, action: 'template.create', actor: actor(ctx), after: { code } });
  return serializeTemplate(t);
}

export async function updateTemplateHeader(ctx: QcContext, id: string, input: Record<string, unknown>) {
  const t = await prisma.qcTemplate.findUniqueOrThrow({ where: { id } });
  assertMayEdit(ctx, t);
  if (t.versionStatus !== 'DRAFT') throw ApiError.conflict('A published version cannot be edited; create a new draft version', 'TEMPLATE_PUBLISHED');
  const merged = { ...(t.data as Record<string, unknown>), ...input };
  const data = validateOrThrow('E16', merged, { skipRequired: ['parent_template_and_version', 'change_summary', 'stage', 'template_code'] });
  const row = await prisma.qcTemplate.update({ where: { id }, data: { name: str(data.template_name) || t.name, stageKey: str(input.stage) || t.stageKey, data: asJson({ ...data, version_label: (t.data as Record<string, unknown>).version_label }) } });
  await recordAudit({ clientId: t.clientId, entityType: 'Template', entityId: id, action: 'template.update', actor: actor(ctx), after: input });
  return serializeTemplate(row);
}

const hashItem = (data: Record<string, unknown>) => createHash('sha1').update(JSON.stringify(Object.entries(data).filter(([k]) => !['originHash', 'origin_item', 'sequence'].includes(k)).sort())).digest('hex');

function itemColumns(data: Record<string, unknown>) {
  return {
    itemNumber: str(data.item_number),
    section: str(data.section) || null,
    sortOrder: Number(data.sequence) || 0,
    active: data.active !== false,
    locked: data.locked_by_super_admin === true,
    mandatory: data.mandatory_item !== false,
    itemType: str(data.item_type) || 'Result only',
  };
}

function validateItem(input: Record<string, unknown>): Record<string, unknown> {
  const data = validateOrThrow('E17', { active: true, mandatory_item: true, locked_by_super_admin: false, photo_rule: 'When result is not OK (default)', item_type: 'Result only', applies_to_floor_systems: 'All', applies_to_building_classes: '1a, 1b, 2, 10a, 10b', sequence: 0, ...input }, { skipRequired: ['origin_item'] });
  if (data.item_type === 'Measurement') {
    if (!data.measurement_unit) throw ApiError.badRequest('A measurement item needs a unit');
    const tol = data.tolerance_minimum_and_maximum as unknown[] | undefined;
    if (tol && tol.length >= 2 && tol[0] !== '' && tol[1] !== '' && Number(tol[0]) > Number(tol[1])) throw ApiError.badRequest('The minimum tolerance cannot be above the maximum');
  }
  return data;
}

export async function addItem(ctx: QcContext, templateId: string, input: Record<string, unknown>) {
  const t = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: templateId } });
  assertMayEdit(ctx, t);
  if (t.versionStatus !== 'DRAFT') throw ApiError.conflict('A published version cannot be edited; create a new draft version', 'TEMPLATE_PUBLISHED');
  const data = validateItem(input);
  if (await prisma.qcTemplateItem.findFirst({ where: { templateId, itemNumber: str(data.item_number) } })) throw ApiError.conflict(`Item number ${data.item_number} is already used in this template`, 'KEY_TAKEN');
  // Only the Super Admin can lock an item; a client copy never creates locked items.
  if (t.level !== 'BASE') data.locked_by_super_admin = false;
  if (!data.sequence) data.sequence = (await prisma.qcTemplateItem.count({ where: { templateId } })) + 1;
  const row = await prisma.qcTemplateItem.create({ data: { templateId, ...itemColumns(data), data: asJson({ ...data, originHash: undefined }) } });
  await recordAudit({ clientId: t.clientId, entityType: 'Template', entityId: templateId, action: 'template.item.add', actor: actor(ctx), after: { item: data.item_number } });
  return serializeItem(row);
}

export async function updateItem(ctx: QcContext, itemId: string, input: Record<string, unknown>) {
  const item = await prisma.qcTemplateItem.findUniqueOrThrow({ where: { id: itemId }, include: { template: true } });
  assertMayEdit(ctx, item.template);
  if (item.template.versionStatus !== 'DRAFT') throw ApiError.conflict('A published version cannot be edited; create a new draft version', 'TEMPLATE_PUBLISHED');
  // Items locked by the Super Admin stay as published in client and project copies (REQ-TPL-003).
  if (item.locked && item.template.level !== 'BASE') throw ApiError.forbidden('This item is locked by the platform administrator');
  const merged: Record<string, unknown> = { ...(item.data as Record<string, unknown>), ...input, item_number: item.itemNumber };
  if (item.template.level !== 'BASE') merged.locked_by_super_admin = false;
  const data = validateItem(merged);
  const row = await prisma.qcTemplateItem.update({ where: { id: itemId }, data: { ...itemColumns(data), data: asJson(data) } });
  await recordAudit({ clientId: item.template.clientId, entityType: 'Template', entityId: item.templateId, action: 'template.item.update', actor: actor(ctx), after: { item: item.itemNumber } });
  return serializeItem(row);
}

export async function removeItem(ctx: QcContext, itemId: string) {
  const item = await prisma.qcTemplateItem.findUniqueOrThrow({ where: { id: itemId }, include: { template: true } });
  assertMayEdit(ctx, item.template);
  if (item.template.versionStatus !== 'DRAFT') throw ApiError.conflict('A published version cannot be edited; create a new draft version', 'TEMPLATE_PUBLISHED');
  if (item.locked && item.template.level !== 'BASE') throw ApiError.forbidden('Locked items cannot be removed');
  await prisma.qcTemplateItem.delete({ where: { id: itemId } });
  await recordAudit({ clientId: item.template.clientId, entityType: 'Template', entityId: item.templateId, action: 'template.item.remove', actor: actor(ctx), after: { item: item.itemNumber } });
}

/** Start the next draft version of a template, copying the latest version's items. */
export async function newDraftVersion(ctx: QcContext, templateId: string) {
  const src = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { items: true } });
  assertMayEdit(ctx, src);
  const lineage = { code: src.code, level: src.level, clientId: src.clientId, projectId: src.projectId };
  const latest = await prisma.qcTemplate.findFirst({ where: lineage, orderBy: { version: 'desc' } });
  if (latest && latest.versionStatus === 'DRAFT') throw ApiError.conflict('This template already has a draft version', 'DRAFT_EXISTS');
  const base = latest ?? src;
  const baseItems = base.id === src.id ? src.items : await prisma.qcTemplateItem.findMany({ where: { templateId: base.id } });
  const next = await prisma.qcTemplate.create({
    data: {
      ...lineage, name: base.name, parentId: base.parentId, parentVersion: base.parentVersion, stageKey: base.stageKey, version: base.version + 1, versionStatus: 'DRAFT',
      data: asJson({ ...(base.data as object), version_label: undefined, change_summary: undefined }), createdById: ctx.userId,
      items: { create: baseItems.map((i) => ({ itemNumber: i.itemNumber, section: i.section, sortOrder: i.sortOrder, active: i.active, locked: i.locked, mandatory: i.mandatory, itemType: i.itemType, data: i.data as Prisma.InputJsonValue })) },
    },
    include: { items: true },
  });
  await recordAudit({ clientId: src.clientId, entityType: 'Template', entityId: next.id, action: 'template.draft', actor: actor(ctx), after: { from: base.version } });
  return serializeTemplate(next);
}

/** F07: publish a draft. Previous published versions become Retired but stay readable (inspections snapshot their items). */
export async function publishTemplate(ctx: QcContext, templateId: string, input: Record<string, unknown>) {
  const t = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { _count: { select: { items: true } } } });
  assertMayEdit(ctx, t);
  if (t.versionStatus !== 'DRAFT') throw ApiError.conflict('Only a draft can be published', 'NOT_DRAFT');
  const data = validateOrThrow('F07', input, { skipRequired: ['template', 'adopt_projects_and_stages_to_apply'] });
  const versionLabel = str(data.new_version_number);
  if (!VERSION_RE.test(versionLabel)) throw ApiError.badRequest('Version number must look like 1.1 (major.minor)');
  const prev = await prisma.qcTemplate.findMany({ where: { code: t.code, level: t.level, clientId: t.clientId, projectId: t.projectId, versionStatus: { in: ['PUBLISHED', 'RETIRED'] } } });
  if (prev.some((p) => cmpVersion(versionLabel, label(p)) <= 0)) throw ApiError.badRequest('The version number must be higher than every earlier version');
  if (t._count.items === 0) throw ApiError.badRequest('A template needs at least one item before it can be published');
  const dup = await prisma.$queryRaw<Array<{ itemNumber: string }>>`SELECT "itemNumber" FROM qc_template_items WHERE "templateId" = ${templateId} GROUP BY "itemNumber" HAVING COUNT(*) > 1`;
  if (dup.length) throw ApiError.badRequest(`Item number ${dup[0]!.itemNumber} is used more than once`);

  await prisma.$transaction([
    prisma.qcTemplate.updateMany({ where: { code: t.code, level: t.level, clientId: t.clientId, projectId: t.projectId, versionStatus: 'PUBLISHED' }, data: { versionStatus: 'RETIRED' } }),
    prisma.qcTemplate.update({
      where: { id: templateId },
      data: { versionStatus: 'PUBLISHED', publishedAt: new Date(), changeSummary: str(data.change_summary), data: asJson({ ...(t.data as object), version_label: versionLabel, effective_from: str(data.effective_for_new_inspections_from), published_by: ctx.userId }) },
    }),
  ]);
  await recordAudit({ clientId: t.clientId, entityType: 'Template', entityId: templateId, action: 'template.publish', actor: actor(ctx), reason: str(data.change_summary), after: { version: versionLabel } });

  // Tell the Client Admins of clients that cloned this template (REQ-TPL-004).
  if (t.level === 'BASE' && data.notify_client_admins !== false) {
    const lineageIds = (await prisma.qcTemplate.findMany({ where: { code: t.code, level: 'BASE' }, select: { id: true } })).map((x) => x.id);
    const cloned = await prisma.qcTemplate.findMany({ where: { parentId: { in: lineageIds } }, select: { clientId: true } });
    const clientIds = [...new Set(cloned.map((c) => c.clientId).filter((x): x is string => !!x))];
    for (const clientId of clientIds) {
      const admins = await prisma.qcMembership.findMany({ where: { clientId, role: 'CLIENT_ADMIN', status: 'ACTIVE' }, select: { userId: true } });
      await notify({ clientId, type: 'inspection.assigned', userIds: admins.map((a) => a.userId), title: `A new version (${versionLabel}) of the "${t.name}" template is available`, entityType: 'QcTemplate', entityId: templateId });
    }
  }
  const fresh = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { _count: { select: { items: true } } } });
  return serializeTemplate(fresh);
}

/**
 * Point a project's inspection-plan stages at a template version (REQ-TPL-004:
 * "adopt"). Inspections already started keep the snapshot they began with.
 */
export async function adoptVersion(ctx: QcContext, templateId: string, projectIds: string[]) {
  const t = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: templateId } });
  if (t.versionStatus !== 'PUBLISHED') throw ApiError.badRequest('Only a published version can be adopted');
  const clientId = ctx.clientId;
  let adopted = 0;
  for (const projectId of projectIds) {
    const project = await prisma.qcProject.findUnique({ where: { id: projectId }, select: { clientId: true } });
    if (!project || (clientId && project.clientId !== clientId)) throw ApiError.notFound('Project not found');
    const stages = await prisma.qcRecord.findMany({ where: { kind: 'project_stage', projectId } });
    for (const s of stages) {
      const d = s.data as Record<string, unknown>;
      const tpl = d.templateId ? await prisma.qcTemplate.findUnique({ where: { id: String(d.templateId) } }) : null;
      if (tpl && tpl.code === t.code && tpl.level === t.level && tpl.clientId === t.clientId) {
        await prisma.qcRecord.update({ where: { id: s.id }, data: { data: asJson({ ...d, templateId: t.id, templateVersion: label(t) }) } });
        adopted++;
      }
    }
    await recordAudit({ clientId: project.clientId, entityType: 'Project', entityId: projectId, action: 'template.adopt', actor: actor(ctx), after: { template: t.code, version: label(t) } });
  }
  return { adopted };
}

/** F08: clone a published template for a client or a project. */
export async function cloneTemplate(ctx: QcContext, sourceId: string, input: Record<string, unknown>) {
  const data = validateOrThrow('F08', input, { skipRequired: ['source_template_and_version', 'project'] });
  const src = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: sourceId }, include: { items: true } });
  if (src.versionStatus !== 'PUBLISHED') throw ApiError.badRequest('Only a published version can be cloned');
  const clientId = ctx.clientId;
  if (!clientId) throw ApiError.conflict('Choose a client first', 'CLIENT_REQUIRED');
  if (src.level !== 'BASE' && src.clientId !== clientId) throw ApiError.notFound('Template not found');
  const level = str(data.level).toUpperCase() === 'PROJECT' ? 'PROJECT' : 'CLIENT';
  let projectId: string | null = null;
  if (level === 'PROJECT') {
    projectId = str(input.projectId ?? data.project);
    const p = await prisma.qcProject.findUnique({ where: { id: projectId }, select: { clientId: true } });
    if (!p || p.clientId !== clientId) throw ApiError.badRequest('Choose one of your projects for a project-level template');
  }
  const items = src.items.filter((i) => data.include_inactive_items === true || i.active);
  const code = `${src.code}-${level === 'CLIENT' ? 'C' : 'P'}${Date.now().toString(36).slice(-4).toUpperCase()}`;
  const clone = await prisma.qcTemplate.create({
    data: {
      code, name: str(data.new_template_name), level, clientId, projectId, parentId: src.id, parentVersion: src.version, stageKey: src.stageKey, version: 1, versionStatus: 'DRAFT',
      data: asJson({ ...(src.data as object), version_label: '1.0', template_name: str(data.new_template_name), template_code: code, change_summary: undefined }), createdById: ctx.userId,
      items: { create: items.map((i) => ({ itemNumber: i.itemNumber, section: i.section, sortOrder: i.sortOrder, active: i.active, locked: i.locked, mandatory: i.mandatory, itemType: i.itemType, data: asJson({ ...(i.data as object), origin_item: i.id, originHash: hashItem(i.data as Record<string, unknown>) }) })) },
    },
    include: { items: true },
  });
  await recordAudit({ clientId, entityType: 'Template', entityId: clone.id, action: 'template.clone', actor: actor(ctx), after: { from: src.code, version: label(src) } });
  return serializeTemplate(clone);
}

/** REQ-TPL-005: what changed in the parent since this clone was made, and what the clone changed locally. */
export async function diffWithParent(ctx: QcContext, templateId: string) {
  const clone = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { items: true } });
  assertMayEdit(ctx, clone);
  if (!clone.parentId) throw ApiError.badRequest('This template is not a copy of another template');
  const parentRoot = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: clone.parentId } });
  const latest = await prisma.qcTemplate.findFirst({ where: { code: parentRoot.code, level: parentRoot.level, clientId: parentRoot.clientId, projectId: parentRoot.projectId, versionStatus: 'PUBLISHED' }, orderBy: { version: 'desc' }, include: { items: true } });
  if (!latest) return { upToDate: true, parentVersion: label(parentRoot), added: [], removed: [], changed: [], localChanges: [] };
  const cloneByNumber = new Map(clone.items.map((i) => [i.itemNumber, i]));
  const parentByNumber = new Map(latest.items.map((i) => [i.itemNumber, i]));
  const added = latest.items.filter((p) => !cloneByNumber.has(p.itemNumber)).map(serializeItem);
  const removed = clone.items.filter((c) => !parentByNumber.has(c.itemNumber) && (c.data as Record<string, unknown>).origin_item).map(serializeItem);
  const changed: Array<{ itemNumber: string; locallyModified: boolean; parent: ReturnType<typeof serializeItem>; current: ReturnType<typeof serializeItem> }> = [];
  const localChanges: string[] = [];
  for (const c of clone.items) {
    const cd = c.data as Record<string, unknown>;
    const local = cd.originHash ? hashItem(cd) !== cd.originHash : !cd.origin_item;
    if (local) localChanges.push(c.itemNumber);
    const p = parentByNumber.get(c.itemNumber);
    if (p && hashItem(p.data as Record<string, unknown>) !== (cd.originHash ?? '') && hashItem(p.data as Record<string, unknown>) !== hashItem(cd)) {
      changed.push({ itemNumber: c.itemNumber, locallyModified: local, parent: serializeItem(p), current: serializeItem(c) });
    }
  }
  return { upToDate: !added.length && !removed.length && !changed.length, parentVersion: label(latest), parentTemplateId: latest.id, clonedFromVersion: clone.parentVersion, added, removed, changed, localChanges };
}

/** Apply selected upstream changes to a draft clone. Items edited locally are skipped unless `overwriteLocal`. */
export async function mergeFromParent(ctx: QcContext, templateId: string, selection: { itemNumbers: string[]; overwriteLocal?: boolean }) {
  const clone = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { items: true } });
  assertMayEdit(ctx, clone);
  if (clone.versionStatus !== 'DRAFT') throw ApiError.conflict('Create a new draft version before merging', 'TEMPLATE_PUBLISHED');
  const diff = await diffWithParent(ctx, templateId);
  const pick = new Set(selection.itemNumbers);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let removed = 0;
  for (const a of diff.added) {
    if (!pick.has(a.itemNumber)) continue;
    const { id: _id, templateId: _t, itemNumber, section, sortOrder, active, locked, mandatory, itemType, ...rest } = a as ReturnType<typeof serializeItem> & Record<string, unknown>;
    await prisma.qcTemplateItem.create({ data: { templateId, itemNumber, section, sortOrder, active, locked, mandatory, itemType, data: asJson({ ...rest, origin_item: a.id, originHash: hashItem(rest) }) } });
    added++;
  }
  for (const c of diff.changed) {
    if (!pick.has(c.itemNumber)) continue;
    if (c.locallyModified && !selection.overwriteLocal) { skipped++; continue; }
    const item = clone.items.find((i) => i.itemNumber === c.itemNumber)!;
    const { id: _id, templateId: _t, itemNumber: _n, section, sortOrder, active, locked, mandatory, itemType, ...rest } = c.parent as ReturnType<typeof serializeItem> & Record<string, unknown>;
    await prisma.qcTemplateItem.update({ where: { id: item.id }, data: { section, sortOrder, active, locked, mandatory, itemType, data: asJson({ ...rest, origin_item: c.parent.id, originHash: hashItem(rest) }) } });
    updated++;
  }
  for (const r of diff.removed) {
    if (!pick.has(r.itemNumber)) continue;
    if (r.locked) { skipped++; continue; }
    await prisma.qcTemplateItem.delete({ where: { id: r.id } });
    removed++;
  }
  await prisma.qcTemplate.update({ where: { id: templateId }, data: { parentVersion: undefined } });
  await recordAudit({ clientId: clone.clientId, entityType: 'Template', entityId: templateId, action: 'template.merge', actor: actor(ctx), after: { added, updated, removed, skipped } });
  return { added, updated, removed, skipped };
}

// ───────────────────────── Excel import / export ─────────────────────────

const EXPORT_COLUMNS: Array<{ key: string; header: string; width: number }> = [
  { key: 'item_number', header: 'Item number', width: 12 }, { key: 'section', header: 'Section', width: 24 }, { key: 'location_or_element', header: 'Location or element', width: 24 },
  { key: 'check_description', header: 'Check description', width: 40 }, { key: 'what_to_check_and_method', header: 'What to check and method', width: 50 }, { key: 'reference', header: 'Reference', width: 28 },
  { key: 'guide_value_or_acceptable_tolerance', header: 'Guide value or tolerance', width: 32 }, { key: 'item_type', header: 'Item type', width: 14 }, { key: 'measurement_unit', header: 'Measurement unit', width: 12 },
  { key: 'tolerance_min', header: 'Tolerance minimum', width: 12 }, { key: 'tolerance_max', header: 'Tolerance maximum', width: 12 }, { key: 'photo_rule', header: 'Photo rule', width: 26 },
  { key: 'mandatory_item', header: 'Mandatory', width: 10 }, { key: 'locked_by_super_admin', header: 'Locked', width: 8 }, { key: 'applies_to_floor_systems', header: 'Floor systems', width: 18 },
  { key: 'applies_to_building_classes', header: 'Building classes', width: 18 }, { key: 'sequence', header: 'Sequence', width: 10 }, { key: 'active', header: 'Active', width: 8 },
];

export async function exportTemplateXlsx(scope: TemplateScope, templateId: string): Promise<Buffer> {
  const t = await getTemplate(scope, templateId);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Checklist items');
  ws.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  for (const i of t.items ?? []) {
    const tol = (i as Record<string, unknown>).tolerance_minimum_and_maximum as unknown[] | undefined;
    ws.addRow({ ...i, tolerance_min: tol?.[0] ?? '', tolerance_max: tol?.[1] ?? '', mandatory_item: i.mandatory ? 'Yes' : 'No', locked_by_super_admin: i.locked ? 'Yes' : 'No', active: i.active ? 'Yes' : 'No' });
  }
  const meta = wb.addWorksheet('Template');
  meta.addRows([['Name', t.name], ['Code', t.code], ['Version', t.versionLabel], ['Status', t.versionStatus], ['Level', t.level]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const yes = (v: unknown) => /^(y|yes|true|1)$/i.test(String(v ?? '').trim());

export interface ImportReport {
  rows: number;
  imported: number;
  errors: Array<{ row: number; message: string }>;
}

/** Import items from a workbook into a draft. All-or-nothing unless `partial` (row-by-row report either way). */
export async function importTemplateXlsx(ctx: QcContext, templateId: string, buffer: Buffer, opts: { partial?: boolean } = {}): Promise<ImportReport> {
  const t = await prisma.qcTemplate.findUniqueOrThrow({ where: { id: templateId } });
  assertMayEdit(ctx, t);
  if (t.versionStatus !== 'DRAFT') throw ApiError.conflict('Import into a draft version', 'TEMPLATE_PUBLISHED');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw ApiError.badRequest('The workbook has no sheets');
  const headers = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => headers.set(String(cell.value ?? '').trim().toLowerCase(), col));
  const get = (row: ExcelJS.Row, header: string) => {
    const col = headers.get(header.toLowerCase());
    const v = col ? row.getCell(col).value : null;
    return v === null || v === undefined ? '' : typeof v === 'object' && 'text' in (v as object) ? String((v as { text: string }).text) : String(v).trim();
  };
  if (!headers.has('item number') || !headers.has('check description')) throw ApiError.badRequest('The first sheet needs at least the columns "Item number" and "Check description"');

  const existing = new Set((await prisma.qcTemplateItem.findMany({ where: { templateId }, select: { itemNumber: true } })).map((i) => i.itemNumber));
  const seen = new Set<string>();
  const good: Array<Record<string, unknown>> = [];
  const errors: ImportReport['errors'] = [];
  let rows = 0;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    if (!get(row, 'Item number') && !get(row, 'Check description')) return;
    rows++;
    try {
      const itemNumber = get(row, 'Item number');
      if (existing.has(itemNumber) || seen.has(itemNumber)) throw new Error(`Item number ${itemNumber} is already used`);
      const tolMin = get(row, 'Tolerance minimum');
      const tolMax = get(row, 'Tolerance maximum');
      const item = validateItem({
        item_number: itemNumber, section: get(row, 'Section') || 'General', location_or_element: get(row, 'Location or element') || 'General', check_description: get(row, 'Check description'),
        what_to_check_and_method: get(row, 'What to check and method') || get(row, 'Check description'), reference: get(row, 'Reference') || 'See reference library',
        guide_value_or_acceptable_tolerance: get(row, 'Guide value or tolerance') || 'As specified', item_type: get(row, 'Item type') || 'Result only',
        measurement_unit: get(row, 'Measurement unit') || undefined, tolerance_minimum_and_maximum: tolMin || tolMax ? [tolMin, tolMax] : undefined,
        photo_rule: get(row, 'Photo rule') || 'When result is not OK (default)', mandatory_item: headers.has('mandatory') ? yes(get(row, 'Mandatory')) : true,
        locked_by_super_admin: t.level === 'BASE' && yes(get(row, 'Locked')), applies_to_floor_systems: get(row, 'Floor systems') || 'All',
        applies_to_building_classes: get(row, 'Building classes') || '1a, 1b, 2, 10a, 10b', sequence: Number(get(row, 'Sequence')) || n - 1, active: headers.has('active') ? yes(get(row, 'Active')) : true,
      });
      seen.add(itemNumber);
      good.push(item);
    } catch (err) {
      errors.push({ row: n, message: err instanceof ApiError || err instanceof Error ? err.message : 'Invalid row' });
    }
  });
  if (errors.length && !opts.partial) return { rows, imported: 0, errors };
  for (const item of good) await prisma.qcTemplateItem.create({ data: { templateId, ...itemColumns(item), data: asJson(item) } });
  await recordAudit({ clientId: t.clientId, entityType: 'Template', entityId: templateId, action: 'template.import', actor: actor(ctx), after: { imported: good.length, errors: errors.length } });
  return { rows, imported: good.length, errors };
}

/** Check a measurement against an item's tolerance. Returns null when no tolerance is set. */
export function checkTolerance(itemData: Record<string, unknown>, value: number): { within: boolean; min: number | null; max: number | null } | null {
  const tol = itemData.tolerance_minimum_and_maximum as unknown[] | undefined;
  if (!tol) return null;
  const min = tol[0] === '' || tol[0] === undefined ? null : Number(tol[0]);
  const max = tol[1] === '' || tol[1] === undefined ? null : Number(tol[1]);
  if (min === null && max === null) return null;
  return { within: (min === null || value >= min) && (max === null || value <= max), min, max };
}

export { getForm, validateAgainstSpec };
