import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { DecisionInput } from './review.schemas';
import { Actor, canEdit, canViewDetail } from '../web/assignment.rules';

/**
 * Admin "pushes" a submitted inspection to an inspector as the baseline for a
 * new Post-Dilapidation job: creates an empty placeholder Inspection (no
 * sections yet) carrying the baseline link + the original job's metadata as
 * a head start. It shows up in that inspector's mobile "Assigned Jobs" list
 * (GET /inspections/assigned) until they pick it up and submit, at which
 * point `inspectionsService.submit`'s `assignmentId` path fills this same
 * row in rather than creating a second one.
 */
async function createPostDilapidation(baselineId: string, inspectorId: string, actor: Actor) {
  const baseline = await prisma.inspection.findUnique({ where: { id: baselineId } });
  if (!baseline) throw ApiError.notFound('Inspection not found');
  if (!canEdit(actor, baseline)) throw new ApiError(403, 'Only the reviewer this inspection is assigned to (or an admin) can do this', 'NOT_ASSIGNEE');
  if (!baseline.submittedAt) throw ApiError.badRequest('Only a submitted inspection can be used as a baseline');

  const inspector = await prisma.user.findUnique({ where: { id: inspectorId } });
  if (!inspector) throw ApiError.notFound('Inspector not found');

  const assignment = await prisma.inspection.create({
    data: {
      inspectorId,
      baselineInspectionId: baseline.id,
      inspectionType: baseline.inspectionType,
      propertyType: baseline.propertyType,
      jobNo: baseline.jobNo,
      address: baseline.address,
      suburb: baseline.suburb,
      client: baseline.client,
      status: 'DRAFT',
    },
  });
  return assignment;
}

/** Review job + its per-agent results — what the dashboard polls for status. */
async function getJob(id: string) {
  const job = await prisma.reviewJob.findUnique({
    where: { id },
    include: { results: true },
  });
  if (!job) throw ApiError.notFound('Review job not found');
  return job;
}

/** Inspector picker for the "push as Post-Dilapidation baseline" dashboard action. */
async function listInspectors() {
  return prisma.user.findMany({
    where: { role: 'INSPECTOR' },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}

/** Reviewer dashboard list: every inspection with its latest job status + summary. */
async function listInspections(actor: Actor) {
  const inspections = await prisma.inspection.findMany({
    orderBy: { submittedAt: 'desc' },
    include: {
      inspector: { select: { name: true, email: true } },
      reviewSummary: { select: { id: true, riskScore: true, status: true } },
      reviewJobs: { orderBy: { queuedAt: 'desc' }, take: 1, select: { status: true } },
    },
  });
  // Reviewers see their own and unassigned ones here; another reviewer's are withheld.
  return inspections.filter((i) => canViewDetail(actor, i)).map((i) => ({
    id: i.id,
    inspectionType: i.inspectionType,
    propertyType: i.propertyType,
    submittedAt: i.submittedAt,
    inspector: i.inspector,
    jobStatus: i.reviewJobs[0]?.status ?? null,
    summary: i.reviewSummary,
  }));
}

/** Full review detail for one inspection: agent findings, summary, decisions. */
async function getInspectionDetail(id: string, actor: Actor) {
  const inspection = await prisma.inspection.findUnique({
    where: { id },
    include: {
      inspector: { select: { name: true, email: true } },
      reviewSummary: {
        include: {
          decisions: {
            orderBy: { decidedAt: 'desc' },
            include: { reviewer: { select: { name: true, email: true } } },
          },
        },
      },
      reviewJobs: { orderBy: { queuedAt: 'desc' }, take: 1, include: { results: true } },
    },
  });
  if (!inspection) throw ApiError.notFound('Inspection not found');
  if (!canViewDetail(actor, inspection)) throw new ApiError(403, 'This inspection is assigned to another reviewer', 'ASSIGNED_TO_OTHER');
  return inspection;
}

/** Record a human reviewer's decision on a summary (the audit trail) and flip
 *  the summary's status. AI output stays advisory — this is the final word. */
async function recordDecision(summaryId: string, actor: Actor, input: DecisionInput) {
  const reviewerId = actor.id;
  const summary = await prisma.reviewSummary.findUnique({ where: { id: summaryId }, include: { inspection: { select: { reviewerId: true, status: true } } } });
  if (!summary) throw ApiError.notFound('Review summary not found');
  if (!canEdit(actor, summary.inspection)) throw new ApiError(403, 'Only the reviewer this inspection is assigned to (or an admin) can decide on it', 'NOT_ASSIGNEE');

  const [, decision] = await prisma.$transaction([
    prisma.reviewSummary.update({
      where: { id: summaryId },
      data: {
        status: input.decision,
        ...(input.summaryText ? { summaryText: input.summaryText } : {}),
      },
    }),
    prisma.reviewDecision.create({
      data: {
        reviewSummaryId: summaryId,
        reviewerId,
        decision: input.decision,
        notes: input.notes,
      },
      include: { reviewer: { select: { name: true, email: true } } },
    }),
  ]);
  return decision;
}

export const reviewService = { getJob, listInspections, getInspectionDetail, recordDecision, createPostDilapidation, listInspectors };
