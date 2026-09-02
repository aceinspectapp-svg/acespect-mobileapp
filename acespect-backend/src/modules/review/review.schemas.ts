import { z } from 'zod';

/** A reviewer's verdict on an AI summary. EDITED may also revise the text. */
export const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'EDITED']),
  notes: z.string().trim().max(2000).optional(),
  summaryText: z.string().trim().max(5000).optional(),
});

export type DecisionInput = z.infer<typeof decisionSchema>;

/** Admin pushing a submitted inspection to an inspector as a Post-Dilapidation baseline. */
export const createPostDilapidationSchema = z.object({
  inspectorId: z.string().uuid(),
});

export type CreatePostDilapidationInput = z.infer<typeof createPostDilapidationSchema>;
