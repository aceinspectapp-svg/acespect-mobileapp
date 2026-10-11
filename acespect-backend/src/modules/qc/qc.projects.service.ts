/**
 * Project set-up beyond the basic record: documents (E11), the inspection plan
 * by stage (E12), bulk lot import (F06), the lot x stage planning matrix and
 * the guarded project status lifecycle (REQ-PRJ-*).
 */
import { signMediaUrl } from '../../lib/mediaLinks';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../lib/audit';
import { validateAgainstSpec, validateOrThrow } from './spec/qcSpec';
import { QcContext } from './qc.context';
import { can } from './qc.permissions';
import { listStages } from './qc.templates.service';

const asJson = (v: unknown) => v as Prisma.InputJsonValue;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const actor = (ctx: QcContext) => ({ id: ctx.userId, role: ctx.role });

// ───────────────────────── Project documents (E11) ─────────────────────────

const DOC_VISIBILITY: Record<string, string> = {
  CLIENT_ADMIN: 'Client roles', CLIENT_USER: 'Client roles',
  MC_MANAGER: 'Master Contractor roles', MC_SITE_SUPERVISOR: 'Master Contractor roles', MC_PROJECT_MANAGER: 'Master Contractor roles',
  PRIVATE_INSPECTOR: 'Private Inspector',
};

export async function listDocuments(ctx: QcContext, projectId: string) {
  const rows = await prisma.qcRecord.findMany({ where: { kind: 'project_document', projectId }, orderBy: { createdAt: 'desc' } });
  const group = DOC_VISIBILITY[ctx.role];
  return rows
    .filter((r) => ctx.isSA || ctx.role === 'CLIENT_ADMIN' || (group && ((r.data as Record<string, unknown>).visible_to as string[] | undefined)?.includes(group)))
    .map((r) => {
      const d = r.data as Record<string, unknown>;
      // The file is only served through a short-lived signed link (see the media route).
      return { id: r.id, createdAt: r.createdAt, ...d, fileUrl: typeof d.fileUrl === 'string' ? signMediaUrl(d.fileUrl) : d.fileUrl };
    });
}

