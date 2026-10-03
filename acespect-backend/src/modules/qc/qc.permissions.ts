/**
 * The role and permission matrix from the requirements spec (section 3), as
 * code (REQ-AUT-003: authorise every request on the server, deny by default).
 *
 * `true`  = full within scope.
 * `{ permission }` = scoped: a Client User needs that optional permission on
 *                    their membership (E05 optional permissions).
 * `'scope'` = scoped by organisation / assigned projects / own allocated items;
 *             the handler narrows the data, the matrix only opens the door.
 *
 * Defect lifecycle steps are not listed here: qc.lifecycle.ts owns who may do
 * what to a defect in which status.
 */
import { ActorRole } from './qc.lifecycle';

type Grant = true | 'scope' | { permission: string };
type Row = Partial<Record<ActorRole, Grant>>;

const ALL: ActorRole[] = ['SA', 'CLIENT_ADMIN', 'CLIENT_USER', 'MC_MANAGER', 'MC_SITE_SUPERVISOR', 'MC_PROJECT_MANAGER', 'TRADE_USER', 'PRIVATE_INSPECTOR'];
const everyone = (): Row => Object.fromEntries(ALL.map((r) => [r, true])) as Row;

export const OPTIONAL_PERMISSIONS = [
  'Create projects',
  'Plan and assign inspections',
  'Resolve disputed assignments',
  'Accept defects as exceptions',
  'Sign off DLP close-out',
  'Manually escalate',
] as const;

export const CAPABILITIES = {
  // Platform and tenancy
  'client.manage': { SA: true },
  'client.defaults': { SA: true, CLIENT_ADMIN: true },
  'support.enter': { SA: true },
  'securitylog.view': { SA: true, CLIENT_ADMIN: true },
  'retention.hold': { SA: true, CLIENT_ADMIN: true },
  'tenant.export': { SA: true, CLIENT_ADMIN: 'scope' },
  'privacy.handle': { SA: true },
  // Users and organisations
  'users.clientUsers': { SA: true, CLIENT_ADMIN: true },
  'users.mcOrg': { SA: true, CLIENT_ADMIN: true },
  'users.mcStaff': { SA: true, CLIENT_ADMIN: true, MC_MANAGER: 'scope' },
  'users.trade': { SA: true, CLIENT_ADMIN: true, MC_MANAGER: 'scope', MC_PROJECT_MANAGER: 'scope' },
  'users.credentialInspector': { SA: true },
  'users.deactivate': { SA: true, CLIENT_ADMIN: true, MC_MANAGER: 'scope' },
  'users.grantPermissions': { SA: true, CLIENT_ADMIN: true },
  'users.view': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', MC_MANAGER: 'scope', MC_PROJECT_MANAGER: 'scope' },
  // Projects
  'projects.create': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: { permission: 'Create projects' } },
  'projects.team': { SA: true, CLIENT_ADMIN: true, MC_MANAGER: 'scope', MC_PROJECT_MANAGER: 'scope' },
  'projects.override': { SA: true, CLIENT_ADMIN: true },
  'projects.holdPoints': { SA: true, CLIENT_ADMIN: true },
  'projects.status': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: { permission: 'Create projects' } },
  'projects.docs.upload': { SA: true, CLIENT_ADMIN: true },
  'projects.docs.view': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: true, MC_MANAGER: true, MC_SITE_SUPERVISOR: true, MC_PROJECT_MANAGER: true, PRIVATE_INSPECTOR: true },
  'projects.view': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', MC_MANAGER: 'scope', MC_SITE_SUPERVISOR: 'scope', MC_PROJECT_MANAGER: 'scope', PRIVATE_INSPECTOR: 'scope' },
  // Templates
  'templates.maintainBase': { SA: true },
  'templates.customise': { SA: true, CLIENT_ADMIN: true },
  'templates.assign': { SA: true, CLIENT_ADMIN: true },
  'templates.view': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: true, PRIVATE_INSPECTOR: true },
  // Inspections
  'inspections.plan': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: { permission: 'Plan and assign inspections' } },
  'inspections.request': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: true, MC_MANAGER: true, MC_SITE_SUPERVISOR: true, MC_PROJECT_MANAGER: true },
  'inspections.progress': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', MC_MANAGER: 'scope', MC_SITE_SUPERVISOR: 'scope', MC_PROJECT_MANAGER: 'scope', PRIVATE_INSPECTOR: 'scope' },
  'inspections.adhoc': { SA: true, CLIENT_ADMIN: true, PRIVATE_INSPECTOR: 'scope' },
  'inspections.perform': { SA: true, PRIVATE_INSPECTOR: 'scope' },
  'inspections.reports': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', MC_MANAGER: 'scope', MC_SITE_SUPERVISOR: 'scope', MC_PROJECT_MANAGER: 'scope', PRIVATE_INSPECTOR: 'scope' },
  // Defects (non-lifecycle)
  'defects.view': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', MC_MANAGER: 'scope', MC_SITE_SUPERVISOR: 'scope', MC_PROJECT_MANAGER: 'scope', TRADE_USER: 'scope', PRIVATE_INSPECTOR: 'scope' },
  'defects.comment': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', MC_MANAGER: 'scope', MC_SITE_SUPERVISOR: 'scope', MC_PROJECT_MANAGER: 'scope', TRADE_USER: 'scope', PRIVATE_INSPECTOR: 'scope' },
  'defects.create': { SA: true, PRIVATE_INSPECTOR: 'scope' },
  // SLA, escalation, DLP
  'sla.configure': { SA: true, CLIENT_ADMIN: true },
  'sla.escalate': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: { permission: 'Manually escalate' } },
  'dlp.manage': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: { permission: 'Sign off DLP close-out' } },
  'dlp.reminders': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: true },
  // Reporting and records
  'reports.dashboard': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', MC_MANAGER: 'scope', MC_PROJECT_MANAGER: 'scope', PRIVATE_INSPECTOR: 'scope' },
  'reports.openItems': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', MC_MANAGER: 'scope', MC_PROJECT_MANAGER: 'scope' },
  'reports.dlpEscalation': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope' },
  'reports.portfolio': { SA: true, CLIENT_ADMIN: true },
  'evidence.export': { SA: true, CLIENT_ADMIN: true, CLIENT_USER: 'scope', PRIVATE_INSPECTOR: 'scope' },
  'audit.view': { SA: true, CLIENT_ADMIN: true },
  // Own account
  'account.self': everyone(),
} as const satisfies Record<string, Row>;

export type Capability = keyof typeof CAPABILITIES;

export interface PermissionSubject {
  role: ActorRole;
  permissions: string[];
}

/** Does this role hold the capability? Scoped grants are a yes here; handlers narrow the data. */
export function can(subject: PermissionSubject, capability: Capability): boolean {
  const grant = (CAPABILITIES[capability] as Row)[subject.role];
  if (!grant) return false;
  if (grant === true || grant === 'scope') return true;
  return subject.permissions.includes(grant.permission);
}

/** What the signed-in user may do, for the web/mobile clients to show or hide controls (the server still enforces). */
export function capabilityList(subject: PermissionSubject): Capability[] {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(subject, c));
}

/** The matrix for the read-only "what can each role do" screen (REQ-USR-007). */
export function permissionMatrix() {
  return (Object.keys(CAPABILITIES) as Capability[]).map((capability) => ({
    capability,
    roles: Object.fromEntries(ALL.map((r) => {
      const g = (CAPABILITIES[capability] as Row)[r];
      return [r, !g ? 'none' : g === true ? 'full' : g === 'scope' ? 'scoped' : `needs "${g.permission}"`];
    })),
  }));
}
