import type { Inspection } from "./mockData";

/**
 * The reviewer dashboard's three lists from the one list the server sends: what the reviewer holds, what nobody holds yet (free to take),
 * and what other reviewers hold (shown without details). Drafts never reach reviewers; they are left out here as well.
 */
export function splitReviewerQueue(inspections: Inspection[], myId: string) {
  const live = inspections.filter((i) => i.status !== "draft");
  return {
    mine: live.filter((i) => i.reviewerId === myId),
    unassigned: live.filter((i) => !i.reviewerId),
    others: live.filter((i) => !!i.reviewerId && i.reviewerId !== myId),
  };
}

/** Whether this person may edit/approve the inspection: its assigned reviewer, or an admin. Mirrors the server's rule (the server enforces it). */
export function canEditInspection(user: { id: string; role: string } | null | undefined, inspection: Pick<Inspection, "reviewerId">): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.role === "reviewer" && inspection.reviewerId === user.id;
}
