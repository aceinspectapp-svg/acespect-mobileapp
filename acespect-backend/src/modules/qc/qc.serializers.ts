/**
 * Flattens the nested Prisma `include` shapes into the field names the mobile
 * app's `QcDefect`/`QcTask` types use (client/project/property as plain
 * objects, severity/status as key+label+color). New spec fields are added
 * alongside the originals so older mobile builds keep working.
 */

import { signMediaUrl } from '../../lib/mediaLinks';

/** Every photo link leaves the API signed (expiring); links to files that are not protected simply ignore the signature. */
export const signUrls = (urls: unknown): string[] => (Array.isArray(urls) ? urls.map((u) => signMediaUrl(String(u))) : []);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeDefect(defect: any, extras?: { allowedActions?: unknown }) {
  const project = defect.property.project;
  return {
    id: defect.id,
    defectRef: defect.defectRef,
    title: defect.title,
    location: defect.location,
    locationDetails: defect.locationDetails,
    summary: defect.summary,
    roomArea: defect.roomArea,
    element: defect.element,
    nature: defect.nature,
    codeRef: defect.codeRef,
    isDraft: defect.isDraft,
    flags: defect.flags ?? [],
    escalationLevel: defect.escalationLevel,
    reworkCount: defect.reworkCount,
    photoUrls: signUrls(defect.photoUrls),
    dueDate: defect.dueDate,
    targetRectificationDate: defect.targetRectificationDate,
    scheduledAttendanceDate: defect.scheduledAttendanceDate,
    holdReason: defect.holdReason,
    holdReviewDate: defect.holdReviewDate,
    withdrawnReason: defect.withdrawnReason,
    exceptionReason: defect.exceptionReason,
    disputeBy: defect.disputeBy,
    closedAt: defect.closedAt,
    dlpDefect: defect.dlpDefect ?? false,
    foundAtStage: defect.foundAtStage ?? null,
    sourceInspectionId: defect.sourceInspectionId ?? null,
    sourceItemNumber: defect.sourceItemNumber ?? null,
    ackDueAt: defect.ackDueAt ?? null,
    rectifyDueAt: defect.rectifyDueAt ?? null,
    reinspectDueAt: defect.reinspectDueAt ?? null,
    acknowledgedAt: defect.acknowledgedAt ?? null,
    rectifiedAt: defect.rectifiedAt ?? null,
    verifiedAt: defect.verifiedAt ?? null,
    releasedAt: defect.releasedAt ?? null,
    createdAt: defect.createdAt,
    updatedAt: defect.updatedAt,
    property: {
      id: defect.property.id,
      name: defect.property.name,
      propertyType: {
        id: defect.property.propertyType.id,
        key: defect.property.propertyType.key,
        label: defect.property.propertyType.label,
        icon: defect.property.propertyType.icon,
      },
    },
    site: defect.property.site ? { id: defect.property.site.id, name: defect.property.site.name } : null,
    project: {
      id: project.id,
      name: project.name,
      jobNumber: project.jobNumber,
      closurePolicy: project.closurePolicy,
      deskReviewAllowed: project.deskReviewAllowed,
    },
    client: { id: project.client.id, name: project.client.name },
    builder: project.builder ? { id: project.builder.id, name: project.builder.name } : null,
    tradeCategory: defect.tradeCategory ?? null,
    severity: defect.severity
      ? { id: defect.severity.id, key: defect.severity.key, label: defect.severity.label, color: defect.severity.color }
      : null,
    status: {
      id: defect.status.id,
      key: defect.status.key,
      label: defect.status.label,
      color: defect.status.color,
      meaning: defect.status.meaning,
    },
    assignedTo: defect.assignedTo,
    createdBy: defect.createdBy,
    builderContact: defect.builderContact ?? null,
    allocatedTradeCompany: defect.allocatedTradeCompany ?? null,
    allocatedTradeUser: defect.allocatedTradeUser ?? null,
    closedBy: defect.closedBy ?? null,
    ...(extras?.allowedActions !== undefined ? { allowedActions: extras.allowedActions } : {}),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeTask(task: any, allowedActions?: unknown) {
  return {
    id: task.id,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    assignedTo: task.assignedTo,
    defect: serializeDefect(task.defect, allowedActions !== undefined ? { allowedActions } : undefined),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updates: task.updates?.map((u: any) => ({
      id: u.id,
      author: u.author,
      comment: u.comment,
      photoUrls: signUrls(u.photoUrls),
      statusAfter: u.statusAfter,
      statusChanged: u.statusChanged,
      createdAt: u.createdAt,
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeEvent(e: any, statusById: Map<string, { key: string; label: string }>) {
  return {
    id: e.id,
    type: e.type,
    from: e.fromStatusId ? statusById.get(e.fromStatusId) ?? null : null,
    to: e.toStatusId ? statusById.get(e.toStatusId) ?? null : null,
    actor: e.actor,
    actorRole: e.actorRole,
    onBehalf: e.onBehalf,
    note: e.note,
    changes: e.changes,
    attachments: signUrls(e.attachments),
    reworkCount: e.reworkCount,
    hash: e.hash,
    createdAt: e.createdAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeComment(c: any) {
  return { ...c, attachments: signUrls(c.attachments) };
}
