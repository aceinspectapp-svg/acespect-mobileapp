// Maps DB rows to the exact shapes the acespect-web frontend expects
// (camelCase fields, lowercase-hyphen enum strings from mockData.ts).
import type { Damage, Inspection, Section, User } from '@prisma/client';

export const INS_STATUS_TO_WEB = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  IN_REVIEW: 'in-review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;
export const WEB_TO_INS_STATUS = {
  draft: 'DRAFT',
  submitted: 'SUBMITTED',
  'in-review': 'IN_REVIEW',
  approved: 'APPROVED',
  rejected: 'REJECTED',
} as const;

const SEC_STATUS_TO_WEB = { COMPLETE: 'complete', PARTIAL: 'partial', PENDING: 'pending' } as const;

export const REV_STATUS_TO_WEB = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REVISION_REQUESTED: 'revision-requested',
} as const;
export const WEB_TO_REV_STATUS = {
  pending: 'PENDING',
  approved: 'APPROVED',
  'revision-requested': 'REVISION_REQUESTED',
} as const;

const ROLE_TO_WEB = {
  ADMIN: 'admin',
  REVIEWER: 'reviewer',
  INSPECTOR: 'inspector',
  CLIENT: 'inspector',
} as const;

function initials(name: string | null): string {
  if (!name) return '??';
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

export function serializeUser(u: User) {
  return {
    id: u.id,
    name: u.name ?? u.email,
    email: u.email,
    role: ROLE_TO_WEB[u.role],
    avatar: u.avatar ?? initials(u.name),
    phone: u.phone ?? undefined,
    region: u.region ?? undefined,
  };
}

function serializeDamage(d: Damage) {
  return {
    id: d.id,
    type: d.type,
    location: d.location,
    direction: d.direction,
    widthMm: d.widthMm,
    lengthMm: d.lengthMm,
    notes: d.notes,
    photos: d.photos ?? [],
  };
}

export function serializeSection(s: Section & { damages: Damage[] }) {
  return {
    id: s.id,
    key: s.key, // stable slug ("driveway", "job-info", …) — used by the web to group sections
    name: s.name,
    icon: s.icon,
    status: SEC_STATUS_TO_WEB[s.status],
    reviewStatus: REV_STATUS_TO_WEB[s.reviewStatus],
    reviewComment: s.reviewComment,
    reportText: s.reportText,
    fields: s.fields ?? {},
    // Raw answer tree — what the inspector dashboard reopens for editing.
    answers: s.answers ?? null,
    damages: s.damages.map(serializeDamage),
    photos: s.photos ?? [],
  };
}

type InspectionWithSections = Inspection & { sections: (Section & { damages: Damage[] })[] };

export function serializeInspection(i: InspectionWithSections, withSections = true) {
  return {
    id: i.id,
    jobNo: i.jobNo ?? '',
    address: i.address ?? '',
    suburb: i.suburb ?? '',
    client: i.client ?? '',
    inspectorId: i.inspectorId,
    reviewerId: i.reviewerId,
    date: i.date.toISOString().slice(0, 10),
    submittedAt: i.submittedAt ? i.submittedAt.toISOString() : null,
    type: i.inspectionType,
    propertyType: i.propertyType,
    status: INS_STATUS_TO_WEB[i.status],
    overallProgress: i.overallProgress,
    notes: i.notes,
    sections: withSections ? i.sections.map(serializeSection) : [],
  };
}
