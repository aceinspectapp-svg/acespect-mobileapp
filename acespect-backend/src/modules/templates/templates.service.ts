import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { CreateTemplateInput, UpdateTemplateInput } from './templates.schemas';
import { TEMPLATABLE_SECTION_KEYS } from './templates.sections';

interface Lineage {
  inspectionType: string;
  propertyType: string;
  sectionKey: string;
}

/** The current published template for a profile+section, regardless of who's asking. */
async function getLatestPublished({ inspectionType, propertyType, sectionKey }: Lineage) {
  const row = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType, propertyType, sectionKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!row) {
    throw ApiError.notFound(`No published template for ${inspectionType}/${propertyType}/${sectionKey}`);
  }
  return row;
}

/**
 * Mobile/web-facing: the template THIS inspector is currently on for new
 * inspections in this lineage -- not necessarily the latest published one.
 * Publishing never moves an inspector off their accepted version; they only
 * move forward by calling `acceptProfileUpdates`. First-ever fetch for a
 * lineage auto-accepts whatever's published at the time (nothing to keep
 * them pinned away from).
 */
async function getActiveForInspector(inspectorId: string, lineage: Lineage) {
  const existing = await prisma.templateAcceptance.findUnique({
    where: {
      inspectorId_inspectionType_propertyType_sectionKey: {
        inspectorId,
        inspectionType: lineage.inspectionType,
        propertyType: lineage.propertyType,
        sectionKey: lineage.sectionKey,
      },
    },
    include: { acceptedTemplate: true },
  });
  if (existing) return existing.acceptedTemplate;

  const latest = await getLatestPublished(lineage);
  await prisma.templateAcceptance.create({
    data: {
      inspectorId,
      inspectionType: lineage.inspectionType,
      propertyType: lineage.propertyType,
      sectionKey: lineage.sectionKey,
      acceptedTemplateId: latest.id,
    },
  });
  return latest;
}

interface ProfileKey {
  inspectionType: string;
  propertyType: string;
}

function profileKeyOf(p: ProfileKey): string {
  return `${p.inspectionType}:${p.propertyType}`;
}

