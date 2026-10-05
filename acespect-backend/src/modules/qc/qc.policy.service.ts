/**
 * SLA targets (E13) and escalation / project policies (E14).
 *
 * A client sets defaults; a project may override them per severity (SLA) or
 * per field (policy) and revert to the default at any time. Every change is
 * audited with before and after (REQ-SLA-001/002). The effective policy for a
 * project is: system default, then client default, then project override.
 * Only targets set *after* a change apply to defects released afterwards;
 * defects already running keep the due dates they were given (REQ-SLA-002).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { recordAudit } from '../../lib/audit';
import { BusinessCalendar, Duration } from './qc.calendar';
import { QcContext } from './qc.context';

export const SEVERITY_KEYS = ['safety_hazard', 'major', 'minor', 'monitor'] as const;
export type SeverityKey = (typeof SEVERITY_KEYS)[number];
export const SEVERITY_LABEL: Record<SeverityKey, string> = {
  safety_hazard: 'Safety Hazard',
  major: 'Major Defect',
  minor: 'Minor Defect',
  monitor: 'Monitor / Serviceability',
};

export interface SlaRule {
  acknowledge: Duration | null;
  rectifyFrom: Duration | null;
  rectifyTo: Duration | null;
  orByNextStage: boolean;
  reinspect: Duration | null;
  reviewAtNextStage: boolean;
  effectiveFrom: string;
}
export type SlaRules = Record<SeverityKey, SlaRule>;

export interface EscalationLevel {
  level: number;
  name: string;
  trigger: string;
  waitDays: number | null;
  failedCount: number | null;
  action: string;
  notifyRoles: string[];
  extraEmails: string;
}

export interface ProjectPolicy {
  levels: EscalationLevel[];
  closurePolicy: 'DEVELOPER_SIGNOFF' | 'AUTO_CLOSE' | 'INSPECTOR_CLOSE';
  evidenceOnlyFor: SeverityKey[];
  autoReleaseSafety: boolean;
  safetyRecipients: string[];
  safetyAckHours: number;
  calendarState: string;
  extraDates: string[];
  shutdowns: Array<{ name: string; start: string; end: string }>;
  includeShutdowns: boolean;
  dlpReminderDays: number[];
  dlpEscalationWindowDays: number;
  repeatFailureCount: number;
  severityLabels: Partial<Record<SeverityKey, string>>;
}

const bd = (value: number): Duration => ({ value, unit: 'business_days' });
const hrs = (value: number): Duration => ({ value, unit: 'hours' });
const today = () => new Date().toISOString().slice(0, 10);

/** Built-in defaults, from the spec's sample values. */
export const DEFAULT_SLA: SlaRules = {
  safety_hazard: { acknowledge: hrs(4), rectifyFrom: hrs(24), rectifyTo: hrs(48), orByNextStage: false, reinspect: hrs(24), reviewAtNextStage: false, effectiveFrom: '2026-01-01' },
  major: { acknowledge: bd(1), rectifyFrom: bd(10), rectifyTo: null, orByNextStage: false, reinspect: bd(3), reviewAtNextStage: false, effectiveFrom: '2026-01-01' },
  minor: { acknowledge: bd(3), rectifyFrom: bd(15), rectifyTo: bd(20), orByNextStage: true, reinspect: bd(5), reviewAtNextStage: false, effectiveFrom: '2026-01-01' },
  monitor: { acknowledge: null, rectifyFrom: null, rectifyTo: null, orByNextStage: false, reinspect: null, reviewAtNextStage: true, effectiveFrom: '2026-01-01' },
};

export const DEFAULT_POLICY: ProjectPolicy = {
  levels: [
    { level: 1, name: 'Reminder', trigger: 'Acknowledgement SLA missed', waitDays: 0, failedCount: null, action: 'Automatic reminder', notifyRoles: ['Any of the eight roles', 'Trade User allowed at Level 1 only'], extraEmails: '' },
    { level: 2, name: 'Formal notice', trigger: 'Previous level unresolved', waitDays: 2, failedCount: null, action: 'Formal in-app notice and flag Escalated', notifyRoles: ['Any of the eight roles'], extraEmails: '' },
    { level: 3, name: 'Developer notice', trigger: 'Previous level unresolved', waitDays: 5, failedCount: null, action: 'Formal notice to Developer or project manager and flag for contract review', notifyRoles: ['Any of the eight roles'], extraEmails: '' },
    { level: 4, name: 'External referral', trigger: 'Developer elects', waitDays: null, failedCount: null, action: 'Record referral outside the platform', notifyRoles: ['Any of the eight roles'], extraEmails: '' },
  ],
  closurePolicy: 'DEVELOPER_SIGNOFF',
  evidenceOnlyFor: [],
  autoReleaseSafety: true,
  safetyRecipients: ['MC Project Manager', 'MC Manager', 'Client Admin'],
  safetyAckHours: 4,
  calendarState: 'VIC',
  extraDates: [],
  shutdowns: [],
  includeShutdowns: false,
  dlpReminderDays: [90, 60, 30, 7],
  dlpEscalationWindowDays: 14,
  repeatFailureCount: 2,
  severityLabels: {},
};

