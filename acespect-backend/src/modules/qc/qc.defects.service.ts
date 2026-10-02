import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { defectInclude, requireExists, userSelect } from './qc.shared';
import {
  ACTIONS,
  ActorContext,
  ActorRole,
  DefectView,
  availableActions,
  canPerform,
  getAction,
} from './qc.lifecycle';
import { SEVERITY_KEY_TO_PRIORITY } from './qc.schemas';
import { FormSpec, getForm, validateAgainstSpec, validateOrThrow } from './spec/qcSpec';

type Tx = Prisma.TransactionClient;
type Requester = { id: string; role: string };
type Input = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DefectRow = any;

// ───────────────────────── Actor resolution ─────────────────────────

const MEMBER_ROLE_TO_ACTOR: Record<string, ActorRole> = {
  CLIENT_ADMIN: 'CLIENT_ADMIN',
  CLIENT_USER: 'CLIENT_USER',
  MC_MANAGER: 'MC_MANAGER',
  MC_SITE_SUPERVISOR: 'MC_SITE_SUPERVISOR',
  MC_PROJECT_MANAGER: 'MC_PROJECT_MANAGER',
  TRADE_USER: 'TRADE_USER',
  PRIVATE_INSPECTOR: 'PRIVATE_INSPECTOR',
};

/**
 * Which lifecycle role is this user acting as on this defect? The Super Admin
 * (User.role ADMIN) acts as anyone, in logged support mode. Everyone else
 * gets their membership role in the defect's client, narrowed by project /
 * assignment scope. Accounts that predate memberships (mobile INSPECTOR /
 * FIELD_USER) act as a Private Inspector on defects assigned to them.
 */
export async function resolveActor(user: Requester, defect: DefectRow): Promise<ActorContext | null> {
  if (user.role === 'ADMIN') return { role: 'SA', permissions: [] };

  const project = defect.property.project;
  const membership = await prisma.qcMembership.findFirst({
    where: { userId: user.id, clientId: project.clientId, status: 'ACTIVE' },
    include: { projects: { select: { id: true } } },
  });

  if (membership) {
    const role = MEMBER_ROLE_TO_ACTOR[membership.role]!;
    const restricted = membership.projects.length > 0 && !membership.projects.some((p) => p.id === project.id);
    if (restricted && role !== 'CLIENT_ADMIN') return null;
    if (role === 'PRIVATE_INSPECTOR' && defect.assignedToId !== user.id) return null;
    // Until the Inspector releases it, a defect is theirs alone: drafts are invisible to everyone else, and
    // the Builder and Trades never see an Open (unreleased) defect (REQ-DEF-004).
    if (defect.isDraft && role !== 'PRIVATE_INSPECTOR') return null;
    if (defect.status.key === 'open' && (role.startsWith('MC_') || role === 'TRADE_USER')) return null;
    if (role === 'TRADE_USER') {
      const mine = defect.allocatedTradeUserId === user.id;
      const myCompany = !defect.allocatedTradeUserId && !!membership.tradeCompanyId && membership.tradeCompanyId === defect.allocatedTradeCompanyId;
      if (!mine && !myCompany) return null;
    }
    return { role, permissions: membership.optionalPermissions };
  }

  if ((user.role === 'INSPECTOR' || user.role === 'FIELD_USER') && defect.assignedToId === user.id) {
    return { role: 'PRIVATE_INSPECTOR', permissions: [] };
  }
  return null;
}

function toView(defect: DefectRow): DefectView {
  const project = defect.property.project;
  return {
    statusKey: defect.status.key,
    isDraft: defect.isDraft,
    severityKey: defect.severity?.key ?? null,
    disputeBy: defect.disputeBy,
    disputeReviewRequested: defect.disputeReviewRequested,
    flags: defect.flags ?? [],
    closurePolicy: project.closurePolicy,
    deskReviewAllowed: project.deskReviewAllowed,
  };
}

// ───────────────────────── Reads ─────────────────────────

export interface DefectFilters {
  propertyId?: string;
  projectId?: string;
  clientId?: string;
  statusKey?: string;
  severityKey?: string;
  assignedToId?: string;
  q?: string;
  draft?: boolean;
  flag?: string;
}

export async function listDefects(filters: DefectFilters) {
  const where: Prisma.QcDefectWhereInput = {
    propertyId: filters.propertyId,
    assignedToId: filters.assignedToId,
    isDraft: filters.draft,
    status: filters.statusKey ? { key: filters.statusKey } : undefined,
    severity: filters.severityKey ? { key: filters.severityKey } : undefined,
    flags: filters.flag ? { has: filters.flag } : undefined,
    property:
      filters.projectId || filters.clientId
        ? { projectId: filters.projectId, project: filters.clientId ? { clientId: filters.clientId } : undefined }
        : undefined,
    OR: filters.q
      ? [
          { defectRef: { contains: filters.q, mode: 'insensitive' } },
          { title: { contains: filters.q, mode: 'insensitive' } },
          { summary: { contains: filters.q, mode: 'insensitive' } },
          { location: { contains: filters.q, mode: 'insensitive' } },
        ]
      : undefined,
  };
  return prisma.qcDefect.findMany({ where, include: defectInclude, orderBy: { createdAt: 'desc' }, take: 500 });
}

