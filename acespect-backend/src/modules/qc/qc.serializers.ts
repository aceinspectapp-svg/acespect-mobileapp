/**
 * Flattens the nested Prisma `include` shapes into the same field names the
 * mobile prototype's `Defect`/`QcTask` types already use (client/project/
 * property as plain strings alongside their ids, severity/status as
 * key+label+color) — so wiring the real API into the mobile app in Phase 3
 * is a data-source swap, not a shape rewrite.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeDefect(defect: any) {
  return {
    id: defect.id,
    location: defect.location,
    locationDetails: defect.locationDetails,
    summary: defect.summary,
    dueDate: defect.dueDate,
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
    project: { id: defect.property.project.id, name: defect.property.project.name },
    client: { id: defect.property.project.client.id, name: defect.property.project.client.name },
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
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function serializeTask(task: any) {
  return {
    id: task.id,
    priority: task.priority,
    status: task.status,
    dueDate: task.dueDate,
    createdAt: task.createdAt,
    assignedTo: task.assignedTo,
    defect: serializeDefect(task.defect),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updates: task.updates?.map((u: any) => ({
      id: u.id,
      author: u.author,
      comment: u.comment,
      photoUrls: u.photoUrls,
      statusAfter: u.statusAfter,
      statusChanged: u.statusChanged,
      createdAt: u.createdAt,
    })),
  };
}