const asJson = (v: unknown) => v as Prisma.InputJsonValue;
type Partialize<T> = { [K in keyof T]?: T[K] };

// ───────────────────────── Validation ─────────────────────────

const UNITS = ['hours', 'business_days', 'calendar_days'];

function parseDuration(v: unknown, label: string, required: boolean): Duration | null {
  if (v === null || v === undefined || v === '') {
    if (required) throw ApiError.badRequest(`${label} is required`);
    return null;
  }
  const o = v as { value?: unknown; unit?: unknown };
  const value = Number(o.value);
  if (!Number.isInteger(value) || value <= 0) throw ApiError.badRequest(`${label} must be a whole number greater than zero`);
  if (!UNITS.includes(String(o.unit))) throw ApiError.badRequest(`${label}: choose hours or business days`);
  return { value, unit: o.unit as Duration['unit'] };
}

const hoursOf = (d: Duration) => (d.unit === 'hours' ? d.value : d.value * 24);

export function parseSlaRule(input: Record<string, unknown>, severity: SeverityKey): SlaRule {
  const isMonitor = severity === 'monitor';
  const rule: SlaRule = {
    acknowledge: isMonitor ? null : parseDuration(input.acknowledge, 'Acknowledge within', true),
    rectifyFrom: isMonitor && !input.rectifyFrom ? null : parseDuration(input.rectifyFrom, 'Rectify within', !isMonitor),
    rectifyTo: parseDuration(input.rectifyTo, 'Rectify within (to)', false),
    orByNextStage: input.orByNextStage === true,
    reinspect: isMonitor && !input.reinspect ? null : parseDuration(input.reinspect, 'Re-inspect within', !isMonitor),
    reviewAtNextStage: isMonitor ? input.reviewAtNextStage !== false : input.reviewAtNextStage === true,
    effectiveFrom: typeof input.effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) ? input.effectiveFrom : today(),
  };
  if (rule.rectifyFrom && rule.rectifyTo && hoursOf(rule.rectifyTo) < hoursOf(rule.rectifyFrom)) {
    throw ApiError.badRequest('The upper end of the rectification range cannot be shorter than the lower end');
  }
  if (rule.acknowledge && rule.rectifyFrom && hoursOf(rule.rectifyFrom) < hoursOf(rule.acknowledge)) {
    throw ApiError.badRequest('Rectification cannot be due before acknowledgement');
  }
  return rule;
}

const STATES = ['VIC', 'NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'];
const ESC_TRIGGERS = ['Acknowledgement SLA missed', 'Rectification SLA missed', 'Previous level unresolved', 'Failed re-inspections on the same item', 'Developer elects', 'Within N days of DLP expiry'];
const ESC_ACTIONS = ['Automatic reminder', 'Formal in-app notice and flag Escalated', 'Formal notice to Developer or project manager and flag for contract review', 'Record referral outside the platform'];
const CLOSURE = ['DEVELOPER_SIGNOFF', 'AUTO_CLOSE', 'INSPECTOR_CLOSE'];