async function loadDefect(id: string): Promise<DefectRow> {
  const defect = await prisma.qcDefect.findUnique({ where: { id }, include: defectInclude });
  if (!defect) throw ApiError.notFound('Defect not found');
  return defect;
}

/** Plain lookup (mobile's "Defect" link): any signed-in user the defect is visible to. */
export async function getDefectForUser(id: string, requester: Requester) {
  const defect = await loadDefect(id);
  const actor = await resolveActor(requester, defect);
  if (!actor) throw ApiError.forbidden('This defect is not available to you');
  return { defect, actor };
}

const COMMENT_VISIBILITY: Record<ActorRole, string[]> = {
  SA: ['ALL', 'CLIENT_INSPECTOR', 'BUILDER_TRADE', 'INSPECTOR_ONLY'],
  CLIENT_ADMIN: ['ALL', 'CLIENT_INSPECTOR'],
  CLIENT_USER: ['ALL', 'CLIENT_INSPECTOR'],
  MC_MANAGER: ['ALL', 'BUILDER_TRADE'],
  MC_SITE_SUPERVISOR: ['ALL', 'BUILDER_TRADE'],
  MC_PROJECT_MANAGER: ['ALL', 'BUILDER_TRADE'],
  TRADE_USER: ['ALL', 'BUILDER_TRADE'],
  PRIVATE_INSPECTOR: ['ALL', 'CLIENT_INSPECTOR', 'INSPECTOR_ONLY'],
};

/** Full record: the defect, its append-only history and the comments this requester may see. */
export async function getDefectDetail(id: string, requester: Requester) {
  const { defect, actor } = await getDefectForUser(id, requester);
  const [events, comments] = await Promise.all([
    prisma.qcDefectEvent.findMany({
      where: { defectId: id },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: userSelect } },
    }),
    prisma.qcDefectComment.findMany({
      where: { defectId: id, visibleTo: { in: COMMENT_VISIBILITY[actor.role] } },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: userSelect } },
    }),
  ]);
  const statuses = await prisma.qcStatus.findMany({ select: { id: true, key: true, label: true } });
  return { defect, events, comments, statuses, actor, allowedActions: availableActions(actor, toView(defect)) };
}

// ───────────────────────── Create / edit drafts ─────────────────────────

async function nextDefectRef(tx: Tx, projectId: string): Promise<string> {
  const p = await tx.qcProject.update({
    where: { id: projectId },
    data: { defectSeq: { increment: 1 } },
    select: { defectSeq: true, jobNumber: true, projectRef: true },
  });
  return `${p.jobNumber ?? p.projectRef ?? 'QC'}-D${String(p.defectSeq).padStart(4, '0')}`;
}

async function severityByLabel(label: string) {
  const sev = await prisma.qcSeverity.findFirst({ where: { label, active: true } });
  if (!sev) throw ApiError.badRequest(`Unknown severity "${label}"`);
  return sev;
}

/** Spec field values (F16 keys) -> QcDefect columns. Used by both draft edits and the confirm action. */
async function f16ToColumns(data: Input): Promise<Prisma.QcDefectUncheckedUpdateInput> {
  const cols: Prisma.QcDefectUncheckedUpdateInput = {};
  if ('defect_title' in data) cols.title = data.defect_title as string;
  if ('description' in data) cols.summary = data.description as string;
  if ('room_or_area' in data) {
    cols.roomArea = data.room_or_area as string;
    cols.location = data.room_or_area as string;
  }
  if ('element' in data) cols.element = data.element as string;
  if ('location_detail' in data) cols.locationDetails = data.location_detail as string;
  if ('nature_of_defect' in data) cols.nature = data.nature_of_defect as string;
  if ('code_or_standard_reference' in data) cols.codeRef = data.code_or_standard_reference as string;
  if ('severity' in data) cols.severityId = (await severityByLabel(data.severity as string)).id;
  if ('trade_category' in data) {
    await requireExists('qcTradeCategory', data.trade_category as string, 'Trade category');
    cols.tradeCategoryId = data.trade_category as string;
  }
  return cols;
}

/**
 * Defects are assigned to a Private Inspector (REQ-USR-005, REQ-DEF-001):
 * someone with an active Private Inspector membership, or a legacy mobile
 * account with no QC membership at all. An inspector whose credentials are
 * suspended or past their expiry, or who isn't approved for this client,
 * can't take new work.
 */
