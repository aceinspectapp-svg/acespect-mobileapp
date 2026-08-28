import { InspectionTemplate } from '@prisma/client';

const STATUS_TO_WEB = { DRAFT: 'draft', PUBLISHED: 'published', ARCHIVED: 'archived' } as const;

/** Matches the lowercase-enum convention used by web.serializers.ts. */
export function serializeTemplate(t: InspectionTemplate) {
  return {
    id: t.id,
    inspectionType: t.inspectionType,
    propertyType: t.propertyType,
    sectionKey: t.sectionKey,
    name: t.name,
    version: t.version,
    status: STATUS_TO_WEB[t.status],
    fields: t.fields,
    layout: t.layout,
    createdById: t.createdById,
    publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