/** Inspector-facing: profiles where a newer published version exists beyond what they're accepted on. */
async function listPendingUpdates(inspectorId: string) {
  const acceptances = await prisma.templateAcceptance.findMany({
    where: { inspectorId },
    include: { acceptedTemplate: true },
  });

  const byProfile = new Map<
    string,
    { inspectionType: string; propertyType: string; pendingSections: { sectionKey: string; currentVersion: number; newVersion: number }[] }
  >();
  const toNotify: string[] = [];

  for (const acc of acceptances) {
    const latest = await prisma.inspectionTemplate.findFirst({
      where: { inspectionType: acc.inspectionType, propertyType: acc.propertyType, sectionKey: acc.sectionKey, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
    if (!latest || latest.id === acc.acceptedTemplateId) continue;

    const key = profileKeyOf(acc);
    if (!byProfile.has(key)) {
      byProfile.set(key, { inspectionType: acc.inspectionType, propertyType: acc.propertyType, pendingSections: [] });
    }
    byProfile.get(key)!.pendingSections.push({
      sectionKey: acc.sectionKey,
      currentVersion: acc.acceptedTemplate.version,
      newVersion: latest.version,
    });
    if (!acc.notifiedAt) toNotify.push(acc.id);
  }

  if (toNotify.length > 0) {
    await prisma.templateAcceptance.updateMany({
      where: { id: { in: toNotify } },
      data: { notifiedAt: new Date() },
    });
  }

  return [...byProfile.values()];
}

/** Inspector accepts every pending update in one profile at once. */
async function acceptProfileUpdates(inspectorId: string, { inspectionType, propertyType }: ProfileKey) {
  for (const sectionKey of TEMPLATABLE_SECTION_KEYS) {
    const latest = await prisma.inspectionTemplate.findFirst({
      where: { inspectionType, propertyType, sectionKey, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
    });
    if (!latest) continue; // nothing published yet for this section -- nothing to accept
    await prisma.templateAcceptance.upsert({
      where: {
        inspectorId_inspectionType_propertyType_sectionKey: { inspectorId, inspectionType, propertyType, sectionKey },
      },
      update: { acceptedTemplateId: latest.id, acceptedAt: new Date() },
      create: { inspectorId, inspectionType, propertyType, sectionKey, acceptedTemplateId: latest.id },
    });
  }
  return prisma.templateAcceptance.findMany({
    where: { inspectorId, inspectionType, propertyType },
    include: { acceptedTemplate: true },
  });
}

/** Admin-facing: per-inspector adoption status for one profile, across all its sections. */
async function getAdoption({ inspectionType, propertyType }: ProfileKey) {
  const inspectors = await prisma.user.findMany({
    where: { role: 'INSPECTOR', isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });

  const latestBySection = new Map<string, { id: string; version: number } | null>();
  for (const sectionKey of TEMPLATABLE_SECTION_KEYS) {
    const latest = await prisma.inspectionTemplate.findFirst({
      where: { inspectionType, propertyType, sectionKey, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    latestBySection.set(sectionKey, latest);
  }

  const acceptances = await prisma.templateAcceptance.findMany({
    where: { inspectionType, propertyType, inspectorId: { in: inspectors.map((i) => i.id) } },
    include: { acceptedTemplate: { select: { id: true, version: true } } },
  });
  const byInspector = new Map<string, typeof acceptances>();
  for (const acc of acceptances) {
    const list = byInspector.get(acc.inspectorId) ?? [];
    list.push(acc);
    byInspector.set(acc.inspectorId, list);
  }

  return inspectors.map((inspector) => {
    const mine = byInspector.get(inspector.id) ?? [];
    const sections = TEMPLATABLE_SECTION_KEYS.map((sectionKey) => {
      const latest = latestBySection.get(sectionKey) ?? null;
      const acc = mine.find((a) => a.sectionKey === sectionKey);
      return {
        sectionKey,
        currentVersion: acc?.acceptedTemplate.version ?? null,
        latestVersion: latest?.version ?? null,
        upToDate: !!acc && !!latest && acc.acceptedTemplate.id === latest.id,
        notifiedAt: acc?.notifiedAt ?? null,
        acceptedAt: acc?.acceptedAt ?? null,
      };
    });

    const touched = sections.filter((s) => s.currentVersion !== null);
    const status: 'NOT_STARTED' | 'UP_TO_DATE' | 'UPDATE_AVAILABLE' =
      touched.length === 0 ? 'NOT_STARTED' : touched.every((s) => s.upToDate) ? 'UP_TO_DATE' : 'UPDATE_AVAILABLE';
    const notifiedAt = mine.reduce<Date | null>((max, a) => (a.notifiedAt && (!max || a.notifiedAt > max) ? a.notifiedAt : max), null);
    const acceptedAt = mine.reduce<Date | null>((max, a) => (!max || a.acceptedAt > max ? a.acceptedAt : max), null);

    return {
      inspectorId: inspector.id,
      name: inspector.name,
      email: inspector.email,
      status,
      notifiedAt,
      acceptedAt,
      sections,
    };
  });
}

/** Admin: all versions for one lineage, newest first. */
async function list({ inspectionType, propertyType, sectionKey }: Lineage) {
  return prisma.inspectionTemplate.findMany({
    where: { inspectionType, propertyType, sectionKey },
    orderBy: { version: 'desc' },
  });
}

/**
 * Admin: one row per templatable section for a profile, so the section-list
 * page can render its whole board with a single request instead of one
 * round trip per section.
 */
async function summary(inspectionType: string, propertyType: string, sectionKeys: string[]) {
  const rows = await prisma.inspectionTemplate.findMany({
    where: { inspectionType, propertyType, sectionKey: { in: sectionKeys } },
    orderBy: { version: 'desc' },
    select: { id: true, sectionKey: true, version: true, status: true, publishedAt: true },
  });
  return sectionKeys.map((sectionKey) => {
    const forSection = rows.filter((r) => r.sectionKey === sectionKey);
    const published = forSection.find((r) => r.status === 'PUBLISHED');
    const draft = forSection.find((r) => r.status === 'DRAFT');
    return {
      sectionKey,
      publishedVersion: published?.version ?? null,
      publishedAt: published?.publishedAt ?? null,
      hasDraft: !!draft,
      draftId: draft?.id ?? null,
    };
  });
}

async function getById(id: string) {
  const row = await prisma.inspectionTemplate.findUnique({ where: { id } });
  if (!row) throw ApiError.notFound('Template not found');
  return row;
}

/** Admin: start a new draft. If a version already exists for this lineage, increments it. */
async function create(createdById: string, input: CreateTemplateInput) {
  const latest = await prisma.inspectionTemplate.findFirst({
    where: {
      inspectionType: input.inspectionType,
      propertyType: input.propertyType,
      sectionKey: input.sectionKey,
    },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return prisma.inspectionTemplate.create({
    data: {
      inspectionType: input.inspectionType,
      propertyType: input.propertyType,
      sectionKey: input.sectionKey,
      name: input.name,
      version: (latest?.version ?? 0) + 1,
      status: 'DRAFT',
      fields: input.fields as unknown as Prisma.InputJsonValue,
      createdById,
    },
  });
}

/** Admin: edit a draft's name/fields. Only DRAFT templates are mutable. */
async function update(id: string, input: UpdateTemplateInput) {
  const existing = await getById(id);
  if (existing.status !== 'DRAFT') {
    throw ApiError.badRequest('Only a draft template can be edited — publish creates a new version instead');
  }
  return prisma.inspectionTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.fields !== undefined ? { fields: input.fields as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}

/**
 * Admin: publish a draft. Archives whatever was previously published for the
 * same (inspectionType, propertyType, sectionKey) lineage (never mutates it)
 * so inspections already mid-draft keep rendering the version they started
 * with.
 */
async function publish(id: string) {
  const existing = await getById(id);
  if (existing.status !== 'DRAFT') {
    throw ApiError.badRequest('Only a draft template can be published');
  }
  const [, published] = await prisma.$transaction([
    prisma.inspectionTemplate.updateMany({
      where: {
        inspectionType: existing.inspectionType,
        propertyType: existing.propertyType,
        sectionKey: existing.sectionKey,
        status: 'PUBLISHED',
      },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    }),
  ]);
  return published;
}

export const templatesService = {
  getActiveForInspector,
  list,
  summary,
  getById,
  create,
  update,
  publish,
  listPendingUpdates,
  acceptProfileUpdates,
  getAdoption,
};