async function assertAssignableInspector(userId: string, clientId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { qcMemberships: true, qcInspectorCredential: { include: { approvedClients: { select: { id: true } } } } },
  });
  if (!user || !user.isActive) throw ApiError.badRequest('That account is not active');
  const isPI = user.qcMemberships.some((m) => m.role === 'PRIVATE_INSPECTOR' && m.status === 'ACTIVE');
  const isLegacy = user.qcMemberships.length === 0 && (user.role === 'INSPECTOR' || user.role === 'FIELD_USER');
  if (!isPI && !isLegacy) throw ApiError.badRequest('Defects are assigned to a Private Inspector');
  const cred = user.qcInspectorCredential;
  if (!cred) return;
  if (cred.status === 'SUSPENDED' || cred.status === 'EXPIRED') {
    throw ApiError.badRequest(`This inspector's credentials are ${cred.status.toLowerCase()}, so they cannot take new defects`);
  }
  const expiry = (cred.data as Input).registration_expiry;
  if (typeof expiry === 'string' && expiry < new Date().toISOString().slice(0, 10)) {
    throw ApiError.badRequest("This inspector's registration has expired, so they cannot take new defects");
  }
  if (cred.approvedClients.length > 0 && !cred.approvedClients.some((c) => c.id === clientId)) {
    throw ApiError.badRequest('This inspector is not approved for this client');
  }
}

export interface CreateDefectInput extends Input {
  propertyId: string;
  assignedToId: string;
  dueDate?: string;
}

/**
 * An admin creates a defect by picking a lot and a person; everything else
 * is filled in later and the defect stays a draft until confirmed as Open
 * (F16). Descriptive F16 fields may be supplied up front too.
 */
export async function createDefect(creator: Requester, input: CreateDefectInput) {
  const property = await prisma.qcProperty.findUnique({ where: { id: input.propertyId }, include: { project: true } });
  if (!property) throw ApiError.notFound('Property not found');
  await assertAssignableInspector(input.assignedToId, property.project.clientId);
  const openStatus = await prisma.qcStatus.findUnique({ where: { key: 'open' } });
  if (!openStatus) throw ApiError.badRequest('The Open status is missing -- run the QC migrations');

  const { data } = validateAgainstSpec('F16', input, { partial: true });
  const cols = await f16ToColumns(data);
  const severity = cols.severityId ? await prisma.qcSeverity.findUnique({ where: { id: cols.severityId as string } }) : null;
  const priority = severity ? SEVERITY_KEY_TO_PRIORITY[severity.key] ?? 'LOW' : 'LOW';

  const id = await prisma.$transaction(async (tx) => {
    const defectRef = await nextDefectRef(tx, property.projectId);
    const defect = await tx.qcDefect.create({
      data: {
        ...(cols as Prisma.QcDefectUncheckedCreateInput),
        defectRef,
        propertyId: property.id,
        statusId: openStatus.id,
        isDraft: true,
        assignedToId: input.assignedToId,
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        createdById: creator.id,
      },
    });
    await tx.qcTask.create({
      data: { defectId: defect.id, assignedToId: input.assignedToId, priority, dueDate: defect.dueDate },
    });
    await appendEvent(tx, {
      defectId: defect.id,
      type: 'Draft created',
      toStatusId: openStatus.id,
      actorId: creator.id,
      actorRole: creator.role === 'ADMIN' ? 'SA' : 'PRIVATE_INSPECTOR',
      onBehalf: creator.role === 'ADMIN',
      note: null,
      changes: { assignedToId: input.assignedToId, propertyId: property.id },
    });
    return defect.id;
  });
  return loadDefect(id);
}

const DESCRIPTIVE_LEGACY_KEYS = ['location', 'locationDetails', 'summary', 'severityId'];

/**
 * Plain edits. Statuses never change here (lifecycle actions only). While a
 * defect is a draft its descriptive fields can be saved piecemeal (F16 keys,
 * or the legacy location/summary/severityId keys older mobile builds send);
 * once confirmed they only change through actions. Only the Super Admin may
 * reassign or move the due date.
 */
