// Maps DB rows to the exact shapes the acespect-web frontend expects
// (camelCase fields, lowercase-hyphen enum strings from mockData.ts).
import { inspectionFolderUrl } from '../../lib/storage';
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
  // QC-only field worker -- doesn't participate in this Houspect review
  // flow at all, but needs a value here to keep this map exhaustive.
  FIELD_USER: 'inspector',
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
    // Inspector's license/registration number (e.g. DBU license) -- shown
    // alongside their name in the reviewer pane and used as the report
    // cover's fallback when the inspection itself doesn't override it.
    licenseNumber: u.licenseNumber ?? undefined,
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
    excludedPhotoUrls: d.excludedPhotoUrls ?? [],
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
    excludedPhotoUrls: s.excludedPhotoUrls ?? [],
  };
}

/**
 * What a list needs to know about a section (name, completion, review state) and nothing else. The answers, photos and damage records can
 * be very large (hundreds of photo links), and a list of every inspection with all of that was tens of megabytes. Same shape as a full
 * section, with the heavy parts empty; `detail: false` on the inspection tells the web app to fetch the real thing when one is opened.
 */
type SectionSummaryRow = Pick<Section, 'id' | 'key' | 'name' | 'icon' | 'status' | 'reviewStatus' | 'reviewComment' | 'updatedAt'>;
export function serializeSectionSummary(s: SectionSummaryRow) {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    icon: s.icon,
    status: SEC_STATUS_TO_WEB[s.status],
    reviewStatus: REV_STATUS_TO_WEB[s.reviewStatus],
    reviewComment: s.reviewComment,
    reportText: '',
    fields: {},
    answers: null,
    damages: [],
    photos: [],
    excludedPhotoUrls: [],
  };
}

type InspectionWithSections = Inspection & { sections: (Section & { damages: Damage[] })[] };
type InspectionWithSectionSummaries = Inspection & { sections: SectionSummaryRow[] };

/** The latest change to an inspection or any of its sections, so a client can ask for "what changed since I last looked". */
function lastChange(i: Inspection, sections: { updatedAt: Date }[]): string {
  let t = i.updatedAt.getTime();
  for (const s of sections) if (s.updatedAt.getTime() > t) t = s.updatedAt.getTime();
  return new Date(t).toISOString();
}

export function serializeInspectionSummary(i: InspectionWithSectionSummaries) {
  return {
    ...serializeInspection({ ...i, sections: [] } as unknown as InspectionWithSections, false),
    sections: i.sections.map(serializeSectionSummary),
    detail: false,
    updatedAt: lastChange(i, i.sections),
  };
}

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
    // Where this job's photos are saved (Egnyte folder named by job number) -- the report's "Click here" link.
    photoArchiveUrl: inspectionFolderUrl(i.jobNo, i.id, i.egnytePath),
    // Where the photos were placed in Egnyte and whether the office needs to look at it (null before any placement).
    egnyte: i.egnyteStatus
      ? { status: i.egnyteStatus, path: i.egnytePath ?? null, message: i.egnyteMessage ?? null, checkedAt: i.egnyteCheckedAt ? i.egnyteCheckedAt.toISOString() : null }
      : null,
    sections: withSections ? i.sections.map(serializeSection) : [],
    // True when the sections above are complete (see serializeInspectionSummary for the list form).
    detail: withSections,
    updatedAt: lastChange(i, withSections ? i.sections : []),
  };
}