export function parsePolicyPatch(input: Record<string, unknown>): Partialize<ProjectPolicy> {
  const out: Partialize<ProjectPolicy> = {};
  if (input.levels !== undefined) {
    if (!Array.isArray(input.levels) || input.levels.length < 1 || input.levels.length > 4) throw ApiError.badRequest('Define between one and four escalation levels');
    const levels = (input.levels as Array<Record<string, unknown>>).map((l, i): EscalationLevel => {
      const trigger = String(l.trigger ?? '');
      const action = String(l.action ?? '');
      if (!ESC_TRIGGERS.includes(trigger)) throw ApiError.badRequest(`Level ${i + 1}: unknown trigger`);
      if (!ESC_ACTIONS.includes(action)) throw ApiError.badRequest(`Level ${i + 1}: unknown action`);
      if (!String(l.name ?? '').trim()) throw ApiError.badRequest(`Level ${i + 1} needs a name`);
      const waitDays = l.waitDays === null || l.waitDays === undefined || l.waitDays === '' ? null : Number(l.waitDays);
      if (waitDays !== null && (!Number.isInteger(waitDays) || waitDays < 0 || waitDays > 90)) throw ApiError.badRequest(`Level ${i + 1}: wait period must be 0 to 90 business days`);
      if (trigger === 'Previous level unresolved' && waitDays === null) throw ApiError.badRequest(`Level ${i + 1}: a wait period is required`);
      const failedCount = l.failedCount === null || l.failedCount === undefined || l.failedCount === '' ? null : Number(l.failedCount);
      if (trigger === 'Failed re-inspections on the same item' && (failedCount === null || !Number.isInteger(failedCount) || failedCount < 1)) {
        throw ApiError.badRequest(`Level ${i + 1}: set how many failed re-inspections trigger this level`);
      }
      return {
        level: i + 1, name: String(l.name).trim(), trigger, waitDays, failedCount, action,
        notifyRoles: Array.isArray(l.notifyRoles) ? (l.notifyRoles as string[]) : ['Any of the eight roles'],
        extraEmails: String(l.extraEmails ?? ''),
      };
    });
    // Waits must not shrink: an escalation cannot come due before the level it follows.
    let prev = -1;
    for (const l of levels) {
      if (l.trigger === 'Previous level unresolved' && l.waitDays !== null) {
        if (l.waitDays < prev) throw ApiError.badRequest(`Level ${l.level}: wait period cannot be shorter than the previous level's`);
        prev = l.waitDays;
      }
    }
    out.levels = levels;
  }
  if (input.closurePolicy !== undefined) {
    if (!CLOSURE.includes(String(input.closurePolicy))) throw ApiError.badRequest('Unknown closure policy');
    out.closurePolicy = input.closurePolicy as ProjectPolicy['closurePolicy'];
  }
  if (input.evidenceOnlyFor !== undefined) {
    const list = (input.evidenceOnlyFor as string[]) ?? [];
    // Evidence-only re-inspection is never allowed for Major or Safety Hazard (REQ-DEF-014).
    if (list.some((k) => k === 'major' || k === 'safety_hazard')) throw ApiError.badRequest('Desk (evidence-only) re-inspection is never allowed for Major Defects or Safety Hazards');
    out.evidenceOnlyFor = list.filter((k): k is SeverityKey => ['minor', 'monitor'].includes(k));
  }
  if (typeof input.autoReleaseSafety === 'boolean') out.autoReleaseSafety = input.autoReleaseSafety;
  if (input.safetyRecipients !== undefined) {
    const list = (input.safetyRecipients as string[]) ?? [];
    if (list.length === 0) throw ApiError.badRequest('Choose at least one Safety Hazard alert recipient');
    out.safetyRecipients = list;
  }
  if (input.safetyAckHours !== undefined) {
    const n = Number(input.safetyAckHours);
    if (!Number.isInteger(n) || n < 1 || n > 72) throw ApiError.badRequest('Safety Hazard acknowledgement target must be 1 to 72 hours');
    out.safetyAckHours = n;
  }
  if (input.calendarState !== undefined) {
    if (!STATES.includes(String(input.calendarState))) throw ApiError.badRequest('Choose a state or territory for the business-day calendar');
    out.calendarState = String(input.calendarState);
  }
  if (input.extraDates !== undefined) {
    const list = (input.extraDates as string[]) ?? [];
    if (list.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) throw ApiError.badRequest('Extra non-working dates must be YYYY-MM-DD');
    out.extraDates = [...new Set(list)].sort();
  }
  if (input.shutdowns !== undefined) {
    const list = (input.shutdowns as Array<{ name: string; start: string; end: string }>) ?? [];
    for (const s of list) {
      if (!s.name || !/^\d{4}-\d{2}-\d{2}$/.test(s.start) || !/^\d{4}-\d{2}-\d{2}$/.test(s.end) || s.end < s.start) throw ApiError.badRequest('Each shutdown period needs a name, a start date and an end date after it');
    }
    out.shutdowns = list;
  }
  if (typeof input.includeShutdowns === 'boolean') out.includeShutdowns = input.includeShutdowns;
  if (input.dlpReminderDays !== undefined) {
    const list = ((input.dlpReminderDays as unknown[]) ?? []).map(Number);
    if (list.length === 0 || list.some((n) => !Number.isInteger(n) || n < 1 || n > 365)) throw ApiError.badRequest('DLP reminder days must be whole numbers between 1 and 365');
    out.dlpReminderDays = [...new Set(list)].sort((a, b) => b - a);
  }
  if (input.dlpEscalationWindowDays !== undefined) {
    const n = Number(input.dlpEscalationWindowDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) throw ApiError.badRequest('DLP escalation window must be 1 to 90 days');
    out.dlpEscalationWindowDays = n;
  }
  if (input.repeatFailureCount !== undefined) {
    const n = Number(input.repeatFailureCount);
    if (!Number.isInteger(n) || n < 1 || n > 10) throw ApiError.badRequest('Repeat-failure escalation count must be 1 to 10');
    out.repeatFailureCount = n;
  }
  if (input.severityLabels !== undefined) {
    const labels = (input.severityLabels ?? {}) as Record<string, string>;
    out.severityLabels = Object.fromEntries(Object.entries(labels).filter(([k, v]) => (SEVERITY_KEYS as readonly string[]).includes(k) && v.trim()).map(([k, v]) => [k, v.trim().slice(0, 40)]));
  }
  return out;
}

