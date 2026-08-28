import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { ReviewJobData } from '../lib/queue';

/**
 * Shape returned by the Python LangGraph service. Each agent contributes a
 * structured block; `summary` is the reviewer-facing synthesis.
 */
interface AiReviewResponse {
  agents: Array<{
    agent: 'PHOTO' | 'FORM' | 'RISK' | 'SUMMARY';
    output: unknown;
    model?: string;
    tokensUsed?: number;
    latencyMs?: number;
  }>;
  summary: { riskScore?: number; flags?: unknown; summaryText?: string };
}

interface PhotoRef {
  id: string;
  url?: string;
  caption?: string;
  section?: string;
}

/**
 * Call the Python LangGraph agent service (hybrid mode). We read the inspection
 * here and ship the data to the stateless AI service — Python never touches the
 * DB. Photo `url`s point at this backend's /api/v1/media proxy (which streams
 * the file from Egnyte) and are fetched by the Photo agent (absent until
 * storage is wired, in which case the Photo agent no-ops).
 */
async function callAiService(inspectionId: string, version: number): Promise<AiReviewResponse> {
  const inspection = await prisma.inspection.findUnique({ where: { id: inspectionId } });
  if (!inspection) throw new Error(`Inspection ${inspectionId} not found`);

  const photos = ((inspection.photos as PhotoRef[] | null) ?? []).map((p) => ({
    id: p.id,
    url: p.url,
    caption: p.caption,
    section: p.section,
  }));

  const res = await fetch(`${env.AI_SERVICE_URL}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inspectionId,
      version,
      inspectionType: inspection.inspectionType,
      propertyType: inspection.propertyType,
      payload: inspection.payload,
      photos,
    }),
  });
  if (!res.ok) {
    throw new Error(`AI service responded ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as AiReviewResponse;
}

/**
 * Skeleton-mode stand-in used until the Python service exists. Lets the queue,
 * status transitions, and persistence be exercised end-to-end without any AI.
 */
function simulateReview(): AiReviewResponse {
  return {
    agents: [
      { agent: 'FORM', output: { valid: true, missingFields: [] }, model: 'simulated' },
      { agent: 'PHOTO', output: { photos: 0, defects: [] }, model: 'simulated' },
      { agent: 'RISK', output: { score: 0, risks: [] }, model: 'simulated' },
      { agent: 'SUMMARY', output: { text: 'Simulated review — AI service not configured.' }, model: 'simulated' },
    ],
    summary: { riskScore: 0, flags: [], summaryText: 'Simulated review — AI service not configured.' },
  };
}

/** Persist agent results + the review summary in one transaction. */
async function persistResults(
  reviewJobId: string,
  inspectionId: string,
  result: AiReviewResponse,
) {
  await prisma.$transaction([
    ...result.agents.map((a) =>
      prisma.agentResult.upsert({
        where: { reviewJobId_agent: { reviewJobId, agent: a.agent } },
        create: {
          reviewJobId,
          agent: a.agent,
          output: a.output as Prisma.InputJsonValue,
          model: a.model,
          tokensUsed: a.tokensUsed,
          latencyMs: a.latencyMs,
        },
        update: {
          output: a.output as Prisma.InputJsonValue,
          model: a.model,
          tokensUsed: a.tokensUsed,
          latencyMs: a.latencyMs,
        },
      }),
    ),
    prisma.reviewSummary.upsert({
      where: { inspectionId },
      create: {
        inspectionId,
        riskScore: result.summary.riskScore,
        flags: (result.summary.flags ?? []) as Prisma.InputJsonValue,
        summaryText: result.summary.summaryText,
      },
      update: {
        riskScore: result.summary.riskScore,
        flags: (result.summary.flags ?? []) as Prisma.InputJsonValue,
        summaryText: result.summary.summaryText,
      },
    }),
  ]);
}

/**
 * BullMQ processor for one review job: PROCESSING → run agents → persist → DONE.
 * Throwing marks the job FAILED and lets BullMQ retry with backoff.
 */
export async function processReview(job: Job<ReviewJobData>): Promise<void> {
  const { reviewJobId, inspectionId, version } = job.data;

  await prisma.reviewJob.update({
    where: { id: reviewJobId },
    data: { status: 'PROCESSING', startedAt: new Date(), attempts: { increment: 1 } },
  });

  try {
    const result = env.AI_SERVICE_URL
      ? await callAiService(inspectionId, version)
      : simulateReview();

    await persistResults(reviewJobId, inspectionId, result);

    await prisma.reviewJob.update({
      where: { id: reviewJobId },
      data: { status: 'DONE', error: null, finishedAt: new Date() },
    });
  } catch (err) {
    await prisma.reviewJob.update({
      where: { id: reviewJobId },
      data: { status: 'FAILED', error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
