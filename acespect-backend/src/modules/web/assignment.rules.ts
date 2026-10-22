/**
 * Who may see, edit and hand over an inspection once it has reached the reviewers. Pure functions (no database), so the rules are
 * tested directly and every route applies the same ones.
 *
 *  - Admins: everything.
 *  - Reviewers: may see the full inspection when it is theirs or unassigned; may edit/approve only when it is theirs.
 *    One assigned to another reviewer is listed (job, address, status, assignee) but its details are withheld.
 *  - Anyone else (inspectors, QC roles) is not covered here; they keep their own-inspection rule.
 */
export interface Actor { id: string; role: string }
export interface AssignableInspection { reviewerId: string | null; status: string }

export const isAdmin = (a: Actor) => a.role === 'ADMIN';
export const isReviewer = (a: Actor) => a.role === 'REVIEWER';

export function canViewDetail(actor: Actor, insp: AssignableInspection): boolean {
  if (isAdmin(actor)) return true;
  if (!isReviewer(actor)) return false;
  return insp.reviewerId === null || insp.reviewerId === actor.id;
}

export function canEdit(actor: Actor, insp: AssignableInspection): boolean {
  if (isAdmin(actor)) return true;
  return isReviewer(actor) && insp.reviewerId === actor.id;
}

export type AssignDenial = 'NOT_REVIEWER' | 'NOT_SUBMITTED' | 'ASSIGNED_TO_OTHER' | 'SAME_ASSIGNEE';

/**
 * May `actor` set the assignee of `insp` to `targetId` directly (no consent step)?
 * Returns null when allowed, otherwise why not. A reviewer who wants an inspection somebody else holds gets ASSIGNED_TO_OTHER and has to ask
 * the holder (see requestTransfer); an admin can always reassign.
 */
export function assignDenial(actor: Actor, insp: AssignableInspection, targetId: string): AssignDenial | null {
  if (!isAdmin(actor) && !isReviewer(actor)) return 'NOT_REVIEWER';
  if (insp.status === 'DRAFT') return 'NOT_SUBMITTED';
  if (insp.reviewerId === targetId) return 'SAME_ASSIGNEE';
  if (isAdmin(actor)) return null;
  if (insp.reviewerId === null || insp.reviewerId === actor.id) return null;
  return 'ASSIGNED_TO_OTHER';
}

/** A reviewer may ask for an inspection only when somebody else currently holds it. */
export function transferRequestDenial(actor: Actor, insp: AssignableInspection): 'NOT_REVIEWER' | 'NOT_SUBMITTED' | 'UNASSIGNED' | 'ALREADY_YOURS' | null {
  if (!isReviewer(actor)) return 'NOT_REVIEWER';
  if (insp.status === 'DRAFT') return 'NOT_SUBMITTED';
  if (insp.reviewerId === null) return 'UNASSIGNED';
  if (insp.reviewerId === actor.id) return 'ALREADY_YOURS';
  return null;
}

/** Only the current assignee (or an admin) may answer a request. */
export function canRespondToTransfer(actor: Actor, request: { fromReviewerId: string }): boolean {
  return isAdmin(actor) || (isReviewer(actor) && request.fromReviewerId === actor.id);
}

/** The fields a reviewer still sees on an inspection held by someone else; everything else is blanked by the serializer. */
export const RESTRICTED_VISIBLE_FIELDS = ['id', 'jobNo', 'address', 'suburb', 'inspectorId', 'reviewerId', 'date', 'submittedAt', 'type', 'status', 'updatedAt'] as const;
