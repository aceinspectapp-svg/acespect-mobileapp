/**
 * Defect lifecycle rules from the requirements spec (REQ-DEF-001..020,
 * REQ-DEF-017's allowed-transitions note). Pure functions only: who may do
 * what to a defect in which status. The database work for each action lives
 * in qc.defects.service.ts.
 *
 * Status keys:  open, assigned, allocated, acknowledged, in_progress,
 * rectified, pending_re_inspection, verified, reopened, closed, disputed,
 * on_hold, accepted_exception, withdrawn.
 * Overdue / Escalated / Urgent are flags on the defect, not statuses.
 */
import { FieldSpec, FormSpec, registerExtraForms } from './spec/qcSpec';

export type ActorRole =
  | 'SA'
  | 'CLIENT_ADMIN'
  | 'CLIENT_USER'
  | 'MC_MANAGER'
  | 'MC_SITE_SUPERVISOR'
  | 'MC_PROJECT_MANAGER'
  | 'TRADE_USER'
  | 'PRIVATE_INSPECTOR';

export const TERMINAL_STATUSES = ['closed', 'withdrawn', 'accepted_exception'];
export const NON_TERMINAL = (status: string) => !TERMINAL_STATUSES.includes(status);

/** What the lifecycle engine needs to know about a defect (and its project's policy) to decide. */
export interface DefectView {
  statusKey: string;
  isDraft: boolean;
  severityKey: string | null;
  disputeBy: string | null;
  disputeReviewRequested: boolean;
  flags: string[];
  closurePolicy: string; // DEVELOPER_SIGNOFF | AUTO_CLOSE | INSPECTOR_CLOSE
  deskReviewAllowed: boolean;
}

export interface ActionDef {
  key: string;
  label: string;
  /** Spec form code (F16...) or a synthetic one (X01...) defined below. */
  form: string;
  /** Roles allowed in addition to SA (who may do anything, in logged support mode). */
  roles: ActorRole[];
  /** Optional permission a CLIENT_USER needs on their membership (E05 optional permissions). */
  clientUserPermission?: string;
  from: string[] | 'NON_TERMINAL';
  /** Extra condition on the defect; returns false to hide the action. */
  when?: (d: DefectView) => boolean;
  /** Spec event type written to the history (E25). */
  eventType: string;
}

const MC: ActorRole[] = ['MC_MANAGER', 'MC_PROJECT_MANAGER', 'MC_SITE_SUPERVISOR'];

export const ACTIONS: ActionDef[] = [
  { key: 'confirm', label: 'Confirm as Open', form: 'F16', roles: ['PRIVATE_INSPECTOR'], from: ['open'], when: (d) => d.isDraft, eventType: 'Logged' },
  { key: 'withdraw', label: 'Withdraw defect', form: 'X02', roles: ['PRIVATE_INSPECTOR'], from: ['open'], eventType: 'Withdrawn' },
  { key: 'revise_severity', label: 'Revise severity', form: 'F17', roles: ['PRIVATE_INSPECTOR'], from: 'NON_TERMINAL', when: (d) => !d.isDraft, eventType: 'Severity revised' },
  { key: 'flag_urgent', label: 'Flag urgent safety concern', form: 'F18', roles: MC, from: 'NON_TERMINAL', when: (d) => !d.isDraft && !d.flags.includes('urgent'), eventType: 'Urgent concern raised or cleared' },
  { key: 'resolve_urgent', label: 'Confirm or decline urgent concern', form: 'X01', roles: ['PRIVATE_INSPECTOR'], from: 'NON_TERMINAL', when: (d) => d.flags.includes('urgent'), eventType: 'Urgent concern raised or cleared' },
  { key: 'release', label: 'Release to Builder', form: 'F19', roles: ['PRIVATE_INSPECTOR'], from: ['open'], when: (d) => !d.isDraft, eventType: 'Released to Builder' },
  { key: 'dispute_assignment', label: 'Dispute assignment', form: 'F20', roles: ['MC_MANAGER', 'MC_PROJECT_MANAGER'], from: ['assigned'], eventType: 'Disputed by Builder' },
  { key: 'resolve_dispute', label: 'Resolve disputed assignment', form: 'F21', roles: ['CLIENT_ADMIN', 'CLIENT_USER'], clientUserPermission: 'Resolve disputed assignments', from: ['disputed'], when: (d) => !d.disputeReviewRequested, eventType: 'Dispute resolved' },
  { key: 'inspector_review', label: 'Review disputed defect', form: 'F22', roles: ['PRIVATE_INSPECTOR'], from: ['disputed'], when: (d) => d.disputeReviewRequested, eventType: 'Dispute resolved' },
  { key: 'allocate', label: 'Allocate to trade', form: 'F23', roles: MC, from: ['assigned', 'reopened'], eventType: 'Allocated' },
  { key: 'acknowledge', label: 'Acknowledge defect', form: 'F24', roles: ['TRADE_USER'], from: ['allocated'], eventType: 'Acknowledged' },
  { key: 'progress', label: 'Record progress', form: 'F25', roles: ['TRADE_USER'], from: ['acknowledged', 'in_progress'], eventType: 'Work started' },
  { key: 'mark_rectified', label: 'Mark rectification complete', form: 'F26', roles: ['TRADE_USER'], from: ['in_progress'], eventType: 'Rectified' },
  { key: 'dispute_trade', label: 'Dispute defect', form: 'F27', roles: ['TRADE_USER'], from: ['allocated', 'acknowledged', 'in_progress'], eventType: 'Disputed by Trade' },
  { key: 'review_trade_dispute', label: 'Review trade dispute', form: 'F28', roles: ['MC_MANAGER', 'MC_PROJECT_MANAGER'], from: ['disputed'], when: (d) => d.disputeBy === 'TRADE', eventType: 'Dispute resolved' },
  { key: 'submit_reinspection', label: 'Submit for re-inspection', form: 'F29', roles: MC, from: ['rectified'], eventType: 'Submitted for re-inspection' },
  { key: 'verify_or_reject', label: 'Verify or reject', form: 'F30', roles: ['PRIVATE_INSPECTOR'], from: ['pending_re_inspection'], eventType: 'Verified' },
  { key: 'close', label: 'Close out defect', form: 'F31', roles: ['PRIVATE_INSPECTOR', 'CLIENT_ADMIN', 'CLIENT_USER'], from: ['verified'], eventType: 'Closed' },
  { key: 'hold', label: 'Place on hold', form: 'F32', roles: ['CLIENT_ADMIN', 'CLIENT_USER', 'MC_MANAGER', 'MC_PROJECT_MANAGER', 'PRIVATE_INSPECTOR'], from: 'NON_TERMINAL', when: (d) => d.statusKey !== 'on_hold' && !d.isDraft, eventType: 'Placed on hold' },
  { key: 'resume', label: 'Resume', form: 'F32', roles: ['CLIENT_ADMIN', 'CLIENT_USER', 'MC_MANAGER', 'MC_PROJECT_MANAGER', 'PRIVATE_INSPECTOR'], from: ['on_hold'], eventType: 'Resumed' },
  { key: 'accept_exception', label: 'Accept as exception', form: 'F33', roles: ['CLIENT_ADMIN', 'CLIENT_USER'], clientUserPermission: 'Accept defects as exceptions', from: 'NON_TERMINAL', when: (d) => !d.isDraft, eventType: 'Accepted as exception' },
];

