import { z } from 'zod';

// ─── Admin config CRUD ──────────────────────────────────────────────────────

export const createClientSchema = z.object({
  name: z.string().min(1).max(200),
});
export const updateClientSchema = createClientSchema.partial();

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  clientId: z.string().uuid(),
});
export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

export const createPropertySchema = z.object({
  name: z.string().min(1).max(200),
  projectId: z.string().uuid(),
  propertyTypeId: z.string().uuid(),
});
export const updatePropertySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  propertyTypeId: z.string().uuid().optional(),
});

export const createPropertyTypeSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  icon: z.string().min(1).max(60).optional(),
  order: z.number().int().optional(),
});
export const updatePropertyTypeSchema = createPropertyTypeSchema.partial();

export const createSeveritySchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  color: z.string().min(1).max(20),
  order: z.number().int().optional(),
});
export const updateSeveritySchema = createSeveritySchema.partial();

export const createStatusSchema = z.object({
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  color: z.string().min(1).max(20),
  meaning: z.string().max(500).optional(),
  order: z.number().int().optional(),
});
export const updateStatusSchema = createStatusSchema.partial();

export const createFieldUserSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

// ─── Defects / tasks ────────────────────────────────────────────────────────

const TASK_PRIORITY = ['HIGH', 'MEDIUM', 'LOW'] as const;
const TASK_STATUS = ['PENDING', 'IN_PROGRESS', 'COMPLETED'] as const;
export type QcTaskPriorityValue = (typeof TASK_PRIORITY)[number];
export type QcTaskStatusValue = (typeof TASK_STATUS)[number];

/** Major/Moderate/Minor severity → task priority, same mapping as the mobile prototype's severityToPriority. */
export const SEVERITY_KEY_TO_PRIORITY: Record<string, QcTaskPriorityValue> = {
  major: 'HIGH',
  moderate: 'MEDIUM',
  minor: 'LOW',
  observation: 'LOW',
};

// Admin creates with just property + assignee -- location/summary/severity
// are filled in later by the assigned field user from mobile (see
// updateDefectSchema, now reachable by them too, not just admin).
export const createDefectSchema = z.object({
  propertyId: z.string().uuid(),
  assignedToId: z.string().uuid(),
  location: z.string().min(1).max(200).optional(),
  locationDetails: z.string().max(1000).optional(),
  summary: z.string().min(1).max(2000).optional(),
  severityId: z.string().uuid().optional(),
  dueDate: z.string().datetime().optional(),
});

export const updateDefectSchema = z.object({
  location: z.string().min(1).max(200).optional(),
  locationDetails: z.string().max(1000).optional(),
  summary: z.string().min(1).max(2000).optional(),
  severityId: z.string().uuid().optional(),
  statusId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  dueDate: z.string().datetime().nullable().optional(),
});

export const reassignTaskSchema = z.object({
  assignedToId: z.string().uuid(),
});

export const postTaskUpdateSchema = z.object({
  comment: z.string().max(4000).default(''),
  markCompleted: z.coerce.boolean().default(false),
});

/** Direct, free status change for a task -- separate from postTaskUpdate's automatic PENDING->IN_PROGRESS/COMPLETED bump. */
export const updateTaskStatusSchema = z.object({
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED']),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type CreatePropertyTypeInput = z.infer<typeof createPropertyTypeSchema>;
export type CreateSeverityInput = z.infer<typeof createSeveritySchema>;
export type CreateStatusInput = z.infer<typeof createStatusSchema>;
export type CreateFieldUserInput = z.infer<typeof createFieldUserSchema>;
export type CreateDefectInput = z.infer<typeof createDefectSchema>;
export type UpdateDefectInput = z.infer<typeof updateDefectSchema>;
export type PostTaskUpdateInput = z.infer<typeof postTaskUpdateSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