// ───────────────────────── Storage and resolution ─────────────────────────

async function load(kind: 'sla_policy' | 'project_policy', clientId: string, projectId: string | null) {
  return prisma.qcRecord.findFirst({ where: { kind, clientId, projectId } });
}

function mergeSla(...layers: Array<Partialize<SlaRules> | undefined>): SlaRules {
  const out = JSON.parse(JSON.stringify(DEFAULT_SLA)) as SlaRules;
  for (const layer of layers) {
    if (!layer) continue;
    for (const k of SEVERITY_KEYS) if (layer[k]) out[k] = layer[k] as SlaRule;
  }
  return out;
}

export interface SlaView {
  effective: SlaRules;
  /** Where each severity's rule comes from. */
  source: Record<SeverityKey, 'default' | 'client' | 'project'>;
  clientDefault: SlaRules;
}

export async function getSlaPolicy(clientId: string, projectId: string | null): Promise<SlaView> {
  const [client, project] = await Promise.all([load('sla_policy', clientId, null), projectId ? load('sla_policy', clientId, projectId) : null]);
  const c = (client?.data ?? {}) as Partialize<SlaRules>;
  const p = (project?.data ?? {}) as Partialize<SlaRules>;
  const source = Object.fromEntries(SEVERITY_KEYS.map((k) => [k, p[k] ? 'project' : c[k] ? 'client' : 'default'])) as SlaView['source'];
  return { effective: mergeSla(c, p), source, clientDefault: mergeSla(c) };
}

export async function saveSlaRule(ctx: QcContext, clientId: string, projectId: string | null, severity: string, input: Record<string, unknown>) {
  if (!(SEVERITY_KEYS as readonly string[]).includes(severity)) throw ApiError.badRequest('Unknown severity');
  const key = severity as SeverityKey;
  const rule = parseSlaRule(input, key);
  const existing = await load('sla_policy', clientId, projectId);
  const before = (existing?.data ?? {}) as Partialize<SlaRules>;
  const data = { ...before, [key]: rule };
  if (existing) await prisma.qcRecord.update({ where: { id: existing.id }, data: { data: asJson(data) } });
  else await prisma.qcRecord.create({ data: { kind: 'sla_policy', clientId, projectId, title: projectId ? 'Project SLA override' : 'Client SLA default', data: asJson(data), createdById: ctx.userId } });
  await recordAudit({
    clientId, entityType: projectId ? 'ProjectSla' : 'ClientSla', entityId: projectId ?? clientId, action: 'sla.update',
    actor: { id: ctx.userId, role: ctx.role }, supportSessionId: ctx.supportSession?.id ?? null,
    before: before[key] ?? null, after: rule, reason: `${SEVERITY_LABEL[key]}${projectId ? ' (project override)' : ' (client default)'}`,
  });
  return getSlaPolicy(clientId, projectId);
}

/** Remove a project's override so it follows the client default again. */
export async function revertSlaOverride(ctx: QcContext, clientId: string, projectId: string, severity: string | null) {
  const existing = await load('sla_policy', clientId, projectId);
  if (!existing) return getSlaPolicy(clientId, projectId);
  const before = existing.data as Partialize<SlaRules>;
  if (severity) {
    const next = { ...before };
    delete next[severity as SeverityKey];
    if (Object.keys(next).length === 0) await prisma.qcRecord.delete({ where: { id: existing.id } });
    else await prisma.qcRecord.update({ where: { id: existing.id }, data: { data: asJson(next) } });
  } else {
    await prisma.qcRecord.delete({ where: { id: existing.id } });
  }
  await recordAudit({
    clientId, entityType: 'ProjectSla', entityId: projectId, action: 'sla.revert', actor: { id: ctx.userId, role: ctx.role },
    supportSessionId: ctx.supportSession?.id ?? null, before: severity ? before[severity as SeverityKey] : before, reason: severity ? SEVERITY_LABEL[severity as SeverityKey] : 'all severities',
  });
  return getSlaPolicy(clientId, projectId);
}