export function getAction(key: string): ActionDef | undefined {
  return ACTIONS.find((a) => a.key === key);
}

/** Who may close, given the project's closure policy (decision D6). */
function closureAllowed(role: ActorRole, policy: string): boolean {
  if (role === 'SA') return true;
  if (policy === 'DEVELOPER_SIGNOFF') return role === 'CLIENT_ADMIN' || role === 'CLIENT_USER';
  if (policy === 'INSPECTOR_CLOSE') return role === 'PRIVATE_INSPECTOR';
  return false; // AUTO_CLOSE closes by itself when the inspector verifies
}

export interface ActorContext {
  role: ActorRole;
  /** Optional permissions on a Client User's membership. */
  permissions: string[];
}

export function canPerform(action: ActionDef, actor: ActorContext, d: DefectView): boolean {
  const fromOk = action.from === 'NON_TERMINAL' ? NON_TERMINAL(d.statusKey) : action.from.includes(d.statusKey);
  if (!fromOk) return false;
  if (d.isDraft && !['confirm', 'withdraw'].includes(action.key)) return false;
  if (action.when && !action.when(d)) return false;
  if (action.key === 'close' && !closureAllowed(actor.role, d.closurePolicy)) return false;
  if (actor.role === 'SA') return true;
  if (!action.roles.includes(actor.role)) return false;
  if (actor.role === 'CLIENT_USER' && action.clientUserPermission && !actor.permissions.includes(action.clientUserPermission)) return false;
  return true;
}

export function availableActions(actor: ActorContext, d: DefectView) {
  return ACTIONS.filter((a) => canPerform(a, actor, d)).map((a) => ({ key: a.key, label: a.label, form: a.form }));
}

// ───────────────────────── Synthetic forms (no F-number in the spec) ─────────────────────────
// The spec describes these steps in stories (REQ-DEF-003, REQ-DEF-001) without
// a dedicated form, so their minimal fields are defined here.

const f = (over: Partial<FieldSpec> & Pick<FieldSpec, 'key' | 'label' | 'kind' | 'req'>): FieldSpec => ({
  group: '',
  system: false,
  ...over,
});

export const EXTRA_FORMS: Record<string, FormSpec> = {
  X01: {
    code: 'X01',
    title: 'Confirm or decline urgent safety concern',
    description: 'The Inspector confirms the risk (severity becomes Safety Hazard) or declines it with a reason.',
    usedBy: 'Private Inspector',
    actions: 'Submit',
    fields: [
      f({ key: 'decision', label: 'Decision', kind: 'select', req: 'M', options: ['Confirm as Safety Hazard', 'Decline'] }),
      f({ key: 'reason', label: 'Reason', kind: 'longtext', req: 'M' }),
    ],
  },
  X02: {
    code: 'X02',
    title: 'Withdraw defect',
    description: 'Terminal status for a defect raised in error. A reason is mandatory.',
    usedBy: 'Private Inspector',
    actions: 'Withdraw',
    fields: [f({ key: 'reason', label: 'Reason', kind: 'longtext', req: 'M', min: 10 })],
  },
};

registerExtraForms(EXTRA_FORMS);