export async function updateDefect(id: string, input: Input, requester: Requester) {
  const defect = await loadDefect(id);
  const actor = await resolveActor(requester, defect);
  if (!actor) throw ApiError.forbidden('This defect is not assigned to you');
  if (input.statusId !== undefined) {
    throw ApiError.badRequest('Defect status only changes through lifecycle actions (POST /qc/defects/:id/actions/:action)');
  }
  const isSA = actor.role === 'SA';

  const cols: Prisma.QcDefectUncheckedUpdateInput = {};
  const f16 = validateAgainstSpec('F16', input, { partial: true });
  const touchesDescription = DESCRIPTIVE_LEGACY_KEYS.some((k) => k in input) || Object.keys(f16.data).length > 0;

  if (touchesDescription) {
    if (!defect.isDraft && !isSA) throw ApiError.badRequest('This defect is confirmed; change it through a lifecycle action');
    const { data, issues } = f16;
    if (issues.length) throw ApiError.badRequest(issues.map((i) => i.message).join('; '));
    Object.assign(cols, await f16ToColumns(data));
    // Legacy keys from older mobile builds.
    if (typeof input.location === 'string' && !('room_or_area' in data)) cols.location = input.location;
    if (typeof input.locationDetails === 'string' && !('location_detail' in data)) cols.locationDetails = input.locationDetails;
    if (typeof input.summary === 'string' && !('description' in data)) cols.summary = input.summary;
    if (typeof input.severityId === 'string') {
      await requireExists('qcSeverity', input.severityId, 'Severity');
      cols.severityId = input.severityId;
    }
  }
  if (input.dueDate !== undefined) {
    if (!isSA) throw ApiError.forbidden('Only an admin can change the due date');
    cols.dueDate = input.dueDate ? new Date(input.dueDate as string) : null;
  }
  if (input.assignedToId !== undefined) {
    if (!isSA) throw ApiError.forbidden('Only an admin can reassign a defect');
    if (input.assignedToId) await assertAssignableInspector(input.assignedToId as string, defect.property.project.clientId);
    cols.assignedToId = (input.assignedToId as string | null) ?? null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.qcDefect.update({ where: { id }, data: cols });
    if (cols.severityId) {
      const sev = await tx.qcSeverity.findUnique({ where: { id: cols.severityId as string } });
      if (sev) await tx.qcTask.updateMany({ where: { defectId: id }, data: { priority: SEVERITY_KEY_TO_PRIORITY[sev.key] ?? 'LOW' } });
    }
    if (typeof cols.assignedToId === 'string' && cols.assignedToId !== defect.assignedToId) {
      await tx.qcTask.updateMany({ where: { defectId: id }, data: { assignedToId: cols.assignedToId } });
      await appendEvent(tx, {
        defectId: id,
        type: 'Correction',
        actorId: requester.id,
        actorRole: actor.role,
        onBehalf: actor.role === 'SA',
        note: 'Reassigned',
        changes: { assignedToId: { from: defect.assignedToId, to: cols.assignedToId } },
      });
    }
  });
  return loadDefect(id);
}

// ───────────────────────── Event log (E25) ─────────────────────────

interface EventInput {
  defectId: string;
  type: string;
  fromStatusId?: string | null;
  toStatusId?: string | null;
  actorId: string;
  actorRole: string;
  onBehalf?: boolean;
  note?: string | null;
  changes?: Input;
  attachments?: string[];
  reworkCount?: number;
}

async function appendEvent(tx: Tx, e: EventInput) {
  const prev = await tx.qcDefectEvent.findFirst({ where: { defectId: e.defectId }, orderBy: { createdAt: 'desc' }, select: { hash: true } });
  const createdAt = new Date();
  const changes = (e.changes ?? {}) as Prisma.InputJsonValue;
  const hash = createHash('sha256')
    .update([prev?.hash ?? '', e.defectId, e.type, e.fromStatusId ?? '', e.toStatusId ?? '', e.actorId, e.note ?? '', JSON.stringify(changes), createdAt.toISOString()].join('|'))
    .digest('hex');
  return tx.qcDefectEvent.create({
    data: {
      defectId: e.defectId,
      type: e.type,
      fromStatusId: e.fromStatusId ?? null,
      toStatusId: e.toStatusId ?? null,
      actorId: e.actorId,
      actorRole: e.actorRole,
      onBehalf: e.onBehalf ?? false,
      note: e.note ?? null,
      changes,
      attachments: (e.attachments ?? []) as Prisma.InputJsonValue,
      reworkCount: e.reworkCount ?? 0,
      prevHash: prev?.hash ?? null,
      hash,
      createdAt,
    },
  });
}

// ───────────────────────── Actions ─────────────────────────

const statusIdCache = new Map<string, string>();
async function statusId(key: string): Promise<string> {
  const cached = statusIdCache.get(key);
  if (cached) return cached;
  const s = await prisma.qcStatus.findUnique({ where: { key } });
  if (!s) throw ApiError.badRequest(`Status "${key}" is missing -- run the QC migrations`);
  statusIdCache.set(key, s.id);
  return s.id;
}