export interface PolicyView {
  effective: ProjectPolicy;
  /** Keys the project overrides (empty for a client-level view). */
  overridden: string[];
  clientDefault: ProjectPolicy;
}

export async function getProjectPolicy(clientId: string, projectId: string | null): Promise<PolicyView> {
  const [client, project] = await Promise.all([load('project_policy', clientId, null), projectId ? load('project_policy', clientId, projectId) : null]);
  const c = (client?.data ?? {}) as Partialize<ProjectPolicy>;
  const p = (project?.data ?? {}) as Partialize<ProjectPolicy>;
  return {
    effective: { ...DEFAULT_POLICY, ...c, ...p },
    overridden: Object.keys(p),
    clientDefault: { ...DEFAULT_POLICY, ...c },
  };
}

export async function saveProjectPolicy(ctx: QcContext, clientId: string, projectId: string | null, input: Record<string, unknown>) {
  const patch = parsePolicyPatch(input);
  if (Object.keys(patch).length === 0) throw ApiError.badRequest('Nothing to change');
  const existing = await load('project_policy', clientId, projectId);
  const before = (existing?.data ?? {}) as Partialize<ProjectPolicy>;
  const data = { ...before, ...patch };
  if (existing) await prisma.qcRecord.update({ where: { id: existing.id }, data: { data: asJson(data) } });
  else await prisma.qcRecord.create({ data: { kind: 'project_policy', clientId, projectId, title: projectId ? 'Project policy override' : 'Client policy default', data: asJson(data), createdById: ctx.userId } });

  // The lifecycle engine reads these three switches from the project's columns.
  if (projectId) await syncProjectColumns(projectId, clientId);
  else {
    const projects = await prisma.qcProject.findMany({ where: { clientId }, select: { id: true } });
    for (const pr of projects) await syncProjectColumns(pr.id, clientId);
  }
  await recordAudit({
    clientId, entityType: projectId ? 'ProjectPolicy' : 'ClientPolicy', entityId: projectId ?? clientId, action: 'policy.update',
    actor: { id: ctx.userId, role: ctx.role }, supportSessionId: ctx.supportSession?.id ?? null,
    before: Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k] ?? null])), after: patch,
  });
  return getProjectPolicy(clientId, projectId);
}

export async function revertProjectPolicy(ctx: QcContext, clientId: string, projectId: string, keys: string[] | null) {
  const existing = await load('project_policy', clientId, projectId);
  if (!existing) return getProjectPolicy(clientId, projectId);
  const before = existing.data as Record<string, unknown>;
  if (keys && keys.length) {
    const next = { ...before };
    for (const k of keys) delete next[k];
    if (Object.keys(next).length === 0) await prisma.qcRecord.delete({ where: { id: existing.id } });
    else await prisma.qcRecord.update({ where: { id: existing.id }, data: { data: asJson(next) } });
  } else {
    await prisma.qcRecord.delete({ where: { id: existing.id } });
  }
  await syncProjectColumns(projectId, clientId);
  await recordAudit({ clientId, entityType: 'ProjectPolicy', entityId: projectId, action: 'policy.revert', actor: { id: ctx.userId, role: ctx.role }, supportSessionId: ctx.supportSession?.id ?? null, before: keys ? Object.fromEntries(keys.map((k) => [k, before[k] ?? null])) : before });
  return getProjectPolicy(clientId, projectId);
}

/** Copy the lifecycle-relevant switches of the effective policy onto the project's columns. */
export async function syncProjectColumns(projectId: string, clientId: string): Promise<void> {
  const { effective } = await getProjectPolicy(clientId, projectId);
  await prisma.qcProject.update({
    where: { id: projectId },
    data: { closurePolicy: effective.closurePolicy, safetyAutoRelease: effective.autoReleaseSafety, deskReviewAllowed: effective.evidenceOnlyFor.length > 0 },
  });
}

export async function calendarFor(projectId: string): Promise<BusinessCalendar> {
  const project = await prisma.qcProject.findUnique({ where: { id: projectId }, select: { clientId: true, state: true } });
  if (!project) return { state: 'VIC' };
  const { effective } = await getProjectPolicy(project.clientId, projectId);
  return {
    state: STATES.includes(project.state ?? '') ? (project.state as string) : effective.calendarState,
    extraDates: effective.extraDates,
    shutdowns: effective.shutdowns,
    includeShutdowns: effective.includeShutdowns,
  };
}