export async function addDocument(ctx: QcContext, projectId: string, input: Record<string, unknown>, file: { url: string; name: string; size: number; mime: string }) {
  const project = await prisma.qcProject.findUniqueOrThrow({ where: { id: projectId } });
  if (!/^application\/pdf$|^image\//.test(file.mime)) throw ApiError.badRequest('Documents must be PDF or image files');
  if (file.size > 50 * 1024 * 1024) throw ApiError.badRequest('The file is larger than 50 MB');
  const visible = Array.isArray(input.visible_to) ? input.visible_to : typeof input.visible_to === 'string' ? String(input.visible_to).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const data = validateOrThrow('E11', { ...input, visible_to: visible, file: file.url }, { skipRequired: ['site_or_lot'] });
  if (data.applies_to !== 'Project' && !data.site_or_lot) throw ApiError.badRequest('Choose the site or lot this document applies to');

  // A new revision of the same document supersedes the old one; nothing is deleted.
  const previous = await prisma.qcRecord.findMany({ where: { kind: 'project_document', projectId, status: 'Current', title: str(data.title) } });
  for (const p of previous) {
    const pd = p.data as Record<string, unknown>;
    if (pd.document_type === data.document_type) await prisma.qcRecord.update({ where: { id: p.id }, data: { status: 'Superseded', data: asJson({ ...pd, status: 'Superseded' }) } });
  }
  const row = await prisma.qcRecord.create({
    data: {
      kind: 'project_document', clientId: project.clientId, projectId, status: 'Current', title: str(data.title), createdById: ctx.userId,
      data: asJson({ ...data, status: 'Current', fileUrl: file.url, fileName: file.name, fileSize: file.size, uploadedBy: ctx.userId, uploadedAt: new Date().toISOString() }),
    },
  });
  await recordAudit({ clientId: project.clientId, entityType: 'Project', entityId: projectId, action: 'document.upload', actor: actor(ctx), after: { title: data.title, revision: data.revision } });
  return { id: row.id, ...(row.data as Record<string, unknown>) };
}

// ───────────────────────── Inspection plan (E12) ─────────────────────────

export interface PlanStage {
  id: string;
  stageId: string;
  stageNumber: string;
  stageName: string;
  sequence: number;
  enabled: boolean;
  mandatoryNotification: boolean;
  combinedWithStage: string | null;
  templateId: string | null;
  templateVersion: string | null;
  noticeDays: number | null;
  holdPoint: boolean;
  defaultInspectorId: string | null;
}

function toPlanStage(row: { id: string; data: unknown }, stage: Record<string, unknown> | undefined): PlanStage {
  const d = row.data as Record<string, unknown>;
  return {
    id: row.id,
    stageId: str(d.stageId),
    stageNumber: str(stage?.stage_number),
    stageName: str(stage?.stage_name),
    sequence: Number(d.sequence ?? stage?.sequence ?? 0),
    enabled: d.enabled !== false,
    mandatoryNotification: stage?.statutory_mandatory_notification_stage === true,
    combinedWithStage: (d.combinedWithStage as string | null) ?? null,
    templateId: (d.templateId as string | null) ?? null,
    templateVersion: (d.templateVersion as string | null) ?? null,
    noticeDays: d.noticeDays === undefined || d.noticeDays === null ? null : Number(d.noticeDays),
    holdPoint: d.holdPoint === true,
    defaultInspectorId: (d.defaultInspectorId as string | null) ?? null,
  };
}

export async function getPlan(projectId: string): Promise<PlanStage[]> {
  const [rows, stages] = await Promise.all([prisma.qcRecord.findMany({ where: { kind: 'project_stage', projectId } }), listStages()]);
  const byId = new Map(stages.map((s) => [String((s as { id: string }).id), s as unknown as Record<string, unknown>]));
  return rows.map((r) => toPlanStage(r, byId.get(str((r.data as Record<string, unknown>).stageId)))).sort((a, b) => a.sequence - b.sequence);
}

/** Create the plan rows for every active stage, enabled by default, using the latest published base template for each. */
export async function seedPlan(ctx: QcContext, projectId: string) {
  const project = await prisma.qcProject.findUniqueOrThrow({ where: { id: projectId } });
  const existing = await prisma.qcRecord.findMany({ where: { kind: 'project_stage', projectId } });
  const have = new Set(existing.map((e) => str((e.data as Record<string, unknown>).stageId)));
  const stages = (await listStages()) as unknown as Array<Record<string, unknown> & { id: string }>;
  let created = 0;
  for (const s of stages) {
    if (s.active === false || have.has(s.id)) continue;
    const tpl = await prisma.qcTemplate.findFirst({ where: { stageKey: s.id, level: 'BASE', versionStatus: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    await prisma.qcRecord.create({
      data: {
        kind: 'project_stage', clientId: project.clientId, projectId, title: str(s.stage_name),
        data: asJson({ stageId: s.id, sequence: s.sequence, enabled: true, templateId: tpl?.id ?? null, templateVersion: tpl ? (tpl.data as Record<string, unknown>).version_label ?? null : null, noticeDays: s.statutory_mandatory_notification_stage ? 2 : null, holdPoint: false }),
      },
    });
    created++;
  }
  if (created) await recordAudit({ clientId: project.clientId, entityType: 'Project', entityId: projectId, action: 'plan.seed', actor: actor(ctx), after: { stages: created } });
  return getPlan(projectId);
}

export async function updatePlanStage(ctx: QcContext, projectId: string, planStageId: string, input: Record<string, unknown>) {
  const project = await prisma.qcProject.findUniqueOrThrow({ where: { id: projectId } });
  const row = await prisma.qcRecord.findFirst({ where: { id: planStageId, kind: 'project_stage', projectId } });
  if (!row) throw ApiError.notFound('Stage not found');
  const plan = await getPlan(projectId);
  const current = plan.find((p) => p.id === planStageId)!;
  const d = { ...(row.data as Record<string, unknown>) };

  if (typeof input.enabled === 'boolean') {
    // A statutory notification stage cannot be switched off (REQ-PRJ-004).
    if (!input.enabled && current.mandatoryNotification) throw ApiError.badRequest(`${current.stageName} is a mandatory notification stage and cannot be disabled`);
    d.enabled = input.enabled;
  }
  if (input.combinedWithStage !== undefined) {
    const target = input.combinedWithStage ? plan.find((p) => p.stageId === input.combinedWithStage) : null;
    if (input.combinedWithStage && (!target || target.stageId === current.stageId)) throw ApiError.badRequest('Choose a different stage to combine with');
    if (target && current.mandatoryNotification && target.sequence !== current.sequence) {
      // A mandatory stage keeps its own visit; only non-statutory stages fold into another.
      throw ApiError.badRequest('A mandatory notification stage cannot be combined into another stage');
    }
    d.combinedWithStage = input.combinedWithStage || null;
  }
  if (input.templateId !== undefined) {
    const tpl = await prisma.qcTemplate.findUnique({ where: { id: String(input.templateId) } });
    if (!tpl || tpl.versionStatus !== 'PUBLISHED') throw ApiError.badRequest('Choose a published template version');
    if (tpl.level !== 'BASE' && tpl.clientId !== project.clientId) throw ApiError.badRequest('That template belongs to a different client');
    if (tpl.level === 'PROJECT' && tpl.projectId !== projectId) throw ApiError.badRequest('That template belongs to a different project');
    if (tpl.stageKey && tpl.stageKey !== current.stageId) throw ApiError.badRequest('That template is for a different stage');
    d.templateId = tpl.id;
    d.templateVersion = (tpl.data as Record<string, unknown>).version_label ?? null;
  }
  if (input.noticeDays !== undefined) {
    const n = input.noticeDays === null || input.noticeDays === '' ? null : Number(input.noticeDays);
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 30)) throw ApiError.badRequest('Notice before inspection must be 0 to 30 days');
    d.noticeDays = n;
  }
  if (typeof input.holdPoint === 'boolean') {
    if (!can(ctx, 'projects.holdPoints')) throw ApiError.forbidden('Only a Client Admin can set hold points');
    d.holdPoint = input.holdPoint;
  }
  if (input.defaultInspectorId !== undefined) {
    if (input.defaultInspectorId) {
      const ok = await prisma.qcMembership.findFirst({ where: { userId: String(input.defaultInspectorId), clientId: project.clientId, role: 'PRIVATE_INSPECTOR', status: 'ACTIVE' } });
      if (!ok) throw ApiError.badRequest('That person is not an approved inspector for this client');
    }
    d.defaultInspectorId = input.defaultInspectorId || null;
  }
  if (typeof input.sequence === 'number') d.sequence = input.sequence;
  await prisma.qcRecord.update({ where: { id: planStageId }, data: { data: asJson(d) } });
  await recordAudit({ clientId: project.clientId, entityType: 'Project', entityId: projectId, action: 'plan.update', actor: actor(ctx), before: current, after: input, supportSessionId: ctx.supportSession?.id ?? null });
  return getPlan(projectId);
}

// ───────────────────────── Lots: bulk import (F06) and applicability ─────────────────────────

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const LOT_COLUMNS: Record<string, string> = {
  'lot number': 'lot_number', 'lot reference': 'lot_reference', 'unit number': 'unit_or_apartment_number', 'unit': 'unit_or_apartment_number', building: 'building_or_block_name',
  level: 'level_or_floor', 'street address': 'street_address', 'dwelling type': 'dwelling_type', 'ncc class': 'ncc_building_class', 'building class': 'ncc_building_class',
  storeys: 'storeys', 'floor system': 'floor_system', frame: 'frame', 'floor area': 'floor_area', 'plan number': 'plan_type_and_number', 'wall cladding': 'wall_cladding', 'roof cover': 'roof_cover',
};

export interface LotImportReport {
  rows: number;
  added: number;
  updated: number;
  errors: Array<{ row: number; message: string }>;
}

/** F06. Row-by-row validation; with errors nothing is imported unless `partial` (REQ-PRJ-006). */
export async function importLots(ctx: QcContext, siteId: string, csv: string, opts: { mode: 'add' | 'update'; partial?: boolean }): Promise<LotImportReport> {
  const site = await prisma.qcSite.findUniqueOrThrow({ where: { id: siteId }, include: { project: true } });
  const rows = parseCsv(csv);
  if (rows.length < 2) throw ApiError.badRequest('The file needs a header row and at least one lot');
  if (rows.length > 2001) throw ApiError.badRequest('Import at most 2,000 lots at a time');
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const keyFor = header.map((h) => LOT_COLUMNS[h]);
  if (!keyFor.includes('lot_number') && !keyFor.includes('lot_reference')) throw ApiError.badRequest('The file needs a "Lot number" column');
  const existing = await prisma.qcProperty.findMany({ where: { siteId }, select: { id: true, name: true, data: true } });
  const byName = new Map(existing.map((e) => [e.name, e]));
  const report: LotImportReport = { rows: rows.length - 1, added: 0, updated: 0, errors: [] };
  const plan: Array<{ mode: 'add' | 'update'; id?: string; data: Record<string, unknown> }> = [];
  const seen = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const raw: Record<string, unknown> = {};
    keyFor.forEach((k, i) => { if (k && rows[r]![i]?.trim()) raw[k] = rows[r]![i]!.trim(); });
    if (raw.storeys) raw.storeys = Number(raw.storeys);
    if (!raw.lot_reference && raw.lot_number) raw.lot_reference = raw.unit_or_apartment_number ? `${raw.lot_number}/${raw.unit_or_apartment_number}` : raw.lot_number;
    const ref = str(raw.lot_reference);
    try {
      if (!ref) throw new Error('Lot number is required');
      if (seen.has(ref)) throw new Error(`Lot ${ref} appears more than once in the file`);
      seen.add(ref);
      const known = byName.get(ref);
      if (known && opts.mode === 'add') throw new Error(`Lot ${ref} already exists on this site`);
      const merged = known ? { ...(known.data as Record<string, unknown>), ...raw } : { dwelling_type: 'Detached house', ...raw };
      const { data, issues } = validateAgainstSpec('E09', merged, { partial: false, skipRequired: ['street_address', 'ncc_building_class', 'storeys', 'floor_system', 'frame', 'floor_area', 'plan_type_and_number', 'wall_cladding', 'roof_cover'] });
      if (issues.length) throw new Error(issues.map((i) => i.message).join('; '));
      plan.push({ mode: known ? 'update' : 'add', id: known?.id, data });
    } catch (err) {
      report.errors.push({ row: r + 1, message: err instanceof Error ? err.message : 'Invalid row' });
    }
  }
  if (report.errors.length && !opts.partial) return report;

  const { createLotRow, updateLotRow } = await import('./qc.master.service').then((m) => ({ createLotRow: m.createLot, updateLotRow: m.updateLot }));
  for (const p of plan) {
    if (p.mode === 'add') { await createLotRow({ ...p.data, siteId }, { lenient: true }); report.added++; }
    else { await updateLotRow(p.id!, p.data, { lenient: true }); report.updated++; }
  }
  await recordAudit({ clientId: site.project.clientId, entityType: 'Site', entityId: siteId, action: 'lots.import', actor: actor(ctx), after: { added: report.added, updated: report.updated, errors: report.errors.length } });
  return report;
}

export function csvTemplate(): string {
  return 'Lot number,Unit number,Building,Level,Street address,Dwelling type,NCC class,Storeys,Floor system,Frame\n1,,,,12 Example St,Detached house,1a,2,Slab on ground,Timber\n';
}

/** Floor systems named in a stage or item ("Slab on ground") match the lot's longer option ("Slab on ground - waffle pod"). */
export function floorAllowed(allowed: string, lotFloor: string): boolean {
  const a = allowed.trim().toLowerCase();
  const f = lotFloor.trim().toLowerCase();
  if (!a || a === 'all' || !f) return true;
  return a.split(/[,;]/).map((x) => x.trim()).filter(Boolean).some((tok) => f === tok || f.startsWith(tok) || tok.startsWith(f));
}

/** Does this stage apply to this lot, by the stage's floor systems and building classes (REQ-PRJ-006)? */
export function stageApplies(stage: Record<string, unknown>, lot: Record<string, unknown>): boolean {
  if (!floorAllowed(String(stage.applies_to_floor_systems ?? 'All'), String(lot.floor_system ?? ''))) return false;
  const classes = (stage.applies_to_building_classes as string[] | undefined) ?? [];
  const lotClass = String(lot.ncc_building_class ?? '').toLowerCase();
  if (classes.length && lotClass && !classes.map((c) => c.toLowerCase()).includes(lotClass)) return false;
  return true;
}

/** Lots x stages: whether each applies, and the latest inspection status (the planning matrix, REQ-INP-001). */
export async function planMatrix(projectId: string, siteId?: string) {
  const [plan, stages, lots] = await Promise.all([
    getPlan(projectId),
    listStages(),
    prisma.qcProperty.findMany({ where: { projectId, siteId: siteId || undefined }, orderBy: { name: 'asc' }, select: { id: true, name: true, siteId: true, lotStatus: true, data: true } }),
  ]);
  const inspections = await prisma.qcInspection.findMany({
    where: { projectId, propertyId: { in: lots.map((l) => l.id) }, status: { not: 'CANCELLED' } },
    select: { id: true, propertyId: true, stageKey: true, status: true, plannedFrom: true, inspectorId: true, type: true },
    orderBy: { createdAt: 'desc' },
  });
  const stageDef = new Map(stages.map((s) => [String((s as { id: string }).id), s as unknown as Record<string, unknown>]));
  return {
    stages: plan.filter((p) => p.enabled),
    lots: lots.map((l) => ({
      id: l.id, name: l.name, siteId: l.siteId, lotStatus: l.lotStatus,
      cells: plan.filter((p) => p.enabled).map((p) => {
        const applies = stageApplies(stageDef.get(p.stageId) ?? {}, l.data as Record<string, unknown>);
        const insp = inspections.filter((i) => i.propertyId === l.id && i.stageKey === p.stageId);
        const latest = insp[0];
        return { stageId: p.stageId, applies, status: latest?.status ?? (applies ? 'NOT_PLANNED' : 'NOT_APPLICABLE'), inspectionId: latest?.id ?? null, plannedFrom: latest?.plannedFrom ?? null, inspectorId: latest?.inspectorId ?? null };
      }),
    })),
  };
}

// ───────────────────────── Project status lifecycle ─────────────────────────

const STATUS_FLOW: Record<string, string[]> = {
  SETUP: ['CONSTRUCTION', 'ARCHIVED'],
  CONSTRUCTION: ['PRACTICAL_COMPLETION', 'SETUP'],
  PRACTICAL_COMPLETION: ['CONSTRUCTION'],
  DLP: ['ARCHIVED'], // set by practical completion (F36); leaves via sign-off (F37)
  DLP_COMPLETE: ['ARCHIVED'],
  ARCHIVED: ['CONSTRUCTION', 'DLP_COMPLETE'],
};

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  SETUP: 'Set-up', CONSTRUCTION: 'Construction', PRACTICAL_COMPLETION: 'Practical completion', DLP: 'Defects liability period', DLP_COMPLETE: 'DLP complete', ARCHIVED: 'Archived',
};