function filesField(form: FormSpec): string | undefined {
  return form.fields.find((f) => f.kind === 'files')?.key;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const todayIso = () => new Date().toISOString().slice(0, 10);

interface ActionResult {
  /** Target status key (omit to stay put). */
  toStatus?: string;
  cols?: Prisma.QcDefectUncheckedUpdateInput;
  note?: string | null;
  changes?: Input;
  /** Extra follow-on events, e.g. an automatic release or close. */
  followUps?: Array<{ type: string; toStatus: string; cols?: Prisma.QcDefectUncheckedUpdateInput; note?: string }>;
  comment?: { text: string; visibleTo?: string };
  /** Recompute the task's priority from this severity id. */
  severityId?: string;
}

export interface ActionRequest {
  defectId: string;
  action: string;
  input: Input;
  /** URLs of files uploaded with this request (already stored). */
  fileUrls: string[];
  requester: Requester;
  /** Optimistic concurrency: the updatedAt the client last saw (DEF-017). */
  expectedUpdatedAt?: string;
}

export async function performAction(req: ActionRequest) {
  const defect = await loadDefect(req.defectId);
  const actor = await resolveActor(req.requester, defect);
  if (!actor) throw ApiError.forbidden('This defect is not available to you');

  const action = getAction(req.action);
  if (!action) throw ApiError.notFound(`Unknown action "${req.action}"`);
  const view = toView(defect);
  if (!canPerform(action, actor, view)) {
    const roleOk = actor.role === 'SA' || action.roles.includes(actor.role);
    if (!roleOk) throw ApiError.forbidden(`Your role (${actor.role}) cannot do "${action.label}"`);
    throw ApiError.conflict(`"${action.label}" is not available while the defect is ${defect.status.label}`, 'INVALID_TRANSITION');
  }
  if (req.expectedUpdatedAt && new Date(req.expectedUpdatedAt).getTime() !== defect.updatedAt.getTime()) {
    throw ApiError.conflict('This defect has changed since you opened it -- refresh and try again', 'DEFECT_CHANGED');
  }

  const form = getForm(action.form);
  const input = { ...req.input };
  // The hold/resume pair share F32; the action key decides which one this is.
  if (action.form === 'F32') input.action = action.key === 'hold' ? 'Place on hold' : 'Resume';
  const ff = filesField(form);
  if (ff && req.fileUrls.length) input[ff] = req.fileUrls;

  const skipRequired: string[] = [];
  if (action.key === 'confirm') skipRequired.push('photos');
  if (action.key === 'resume') skipRequired.push('reason_category');
  const data = validateOrThrow(action.form, input, { skipRequired });

  const result = await runHandler(action.key, { defect, data, input: req.input, fileUrls: req.fileUrls, actor, view });

  const fromStatusId = defect.statusId;
  await prisma.$transaction(async (tx) => {
    let currentStatusId = fromStatusId;
    const rework = (result.cols?.reworkCount as number | undefined) ?? defect.reworkCount;
    const toId = result.toStatus ? await statusId(result.toStatus) : fromStatusId;
    const toKey = result.toStatus ?? defect.status.key;
    const terminalClosed = toKey === 'closed';

    await tx.qcDefect.update({
      where: { id: defect.id },
      data: {
        ...(result.cols ?? {}),
        statusId: toId,
        ...(terminalClosed ? { closedAt: new Date(), closedById: req.requester.id } : {}),
        ...(ff && req.fileUrls.length && ['confirm'].includes(action.key)
          ? { photoUrls: [...((defect.photoUrls as string[]) ?? []), ...req.fileUrls] as Prisma.InputJsonValue }
          : {}),
      },
    });
    await appendEvent(tx, {
      defectId: defect.id,
      type: action.eventType,
      fromStatusId: currentStatusId,
      toStatusId: toId,
      actorId: req.requester.id,
      actorRole: actor.role,
      onBehalf: actor.role === 'SA',
      note: result.note ?? null,
      changes: { action: action.key, ...(result.changes ?? {}) },
      attachments: req.fileUrls,
      reworkCount: rework,
    });
    currentStatusId = toId;

    for (const fu of result.followUps ?? []) {
      const nextId = await statusId(fu.toStatus);
      await tx.qcDefect.update({
        where: { id: defect.id },
        data: {
          ...(fu.cols ?? {}),
          statusId: nextId,
          ...(fu.toStatus === 'closed' ? { closedAt: new Date(), closedById: req.requester.id } : {}),
        },
      });
      await appendEvent(tx, {
        defectId: defect.id,
        type: fu.type,
        fromStatusId: currentStatusId,
        toStatusId: nextId,
        actorId: req.requester.id,
        actorRole: actor.role,
        onBehalf: actor.role === 'SA',
        note: fu.note ?? 'Automatic, per project policy',
        changes: { action: action.key, automatic: true },
        reworkCount: rework,
      });
      currentStatusId = nextId;
    }

    if (result.comment) {
      await tx.qcDefectComment.create({
        data: {
          defectId: defect.id,
          authorId: req.requester.id,
          authorRole: actor.role,
          text: result.comment.text,
          visibleTo: result.comment.visibleTo ?? 'ALL',
          attachments: req.fileUrls as Prisma.InputJsonValue,
        },
      });
    }
    if (result.severityId) {
      const sev = await tx.qcSeverity.findUnique({ where: { id: result.severityId } });
      if (sev) await tx.qcTask.updateMany({ where: { defectId: defect.id }, data: { priority: SEVERITY_KEY_TO_PRIORITY[sev.key] ?? 'LOW' } });
    }
  });

  return getDefectDetail(defect.id, req.requester);
}

interface HandlerCtx {
  defect: DefectRow;
  data: Input;
  input: Input;
  fileUrls: string[];
  actor: ActorContext;
  view: DefectView;
}

async function runHandler(key: string, c: HandlerCtx): Promise<ActionResult> {
  const { defect, data, fileUrls, view } = c;
  const project = defect.property.project;

  switch (key) {
    case 'confirm': {
      const photos = [...((defect.photoUrls as string[]) ?? []), ...fileUrls];
      if (photos.length === 0) throw ApiError.badRequest('Photos is required: attach at least one photo');
      const cols = await f16ToColumns(data);
      const severity = await severityByLabel(str(data.severity));
      const result: ActionResult = {
        cols: { ...cols, isDraft: false },
        severityId: severity.id,
        note: str(data.defect_title),
        changes: { severity: severity.label },
      };
      if (severity.key === 'safety_hazard' && project.safetyAutoRelease) {
        result.followUps = [{ type: 'Released to Builder', toStatus: 'assigned', cols: { releasedAt: new Date() }, note: 'Safety Hazard released automatically' }];
      }
      return result;
    }
    case 'withdraw':
      return { toStatus: 'withdrawn', cols: { withdrawnReason: str(data.reason) }, note: str(data.reason) };

    case 'revise_severity': {
      const reason = str(data.reason);
      if (reason.length < 20) throw ApiError.badRequest('Reason must be at least 20 characters');
      const next = await severityByLabel(str(data.new_severity));
      if (defect.severityId === next.id) throw ApiError.badRequest('New severity must differ from the current severity');
      return {
        cols: { severityId: next.id },
        severityId: next.id,
        note: reason,
        changes: { severity: { from: defect.severity?.label ?? null, to: next.label }, notifyBuilderAndDeveloper: data.notify_builder_and_developer ?? true },
      };
    }
    case 'flag_urgent':
      return {
        cols: { flags: [...defect.flags, 'urgent'] },
        note: str(data.nature_of_risk),
        changes: { peopleExposed: data.people_exposed, temporaryControls: data.temporary_controls_in_place, contact: data.contact_for_inspector, state: 'raised' },
      };
    case 'resolve_urgent': {
      const confirmed = data.decision === 'Confirm as Safety Hazard';
      const flags = defect.flags.filter((x: string) => x !== 'urgent');
      if (!confirmed) return { cols: { flags }, note: str(data.reason), changes: { state: 'declined' } };
      const sev = await prisma.qcSeverity.findUnique({ where: { key: 'safety_hazard' } });
      const result: ActionResult = {
        cols: { flags, ...(sev ? { severityId: sev.id } : {}) },
        severityId: sev?.id,
        note: str(data.reason),
        changes: { state: 'confirmed', severity: 'Safety Hazard' },
      };
      if (defect.status.key === 'open' && project.safetyAutoRelease) {
        result.followUps = [{ type: 'Released to Builder', toStatus: 'assigned', cols: { releasedAt: new Date() }, note: 'Safety Hazard released automatically' }];
      }
      return result;
    }
    case 'release': {
      if (data.builder_recipient) await requireExists('user', str(data.builder_recipient), 'Builder recipient');
      // Default recipient: the builder's Project Manager on this project (F19).
      const recipient = data.builder_recipient
        ? str(data.builder_recipient)
        : (
            await prisma.qcMembership.findFirst({
              where: {
                role: 'MC_PROJECT_MANAGER',
                status: 'ACTIVE',
                masterContractorId: project.builderId ?? undefined,
                OR: [{ projects: { none: {} } }, { projects: { some: { id: project.id } } }],
              },
              select: { userId: true },
            })
          )?.userId;
      return {
        toStatus: 'assigned',
        cols: { releasedAt: new Date(), ...(recipient ? { builderContactId: recipient } : {}) },
        note: str(data.cover_note) || null,
        changes: { safetyHazard: view.severityKey === 'safety_hazard' },
      };
    }
    case 'dispute_assignment':
      if (str(data.explanation).length < 20) throw ApiError.badRequest('Explanation must be at least 20 characters');
      return {
        toStatus: 'disputed',
        cols: { disputeBy: 'BUILDER', disputePrevStatusId: defect.statusId, disputeReviewRequested: false },
        note: str(data.explanation),
        changes: { reasonCategory: data.reason_category, suggestedResponsibleParty: data.suggested_responsible_party },
      };
    case 'resolve_dispute': {
      const decision = str(data.decision);
      const base = { note: str(data.note), changes: { decision, variationReference: data.variation_reference } };
      const target = data.revised_target_date ? { targetRectificationDate: new Date(str(data.revised_target_date)) } : {};
      if (decision === 'Request Inspector review') return { ...base, cols: { disputeReviewRequested: true, ...target } };
      if (decision === 'Place on hold') {
        return { ...base, toStatus: 'on_hold', cols: { holdPrevStatusId: defect.statusId, holdReason: str(data.note), disputeReviewRequested: false, ...target } };
      }
      return { ...base, toStatus: 'assigned', cols: { disputeBy: null, disputePrevStatusId: null, disputeReviewRequested: false, ...target } };
    }
    case 'inspector_review': {
      const outcome = str(data.outcome);
      const base = { note: str(data.reason), changes: { outcome } };
      if (outcome.startsWith('Withdraw')) {
        return { ...base, toStatus: 'withdrawn', cols: { withdrawnReason: str(data.reason), disputeBy: null, disputePrevStatusId: null, disputeReviewRequested: false } };
      }
      return { ...base, toStatus: 'assigned', cols: { disputeBy: null, disputePrevStatusId: null, disputeReviewRequested: false } };
    }
    case 'allocate': {
      const companyId = str(data.trade_company);
      const company = await prisma.qcTradeCompany.findUnique({ where: { id: companyId }, include: { categories: { select: { id: true } } } });
      if (!company) throw ApiError.notFound('Trade company not found');
      if (company.status !== 'ACTIVE') throw ApiError.badRequest('That trade company is inactive');
      if (data.trade_user) {
        const m = await prisma.qcMembership.findFirst({ where: { userId: str(data.trade_user), tradeCompanyId: companyId, status: 'ACTIVE' } });
        if (!m) throw ApiError.badRequest('That user is not an active member of the selected trade company');
      }
      const mismatch = defect.tradeCategoryId && !company.categories.some((cat) => cat.id === defect.tradeCategoryId);
      if (mismatch && c.input.confirm_mismatch !== true && c.input.confirm_mismatch !== 'true') {
        throw ApiError.conflict(`${company.name} is not registered for this defect's trade category (${defect.tradeCategory?.name}). Confirm to allocate anyway.`, 'CATEGORY_MISMATCH');
      }
      return {
        toStatus: 'allocated',
        cols: {
          allocatedTradeCompanyId: companyId,
          allocatedTradeUserId: data.trade_user ? str(data.trade_user) : null,
          targetRectificationDate: new Date(str(data.target_rectification_date)),
        },
        note: str(data.instructions) || null,
        changes: { tradeCompany: company.name, categoryMismatchConfirmed: !!mismatch, siteAccess: data.site_access_arrangements },
      };
    }
    case 'acknowledge': {
      if (data.acknowledgement !== true) throw ApiError.badRequest('Tick "I have read this defect" to acknowledge');
      const date = str(data.scheduled_attendance_date);
      if (date < todayIso()) throw ApiError.badRequest('Scheduled attendance date cannot be earlier than today');
      const target = defect.targetRectificationDate as Date | null;
      const beyond = !!target && new Date(date).getTime() > target.getTime();
      return {
        toStatus: 'acknowledged',
        cols: { scheduledAttendanceDate: new Date(date) },
        note: str(data.comments) || null,
        changes: { scheduledAttendanceDate: date, estimatedDuration: data.estimated_duration, crewContact: data.crew_contact_on_site, beyondTarget: beyond },
      };
    }
    case 'progress': {
      const pct = data.percent_complete as number | undefined;
      return {
        toStatus: 'in_progress',
        cols: data.revised_attendance_date ? { scheduledAttendanceDate: new Date(str(data.revised_attendance_date)) } : {},
        note: str(data.progress_note),
        comment: { text: str(data.progress_note), visibleTo: 'ALL' },
        changes: { percentComplete: pct, blocker: data.blocker === true },
      };
    }
    case 'mark_rectified':
      if (fileUrls.length === 0) throw ApiError.badRequest('After photos is required: attach at least one photo');
      return {
        toStatus: 'rectified',
        note: str(data.work_done),
        changes: { completionDate: data.completion_date, productOrMethod: data.product_or_method_used },
      };
    case 'dispute_trade':
      return {
        toStatus: 'disputed',
        cols: { disputeBy: 'TRADE', disputePrevStatusId: defect.statusId, disputeReviewRequested: false },
        note: str(data.explanation),
        changes: { reasonCategory: data.reason_category, proposedAlternative: data.proposed_alternative },
      };
    case 'review_trade_dispute': {
      const decision = str(data.decision);
      const base = { note: str(data.note), changes: { decision } };
      if (decision.startsWith('Reject')) {
        const prev = defect.disputePrevStatusId as string | null;
        const prevKey = prev ? (await prisma.qcStatus.findUnique({ where: { id: prev } }))?.key : undefined;
        return { ...base, toStatus: prevKey ?? 'allocated', cols: { disputeBy: null, disputePrevStatusId: null } };
      }
      if (decision.startsWith('Reallocate')) {
        const companyId = str(data.new_trade);
        await requireExists('qcTradeCompany', companyId, 'Trade company');
        return {
          ...base,
          toStatus: 'allocated',
          cols: { allocatedTradeCompanyId: companyId, allocatedTradeUserId: null, disputeBy: null, disputePrevStatusId: null },
        };
      }
      // Escalate to Developer: it now follows the disputed-assignment path (REQ-DEF-006).
      return { ...base, cols: { disputeBy: 'BUILDER', disputeReviewRequested: false } };
    }
    case 'submit_reinspection': {
      const returning = str(data.builder_assessment).startsWith('Work not acceptable');
      return {
        toStatus: returning ? 'in_progress' : 'pending_re_inspection',
        note: str(data.note) || null,
        changes: { assessment: data.builder_assessment, dateWorkChecked: data.date_work_checked, preferredWindow: data.preferred_re_inspection_window },
      };
    }
    case 'verify_or_reject': {
      if (fileUrls.length === 0) throw ApiError.badRequest('Fresh photos is required: attach at least one photo');
      const method = str(data.method);
      const desk = method.startsWith('Evidence review');
      if (desk && (!project.deskReviewAllowed || !['minor', 'monitor'].includes(view.severityKey ?? ''))) {
        throw ApiError.badRequest('Evidence-only review is allowed only for Minor and Monitor defects where the project policy permits it; an on-site re-inspection is required');
      }
      const base = { changes: { method, outcome: data.outcome, dateInspected: data.date_inspected_or_reviewed, standardChecked: data.standard_checked } };
      if (data.outcome === 'Verified') {
        const result: ActionResult = { ...base, toStatus: 'verified', note: str(data.standard_checked) || null, cols: { disputeBy: null } };
        if (project.closurePolicy === 'AUTO_CLOSE') result.followUps = [{ type: 'Closed', toStatus: 'closed' }];
        return result;
      }
      const rework = defect.reworkCount + 1;
      const flags = rework >= 2 ? Array.from(new Set([...defect.flags, 'escalated'])) : defect.flags;
      return {
        ...base,
        toStatus: 'reopened',
        note: str(data.fail_reason),
        cols: { reworkCount: rework, flags, ...(rework >= 2 ? { escalationLevel: Math.max(defect.escalationLevel, 3) } : {}) },
        changes: { ...base.changes, reworkCount: rework },
      };
    }
    case 'close':
      if (data.confirm_lock !== true) throw ApiError.badRequest('Confirm that the record will become read only');
      return { toStatus: 'closed', note: str(data.comments) || null };
    case 'hold': {
      if (view.severityKey === 'safety_hazard' && data.client_admin_confirmation !== true) {
        throw ApiError.badRequest('A Safety Hazard can only be held with Client Admin confirmation');
      }
      return {
        toStatus: 'on_hold',
        cols: {
          holdPrevStatusId: defect.statusId,
          holdReason: `${str(data.reason_category)}: ${str(data.explanation)}`,
          holdReviewDate: data.review_date ? new Date(str(data.review_date)) : null,
        },
        note: str(data.explanation),
        changes: { reasonCategory: data.reason_category, reviewDate: data.review_date, safetyHazardHold: view.severityKey === 'safety_hazard' },
      };
    }
    case 'resume': {
      const prev = defect.holdPrevStatusId as string | null;
      const prevKey = prev ? (await prisma.qcStatus.findUnique({ where: { id: prev } }))?.key : undefined;
      return {
        toStatus: prevKey ?? 'assigned',
        cols: { holdPrevStatusId: null, holdReason: null, holdReviewDate: null },
        note: str(data.explanation),
      };
    }
    case 'accept_exception':
      return {
        toStatus: 'accepted_exception',
        cols: { exceptionReason: str(data.reason) },
        note: str(data.reason),
        changes: { basis: data.basis, allowanceReference: data.allowance_or_settlement_reference },
      };
    default:
      throw ApiError.badRequest(`Action "${key}" is not implemented`);
  }
}

// ───────────────────────── Comments and photos ─────────────────────────

export async function postComment(defectId: string, requester: Requester, input: { text: string; visibleTo?: string }, fileUrls: string[]) {
  const { actor } = await getDefectForUser(defectId, requester);
  const visibleTo = input.visibleTo ?? 'ALL';
  if (!COMMENT_VISIBILITY.SA.includes(visibleTo)) throw ApiError.badRequest('Unknown visibility');
  if (!COMMENT_VISIBILITY[actor.role].includes(visibleTo)) throw ApiError.forbidden('You cannot post a comment with that visibility');
  const text = input.text?.trim();
  if (!text || text.length > 4000) throw ApiError.badRequest('Comment must be 1 to 4000 characters');
  return prisma.qcDefectComment.create({
    data: { defectId, authorId: requester.id, authorRole: actor.role, text, visibleTo, attachments: fileUrls as Prisma.InputJsonValue },
    include: { author: { select: userSelect } },
  });
}

/** Adds photos to a draft (F16 needs at least one before it can be confirmed). */
export async function addDefectPhotos(defectId: string, requester: Requester, fileUrls: string[]) {
  const { defect, actor } = await getDefectForUser(defectId, requester);
  if (!defect.isDraft && actor.role !== 'SA') throw ApiError.badRequest('Photos on a confirmed defect are added through lifecycle actions or comments');
  if (fileUrls.length === 0) throw ApiError.badRequest('No photos received');
  await prisma.qcDefect.update({
    where: { id: defectId },
    data: { photoUrls: [...((defect.photoUrls as string[]) ?? []), ...fileUrls] as Prisma.InputJsonValue },
  });
  return loadDefect(defectId);
}

export { ACTIONS };
