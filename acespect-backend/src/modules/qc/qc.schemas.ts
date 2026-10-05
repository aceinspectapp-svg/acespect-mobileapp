import { z } from 'zod';

// Spec-driven entities (clients, projects, lots, people, defect forms...) are
// validated by spec/qcSpec.ts, not here. Only the few hand-rolled shapes stay.

export const createPropertyTypeSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  icon: z.string().min(1).max(60).optional(),
  order: z.number().int().optional(),
});
export const updatePropertyTypeSchema = createPropertyTypeSchema.partial();

// ─── Tasks ──────────────────────────────────────────────────────────────────

const TASK_PRIORITY = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type QcTaskPriorityValue = (typeof TASK_PRIORITY)[number];

/** Severity tier -> task priority. The legacy moderate/observation keys stay mapped for retired rows. */
export const SEVERITY_KEY_TO_PRIORITY: Record<string, QcTaskPriorityValue> = {
  safety_hazard: 'HIGH',
  major: 'HIGH',
  minor: 'MEDIUM',
  monitor: 'LOW',
  moderate: 'MEDIUM',
  observation: 'LOW',
};

export const postTaskUpdateSchema = z.object({
  comment: z.string().max(4000).default(''),
  markCompleted: z.coerce.boolean().default(false),
});

/** Direct, free change of a task's progress flag -- separate from the defect lifecycle. */
export const updateTaskStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
});

export type CreatePropertyTypeInput = z.infer<typeof createPropertyTypeSchema>;
export type PostTaskUpdateInput = z.infer<typeof postTaskUpdateSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