/** Move a project through its lifecycle with the guards the spec asks for (REQ-PRJ-002). */
export async function transitionProject(ctx: QcContext, projectId: string, to: string, reason?: string) {
  const project = await prisma.qcProject.findUniqueOrThrow({ where: { id: projectId } });
  if (project.status === to) return project;
  if (!(STATUS_FLOW[project.status] ?? []).includes(to)) {
    throw ApiError.conflict(`A project cannot move from ${PROJECT_STATUS_LABEL[project.status] ?? project.status} to ${PROJECT_STATUS_LABEL[to] ?? to}`, 'INVALID_TRANSITION');
  }
  if (to === 'CONSTRUCTION' && project.status === 'SETUP') {
    const [lots, plan] = await Promise.all([prisma.qcProperty.count({ where: { projectId } }), getPlan(projectId)]);
    const problems: string[] = [];
    if (!project.builderId) problems.push('a builder');
    if (lots === 0) problems.push('at least one lot');
    if (!plan.some((p) => p.enabled)) problems.push('an inspection plan with at least one enabled stage');
    else if (plan.some((p) => p.enabled && !p.templateId)) problems.push('a template for every enabled stage');
    if (problems.length) throw ApiError.badRequest(`Before construction starts the project needs ${problems.join(', ')}`);
  }
  if (to === 'SETUP') {
    const started = await prisma.qcInspection.count({ where: { projectId, status: { in: ['IN_PROGRESS', 'COMPLETED'] } } });
    if (started > 0) throw ApiError.conflict('Inspections have already started, so the project cannot return to set-up', 'HAS_INSPECTIONS');
  }
  if (to === 'ARCHIVED') {
    const open = await prisma.qcDefect.count({ where: { property: { projectId }, isDraft: false, status: { terminal: false } } });
    if (open > 0) throw ApiError.conflict(`${open} defect(s) are still open, so the project cannot be archived`, 'OPEN_DEFECTS');
    if (!reason?.trim()) throw ApiError.badRequest('A reason for archiving is required');
  }
  if (project.status === 'ARCHIVED' && !reason?.trim()) throw ApiError.badRequest('A reason for reopening is required');
  const updated = await prisma.qcProject.update({ where: { id: projectId }, data: { status: to } });
  await recordAudit({ clientId: project.clientId, entityType: 'Project', entityId: projectId, action: 'project.status', actor: actor(ctx), supportSessionId: ctx.supportSession?.id ?? null, reason: reason ?? null, before: { status: project.status }, after: { status: to } });
  return updated;
}
